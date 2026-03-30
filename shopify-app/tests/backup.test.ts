/**
 * PR-029: Daily D1 backup cron — unit tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listTables,
  getCreateStatement,
  exportTableRows,
  buildSqlDump,
  buildR2BackupKey,
  emitBackupMetric,
  runDailyBackup,
  type BackupEnv,
  type BackupResult,
} from "../src/backup.server.js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Build a minimal mock D1Database for given tables and rows. */
function makeDb(
  tables: string[],
  rows: Record<string, Array<Record<string, unknown>>> = {},
  createSqls: Record<string, string> = {}
) {
  // Provide defaults for CREATE sql
  const creates: Record<string, string> = {
    ...Object.fromEntries(tables.map((t) => [t, `CREATE TABLE "${t}" (id INTEGER PRIMARY KEY)`])),
    ...createSqls,
  };

  const db = {
    prepare: vi.fn((sql: string) => {
      // sqlite_master — list tables
      if (sql.includes("sqlite_master") && sql.includes("type='table'") && !sql.includes("name = ?")) {
        return {
          all: vi.fn(async () => ({
            results: tables.map((name) => ({ name })),
          })),
        };
      }
      // sqlite_master — get CREATE for specific table
      if (sql.includes("sqlite_master") && sql.includes("name = ?")) {
        return {
          bind: vi.fn((tableName: string) => ({
            first: vi.fn(async () => ({
              sql: creates[tableName] ?? `CREATE TABLE "${tableName}" (id INTEGER PRIMARY KEY)`,
            })),
          })),
        };
      }
      // SELECT * FROM table
      const tableMatch = sql.match(/SELECT \* FROM "([^"]+)"/);
      if (tableMatch) {
        const tableName = tableMatch[1] ?? "";
        return {
          all: vi.fn(async () => ({
            results: rows[tableName] ?? [],
          })),
        };
      }
      // Fallback
      return {
        all: vi.fn(async () => ({ results: [] })),
        bind: vi.fn(() => ({ first: vi.fn(async () => null) })),
      };
    }),
  } as unknown as D1Database;

  return db;
}

interface MockR2 {
  put: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  _store: Map<string, Uint8Array>;
}

function makeR2(): MockR2 {
  const store = new Map<string, Uint8Array>();
  return {
    put: vi.fn(async (_key: string, value: Uint8Array) => {
      store.set(_key, value);
    }),
    get: vi.fn(async (_key: string) => store.get(_key) ?? null),
    _store: store,
  };
}

function makeAe() {
  return { writeDataPoint: vi.fn() };
}

// ---------------------------------------------------------------------------
// listTables
// ---------------------------------------------------------------------------

