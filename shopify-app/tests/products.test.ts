/**
 * PR-022: Products dashboard unit tests
 *
 * Tests:
 *  - listProducts: returns KV cache on hit, fetches D1 on miss, stores in KV
 *  - applyQuery: filter by status, sort by generated_at asc/desc, sort by title
 *  - bulkRequeue: skips pending items, marks others as pending, invalidates cache
 *  - invalidateProductsCache: deletes the KV key
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  applyQuery,
  listProducts,
  bulkRequeue,
  invalidateProductsCache,
} from "../src/products.server.js";
import type { ProductWithImage, ProductsEnv } from "../src/products.server.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProduct(overrides: Partial<ProductWithImage> = {}): ProductWithImage {
  return {
    id: "p1",
    shopify_product_id: "sp1",
    title: "Alpha Product",
    image_url: "https://cdn.shopify.com/image.jpg",
    last_synced: "2026-01-01T00:00:00Z",
    generated_image_status: "success",
    generated_image_r2_key: "shop/p1/abc.png",
    generated_at: "2026-01-02T10:00:00Z",
    error_message: null,
    ...overrides,
  };
}

const products: ProductWithImage[] = [
  makeProduct({ id: "p1", title: "Alpha", generated_image_status: "success", generated_at: "2026-01-03T00:00:00Z" }),
  makeProduct({ id: "p2", title: "Beta", generated_image_status: "failed", generated_at: "2026-01-02T00:00:00Z" }),
  makeProduct({ id: "p3", title: "Gamma", generated_image_status: "pending", generated_at: "2026-01-04T00:00:00Z" }),
  makeProduct({ id: "p4", title: "Delta", generated_image_status: null, generated_at: null }),
];

// ---------------------------------------------------------------------------
// applyQuery
// ---------------------------------------------------------------------------

describe("applyQuery", () => {
  it("returns all items when statusFilter is 'all'", () => {
    const result = applyQuery(products, { statusFilter: "all" });
    expect(result).toHaveLength(4);
  });

  it("filters by status 'success'", () => {
    const result = applyQuery(products, { statusFilter: "success" });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("p1");
  });

  it("filters by status 'failed'", () => {
    const result = applyQuery(products, { statusFilter: "failed" });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("p2");
  });

  it("filters by 'no_image' (null generated_image_status)", () => {
    const result = applyQuery(products, { statusFilter: "no_image" });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("p4");
  });

  it("sorts by generated_at desc (default)", () => {
    const result = applyQuery(products, { sortField: "generated_at", sortDir: "desc" });
    // p3 (2026-01-04) → p1 (2026-01-03) → p2 (2026-01-02) → p4 (null last)
    expect(result[0]!.id).toBe("p3");
    expect(result[1]!.id).toBe("p1");
    expect(result[2]!.id).toBe("p2");
    expect(result[3]!.id).toBe("p4"); // null last
  });

  it("sorts by generated_at asc", () => {
    const result = applyQuery(products, { sortField: "generated_at", sortDir: "asc" });
    expect(result[0]!.id).toBe("p2");
    expect(result[1]!.id).toBe("p1");
    expect(result[2]!.id).toBe("p3");
    expect(result[3]!.id).toBe("p4"); // null last
  });

  it("sorts by title asc", () => {
    const result = applyQuery(products, { sortField: "title", sortDir: "asc" });
    expect(result.map((r) => r.title)).toEqual(["Alpha", "Beta", "Delta", "Gamma"]);
  });

  it("sorts by title desc", () => {
    const result = applyQuery(products, { sortField: "title", sortDir: "desc" });
    expect(result.map((r) => r.title)).toEqual(["Gamma", "Delta", "Beta", "Alpha"]);
  });

  it("does not mutate the original array", () => {
    const original = [...products];
    applyQuery(products, { sortField: "title", sortDir: "asc" });
    expect(products).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// KV cache and listProducts
// ---------------------------------------------------------------------------

function makeEnv(overrides: {
  kvGet?: unknown;
  dbResults?: ProductWithImage[];
}): ProductsEnv {
  const { kvGet = null, dbResults = [] } = overrides;

  const kvPut = vi.fn().mockResolvedValue(undefined);
  const kvDelete = vi.fn().mockResolvedValue(undefined);
  const kvGetFn = vi.fn().mockResolvedValue(kvGet);

  const dbFirst = vi.fn().mockResolvedValue(null);
  const dbRun = vi.fn().mockResolvedValue({ meta: {} });
  const dbAll = vi.fn().mockResolvedValue({ results: dbResults });
  const dbBind = vi.fn().mockReturnValue({ first: dbFirst, run: dbRun, all: dbAll });
  const dbPrepare = vi.fn().mockReturnValue({ bind: dbBind });

  return {
    KV_STORE: {
      get: kvGetFn,
      put: kvPut,
      delete: kvDelete,
      list: vi.fn(),
      getWithMetadata: vi.fn(),
    } as unknown as KVNamespace,
    DB: {
      prepare: dbPrepare,
      exec: vi.fn(),
      batch: vi.fn(),
      dump: vi.fn(),
    } as unknown as D1Database,
  };
}

describe("listProducts — KV cache hit", () => {
  it("returns cached data without querying D1", async () => {
    const cached: ProductWithImage[] = [makeProduct({ id: "cached" })];
    const env = makeEnv({ kvGet: cached });
    const result = await listProducts("shop.myshopify.com", env);
    expect(result[0]!.id).toBe("cached");
    expect((env.DB.prepare as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

describe("listProducts — KV cache miss", () => {
  it("queries D1 and caches result when KV is empty", async () => {
    const dbRows: ProductWithImage[] = [
      makeProduct({ id: "db1" }),
      makeProduct({ id: "db2", generated_image_status: "failed" }),
    ];
    const env = makeEnv({ kvGet: null, dbResults: dbRows });
    const result = await listProducts("shop.myshopify.com", env);

    expect(result).toHaveLength(2);
    expect((env.KV_STORE.put as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });

  it("applies statusFilter after D1 fetch", async () => {
    const dbRows: ProductWithImage[] = [
      makeProduct({ id: "db1", generated_image_status: "success" }),
      makeProduct({ id: "db2", generated_image_status: "failed" }),
    ];
    const env = makeEnv({ kvGet: null, dbResults: dbRows });
    const result = await listProducts("shop.myshopify.com", env, {
      statusFilter: "failed",
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("db2");
  });
});

// ---------------------------------------------------------------------------
// invalidateProductsCache
// ---------------------------------------------------------------------------

describe("invalidateProductsCache", () => {
  it("deletes the KV key for the shop", async () => {
    const env = makeEnv({});
    await invalidateProductsCache("myshop.myshopify.com", env);
    expect((env.KV_STORE.delete as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      "products-list:myshop.myshopify.com"
    );
  });
});

// ---------------------------------------------------------------------------
// bulkRequeue
// ---------------------------------------------------------------------------

describe("bulkRequeue", () => {
  it("skips products with status 'pending'", async () => {
    const dbFirst = vi.fn().mockResolvedValue({ status: "pending" });
    const dbRun = vi.fn().mockResolvedValue({});
    const dbAll = vi.fn().mockResolvedValue({ results: [] });
    const dbBind = vi.fn().mockReturnValue({ first: dbFirst, run: dbRun, all: dbAll });
    const dbPrepare = vi.fn().mockReturnValue({ bind: dbBind });

    const kvDelete = vi.fn().mockResolvedValue(undefined);
    const env: ProductsEnv = {
      KV_STORE: {
        get: vi.fn(),
        put: vi.fn(),
        delete: kvDelete,
        list: vi.fn(),
        getWithMetadata: vi.fn(),
      } as unknown as KVNamespace,
      DB: {
        prepare: dbPrepare,
        exec: vi.fn(),
        batch: vi.fn(),
        dump: vi.fn(),
      } as unknown as D1Database,
    };

    const result = await bulkRequeue("shop.myshopify.com", ["p1"], env);
    expect(result.skipped).toContain("p1");
    expect(result.queued).toHaveLength(0);
    // Cache NOT invalidated since nothing was queued
    expect(kvDelete).not.toHaveBeenCalled();
  });

  it("queues non-pending products and invalidates cache", async () => {
    const dbFirst = vi.fn().mockResolvedValue({ status: "failed" });
    const dbRun = vi.fn().mockResolvedValue({});
    const dbAll = vi.fn().mockResolvedValue({ results: [] });
    const dbBind = vi.fn().mockReturnValue({ first: dbFirst, run: dbRun, all: dbAll });
    const dbPrepare = vi.fn().mockReturnValue({ bind: dbBind });

    const kvDelete = vi.fn().mockResolvedValue(undefined);
    const env: ProductsEnv = {
      KV_STORE: {
        get: vi.fn(),
        put: vi.fn(),
        delete: kvDelete,
        list: vi.fn(),
        getWithMetadata: vi.fn(),
      } as unknown as KVNamespace,
      DB: {
        prepare: dbPrepare,
        exec: vi.fn(),
        batch: vi.fn(),
        dump: vi.fn(),
      } as unknown as D1Database,
    };

    const result = await bulkRequeue("shop.myshopify.com", ["p2", "p3"], env);
    expect(result.queued).toContain("p2");
    expect(result.queued).toContain("p3");
    expect(result.skipped).toHaveLength(0);
    // Cache invalidated
    expect(kvDelete).toHaveBeenCalledWith("products-list:shop.myshopify.com");
  });

  it("handles products with no existing generated image (first is null)", async () => {
    const dbFirst = vi.fn().mockResolvedValue(null);
    const dbRun = vi.fn().mockResolvedValue({});
    const dbAll = vi.fn().mockResolvedValue({ results: [] });
    const dbBind = vi.fn().mockReturnValue({ first: dbFirst, run: dbRun, all: dbAll });
    const dbPrepare = vi.fn().mockReturnValue({ bind: dbBind });

    const kvDelete = vi.fn().mockResolvedValue(undefined);
    const env: ProductsEnv = {
      KV_STORE: {
        get: vi.fn(),
        put: vi.fn(),
        delete: kvDelete,
        list: vi.fn(),
        getWithMetadata: vi.fn(),
      } as unknown as KVNamespace,
      DB: {
        prepare: dbPrepare,
        exec: vi.fn(),
        batch: vi.fn(),
        dump: vi.fn(),
      } as unknown as D1Database,
    };

    const result = await bulkRequeue("shop.myshopify.com", ["pNew"], env);
    expect(result.queued).toContain("pNew");
    expect(result.skipped).toHaveLength(0);
  });
});
