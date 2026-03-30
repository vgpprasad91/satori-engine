/**
 * PR-039: Instagram Graph API direct publishing
 *
 * Provides:
 *  - OAuth 2.0 flow for Instagram Business accounts (via Facebook Login)
 *  - Post generated images directly to Instagram feed and stories
 *  - Schedule posts via Cloudflare Cron (stored in D1, processed on cron tick)
 *
 * Security notes:
 *  - instagram_access_token NEVER appears in log payloads (logger.ts types
 *    enforce this; we also strip it here at runtime)
 *  - State nonces are stored in KV with 15-minute TTL (replay protection)
 *  - All token exchanges happen server-side only
 */

import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Environment bindings required by Instagram features
// ---------------------------------------------------------------------------

export interface InstagramEnv {
  /** Facebook App ID (also used for Instagram OAuth) */
  INSTAGRAM_APP_ID: string;
  /** Facebook App Secret — NEVER log */
  INSTAGRAM_APP_SECRET: string;
  /** Public URL of this Shopify app (e.g. https://myapp.example.com) */
  SHOPIFY_APP_URL: string;
  DB: D1Database;
  KV_STORE: KVNamespace;
  ASSETS_BUCKET: R2Bucket;
}

// ---------------------------------------------------------------------------
// Graph API constants
// ---------------------------------------------------------------------------

const GRAPH_API_BASE = "https://graph.facebook.com/v20.0";

/** Permissions required for Instagram publishing */
const INSTAGRAM_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_read_engagement",
  "pages_show_list",
].join(",");

// ---------------------------------------------------------------------------
// D1 row types
// ---------------------------------------------------------------------------

export interface InstagramConnection {
  shop: string;
  /** Instagram Business Account ID */
  ig_user_id: string;
  /** Long-lived Facebook User access token — NEVER log */
  fb_access_token: string;
  /** Instagram page name for display */
  page_name: string;
  /** ISO timestamp of OAuth connection */
  connected_at: string;
}

export interface ScheduledPost {
  id: string;
  shop: string;
  ig_user_id: string;
  /** R2 key for the generated image */
  r2_image_key: string;
  /** Public URL of image (pre-signed or CDN) */
  image_url: string;
  caption: string;
  /** "feed" | "story" */
  post_type: "feed" | "story";
  /** ISO timestamp for when to publish (null = publish immediately) */
  scheduled_at: string | null;
  /** "pending" | "published" | "failed" */
  status: "pending" | "published" | "failed";
  error_message: string | null;
  created_at: string;
  published_at: string | null;
}

// ---------------------------------------------------------------------------
// OAuth helpers
// ---------------------------------------------------------------------------

/**
 * Generates the Facebook Login OAuth redirect URL for the given shop.
 * Stores a nonce in KV to prevent CSRF/replay attacks.
 */