describe("listTables", () => {
  it("returns all non-sqlite user tables in alphabetical order", async () => {
    const db = makeDb(["merchants", "products", "generated_images"]);
    const tables = await listTables(db);
    expect(tables).toEqual(["merchants", "products", "generated_images"]);
  });

  it("returns empty array when no tables exist", async () => {
    const db = makeDb([]);
    const tables = await listTables(db);
    expect(tables).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getCreateStatement
// ---------------------------------------------------------------------------

describe("getCreateStatement", () => {
  it("returns the CREATE TABLE sql for a known table", async () => {
    const db = makeDb(["merchants"], {}, {
      merchants: "CREATE TABLE \"merchants\" (id INTEGER PRIMARY KEY, shop TEXT)",
    });
    const sql = await getCreateStatement(db, "merchants");
    expect(sql).toContain("CREATE TABLE");
    expect(sql).toContain("merchants");
  });

  it("returns empty string when table not found", async () => {
    const db = makeDb([], {}, {});
    // Override to return null
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      bind: vi.fn(() => ({
        first: vi.fn(async () => null),
      })),
    });
    const sql = await getCreateStatement(db, "nonexistent");
    expect(sql).toBe("");
  });
});

// ---------------------------------------------------------------------------
// exportTableRows
// ---------------------------------------------------------------------------

describe("exportTableRows", () => {
  it("returns INSERT statements for each row", async () => {
    const db = makeDb(["merchants"], {
      merchants: [
        { id: 1, shop: "test.myshopify.com", plan: "pro" },
      ],
    });
    const inserts = await exportTableRows(db, "merchants");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatch(/^INSERT INTO "merchants"/);
    expect(inserts[0]).toContain("test.myshopify.com");
    expect(inserts[0]).toContain("'pro'");
  });

  it("returns empty array for a table with no rows", async () => {
    const db = makeDb(["merchants"], { merchants: [] });
    const inserts = await exportTableRows(db, "merchants");
    expect(inserts).toEqual([]);
  });

  it("correctly handles NULL values in rows", async () => {
    const db = makeDb(["merchants"], {
      merchants: [{ id: 1, shop: "x.myshopify.com", plan: null }],
    });
    const inserts = await exportTableRows(db, "merchants");
    expect(inserts[0]).toContain("NULL");
  });

  it("escapes single quotes in string values", async () => {
    const db = makeDb(["merchants"], {
      merchants: [{ id: 1, shop: "o'reilly.myshopify.com" }],
    });
    const inserts = await exportTableRows(db, "merchants");
    expect(inserts[0]).toContain("o''reilly");
  });

  it("handles numeric values without quoting", async () => {
    const db = makeDb(["merchants"], {
      merchants: [{ id: 42, monthly_limit: 1000 }],
    });
    const inserts = await exportTableRows(db, "merchants");
    expect(inserts[0]).toContain("42");
    expect(inserts[0]).toContain("1000");
    // Numbers should NOT be quoted
    expect(inserts[0]).not.toMatch(/'42'/);
  });
});

// ---------------------------------------------------------------------------
// buildSqlDump
// ---------------------------------------------------------------------------

describe("buildSqlDump", () => {
  it("includes header comment, PRAGMA, BEGIN/COMMIT, and table data", async () => {
    const now = new Date("2026-03-12T02:00:00Z");
    const db = makeDb(["merchants"], {
      merchants: [{ id: 1, shop: "test.myshopify.com" }],
    });
    const sql = await buildSqlDump(db, now);

    expect(sql).toContain("-- Shopify App D1 Backup");
    expect(sql).toContain("2026-03-12");
    expect(sql).toContain("PRAGMA foreign_keys = OFF");
    expect(sql).toContain("BEGIN TRANSACTION");
    expect(sql).toContain("COMMIT");
    expect(sql).toContain("DROP TABLE IF EXISTS");
    expect(sql).toContain("CREATE TABLE");
    expect(sql).toContain("INSERT INTO");
  });

  it("handles multiple tables", async () => {
    const now = new Date("2026-03-12T02:00:00Z");
    const db = makeDb(["merchants", "products"]);
    const sql = await buildSqlDump(db, now);
    expect(sql).toContain("merchants");
    expect(sql).toContain("products");
  });

  it("produces valid structure with empty database", async () => {
    const now = new Date("2026-03-12T02:00:00Z");
    const db = makeDb([]);
    const sql = await buildSqlDump(db, now);
    expect(sql).toContain("BEGIN TRANSACTION");
    expect(sql).toContain("COMMIT");
  });
});

// ---------------------------------------------------------------------------
// buildR2BackupKey
// ---------------------------------------------------------------------------

describe("buildR2BackupKey", () => {
  it("formats the key as backups/db-YYYY-MM-DD.sql", () => {
    const now = new Date("2026-03-12T02:00:00Z");
    const key = buildR2BackupKey(now);
    expect(key).toBe("backups/db-2026-03-12.sql");
  });

  it("zero-pads month and day", () => {
    const now = new Date("2026-01-05T02:00:00Z");
    const key = buildR2BackupKey(now);
    expect(key).toBe("backups/db-2026-01-05.sql");
  });
});

// ---------------------------------------------------------------------------
// emitBackupMetric
// ---------------------------------------------------------------------------

describe("emitBackupMetric", () => {
  it("calls writeDataPoint with success=1 on successful backup", () => {
    const ae = makeAe();
    const result: BackupResult = {
      success: true,
      r2Key: "backups/db-2026-03-12.sql",
      sizeBytes: 1024,
      durationMs: 350,
    };
    emitBackupMetric(ae, result);
    expect(ae.writeDataPoint).toHaveBeenCalledOnce();
    type DpCall = { indexes: string[]; blobs: string[]; doubles: number[] };
    const calls1 = ae.writeDataPoint.mock.calls as Array<[DpCall]>;
    const call = calls1[0]?.[0];
    expect(call?.indexes).toContain("backup");
    expect(call?.blobs[0]).toBe("success");
    expect(call?.doubles).toContain(1); // successNumeric
    expect(call?.doubles).toContain(1024); // sizeBytes
  });

  it("calls writeDataPoint with success=0 on failure", () => {
    const ae = makeAe();
    const result: BackupResult = {
      success: false,
      r2Key: "backups/db-2026-03-12.sql",
      sizeBytes: 0,
      durationMs: 100,
      error: "D1 export failed",
    };
    emitBackupMetric(ae, result);
    type DpCall = { indexes: string[]; blobs: string[]; doubles: number[] };
    const calls2 = ae.writeDataPoint.mock.calls as Array<[DpCall]>;
    const call = calls2[0]?.[0];
    expect(call?.blobs[0]).toBe("failure");
    expect(call?.blobs[2]).toBe("D1 export failed");
    expect(call?.doubles).toContain(0); // successNumeric
  });

  it("does not throw if writeDataPoint throws", () => {
    const ae = { writeDataPoint: vi.fn(() => { throw new Error("AE down"); }) };
    const result: BackupResult = { success: true, r2Key: "k", sizeBytes: 1, durationMs: 1 };
    expect(() => emitBackupMetric(ae, result)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// runDailyBackup
// ---------------------------------------------------------------------------

describe("runDailyBackup", () => {
  let r2: MockR2;
  let ae: ReturnType<typeof makeAe>;
  let db: D1Database;

  beforeEach(() => {
    r2 = makeR2();
    ae = makeAe();
    db = makeDb(["merchants", "products"], {
      merchants: [{ id: 1, shop: "test.myshopify.com" }],
      products: [],
    });
  });

  it("returns success=true and uploads to correct R2 key", async () => {
    const env: BackupEnv = { DB: db, R2_BUCKET: r2 as unknown as R2Bucket, AE_METRICS: ae };
    const result = await runDailyBackup(env);

    expect(result.success).toBe(true);
    expect(result.r2Key).toMatch(/^backups\/db-\d{4}-\d{2}-\d{2}\.sql$/);
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(r2.put).toHaveBeenCalledOnce();
    const calls = r2.put.mock.calls as Array<[string, ...unknown[]]>;
    expect(calls[0]?.[0]).toMatch(/^backups\/db-/);
  });

  it("emits a success metric to Analytics Engine", async () => {
    const env: BackupEnv = { DB: db, R2_BUCKET: r2 as unknown as R2Bucket, AE_METRICS: ae };
    await runDailyBackup(env);
    expect(ae.writeDataPoint).toHaveBeenCalledOnce();
    const dpCalls = ae.writeDataPoint.mock.calls as Array<[{ blobs: string[] }]>;
    expect(dpCalls[0]?.[0].blobs[0]).toBe("success");
  });

  it("returns success=false and emits failure metric when R2 put throws", async () => {
    r2.put = vi.fn(async () => { throw new Error("R2 unavailable"); });
    const env: BackupEnv = { DB: db, R2_BUCKET: r2 as unknown as R2Bucket, AE_METRICS: ae };
    const result = await runDailyBackup(env);

    expect(result.success).toBe(false);
    expect(result.error).toContain("R2 unavailable");
    expect(ae.writeDataPoint).toHaveBeenCalledOnce();
    const dpCalls = ae.writeDataPoint.mock.calls as Array<[{ blobs: string[] }]>;
    expect(dpCalls[0]?.[0].blobs[0]).toBe("failure");
  });

  it("returns success=false and emits failure metric when DB query throws", async () => {
    const badDb = {
      prepare: vi.fn(() => ({
        all: vi.fn(async () => { throw new Error("D1 offline"); }),
        bind: vi.fn(() => ({ first: vi.fn(async () => { throw new Error("D1 offline"); }) })),
      })),
    } as unknown as D1Database;

    const env: BackupEnv = { DB: badDb, R2_BUCKET: r2 as unknown as R2Bucket, AE_METRICS: ae };
    const result = await runDailyBackup(env);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(ae.writeDataPoint).toHaveBeenCalledOnce();
    const dpCalls = ae.writeDataPoint.mock.calls as Array<[{ blobs: string[] }]>;
    expect(dpCalls[0]?.[0].blobs[0]).toBe("failure");
  });

  it("upload body contains valid SQL with COMMIT statement", async () => {
    const env: BackupEnv = { DB: db, R2_BUCKET: r2 as unknown as R2Bucket, AE_METRICS: ae };
    await runDailyBackup(env);
    const putCalls = r2.put.mock.calls as Array<[string, Uint8Array]>;
    const uploadedBody = putCalls[0]?.[1];
    const text = new TextDecoder().decode(uploadedBody);
    expect(text).toContain("COMMIT");
    expect(text).toContain("BEGIN TRANSACTION");
  });
});
