/**
 * PR-041: Bulk product import and per-category template assignment
 *
 * Features:
 *  - CSV upload for bulk product → template mapping
 *    Expected columns: product_id, title, image_url, category (optional), template_id (optional)
 *  - Background job for bulk processing with progress stored in KV
 *  - Per-category template assignment rule: all "Apparel" products use template X
 *
 * KV keys:
 *   bulk:{shop}:{jobId}          — BulkImportJob state (JSON)
 *   category-template:{shop}     — CategoryTemplateMap (JSON)
 *
 * Flow:
 *   1. Merchant uploads CSV → parseCsvRows() validates and normalises rows
 *   2. createBulkImportJob() stores job state in KV, returns jobId
 *   3. processBulkImportJob() runs rows sequentially, updating progress in KV
 *   4. Per-row template resolution: explicit template_id → category rule → shop default
 *   5. getBulkImportProgress() lets the UI poll KV for live progress
 */

import { log } from "./logger.js";
import { enqueueImageJob } from "./queue.server.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CsvProductRow {
  /** Shopify product ID (numeric string or GID). */
  product_id: string;
  /** Product display title. */
  title: string;
  /** Public CDN image URL. */
  image_url: string;
  /** Optional product category, e.g. "Apparel", "Home Goods". */
  category?: string;
  /** Optional explicit template ID to use for this product. */
  template_id?: string;
}

export interface BulkImportJob {
  jobId: string;
  shop: string;
  totalRows: number;
  processedRows: number;
  successRows: number;
  failedRows: number;
  status: "pending" | "running" | "completed" | "failed";
  errors: Array<{ rowIndex: number; productId: string; error: string }>;
  createdAt: string;
  completedAt: string | null;
}

/** Maps category names (lower-cased) to template IDs. */
export type CategoryTemplateMap = Record<string, string>;

export interface BulkImportEnv {
  KV_STORE: KVNamespace;
  DB: D1Database;
  IMAGE_QUEUE: Queue<import("./queue.server.js").ImageJob>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BULK_JOB_KEY_PREFIX = "bulk:" as const;
const CATEGORY_TEMPLATE_KEY_PREFIX = "category-template:" as const;
/** TTL for completed/failed job state in KV: 7 days. */
const JOB_TTL_SECONDS = 7 * 24 * 60 * 60;

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

/**
 * Parses raw CSV text into validated product rows.
 *
 * Required columns: product_id, title, image_url
 * Optional columns: category, template_id
 *
 * Returns `{ rows, parseErrors }`. Rows with missing required fields are
 * reported as errors and excluded from the returned rows array.
 */
export function parseCsvRows(csv: string): {
  rows: CsvProductRow[];
  parseErrors: Array<{ rowIndex: number; error: string }>;
} {
  const lines = csv
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0);

  if (lines.length < 2) {
    return {
      rows: [],
      parseErrors: [{ rowIndex: 0, error: "CSV must have a header row and at least one data row" }],
    };
  }

  // Parse header
  const headers = splitCsvLine(lines[0]!).map((h) => h.toLowerCase().trim());
  const requiredColumns = ["product_id", "title", "image_url"];
  const missingRequired = requiredColumns.filter((col) => !headers.includes(col));
  if (missingRequired.length > 0) {
    return {
      rows: [],
      parseErrors: [
        {
          rowIndex: 0,
          error: `Missing required columns: ${missingRequired.join(", ")}`,
        },
      ],
    };
  }

  const rows: CsvProductRow[] = [];
  const parseErrors: Array<{ rowIndex: number; error: string }> = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i]!);
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      record[h] = (values[idx] ?? "").trim();
    });

    const missing = requiredColumns.filter((col) => !(record[col] ?? ""));
    if (missing.length > 0) {
      parseErrors.push({
        rowIndex: i,
        error: `Row ${i}: missing required fields: ${missing.join(", ")}`,
      });
      continue;
    }

    rows.push({
      product_id: record["product_id"] as string,
      title: record["title"] as string,
      image_url: record["image_url"] as string,
      category: record["category"] || undefined,
      template_id: record["template_id"] || undefined,
    });
  }

  return { rows, parseErrors };
}

/**
 * Splits a single CSV line respecting double-quoted fields.
 */
export function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote inside quoted field
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ---------------------------------------------------------------------------
// Category template rules
// ---------------------------------------------------------------------------

/**
 * Saves per-category template assignment rules for a shop.
 * Merges with existing rules (new rules overwrite matching categories).
 */
export async function saveCategoryTemplateRules(
  shop: string,
  rules: CategoryTemplateMap,
  env: BulkImportEnv
): Promise<void> {
  const key = `${CATEGORY_TEMPLATE_KEY_PREFIX}${shop}`;
  const existing = await getCategoryTemplateRules(shop, env);
  const merged: CategoryTemplateMap = { ...existing };

  for (const [category, templateId] of Object.entries(rules)) {
    merged[category.toLowerCase()] = templateId;
  }

  await env.KV_STORE.put(key, JSON.stringify(merged));

  log({
    shop,
    step: "category_template_rules_saved",
    status: "ok",
    durationMs: 0,
  });
}

/**
 * Retrieves per-category template assignment rules for a shop.
 * Returns empty object if no rules are configured.
 */
