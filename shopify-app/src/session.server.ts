/**
 * PR-005: D1-backed session storage for Shopify OAuth tokens.
 *
 * Stores one session row per shop in the `merchants` table.
 * The access_token column is sensitive — never logged (enforced by logger.ts types).
 */

export interface MerchantSession {
  shop: string;
  /** Shopify OAuth access token — NEVER log this field */
  access_token: string;
  scope: string;
  expires_at: number | null; // Unix timestamp ms, null = permanent token
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// D1 session storage helpers
// ---------------------------------------------------------------------------

export async function upsertSession(
  db: D1Database,
  shop: string,
  accessToken: string,
  scope: string,
  expiresAt: number | null
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO merchants (shop, access_token, scope, expires_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT(shop) DO UPDATE SET
         access_token = excluded.access_token,
         scope        = excluded.scope,
         expires_at   = excluded.expires_at,
         updated_at   = excluded.updated_at`
    )
    .bind(shop, accessToken, scope, expiresAt, now)
    .run();
}

export async function getSession(
  db: D1Database,
  shop: string
): Promise<MerchantSession | null> {
  const row = await db
    .prepare(
      `SELECT shop, access_token, scope, expires_at, created_at, updated_at
       FROM merchants WHERE shop = ?1`
    )
    .bind(shop)
    .first<MerchantSession>();
  return row ?? null;
}

export async function deleteSession(
  db: D1Database,
  shop: string
): Promise<void> {
  await db
    .prepare(`UPDATE merchants SET access_token = NULL, updated_at = ?1 WHERE shop = ?2`)
    .bind(new Date().toISOString(), shop)
    .run();
}

/**
 * Returns true if the session has expired.
 * Tokens with no expiry (expires_at = null) are considered permanent.
 * Adds a 60-second buffer to trigger refresh slightly before actual expiry.
 */
export function isSessionExpired(session: MerchantSession): boolean {
  if (session.expires_at === null) return false;
  return Date.now() >= session.expires_at - 60_000;
}