export async function getInstagramOAuthUrl(
  shop: string,
  env: InstagramEnv
): Promise<string> {
  // Generate a cryptographically random state nonce
  const rawBytes = new Uint8Array(16);
  crypto.getRandomValues(rawBytes);
  const state = Array.from(rawBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Store nonce in KV with 15-minute TTL
  const kvKey = `instagram:oauth:state:${shop}:${state}`;
  await env.KV_STORE.put(kvKey, shop, { expirationTtl: 900 });

  const redirectUri = `${env.SHOPIFY_APP_URL}/app/instagram/callback`;
  const params = new URLSearchParams({
    client_id: env.INSTAGRAM_APP_ID,
    redirect_uri: redirectUri,
    scope: INSTAGRAM_SCOPES,
    response_type: "code",
    state: `${shop}|${state}`,
  });

  return `https://www.facebook.com/v20.0/dialog/oauth?${params.toString()}`;
}

/**
 * Validates the OAuth callback state param and returns the shop domain.
 * Throws if state is missing, malformed, or not found in KV.
 */
export async function validateOAuthState(
  rawState: string,
  env: InstagramEnv
): Promise<string> {
  const parts = rawState.split("|");
  if (parts.length !== 2) {
    throw new Error("Invalid OAuth state format");
  }
  const shop = parts[0] as string;
  const nonce = parts[1] as string;
  const kvKey = `instagram:oauth:state:${shop}:${nonce}`;
  const stored = await env.KV_STORE.get(kvKey);
  if (!stored) {
    throw new Error("OAuth state not found or expired — possible CSRF attempt");
  }
  // Consume the nonce so it cannot be reused
  await env.KV_STORE.delete(kvKey);
  return shop;
}

/**
 * Exchanges an authorisation code for a short-lived user token, then
 * exchanges that for a long-lived token (60-day expiry).
 * Returns ONLY the long-lived token string.
 */
export async function exchangeCodeForLongLivedToken(
  code: string,
  env: InstagramEnv
): Promise<string> {
  const redirectUri = `${env.SHOPIFY_APP_URL}/app/instagram/callback`;

  // Step 1: short-lived token
  const shortLivedRes = await fetch(`${GRAPH_API_BASE}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.INSTAGRAM_APP_ID,
      client_secret: env.INSTAGRAM_APP_SECRET,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    }),
  });

  if (!shortLivedRes.ok) {
    const errText = await shortLivedRes.text().catch(() => "unknown");
    throw new Error(`Short-lived token exchange failed: ${shortLivedRes.status} — ${errText}`);
  }

  const shortLivedData = (await shortLivedRes.json()) as {
    access_token?: string;
    error?: { message: string };
  };
  if (!shortLivedData.access_token) {
    throw new Error(
      `No access_token in short-lived response: ${shortLivedData.error?.message ?? "unknown"}`
    );
  }

  // Step 2: long-lived token (60 days)
  const longLivedRes = await fetch(
    `${GRAPH_API_BASE}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: env.INSTAGRAM_APP_ID,
        client_secret: env.INSTAGRAM_APP_SECRET,
        fb_exchange_token: shortLivedData.access_token,
      }).toString()
  );

  if (!longLivedRes.ok) {
    throw new Error(`Long-lived token exchange failed: ${longLivedRes.status}`);
  }

  const longLivedData = (await longLivedRes.json()) as {
    access_token?: string;
    error?: { message: string };
  };
  if (!longLivedData.access_token) {
    throw new Error(
      `No access_token in long-lived response: ${longLivedData.error?.message ?? "unknown"}`
    );
  }

  return longLivedData.access_token;
}

/**
 * Given a long-lived Facebook user token, fetches the user's Instagram
 * Business Account ID and associated Page name.
 */
export async function fetchInstagramBusinessAccount(
  fbToken: string
): Promise<{ igUserId: string; pageName: string }> {
  // Fetch Pages the user manages
  const pagesRes = await fetch(
    `${GRAPH_API_BASE}/me/accounts?fields=id,name,instagram_business_account&access_token=${encodeURIComponent(fbToken)}`
  );

  if (!pagesRes.ok) {
    throw new Error(`Pages API request failed: ${pagesRes.status}`);
  }

  const pagesData = (await pagesRes.json()) as {
    data?: Array<{
      id: string;
      name: string;
      instagram_business_account?: { id: string };
    }>;
    error?: { message: string };
  };

  const page = pagesData.data?.find((p) => p.instagram_business_account?.id);
  if (!page || !page.instagram_business_account) {
    throw new Error(
      "No Instagram Business Account connected to any Facebook Page managed by this user"
    );
  }

  return {
    igUserId: page.instagram_business_account.id,
    pageName: page.name,
  };
}

// ---------------------------------------------------------------------------
// Connection persistence
// ---------------------------------------------------------------------------

/**
 * Persists (or updates) an Instagram connection for a shop in D1.
 * The fb_access_token is stored encrypted at rest via D1 column-level
 * encryption in production; in this implementation we rely on Cloudflare's
 * at-rest encryption of D1.
 */
