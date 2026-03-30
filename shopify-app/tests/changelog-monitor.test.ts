import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseRssItems,
  checkShopifyChangelog,
  SHOPIFY_CHANGELOG_RSS_URL,
  KV_LAST_GUID_KEY,
  type ChangelogEntry,
  type ChangelogMonitorDeps,
} from '../src/changelog-monitor.server';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRss(items: Array<{ guid: string; title: string; pubDate: string }>): string {
  const itemXml = items
    .map(
      (i) => `
    <item>
      <guid>${i.guid}</guid>
      <title>${i.title}</title>
      <link>https://changelog.shopify.com/${i.guid}</link>
      <pubDate>${i.pubDate}</pubDate>
      <description>Description for ${i.title}</description>
    </item>`
    )
    .join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel>${itemXml}</channel></rss>`;
}

function makeKv(initial: Record<string, string> = {}): KVNamespace {
  const store: Record<string, string> = { ...initial };
  return {
    get: vi.fn(async (key: string) => store[key] ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    delete: vi.fn(async (key: string) => {
      delete store[key];
    }),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cursor: undefined })),
    getWithMetadata: vi.fn(async (key: string) => ({ value: store[key] ?? null, metadata: null })),
  } as unknown as KVNamespace;
}

function makeFetch(rssXml: string, emailOk = true) {
  return vi.fn(async (url: string, options?: RequestInit) => {
    if (typeof url === 'string' && url.includes('resend.com')) {
      return {
        ok: emailOk,
        status: emailOk ? 200 : 500,
        text: async () => (emailOk ? '{"id":"em_1"}' : 'server error'),
        json: async () => ({ id: 'em_1' }),
      } as Response;
    }
    // RSS feed
    return {
      ok: true,
      status: 200,
      text: async () => rssXml,
    } as Response;
  });
}

// ---------------------------------------------------------------------------
// parseRssItems
// ---------------------------------------------------------------------------

describe('parseRssItems', () => {
  it('extracts items from valid RSS XML', () => {
    const xml = buildRss([
      { guid: 'guid-1', title: 'New Feature A', pubDate: 'Mon, 10 Mar 2026 12:00:00 +0000' },
      { guid: 'guid-2', title: 'Deprecated: Old API', pubDate: 'Sun, 09 Mar 2026 08:00:00 +0000' },
    ]);
    const items = parseRssItems(xml);
    expect(items).toHaveLength(2);
    expect(items[0].guid).toBe('guid-1');
    expect(items[0].title).toBe('New Feature A');
    expect(items[1].guid).toBe('guid-2');
  });

  it('returns empty array for XML with no items', () => {
    const xml = '<?xml version="1.0"?><rss><channel></channel></rss>';
    expect(parseRssItems(xml)).toHaveLength(0);
  });

  it('strips CDATA wrappers from title and description', () => {
    const xml = `<rss><channel><item>
      <guid>g1</guid>
      <title><![CDATA[API Version 2026-01 Released]]></title>
      <link>https://example.com</link>
      <pubDate>Fri, 01 Jan 2026 00:00:00 +0000</pubDate>
      <description><![CDATA[This is the <b>description</b>]]></description>
    </item></channel></rss>`;
    const items = parseRssItems(xml);
    expect(items[0].title).toBe('API Version 2026-01 Released');
    expect(items[0].description).toContain('description');
  });

  it('skips items with no GUID', () => {
    const xml = `<rss><channel>
      <item><title>No GUID item</title><link>https://x.com</link></item>
      <item><guid>has-guid</guid><title>With GUID</title><link>https://x.com</link></item>
    </channel></rss>`;
    const items = parseRssItems(xml);
    expect(items).toHaveLength(1);
    expect(items[0].guid).toBe('has-guid');
  });
});

// ---------------------------------------------------------------------------
// checkShopifyChangelog — no previous state
// ---------------------------------------------------------------------------

describe('checkShopifyChangelog — first run (no lastGuid in KV)', () => {
  it('treats all items as new on first run and sends email', async () => {
    const xml = buildRss([
      { guid: 'g3', title: 'Feature C', pubDate: 'Wed, 12 Mar 2026 10:00:00 +0000' },
      { guid: 'g2', title: 'Feature B', pubDate: 'Tue, 11 Mar 2026 10:00:00 +0000' },
    ]);
    const kv = makeKv(); // empty
    const fetchMock = makeFetch(xml);
    const deps: ChangelogMonitorDeps = {
      kv,
      resendApiKey: 'test-key',
      alertEmail: 'admin@example.com',
      fetch: fetchMock,
    };

    const result = await checkShopifyChangelog(deps);

    expect(result.newEntries).toHaveLength(2);
    expect(result.emailSent).toBe(true);
    expect(result.lastGuid).toBe('g3'); // newest GUID persisted
    expect(kv.put).toHaveBeenCalledWith(KV_LAST_GUID_KEY, 'g3');
  });
});

// ---------------------------------------------------------------------------
// checkShopifyChangelog — subsequent run with new entries
// ---------------------------------------------------------------------------

describe('checkShopifyChangelog — subsequent run with new entries', () => {
  it('only returns entries published after lastGuid', async () => {
    const xml = buildRss([
      { guid: 'g5', title: 'Feature E', pubDate: 'Fri, 14 Mar 2026 10:00:00 +0000' },
      { guid: 'g4', title: 'Feature D', pubDate: 'Thu, 13 Mar 2026 10:00:00 +0000' },
      { guid: 'g3', title: 'Feature C', pubDate: 'Wed, 12 Mar 2026 10:00:00 +0000' }, // last seen
    ]);
    const kv = makeKv({ [KV_LAST_GUID_KEY]: 'g3' });
    const fetchMock = makeFetch(xml);
    const deps: ChangelogMonitorDeps = {
      kv,
      resendApiKey: 'test-key',
      alertEmail: 'admin@example.com',
      fetch: fetchMock,
    };

    const result = await checkShopifyChangelog(deps);

    expect(result.newEntries).toHaveLength(2);
    expect(result.newEntries[0].guid).toBe('g5');
    expect(result.newEntries[1].guid).toBe('g4');
    expect(result.emailSent).toBe(true);
    expect(result.lastGuid).toBe('g5');
  });
});

// ---------------------------------------------------------------------------
// checkShopifyChangelog — no new entries
// ---------------------------------------------------------------------------

describe('checkShopifyChangelog — no new entries', () => {
  it('does not send email when nothing is new', async () => {
    const xml = buildRss([
      { guid: 'g3', title: 'Feature C', pubDate: 'Wed, 12 Mar 2026 10:00:00 +0000' },
    ]);
    const kv = makeKv({ [KV_LAST_GUID_KEY]: 'g3' }); // already seen
    const fetchMock = makeFetch(xml);
    const deps: ChangelogMonitorDeps = {
      kv,
      resendApiKey: 'test-key',
      alertEmail: 'admin@example.com',
      fetch: fetchMock,
    };

    const result = await checkShopifyChangelog(deps);

    expect(result.newEntries).toHaveLength(0);
    expect(result.emailSent).toBe(false);
    // fetch was only called once (RSS) — not for Resend
    const resendCalls = (fetchMock.mock.calls as unknown[]).filter(
      (c) => Array.isArray(c) && typeof c[0] === 'string' && (c[0] as string).includes('resend')
    );
    expect(resendCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// checkShopifyChangelog — RSS fetch failure
// ---------------------------------------------------------------------------

describe('checkShopifyChangelog — RSS fetch failure', () => {
  it('throws when the RSS feed returns a non-200 status', async () => {
    const kv = makeKv();
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => '',
    })) as unknown as typeof globalThis.fetch;

    const deps: ChangelogMonitorDeps = {
      kv,
      resendApiKey: 'key',
      alertEmail: 'admin@example.com',
      fetch: fetchMock,
    };

    await expect(checkShopifyChangelog(deps)).rejects.toThrow(/503/);
  });
});

// ---------------------------------------------------------------------------
// checkShopifyChangelog — Resend email failure
// ---------------------------------------------------------------------------

describe('checkShopifyChangelog — Resend failure', () => {
  it('throws when Resend returns a non-200 status', async () => {
    const xml = buildRss([
      { guid: 'g1', title: 'New Feature', pubDate: 'Mon, 10 Mar 2026 12:00:00 +0000' },
    ]);
    const kv = makeKv();
    const fetchMock = makeFetch(xml, false /* email fails */);
    const deps: ChangelogMonitorDeps = {
      kv,
      resendApiKey: 'bad-key',
      alertEmail: 'admin@example.com',
      fetch: fetchMock,
    };

    await expect(checkShopifyChangelog(deps)).rejects.toThrow(/Resend email failed/);
  });
});

// ---------------------------------------------------------------------------
// checkShopifyChangelog — empty RSS
// ---------------------------------------------------------------------------

describe('checkShopifyChangelog — empty RSS feed', () => {
  it('returns empty result when no items are in the feed', async () => {
    const kv = makeKv();
    const fetchMock = makeFetch('<?xml version="1.0"?><rss><channel></channel></rss>');
    const deps: ChangelogMonitorDeps = {
      kv,
      resendApiKey: 'key',
      alertEmail: 'admin@example.com',
      fetch: fetchMock,
    };

    const result = await checkShopifyChangelog(deps);
    expect(result.newEntries).toHaveLength(0);
    expect(result.emailSent).toBe(false);
    expect(result.lastGuid).toBe('');
  });
});
