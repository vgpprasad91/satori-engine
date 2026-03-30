/**
 * PR-029: Daily D1 backup cron
 *
 * Cloudflare Cron Trigger fires at "0 2 * * *" (nightly 02:00 UTC).
 * Exports full D1 schema + data to R2 as `backups/db-{YYYY-MM-DD}.sql`.
 * R2 lifecycle rule deletes objects older than 30 days (configured separately).
 * Backup success/failure emitted to Analytics Engine.
 */

import { AnalyticsEngineDataset } from "./analytics.server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackupEnv {
  DB: D1Database;
  R2_BUCKET: R2Bucket;
  AE_METRICS: AnalyticsEngineDataset;
}

export interface BackupResult {
  success: boolean;
  r2Key: string;
  sizeBytes: number;
  durationMs: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Table list helper
// ---------------------------------------------------------------------------

/**
 * Returns the list of all user-created tables in the D1 database (excluding
 * SQLite internal tables that start with "sqlite_").
 */
export async function listTables(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all<{ name: string }>();

  return (result.results ?? []).map((r) => r.name);
}

// ---------------------------------------------------------------------------
// Schema export helper
// ---------------------------------------------------------------------------

/**
 * Fetches the CREATE TABLE statement for a given table from sqlite_master.
 * Returns an empty string if not found.
 */
export async function getCreateStatement(
  db: D1Database,
  tableName: string
): Promise<string> {
  const row = await db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name = ?"
    )
    .bind(tableName)
    .first<{ sql: string }>();

  return row?.sql ?? "";
}

// ---------------------------------------------------------------------------
// Row export helper
// ---------------------------------------------------------------------------

/**
 * Exports all rows from a table as INSERT statements.
 * Handles NULL, numeric, and string column values.
 */
export async function exportTableRows(
  db: D1Database,
  tableName: string
): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await db.prepare(`SELECT * FROM "${tableName}"`).all<Record<string, any>>();
  const rows = result.results ?? [];
  if (rows.length === 0) return [];

  return rows.map((row) => {
    const cols = Object.keys(row)
      .map((c) => `"${c}"`)
      .join(", ");
    const vals = Object.values(row)
      .map((v) => {
        if (v === null || v === undefined) return "NULL";
        if (typeof v === "number") return String(v);
        // Escape single-quotes in strings
        return `'${String(v).replace(/'/g, "''")}'`;
      })
      .join(", ");
    return `INSERT INTO "${tableName}" (${cols}) VALUES (${vals});`;
  });
}

// ---------------------------------------------------------------------------
// SQL dump builder
// ---------------------------------------------------------------------------

/**
 * Builds a complete SQL dump string for the entire D1 database:
 *   - A header comment with timestamp
 *   - For each table: DROP TABLE IF EXISTS + CREATE TABLE + INSERT statements
 *
 * Returns the SQL as a single string.
 */
export async function buildSqlDump(
  db: D1Database,
  now: Date = new Date()
): Promise<string> {
  const timestamp = now.toISOString();
  const lines: string[] = [
    `-- Shopify App D1 Backup`,
    `-- Generated at: ${timestamp}`,
    `-- Format: SQLite-compatible SQL dump`,
    ``,
    `PRAGMA foreign_keys = OFF;`,
    `BEGIN TRANSACTION;`,
    ``,
  ];

  const tables = await listTables(db);

  for (const table of tables) {
    const createSql = await getCreateStatement(db, table);
    lines.push(`-- Table: ${table}`);
    lines.push(`DROP TABLE IF EXISTS "${table}";`);
    if (createSql) {
      lines.push(`${createSql};`);
    }

    const inserts = await exportTableRows(db, table);
    if (inserts.length > 0) {
      lines.push(...inserts);
    }
    lines.push(``);
  }

  lines.push(`COMMIT;`);
  lines.push(``);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// R2 key builder
// ---------------------------------------------------------------------------

/**
 * Returns the R2 object key for today's backup: `backups/db-YYYY-MM-DD.sql`
 */
export function buildR2BackupKey(now: Date = new Date()): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `backups/db-${yyyy}-${mm}-${dd}.sql`;
}

// ---------------------------------------------------------------------------
// Analytics Engine emission
// ---------------------------------------------------------------------------

/**
 * Emits backup result to Analytics Engine.
 *
 * Index:  "backup"
 * Blobs:  [status ("success"|"failure"), r2Key, errorMessage]
 * Doubles: [sizeBytes, durationMs, successNumeric]
 */
export function emitBackupMetric(
  ae: AnalyticsEngineDataset,
  result: BackupResult
): void {
  try {
    ae.writeDataPoint({
      indexes: ["backup"],
      blobs: [
        result.success ? "success" : "failure",
        result.r2Key,
        result.error ?? "",
      ],
      doubles: [
        result.sizeBytes,
        result.durationMs,
        result.success ? 1 : 0,
      ],
    });
  } catch {
    // Best-effort — never let analytics writes break the backup cron
  }
}

// ---------------------------------------------------------------------------
// Main scheduled handler
// ---------------------------------------------------------------------------

/**
 * Runs the full D1 → R2 backup pipeline.
 *
 * 1. Build SQL dump from all tables.
 * 2. Upload to R2 at `backups/db-{YYYY-MM-DD}.sql`.
 * 3. Emit result to Analytics Engine.
 *
 * Returns a BackupResult with success/failure details.
 */
export async function runDailyBackup(env: BackupEnv): Promise<BackupResult> {
  const startMs = Date.now();
  const now = new Date();
  const r2Key = buildR2BackupKey(now);

  try {
    const sql = await buildSqlDump(env.DB, now);
    const encoder = new TextEncoder();
    const body = encoder.encode(sql);
    const sizeBytes = body.byteLength;

    await env.R2_BUCKET.put(r2Key, body, {
      httpMetadata: {
        contentType: "text/plain; charset=utf-8",
      },
      customMetadata: {
        backupDate: now.toISOString().slice(0, 10),
        backupType: "full-d1-export",
      },
    });

    const durationMs = Date.now() - startMs;
    const result: BackupResult = {
      success: true,
      r2Key,
      sizeBytes,
      durationMs,
    };

    emitBackupMetric(env.AE_METRICS, result);
    return result;
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const errorMessage = err instanceof Error ? err.message : String(err);
    const result: BackupResult = {
      success: false,
      r2Key,
      sizeBytes: 0,
      durationMs,
      error: errorMessage,
    };

    emitBackupMetric(env.AE_METRICS, result);
    return result;
  }
}