export async function getCategoryTemplateRules(
  shop: string,
  env: BulkImportEnv
): Promise<CategoryTemplateMap> {
  const key = `${CATEGORY_TEMPLATE_KEY_PREFIX}${shop}`;
  const raw = await env.KV_STORE.get(key);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as CategoryTemplateMap;
  } catch {
    return {};
  }
}

/**
 * Resolves the template ID to use for a product row.
 *
 * Priority:
 *   1. Explicit template_id on the row
 *   2. Category-based rule (case-insensitive match)
 *   3. Shop-level default template from D1 merchants table
 *   4. Hard-coded fallback: "product-card"
 */
export async function resolveTemplateForRow(
  row: CsvProductRow,
  shop: string,
  categoryRules: CategoryTemplateMap,
  defaultTemplateId: string | null
): Promise<string> {
  if (row.template_id) return row.template_id;

  if (row.category) {
    const categoryKey = row.category.toLowerCase();
    if (categoryRules[categoryKey]) return categoryRules[categoryKey];
  }

  if (defaultTemplateId) return defaultTemplateId;

  return "product-card";
}

// ---------------------------------------------------------------------------
// Bulk import job lifecycle
// ---------------------------------------------------------------------------

/**
 * Creates a new bulk import job in KV and returns its ID.
 * The job starts in "pending" state — call processBulkImportJob() to run it.
 */
export async function createBulkImportJob(
  shop: string,
  rows: CsvProductRow[],
  env: BulkImportEnv
): Promise<BulkImportJob> {
  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job: BulkImportJob = {
    jobId,
    shop,
    totalRows: rows.length,
    processedRows: 0,
    successRows: 0,
    failedRows: 0,
    status: "pending",
    errors: [],
    createdAt: new Date().toISOString(),
    completedAt: null,
  };

  await saveJobState(shop, job, env);

  log({ shop, step: "bulk_import_job_created", status: "ok", durationMs: 0 });

  return job;
}

/**
 * Retrieves the current state of a bulk import job.
 * Returns null if the job does not exist.
 */
export async function getBulkImportProgress(
  shop: string,
  jobId: string,
  env: BulkImportEnv
): Promise<BulkImportJob | null> {
  const key = `${BULK_JOB_KEY_PREFIX}${shop}:${jobId}`;
  const raw = await env.KV_STORE.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BulkImportJob;
  } catch {
    return null;
  }
}

/**
 * Processes all rows for a bulk import job.
 *
 * For each row:
 *   1. Resolve template (explicit → category rule → default → fallback)
 *   2. Upsert product into D1 `products` table
 *   3. Enqueue an image generation job
 *   4. Update job progress in KV after every row
 *
 * The job transitions: pending → running → completed | failed
 */
export async function processBulkImportJob(
  job: BulkImportJob,
  rows: CsvProductRow[],
  locale: string,
  currencyFormat: string,
  brandKit: { primaryColor: string; logoR2Key?: string | null; fontFamily?: string | null },
  defaultTemplateId: string | null,
  env: BulkImportEnv
): Promise<BulkImportJob> {
  const categoryRules = await getCategoryTemplateRules(job.shop, env);

  job.status = "running";
  await saveJobState(job.shop, job, env);

  for (let i = 0; i < rows.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const row = rows[i]!;
    const start = Date.now();

    try {
      const templateId = await resolveTemplateForRow(row, job.shop, categoryRules, defaultTemplateId);

      // Upsert product into D1
      await upsertProduct(row, job.shop, env);

      // Enqueue image generation job
      await enqueueImageJob(
        {
          shop: job.shop,
          productId: row.product_id,
          productTitle: row.title,
          imageUrl: row.image_url,
          templateId,
          locale,
          currencyFormat,
          brandKit,
        },
        {
          IMAGE_QUEUE: env.IMAGE_QUEUE,
          KV_STORE: env.KV_STORE,
          DB: env.DB,
        }
      );

      job.successRows += 1;

      log({
        shop: job.shop,
        step: "bulk_import_row_success",
        status: "ok",
        durationMs: Date.now() - start,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      job.failedRows += 1;
      job.errors.push({ rowIndex: i + 1, productId: row.product_id, error: errorMsg });

      log({
        shop: job.shop,
        step: "bulk_import_row_failed",
        status: "error",
        durationMs: Date.now() - start,
        error: errorMsg,
      });
    }

    job.processedRows += 1;
    // Persist progress after every row so the UI can poll
    await saveJobState(job.shop, job, env);
  }

  job.status = job.failedRows > 0 && job.successRows === 0 ? "failed" : "completed";
  job.completedAt = new Date().toISOString();
  await saveJobState(job.shop, job, env);

  log({
    shop: job.shop,
    step: "bulk_import_job_completed",
    status: job.status === "completed" ? "ok" : "error",
    durationMs: 0,
  });

  return job;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function saveJobState(shop: string, job: BulkImportJob, env: BulkImportEnv): Promise<void> {
  const key = `${BULK_JOB_KEY_PREFIX}${shop}:${job.jobId}`;
  await env.KV_STORE.put(key, JSON.stringify(job), { expirationTtl: JOB_TTL_SECONDS });
}

async function upsertProduct(row: CsvProductRow, shop: string, env: BulkImportEnv): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO products (id, shop, shopify_product_id, title, image_url, last_synced)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       image_url = excluded.image_url,
       last_synced = excluded.last_synced`
  )
    .bind(
      `${shop}:${row.product_id}`,
      shop,
      row.product_id,
      row.title,
      row.image_url,
      new Date().toISOString()
    )
    .run();
}
