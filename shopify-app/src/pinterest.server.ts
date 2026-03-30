/**
 * PR-040: Pinterest API direct publishing
 *
 * Provides:
 *  - OAuth 2.0 flow for Pinterest business accounts
 *  - Create pins directly from generated images with board selection and product metadata
 *  - Schedule pins via Cloudflare Cron (stored in D1, processed on cron tick)
 *
 * Security notes:
 *  - pinterest_access_token NEVER appears in log payloads (logger.ts types enforce this)
 *  - State nonces stored in KV with 15-minute TTL (replay protection)
 *  - All token exchanges happen server-side only
 *  - PKCE (code_verifier / code_challenge) used for enhanced security
 */

import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Environment bindings required by Pinterest features
// ---------------------------------------------------------------------------

export interface PinterestEnv {
  /** Pinterest App ID (OAuth client_id) */
  PINTEREST_APP_ID: string;
  /** Pinterest App Secret — NEVER log */
  PINTEREST_APP_SECRET: string;
  /** Public URL of this Shopify app (e.g. https://myapp.example.com) */
  SHOPIFY_APP_URL: string;
  DB: D1Database;
  KV_STORE: KVNamespace;
  ASSETS_BUCKET: R2Bucket;
}

// ---------------------------------------------------------------------------
// Pinterest API constants
// ---------------------------------------------------------------------------

const PINTEREST_API_BASE = "https://api.pinterest.com/v5";
const PINTEREST_AUTH_BASE = "https://www.pinterest.com/oauth";

/** Scopes required for reading boards and creating pins */
const PINTEREST_SCOPES = [
  "boards:read",
  "boards:write",
  "pins:read",
  "pins:write",
].join(",");

// ---------------------------------------------------------------------------
// D1 row types
// ---------------------------------------------------------------------------

export interface PinterestConnection {
  shop: string;
  /** Pinterest user ID */
  pinterest_user_id: string;
  /** Pinterest access token — NEVER log */
  access_token: string;
  /** Pinterest refresh token — NEVER log */
  refresh_token: string;
  /** ISO timestamp when access token expires */
  token_expires_at: string;
  /** ISO timestamp of OAuth connection */
  connected_at: string;
}

export interface PinterestBoard {
  id: string;
  name: string;
  description: string | null;
  privacy: "PUBLIC" | "PROTECTED" | "SECRET";
  pin_count: number;
}

export interface ScheduledPin {
  id: string;
  shop: string;
  pinterest_user_id: string;
  board_id: string;
  board_name: string;
  /** R2 key for the generated image */
  r2_image_key: string;
  /** Public URL of image */
  image_url: string;
  title: string;
  description: string;
  /** Product link URL for the pin */
  link: string | null;
  /** Alt text for accessibility */
  alt_text: string | null;
  /** ISO timestamp for when to publish (null = publish immediately) */
  scheduled_at: string | null;
  /** "pending" | "published" | "failed" */
  status: "pending" | "published" | "failed";
  /** Pinterest pin ID after successful publish */
  pin_id: string | null;
  error_message: string | null;
  created_at: string;
  published_at: string | null;
}

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

/**
 * Generates a cryptographically random PKCE code verifier (43–128 chars).
 */
