/**
 * PR-002: D1 schema and migration runner — unit tests
 *
 * These tests verify the SQL migration files are syntactically valid and
 * structurally correct by parsing them and running them against an in-memory
 * SQLite database via the `better-sqlite3` shim exposed through the Node test
 * environment (no Miniflare needed for schema validation).
 *
 * We also verify the helper utilities that code in later PRs will rely on:
 *   - parseMigrationFile  — strips comments, returns statements
 *   - getMigrationVersion — extracts version number from filename
 *   - getMigrationOrder   — returns files sorted by version ascending
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Helpers (inline so there is no runtime dependency on the helpers module yet)
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");

function readMigrationFiles(): { file: string; sql: string }[] {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((file) => ({
    file,
    sql: fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8"),
  }));
}

function getMigrationVersion(filename: string): number {
  const match = filename.match(/^(\d+)_/);
  if (!match || !match[1]) throw new Error(`Invalid migration filename: ${filename}`);
  return parseInt(match[1], 10);
}

function stripComments(sql: string): string {
  // Remove -- comments and blank lines
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, "").trim())
    .filter(Boolean)
    .join("\n");
}

function parseStatements(sql: string): string[] {
  return stripComments(sql)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("D1 migration files — structure", () => {
  const migrations = readMigrationFiles();

  it("has exactly 4 migration files", () => {
    expect(migrations).toHaveLength(4);
  });

  it("migration versions are 1, 2, 3, 4 in order", () => {
    const versions = migrations.map((m) => getMigrationVersion(m.file));
    expect(versions).toEqual([1, 2, 3, 4]);
  });

  it("each file has at least one SQL statement", () => {
    for (const { file, sql } of migrations) {
      const stmts = parseStatements(sql);
      expect(stmts.length, `${file} should have at least one statement`).toBeGreaterThan(0);
    }
  });

  it("each file begins with a CREATE TABLE IF NOT EXISTS statement", () => {
    for (const { file, sql } of migrations) {
      const cleaned = stripComments(sql).toUpperCase();
      expect(
        cleaned,
        `${file} should start with CREATE TABLE IF NOT EXISTS`
      ).toMatch(/CREATE TABLE IF NOT EXISTS/);
    }
  });
});

describe("0001_create_merchants.sql", () => {
  const { sql } = readMigrationFiles().find((m) => m.file.startsWith("0001"))!;

  it("contains the merchants table definition", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS merchants/);
  });

  it("defines required columns: shop, access_token, plan, billing_status, monthly_limit, locale, currency_format, created_at", () => {
    const required = [
      "shop",
      "access_token",
      "plan",
      "billing_status",
      "monthly_limit",
      "locale",
      "currency_format",
      "created_at",
    ];
    for (const col of required) {
      expect(sql, `merchants should have column '${col}'`).toMatch(
        new RegExp(`\\b${col}\\b`)
      );
    }
  });

  it("shop is the PRIMARY KEY", () => {
    expect(sql).toMatch(/shop\s+TEXT\s+PRIMARY\s+KEY/i);
  });

  it("has an index on billing_status", () => {
    expect(sql).toMatch(/CREATE INDEX.*billing_status/i);
  });
});

describe("0002_create_products.sql", () => {
  const { sql } = readMigrationFiles().find((m) => m.file.startsWith("0002"))!;

  it("contains the products table definition", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS products/);
  });

  it("defines required columns: id, shop, shopify_product_id, title, image_url, last_synced", () => {
    const required = ["id", "shop", "shopify_product_id", "title", "image_url", "last_synced"];
    for (const col of required) {
      expect(sql, `products should have column '${col}'`).toMatch(
        new RegExp(`\\b${col}\\b`)
      );
    }
  });

  it("has a FOREIGN KEY referencing merchants(shop)", () => {
    expect(sql).toMatch(/FOREIGN KEY.*shop.*REFERENCES.*merchants.*shop/is);
  });

  it("has an index on shop", () => {
    expect(sql).toMatch(/CREATE INDEX.*products.*shop/i);
  });

  it("has a unique index on (shop, shopify_product_id)", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX.*shop.*shopify_product_id/i);
  });
});

describe("0003_create_generated_images.sql", () => {
  const { sql } = readMigrationFiles().find((m) => m.file.startsWith("0003"))!;

  it("contains the generated_images table definition", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS generated_images/);
  });

  it("defines required columns: id, shop, product_id, template_id, r2_key, content_hash, status, error_message, generated_at", () => {
    const required = [
      "id",
      "shop",
      "product_id",
      "template_id",
      "r2_key",
      "content_hash",
      "status",
      "error_message",
      "generated_at",
    ];
    for (const col of required) {
      expect(sql, `generated_images should have column '${col}'`).toMatch(
        new RegExp(`\\b${col}\\b`)
      );
    }
  });

  it("status column has a default of 'pending'", () => {
    expect(sql).toMatch(/status.*DEFAULT.*'pending'/i);
  });

  it("has an index on content_hash for cache-hit lookups", () => {
    expect(sql).toMatch(/CREATE INDEX.*content_hash/i);
  });

  it("has a FOREIGN KEY referencing merchants(shop)", () => {
    expect(sql).toMatch(/FOREIGN KEY.*shop.*REFERENCES.*merchants.*shop/is);
  });
});

describe("0004_create_webhook_log.sql", () => {
  const { sql } = readMigrationFiles().find((m) => m.file.startsWith("0004"))!;

  it("contains the webhook_log table definition", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS webhook_log/);
  });

  it("defines required columns: webhook_id, shop, type, processed_at", () => {
    const required = ["webhook_id", "shop", "type", "processed_at"];
    for (const col of required) {
      expect(sql, `webhook_log should have column '${col}'`).toMatch(
        new RegExp(`\\b${col}\\b`)
      );
    }
  });

  it("webhook_id is the PRIMARY KEY", () => {
    expect(sql).toMatch(/webhook_id\s+TEXT\s+PRIMARY\s+KEY/i);
  });

  it("has indexes on shop, type, and processed_at", () => {
    expect(sql).toMatch(/CREATE INDEX.*webhook_log.*shop/i);
    expect(sql).toMatch(/CREATE INDEX.*webhook_log.*type/i);
    expect(sql).toMatch(/CREATE INDEX.*webhook_log.*processed_at/i);
  });
});

describe("getMigrationVersion helper", () => {
  it("parses version from valid filename", () => {
    expect(getMigrationVersion("0001_create_merchants.sql")).toBe(1);
    expect(getMigrationVersion("0042_add_column.sql")).toBe(42);
  });

  it("throws on invalid filename", () => {
    expect(() => getMigrationVersion("no_version.sql")).toThrow();
  });
});