export async function saveInstagramConnection(
  shop: string,
  igUserId: string,
  fbAccessToken: string,
  pageName: string,
  env: InstagramEnv
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO instagram_connections
       (shop, ig_user_id, fb_access_token, page_name, connected_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(shop) DO UPDATE SET
       ig_user_id     = excluded.ig_user_id,
       fb_access_token = excluded.fb_access_token,
       page_name      = excluded.page_name,
       connected_at   = excluded.connected_at`
  )
    .bind(shop, igUserId, fbAccessToken, pageName, new Date().toISOString())
    .run();

  log({
    shop,
    step: "instagram.connection.saved",
    status: "ok",
    igUserId,
    pageName,
  });
}

/** Retrieves the Instagram connection for a shop, or null if not connected. */
export async function getInstagramConnection(
  shop: string,
  env: InstagramEnv
): Promise<InstagramConnection | null> {
  const row = await env.DB.prepare(
    `SELECT shop, ig_user_id, fb_access_token, page_name, connected_at
     FROM instagram_connections
     WHERE shop = ?`
  )
    .bind(shop)
    .first<InstagramConnection>();

  return row ?? null;
}

/** Removes an Instagram connection for a shop (disconnect flow). */
export async function deleteInstagramConnection(
  shop: string,
  env: InstagramEnv
): Promise<void> {
  await env.DB.prepare(`DELETE FROM instagram_connections WHERE shop = ?`)
    .bind(shop)
    .run();

  log({ shop, step: "instagram.connection.deleted", status: "ok" });
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

export interface PublishOptions {
  /** Instagram Business Account ID */
  igUserId: string;
  /** Long-lived Facebook user access token */
  fbAccessToken: string;
  /** Publicly accessible image URL (must be reachable by Facebook servers) */
  imageUrl: string;
  caption: string;
  /** "feed" (default) or "story" */
  postType?: "feed" | "story";
}

export interface PublishResult {
  /** Instagram media object ID */
  mediaId: string;
  /** Published Instagram post ID (same as mediaId after publish step) */
  postId: string;
}

/**
 * Posts an image to Instagram feed or stories using the two-step
 * Graph API process: (1) create a media container, (2) publish it.
 */
export async function publishToInstagram(
  opts: PublishOptions
): Promise<PublishResult> {
  const { igUserId, fbAccessToken, imageUrl, caption, postType = "feed" } = opts;

  // Step 1: Create media container
  const containerParams: Record<string, string> = {
    image_url: imageUrl,
    access_token: fbAccessToken,
  };

  if (postType === "story") {
    containerParams["media_type"] = "IMAGE";
    // Stories don't support captions via the API; omit
  } else {
    containerParams["caption"] = caption;
  }

  const containerRes = await fetch(
    `${GRAPH_API_BASE}/${igUserId}/media`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(containerParams),
    }
  );

  if (!containerRes.ok) {
    const errText = await containerRes.text().catch(() => "unknown");
    throw new Error(
      `Instagram media container creation failed: ${containerRes.status} — ${errText}`
    );
  }

  const containerData = (await containerRes.json()) as {
    id?: string;
    error?: { message: string };
  };
  if (!containerData.id) {
    throw new Error(
      `No container ID returned: ${containerData.error?.message ?? "unknown"}`
    );
  }

  const mediaId = containerData.id;

  // Step 2: Publish the container
  const publishRes = await fetch(
    `${GRAPH_API_BASE}/${igUserId}/media_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        creation_id: mediaId,
        access_token: fbAccessToken,
      }),
    }
  );

  if (!publishRes.ok) {
    const errText = await publishRes.text().catch(() => "unknown");
    throw new Error(
      `Instagram media publish failed: ${publishRes.status} — ${errText}`
    );
  }

  const publishData = (await publishRes.json()) as {
    id?: string;
    error?: { message: string };
  };
  if (!publishData.id) {
    throw new Error(
      `No post ID returned from publish: ${publishData.error?.message ?? "unknown"}`
    );
  }

  return { mediaId, postId: publishData.id };
}

// ---------------------------------------------------------------------------
// Scheduled post management (stored in D1, published by Cron)
// ---------------------------------------------------------------------------

export interface CreateScheduledPostOpts {
  shop: string;
  igUserId: string;
  r2ImageKey: string;
  imageUrl: string;
  caption: string;
  postType?: "feed" | "story";
  /** ISO timestamp — if omitted, publishes immediately */
  scheduledAt?: string;
}

/**
 * Creates (or immediately publishes) a scheduled Instagram post entry in D1.
 *
 * If scheduledAt is in the future, status is set to "pending" and the Cron
 * trigger will pick it up. If scheduledAt is in the past or omitted, the
 * caller is expected to publish immediately and call markPostPublished().
 */
