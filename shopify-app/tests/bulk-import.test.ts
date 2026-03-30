/**
 * PR-041: Bulk product import and per-category template assignment — unit tests
 *
 * Tests:
 *  - parseCsvRows: valid CSV, missing required columns, missing required fields, quoted fields
 *  - splitCsvLine: plain values, quoted values, escaped quotes, empty fields
 *  - saveCategoryTemplateRules / getCategoryTemplateRules: round-trip, merge, case-insensitive
 *  - resolveTemplateForRow: explicit template_id, category rule, default, fallback
 *  - createBulkImportJob: creates job in pending state
 *  - getBulkImportProgress: returns null for unknown job, returns job for known job
 *  - processBulkImportJob: success path, row failure, progress updates, final status
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseCsvRows,
  splitCsvLine,
  saveCategoryTemplateRules,
  getCategoryTemplateRules,
  resolveTemplateForRow,
  createBulkImportJob,
  getBulkImportProgress,
  processBulkImportJob,
  type BulkImportEnv,
  type CsvProductRow,
} from "../src/bulk-import.server.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeKv(data: Record<string, string> = {}) {
  const store = new Map(Object.entries(data));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string, _opts?: unknown) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }),
    getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null }),
    _store: store,
  };
}

function makeDb(runResult: unknown = { success: true }) {
  const stmt = {
    bind: vi.fn().mockReturnThis(),
    run: vi.fn().mockResolvedValue(runResult),
    first: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue({ results: [] }),
  };
  return {
    prepare: vi.fn().mockReturnValue(stmt),
    _stmt: stmt,
  };
}

function makeQueue() {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    sendBatch: vi.fn().mockResolvedValue(undefined),
  };
}

function makeEnv(overrides: Partial<BulkImportEnv> = {}): BulkImportEnv {
  return {
    KV_STORE: makeKv() as unknown as KVNamespace,
    DB: makeDb() as unknown as D1Database,
    IMAGE_QUEUE: makeQueue() as unknown as Queue<any>,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// splitCsvLine
// ---------------------------------------------------------------------------

describe("splitCsvLine", () => {
  it("splits plain comma-separated values", () => {
    expect(splitCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("handles quoted fields with commas inside", () => {
    expect(splitCsvLine('"hello, world",foo,bar')).toEqual(["hello, world", "foo", "bar"]);
  });

  it("handles escaped quotes inside quoted fields", () => {
    expect(splitCsvLine('"say ""hi""",x')).toEqual(['say "hi"', "x"]);
  });

  it("handles empty fields", () => {
    expect(splitCsvLine("a,,c")).toEqual(["a", "", "c"]);
  });

  it("handles a single value with no commas", () => {
    expect(splitCsvLine("only")).toEqual(["only"]);
  });
});

// ---------------------------------------------------------------------------
// parseCsvRows
// ---------------------------------------------------------------------------

describe("parseCsvRows", () => {
  const VALID_CSV = [
    "product_id,title,image_url,category,template_id",
    "p1,Widget A,https://cdn.shopify.com/widget-a.jpg,Apparel,template-001",
    "p2,Widget B,https://cdn.shopify.com/widget-b.jpg,Home Goods,",
    "p3,Widget C,https://cdn.shopify.com/widget-c.jpg,,",
  ].join("\n");

  it("parses a valid CSV with all columns", () => {
    const { rows, parseErrors } = parseCsvRows(VALID_CSV);
    expect(parseErrors).toHaveLength(0);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      product_id: "p1",
      title: "Widget A",
      image_url: "https://cdn.shopify.com/widget-a.jpg",
      category: "Apparel",
      template_id: "template-001",
    });
  });

  it("returns undefined for empty optional fields", () => {
    const { rows } = parseCsvRows(VALID_CSV);
    expect(rows[1]!.template_id).toBeUndefined();
    expect(rows[2]!.category).toBeUndefined();
    expect(rows[2]!.template_id).toBeUndefined();
  });

  it("reports error for CSV with only a header row", () => {
    const { rows, parseErrors } = parseCsvRows("product_id,title,image_url");
    expect(rows).toHaveLength(0);
    expect(parseErrors[0]!.error).toMatch(/at least one data row/);
  });

  it("reports error for missing required columns", () => {
    const { rows, parseErrors } = parseCsvRows("product_id,title\np1,Widget A");
    expect(rows).toHaveLength(0);
    expect(parseErrors[0]!.error).toMatch(/Missing required columns/);
    expect(parseErrors[0]!.error).toMatch(/image_url/);
  });

  it("skips rows with missing required fields and reports errors", () => {
    const csv = [
      "product_id,title,image_url",
      "p1,,https://cdn.shopify.com/a.jpg",
      "p2,Valid,https://cdn.shopify.com/b.jpg",
    ].join("\n");
    const { rows, parseErrors } = parseCsvRows(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.product_id).toBe("p2");
    expect(parseErrors).toHaveLength(1);
    expect(parseErrors[0]!.rowIndex).toBe(1);
    expect(parseErrors[0]!.error).toMatch(/title/);
  });

  it("handles CRLF line endings", () => {
    const csv = "product_id,title,image_url\r\np1,A,https://cdn.shopify.com/a.jpg";
    const { rows, parseErrors } = parseCsvRows(csv);
    expect(parseErrors).toHaveLength(0);
    expect(rows).toHaveLength(1);
  });

  it("handles quoted fields in data rows", () => {
    const csv = [
      "product_id,title,image_url",
      'p1,"Widget, Special",https://cdn.shopify.com/a.jpg',
    ].join("\n");
    const { rows } = parseCsvRows(csv);
    expect(rows[0]!.title).toBe("Widget, Special");
  });
});

// ---------------------------------------------------------------------------
// Category template rules
// ---------------------------------------------------------------------------

describe("getCategoryTemplateRules", () => {
  it("returns empty object when no rules stored", async () => {
    const env = makeEnv();
    const rules = await getCategoryTemplateRules("test.myshopify.com", env);
    expect(rules).toEqual({});
  });

  it("returns stored rules", async () => {
    const kv = makeKv({
      "category-template:test.myshopify.com": JSON.stringify({ apparel: "t-001" }),
    });
    const env = makeEnv({ KV_STORE: kv as unknown as KVNamespace });
    const rules = await getCategoryTemplateRules("test.myshopify.com", env);
    expect(rules).toEqual({ apparel: "t-001" });
  });
});

describe("saveCategoryTemplateRules", () => {
  it("saves rules in lower-cased form", async () => {
    const kv = makeKv();
    const env = makeEnv({ KV_STORE: kv as unknown as KVNamespace });
    await saveCategoryTemplateRules("shop.myshopify.com", { Apparel: "t-001", "Home Goods": "t-002" }, env);
    const raw = kv._store.get("category-template:shop.myshopify.com")!;
    const stored = JSON.parse(raw);
    expect(stored["apparel"]).toBe("t-001");
    expect(stored["home goods"]).toBe("t-002");
  });

  it("merges with existing rules", async () => {
    const kv = makeKv({
      "category-template:shop.myshopify.com": JSON.stringify({ apparel: "t-001" }),
    });
    const env = makeEnv({ KV_STORE: kv as unknown as KVNamespace });
    await saveCategoryTemplateRules("shop.myshopify.com", { Electronics: "t-003" }, env);
    const raw = kv._store.get("category-template:shop.myshopify.com")!;
    const stored = JSON.parse(raw);
    expect(stored["apparel"]).toBe("t-001");
    expect(stored["electronics"]).toBe("t-003");
  });

  it("overwrites existing category with new template", async () => {
    const kv = makeKv({
      "category-template:shop.myshopify.com": JSON.stringify({ apparel: "t-001" }),
    });
    const env = makeEnv({ KV_STORE: kv as unknown as KVNamespace });
    await saveCategoryTemplateRules("shop.myshopify.com", { Apparel: "t-999" }, env);
    const raw = kv._store.get("category-template:shop.myshopify.com")!;
    const stored = JSON.parse(raw);
    expect(stored["apparel"]).toBe("t-999");
  });
});

// ---------------------------------------------------------------------------
// resolveTemplateForRow
// ---------------------------------------------------------------------------

describe("resolveTemplateForRow", () => {
  const categoryRules = { apparel: "t-apparel", "home goods": "t-home" };
  const shop = "shop.myshopify.com";

  it("returns explicit template_id from row (highest priority)", async () => {
    const row: CsvProductRow = {
      product_id: "p1",
      title: "Shirt",
      image_url: "https://example.com/shirt.jpg",
      category: "Apparel",
      template_id: "explicit-template",
    };
    const result = await resolveTemplateForRow(row, shop, categoryRules, "default-template");
    expect(result).toBe("explicit-template");
  });

  it("falls back to category rule when no explicit template_id", async () => {
    const row: CsvProductRow = {
      product_id: "p2",
      title: "Shirt",
      image_url: "https://example.com/shirt.jpg",
      category: "Apparel",
    };
    const result = await resolveTemplateForRow(row, shop, categoryRules, "default-template");
    expect(result).toBe("t-apparel");
  });

  it("category matching is case-insensitive", async () => {
    const row: CsvProductRow = {
      product_id: "p3",
      title: "Couch",
      image_url: "https://example.com/couch.jpg",
      category: "HOME GOODS",
    };
    const result = await resolveTemplateForRow(row, shop, categoryRules, "default-template");
    expect(result).toBe("t-home");
  });

  it("falls back to default template when no category rule", async () => {
    const row: CsvProductRow = {
      product_id: "p4",
      title: "Gadget",
      image_url: "https://example.com/gadget.jpg",
      category: "Electronics",
    };
    const result = await resolveTemplateForRow(row, shop, categoryRules, "default-template");
    expect(result).toBe("default-template");
  });

  it("falls back to hard-coded fallback when no default template", async () => {
    const row: CsvProductRow = {
      product_id: "p5",
      title: "Gadget",
      image_url: "https://example.com/gadget.jpg",
    };
    const result = await resolveTemplateForRow(row, shop, {}, null);
    expect(result).toBe("product-card");
  });
});

// ---------------------------------------------------------------------------
// createBulkImportJob
// ---------------------------------------------------------------------------

describe("createBulkImportJob", () => {
  it("creates a job in pending state with correct row count", async () => {
    const env = makeEnv();
    const rows: CsvProductRow[] = [
      { product_id: "p1", title: "A", image_url: "https://example.com/a.jpg" },
      { product_id: "p2", title: "B", image_url: "https://example.com/b.jpg" },
    ];
    const job = await createBulkImportJob("shop.myshopify.com", rows, env);

    expect(job.status).toBe("pending");
    expect(job.totalRows).toBe(2);
    expect(job.processedRows).toBe(0);
    expect(job.successRows).toBe(0);
    expect(job.failedRows).toBe(0);
    expect(job.errors).toHaveLength(0);
    expect(job.completedAt).toBeNull();
    expect(job.jobId).toBeTruthy();
    expect(job.shop).toBe("shop.myshopify.com");
  });

  it("stores job state in KV", async () => {
    const kv = makeKv();
    const env = makeEnv({ KV_STORE: kv as unknown as KVNamespace });
    const rows: CsvProductRow[] = [
      { product_id: "p1", title: "A", image_url: "https://example.com/a.jpg" },
    ];
    const job = await createBulkImportJob("shop.myshopify.com", rows, env);

    const stored = kv._store.get(`bulk:shop.myshopify.com:${job.jobId}`);
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.status).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// getBulkImportProgress
// ---------------------------------------------------------------------------

describe("getBulkImportProgress", () => {
  it("returns null for unknown job", async () => {
    const env = makeEnv();
    const result = await getBulkImportProgress("shop.myshopify.com", "nonexistent", env);
    expect(result).toBeNull();
  });

  it("returns job state for known job", async () => {
    const shop = "shop.myshopify.com";
    const jobId = "job-123";
    const jobData = {
      jobId,
      shop,
      totalRows: 5,
      processedRows: 3,
      successRows: 3,
      failedRows: 0,
      status: "running",
      errors: [],
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    const kv = makeKv({ [`bulk:${shop}:${jobId}`]: JSON.stringify(jobData) });
    const env = makeEnv({ KV_STORE: kv as unknown as KVNamespace });

    const result = await getBulkImportProgress(shop, jobId, env);
    expect(result).not.toBeNull();
    expect(result!.processedRows).toBe(3);
    expect(result!.status).toBe("running");
  });
});

// ---------------------------------------------------------------------------
// processBulkImportJob
// ---------------------------------------------------------------------------

describe("processBulkImportJob", () => {
  const shop = "shop.myshopify.com";
  const brandKit = { primaryColor: "#0052CC" };
  const locale = "en";
  const currencyFormat = "${{amount}}";

  function makeRows(count: number): CsvProductRow[] {
    return Array.from({ length: count }, (_, i) => ({
      product_id: `p${i + 1}`,
      title: `Product ${i + 1}`,
      image_url: `https://example.com/p${i + 1}.jpg`,
    }));
  }

  it("processes all rows successfully and sets status to completed", async () => {
    const env = makeEnv();
    const rows = makeRows(3);
    const jobInit = await createBulkImportJob(shop, rows, env);

    const finalJob = await processBulkImportJob(
      jobInit,
      rows,
      locale,
      currencyFormat,
      brandKit,
      null,
      env
    );

    expect(finalJob.status).toBe("completed");
    expect(finalJob.processedRows).toBe(3);
    expect(finalJob.successRows).toBe(3);
    expect(finalJob.failedRows).toBe(0);
    expect(finalJob.errors).toHaveLength(0);
    expect(finalJob.completedAt).not.toBeNull();
  });

  it("records row-level failures and still completes the job", async () => {
    // Make the queue throw on every other product
    const queue = makeQueue();
    let callCount = 0;
    queue.send.mockImplementation(async () => {
      callCount++;
      if (callCount % 2 === 0) throw new Error("queue send failed");
    });
    const env = makeEnv({ IMAGE_QUEUE: queue as unknown as Queue<any> });
    const rows = makeRows(4);
    const jobInit = await createBulkImportJob(shop, rows, env);

    const finalJob = await processBulkImportJob(
      jobInit,
      rows,
      locale,
      currencyFormat,
      brandKit,
      null,
      env
    );

    expect(finalJob.processedRows).toBe(4);
    expect(finalJob.failedRows).toBe(2);
    expect(finalJob.successRows).toBe(2);
    expect(finalJob.errors).toHaveLength(2);
    expect(finalJob.status).toBe("completed"); // some succeeded
  });

  it("sets status to failed when ALL rows fail", async () => {
    const queue = makeQueue();
    queue.send.mockRejectedValue(new Error("always fails"));
    const env = makeEnv({ IMAGE_QUEUE: queue as unknown as Queue<any> });
    const rows = makeRows(2);
    const jobInit = await createBulkImportJob(shop, rows, env);

    const finalJob = await processBulkImportJob(
      jobInit,
      rows,
      locale,
      currencyFormat,
      brandKit,
      null,
      env
    );

    expect(finalJob.status).toBe("failed");
    expect(finalJob.failedRows).toBe(2);
    expect(finalJob.successRows).toBe(0);
  });

  it("updates KV progress after each row (intermediate state visible)", async () => {
    const kv = makeKv();
    const env = makeEnv({ KV_STORE: kv as unknown as KVNamespace });
    const rows = makeRows(2);
    const jobInit = await createBulkImportJob(shop, rows, env);

    // Track KV put calls count (excluding the initial createBulkImportJob put)
    const putCallsBefore = (kv.put as ReturnType<typeof vi.fn>).mock.calls.length;

    await processBulkImportJob(jobInit, rows, locale, currencyFormat, brandKit, null, env);

    // Should have put at least once per row + once for final status + one for "running"
    const putCallsAfter = (kv.put as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(putCallsAfter - putCallsBefore).toBeGreaterThanOrEqual(3); // running + 2 row updates + final
  });

  it("uses category rule to assign template to matching rows", async () => {
    const kv = makeKv({
      "category-template:shop.myshopify.com": JSON.stringify({ apparel: "apparel-template" }),
    });
    const queue = makeQueue();
    const env = makeEnv({
      KV_STORE: kv as unknown as KVNamespace,
      IMAGE_QUEUE: queue as unknown as Queue<any>,
    });

    const rows: CsvProductRow[] = [
      { product_id: "p1", title: "Shirt", image_url: "https://example.com/shirt.jpg", category: "Apparel" },
    ];
    const jobInit = await createBulkImportJob(shop, rows, env);
    await processBulkImportJob(jobInit, rows, locale, currencyFormat, brandKit, null, env);

    const sentJob = (queue.send as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(sentJob.templateId).toBe("apparel-template");
  });

  it("uses explicit template_id over category rule", async () => {
    const kv = makeKv({
      "category-template:shop.myshopify.com": JSON.stringify({ apparel: "apparel-template" }),
    });
    const queue = makeQueue();
    const env = makeEnv({
      KV_STORE: kv as unknown as KVNamespace,
      IMAGE_QUEUE: queue as unknown as Queue<any>,
    });

    const rows: CsvProductRow[] = [
      {
        product_id: "p1",
        title: "Shirt",
        image_url: "https://example.com/shirt.jpg",
        category: "Apparel",
        template_id: "override-template",
      },
    ];
    const jobInit = await createBulkImportJob(shop, rows, env);
    await processBulkImportJob(jobInit, rows, locale, currencyFormat, brandKit, null, env);

    const sentJob = (queue.send as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(sentJob.templateId).toBe("override-template");
  });

  it("uses default template when row has no template_id and no matching category", async () => {
    const queue = makeQueue();
    const env = makeEnv({ IMAGE_QUEUE: queue as unknown as Queue<any> });

    const rows: CsvProductRow[] = [
      { product_id: "p1", title: "Widget", image_url: "https://example.com/w.jpg", category: "Unknown" },
    ];
    const jobInit = await createBulkImportJob(shop, rows, env);
    await processBulkImportJob(jobInit, rows, locale, currencyFormat, brandKit, "shop-default-tpl", env);

    const sentJob = (queue.send as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(sentJob.templateId).toBe("shop-default-tpl");
  });
});