function generateCodeVerifier(): string {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return btoa(String.fromCharCode(...randomBytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Derives a PKCE code challenge (SHA-256 of the verifier, base64url-encoded).
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return btoa(String.fromCharCode(...hashArray))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// ---------------------------------------------------------------------------
// OAuth helpers
// ---------------------------------------------------------------------------

/**
 * Generates the Pinterest OAuth redirect URL for the given shop.
 * Stores state nonce + PKCE verifier in KV to prevent CSRF/replay attacks.
 */
export async function getPinterestOAuthUrl(
  shop: string,
  env: PinterestEnv
): Promise<string> {
  // Generate a cryptographically random state nonce
  const rawBytes = new Uint8Array(16);
  crypto.getRandomValues(rawBytes);
  const nonce = Array.from(rawBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Generate PKCE code verifier + challenge
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Store nonce + verifier in KV with 15-minute TTL
  const kvKey = `pinterest:oauth:state:${shop}:${nonce}`;
  await env.KV_STORE.put(
    kvKey,
    JSON.stringify({ shop, codeVerifier }),
    { expirationTtl: 900 }
  );

  const redirectUri = `${env.SHOPIFY_APP_URL}/app/pinterest/callback`;
  const params = new URLSearchParams({
    client_id: env.PINTEREST_APP_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: PINTEREST_SCOPES,
    state: `${shop}|${nonce}`,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return `${PINTEREST_AUTH_BASE}?${params.toString()}`;
}

/**
 * Validates the OAuth callback state param and returns the shop domain
 * plus the stored PKCE code verifier.
 * Throws if state is missing, malformed, or not found in KV.
 */
export async function validateOAuthState(
  rawState: string,
  env: PinterestEnv
): Promise<{ shop: string; codeVerifier: string }> {
  const parts = rawState.split("|");
  if (parts.length !== 2) {
    throw new Error("Invalid OAuth state format");
  }
  const shop = parts[0] as string;
  const nonce = parts[1] as string;
  const kvKey = `pinterest:oauth:state:${shop}:${nonce}`;
  const storedJson = await env.KV_STORE.get(kvKey);
  if (!storedJson) {
    throw new Error("OAuth state not found or expired — possible CSRF attempt");
  }
  // Consume the nonce so it cannot be reused
  await env.KV_STORE.delete(kvKey);
  const stored = JSON.parse(storedJson) as { shop: string; codeVerifier: string };
  return { shop: stored.shop, codeVerifier: stored.codeVerifier };
}

/**
 * Exchanges an authorisation code for access + refresh tokens using PKCE.
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  env: PinterestEnv
): Promise<{ accessToken: string; refreshToken: string; expiresAt: string }> {
  const redirectUri = `${env.SHOPIFY_APP_URL}/app/pinterest/callback`;

  const res = await fetch(`${PINTEREST_API_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        btoa(`${env.PINTEREST_APP_ID}:${env.PINTEREST_APP_SECRET}`),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "unknown");
    throw new Error(`Pinterest token exchange failed: ${res.status} — ${errText}`);
  }

  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: { message: string };
  };

  if (!data.access_token || !data.refresh_token) {
    throw new Error(
      `Missing tokens in Pinterest response: ${data.error?.message ?? "unknown"}`
    );
  }

  const expiresAt = new Date(
    Date.now() + (data.expires_in ?? 2592000) * 1000
  ).toISOString();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
  };
}

/**
 * Refreshes an expired Pinterest access token using the stored refresh token.
 */
export async function refreshAccessToken(
  refreshToken: string,
  env: PinterestEnv
): Promise<{ accessToken: string; refreshToken: string; expiresAt: string }> {
  const res = await fetch(`${PINTEREST_API_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        btoa(`${env.PINTEREST_APP_ID}:${env.PINTEREST_APP_SECRET}`),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "unknown");
    throw new Error(`Pinterest token refresh failed: ${res.status} — ${errText}`);
  }

  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: { message: string };
  };

  if (!data.access_token) {
    throw new Error(
      `Missing access_token in refresh response: ${data.error?.message ?? "unknown"}`
    );
  }

  const expiresAt = new Date(
    Date.now() + (data.expires_in ?? 2592000) * 1000
  ).toISOString();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt,
  };
}

/**
 * Fetches the authenticated Pinterest user ID.
 */
export async function fetchPinterestUserId(
  accessToken: string
): Promise<string> {
  const res = await fetch(`${PINTEREST_API_BASE}/user_account`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Pinterest user_account request failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    username?: string;
    id?: string;
    error?: { message: string };
  };

  const userId = data.username ?? data.id;
  if (!userId) {
    throw new Error(
      `No user ID in Pinterest response: ${data.error?.message ?? "unknown"}`
    );
  }

  return userId;
}

// ---------------------------------------------------------------------------
// Connection persistence
// ---------------------------------------------------------------------------

/**
 * Persists (or updates) a Pinterest connection for a shop in D1.
 */
export async function savePinterestConnection(
  shop: string,
  pinterestUserId: string,
  accessToken: string,
  refreshToken: string,
  tokenExpiresAt: string,
  env: PinterestEnv
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO pinterest_connections
       (shop, pinterest_user_id, access_token, refresh_token, token_expires_at, connected_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(shop) DO UPDATE SET
       pinterest_user_id = excluded.pinterest_user_id,
       access_token      = excluded.access_token,
       refresh_token     = excluded.refresh_token,
       token_expires_at  = excluded.token_expires_at,
       connected_at      = excluded.connected_at`
  )
    .bind(
      shop,
      pinterestUserId,
      accessToken,
      refreshToken,
      tokenExpiresAt,
      new Date().toISOString()
    )
    .run();

  log({
    shop,
    step: "pinterest.connection.saved",
    status: "ok",
    pinterestUserId,
  });
}

/** Retrieves the Pinterest connection for a shop, or null if not connected. */
export async function getPinterestConnection(
  shop: string,
  env: PinterestEnv
): Promise<PinterestConnection | null> {
  const row = await env.DB.prepare(
    `SELECT shop, pinterest_user_id, access_token, refresh_token,
            token_expires_at, connected_at
     FROM pinterest_connections
     WHERE shop = ?`
  )
    .bind(shop)
    .first<PinterestConnection>();

  return row ?? null;
}

/** Removes a Pinterest connection for a shop (disconnect flow). */
export async function deletePinterestConnection(
  shop: string,
  env: PinterestEnv
): Promise<void> {
  await env.DB.prepare(`DELETE FROM pinterest_connections WHERE shop = ?`)
    .bind(shop)
    .run();

  log({ shop, step: "pinterest.connection.deleted", status: "ok" });
}

// ---------------------------------------------------------------------------
// Board management
// ---------------------------------------------------------------------------

/**
 * Fetches the list of boards for the authenticated Pinterest user.
 * Handles pagination up to 100 boards.
 */
export async function fetchPinterestBoards(
  accessToken: string
): Promise<PinterestBoard[]> {
  const res = await fetch(
    `${PINTEREST_API_BASE}/boards?page_size=100`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!res.ok) {
    throw new Error(`Pinterest boards request failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      name: string;
      description?: string;
      privacy: string;
      pin_count?: number;
    }>;
    error?: { message: string };
  };

  if (!data.items) {
    throw new Error(
      `No boards returned from Pinterest: ${data.error?.message ?? "unknown"}`
    );
  }

  return data.items.map((b) => ({
    id: b.id,
    name: b.name,
    description: b.description ?? null,
    privacy: (b.privacy ?? "PUBLIC") as PinterestBoard["privacy"],
    pin_count: b.pin_count ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Pin creation
// ---------------------------------------------------------------------------

export interface CreatePinOptions {
  /** Pinterest access token */
  accessToken: string;
  /** Target board ID */
  boardId: string;
  /** Publicly accessible image URL */
  imageUrl: string;
  title: string;
  description: string;
  /** Optional product link for the pin */
  link?: string;
  /** Alt text for accessibility */
  altText?: string;
}

export interface CreatePinResult {
  /** Pinterest pin ID */
  pinId: string;
  /** Direct URL to the created pin */
  pinUrl: string;
}

/**
 * Creates a pin on Pinterest with product metadata.
 */
export async function createPin(opts: CreatePinOptions): Promise<CreatePinResult> {
  const { accessToken, boardId, imageUrl, title, description, link, altText } = opts;

  const payload: Record<string, unknown> = {
    board_id: boardId,
    title,
    description,
    media_source: {
      source_type: "image_url",
      url: imageUrl,
    },
  };

  if (link) {
    payload["link"] = link;
  }

  if (altText) {
    payload["alt_text"] = altText;
  }

  const res = await fetch(`${PINTEREST_API_BASE}/pins`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "unknown");
    throw new Error(`Pinterest pin creation failed: ${res.status} — ${errText}`);
  }

  const data = (await res.json()) as {
    id?: string;
    error?: { message: string };
  };

  if (!data.id) {
    throw new Error(
      `No pin ID returned from Pinterest: ${data.error?.message ?? "unknown"}`
    );
  }

  return {
    pinId: data.id,
    pinUrl: `https://www.pinterest.com/pin/${data.id}`,
  };
}

// ---------------------------------------------------------------------------
// Scheduled pin management (stored in D1, published by Cron)
// ---------------------------------------------------------------------------

export interface CreateScheduledPinOpts {
  shop: string;
  pinterestUserId: string;
  boardId: string;
  boardName: string;
  r2ImageKey: string;
  imageUrl: string;
  title: string;
  description: string;
  link?: string;
  altText?: string;
  /** ISO timestamp — if omitted, publishes immediately */
  scheduledAt?: string;
}

/**
 * Creates (or immediately queues) a scheduled Pinterest pin entry in D1.
 */
export async function createScheduledPin(
  opts: CreateScheduledPinOpts,
  env: PinterestEnv
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO pinterest_scheduled_pins
       (id, shop, pinterest_user_id, board_id, board_name, r2_image_key,
        image_url, title, description, link, alt_text, scheduled_at,
        status, pin_id, error_message, created_at, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, NULL)`
  )
    .bind(
      id,
      opts.shop,
      opts.pinterestUserId,
      opts.boardId,
      opts.boardName,
      opts.r2ImageKey,
      opts.imageUrl,
      opts.title,
      opts.description,
      opts.link ?? null,
      opts.altText ?? null,
      opts.scheduledAt ?? null,
      now
    )
    .run();

  log({
    shop: opts.shop,
    step: "pinterest.pin.scheduled",
    status: "ok",
    pinScheduledId: id,
    boardId: opts.boardId,
    scheduledAt: opts.scheduledAt ?? "immediate",
  });

  return id;
}

/** Marks a scheduled pin as published in D1. */
export async function markPinPublished(
  id: string,
  shop: string,
  pinId: string,
  env: PinterestEnv
): Promise<void> {
  await env.DB.prepare(
    `UPDATE pinterest_scheduled_pins
     SET status = 'published', pin_id = ?, published_at = ?, error_message = NULL
     WHERE id = ? AND shop = ?`
  )
    .bind(pinId, new Date().toISOString(), id, shop)
    .run();

  log({
    shop,
    step: "pinterest.pin.published",
    status: "ok",
    scheduledPinId: id,
    pinId,
  });
}

/** Marks a scheduled pin as failed in D1. */
export async function markPinFailed(
  id: string,
  shop: string,
  errorMessage: string,
  env: PinterestEnv
): Promise<void> {
  await env.DB.prepare(
    `UPDATE pinterest_scheduled_pins
     SET status = 'failed', error_message = ?
     WHERE id = ? AND shop = ?`
  )
    .bind(errorMessage, id, shop)
    .run();

  log({
    shop,
    step: "pinterest.pin.failed",
    status: "error",
    scheduledPinId: id,
    error: errorMessage,
  });
}

/** Returns all pending pins with a scheduled_at <= now (ready to publish). */
export async function getDuePins(env: PinterestEnv): Promise<ScheduledPin[]> {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `SELECT id, shop, pinterest_user_id, board_id, board_name, r2_image_key,
            image_url, title, description, link, alt_text, scheduled_at,
            status, pin_id, error_message, created_at, published_at
     FROM pinterest_scheduled_pins
     WHERE status = 'pending'
       AND (scheduled_at IS NULL OR scheduled_at <= ?)
     ORDER BY scheduled_at ASC
     LIMIT 50`
  )
    .bind(now)
    .all<ScheduledPin>();

  return result.results ?? [];
}

/** Returns all scheduled pins for a shop (for dashboard display). */
export async function getShopPins(
  shop: string,
  env: PinterestEnv
): Promise<ScheduledPin[]> {
  const result = await env.DB.prepare(
    `SELECT id, shop, pinterest_user_id, board_id, board_name, r2_image_key,
            image_url, title, description, link, alt_text, scheduled_at,
            status, pin_id, error_message, created_at, published_at
     FROM pinterest_scheduled_pins
     WHERE shop = ?
     ORDER BY created_at DESC
     LIMIT 100`
  )
    .bind(shop)
    .all<ScheduledPin>();

  return result.results ?? [];
}

// ---------------------------------------------------------------------------
// Cron handler — called by the scheduled() export in the Worker entry point
// ---------------------------------------------------------------------------

/**
 * Processes all due Pinterest pins. Intended to run on a Cloudflare Cron
 * Trigger every 5 minutes: `"*\/5 * * * *"`.
 *
 * For each due pin it:
 *   1. Fetches the merchant's stored Pinterest connection.
 *   2. Refreshes the access token if it is within 5 minutes of expiry.
 *   3. Calls createPin().
 *   4. Marks the pin published or failed in D1.
 */
export async function processScheduledPins(env: PinterestEnv): Promise<void> {
  const duePins = await getDuePins(env);

  if (duePins.length === 0) {
    return;
  }

  log({
    shop: "system",
    step: "pinterest.cron.start",
    status: "info",
    dueCount: duePins.length,
  });

  for (const pin of duePins) {
    const conn = await getPinterestConnection(pin.shop, env);
    if (!conn) {
      await markPinFailed(
        pin.id,
        pin.shop,
        "Pinterest connection not found — merchant may have disconnected",
        env
      );
      continue;
    }

    // Refresh token if expiring within 5 minutes
    let accessToken = conn.access_token;
    const expiresAt = new Date(conn.token_expires_at).getTime();
    if (Date.now() >= expiresAt - 5 * 60 * 1000) {
      try {
        const refreshed = await refreshAccessToken(conn.refresh_token, env);
        await savePinterestConnection(
          pin.shop,
          conn.pinterest_user_id,
          refreshed.accessToken,
          refreshed.refreshToken,
          refreshed.expiresAt,
          env
        );
        accessToken = refreshed.accessToken;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await markPinFailed(pin.id, pin.shop, `Token refresh failed: ${msg}`, env);
        continue;
      }
    }

    try {
      const result = await createPin({
        accessToken,
        boardId: pin.board_id,
        imageUrl: pin.image_url,
        title: pin.title,
        description: pin.description,
        link: pin.link ?? undefined,
        altText: pin.alt_text ?? undefined,
      });

      await markPinPublished(pin.id, pin.shop, result.pinId, env);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await markPinFailed(pin.id, pin.shop, msg, env);
    }
  }

  log({
    shop: "system",
    step: "pinterest.cron.complete",
    status: "ok",
    processed: duePins.length,
  });
}