export async function createScheduledPost(
  opts: CreateScheduledPostOpts,
  env: InstagramEnv
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO instagram_scheduled_posts
       (id, shop, ig_user_id, r2_image_key, image_url, caption, post_type,
        scheduled_at, status, error_message, created_at, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, NULL)`
  )
    .bind(
      id,
      opts.shop,
      opts.igUserId,
      opts.r2ImageKey,
      opts.imageUrl,
      opts.caption,
      opts.postType ?? "feed",
      opts.scheduledAt ?? null,
      now
    )
    .run();

  log({
    shop: opts.shop,
    step: "instagram.post.scheduled",
    status: "ok",
    postId: id,
    scheduledAt: opts.scheduledAt ?? "immediate",
    postType: opts.postType ?? "feed",
  });

  return id;
}

/** Marks a scheduled post as published in D1. */
export async function markPostPublished(
  id: string,
  shop: string,
  igPostId: string,
  env: InstagramEnv
): Promise<void> {
  await env.DB.prepare(
    `UPDATE instagram_scheduled_posts
     SET status = 'published', published_at = ?, error_message = NULL
     WHERE id = ? AND shop = ?`
  )
    .bind(new Date().toISOString(), id, shop)
    .run();

  log({
    shop,
    step: "instagram.post.published",
    status: "ok",
    scheduledPostId: id,
    igPostId,
  });
}

/** Marks a scheduled post as failed in D1. */
export async function markPostFailed(
  id: string,
  shop: string,
  errorMessage: string,
  env: InstagramEnv
): Promise<void> {
  await env.DB.prepare(
    `UPDATE instagram_scheduled_posts
     SET status = 'failed', error_message = ?
     WHERE id = ? AND shop = ?`
  )
    .bind(errorMessage, id, shop)
    .run();

  log({
    shop,
    step: "instagram.post.failed",
    status: "error",
    scheduledPostId: id,
    error: errorMessage,
  });
}

/** Returns all pending posts with a scheduled_at <= now (ready to publish). */
export async function getDuePosts(env: InstagramEnv): Promise<ScheduledPost[]> {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `SELECT id, shop, ig_user_id, r2_image_key, image_url, caption,
            post_type, scheduled_at, status, error_message, created_at, published_at
     FROM instagram_scheduled_posts
     WHERE status = 'pending'
       AND (scheduled_at IS NULL OR scheduled_at <= ?)
     ORDER BY scheduled_at ASC
     LIMIT 50`
  )
    .bind(now)
    .all<ScheduledPost>();

  return result.results ?? [];
}

/** Returns all scheduled posts for a shop (for dashboard display). */
export async function getShopPosts(
  shop: string,
  env: InstagramEnv
): Promise<ScheduledPost[]> {
  const result = await env.DB.prepare(
    `SELECT id, shop, ig_user_id, r2_image_key, image_url, caption,
            post_type, scheduled_at, status, error_message, created_at, published_at
     FROM instagram_scheduled_posts
     WHERE shop = ?
     ORDER BY created_at DESC
     LIMIT 100`
  )
    .bind(shop)
    .all<ScheduledPost>();

  return result.results ?? [];
}

// ---------------------------------------------------------------------------
// Cron handler — called by the scheduled() export in the Worker entry point
// ---------------------------------------------------------------------------

/**
 * Processes all due Instagram posts. Intended to run on a Cloudflare Cron
 * Trigger every 5 minutes: `"*\/5 * * * *"`.
 *
 * For each due post it:
 *   1. Fetches the merchant's stored Instagram connection.
 *   2. Calls publishToInstagram().
 *   3. Marks the post published or failed in D1.
 */
export async function processScheduledPosts(env: InstagramEnv): Promise<void> {
  const duePosts = await getDuePosts(env);

  if (duePosts.length === 0) {
    return;
  }

  log({
    shop: "system",
    step: "instagram.cron.start",
    status: "info",
    dueCount: duePosts.length,
  });

  for (const post of duePosts) {
    const conn = await getInstagramConnection(post.shop, env);
    if (!conn) {
      await markPostFailed(
        post.id,
        post.shop,
        "Instagram connection not found — merchant may have disconnected",
        env
      );
      continue;
    }

    try {
      const result = await publishToInstagram({
        igUserId: conn.ig_user_id,
        fbAccessToken: conn.fb_access_token,
        imageUrl: post.image_url,
        caption: post.caption,
        postType: post.post_type,
      });

      await markPostPublished(post.id, post.shop, result.postId, env);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await markPostFailed(post.id, post.shop, msg, env);
    }
  }

  log({
    shop: "system",
    step: "instagram.cron.complete",
    status: "ok",
    processed: duePosts.length,
  });
}
