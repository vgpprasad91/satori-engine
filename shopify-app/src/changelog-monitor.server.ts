/**
 * PR-037: Shopify Partner Changelog Monitor
 *
 * Fetches the Shopify Partner changelog RSS feed, diffs against the last known
 * entry stored in KV, and emails any new entries via Resend.
 *
 * KV key: changelog:last_guid — stores the GUID of the most-recently-seen entry.
 *
 * Called from GitHub Actions (`changelog-check.yml`) via an internal HTTP
 * endpoint OR directly as a Cloudflare Cron Trigger handler.
 */

import { log } from './logger';

export const SHOPIFY_CHANGELOG_RSS_URL =
  'https://changelog.shopify.com/rss.xml';

export const KV_LAST_GUID_KEY = 'changelog:last_guid';

export interface ChangelogEntry {
  guid: string;
  title: string;
  link: string;
  pubDate: string;
  description: string;
}

/**
 * Minimal RSS parser — extracts <item> nodes from an RSS XML string.
 * Uses regex because Cloudflare Workers have no DOM/DOMParser for XML.
 */
export function parseRssItems(xml: string): ChangelogEntry[] {
  const items: ChangelogEntry[] = [];
  const itemPattern = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemPattern.exec(xml)) !== null) {
    const body = match[1];

    const guid = extractTag(body, 'guid') ?? extractTag(body, 'id') ?? '';
    const title = stripCdata(extractTag(body, 'title') ?? '');
    const link = extractTag(body, 'link') ?? extractTag(body, 'url') ?? '';
    const pubDate = extractTag(body, 'pubDate') ?? extractTag(body, 'updated') ?? '';
    const description = stripCdata(
      extractTag(body, 'description') ?? extractTag(body, 'summary') ?? ''
    );

    if (guid) {
      items.push({ guid, title, link, pubDate, description });
    }
  }

  return items;
}

function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = re.exec(xml);
  return m ? m[1].trim() : null;
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

export interface ChangelogMonitorDeps {
  kv: KVNamespace;
  resendApiKey: string;
  alertEmail: string;
  fetch?: typeof globalThis.fetch;
}

export interface ChangelogCheckResult {
  newEntries: ChangelogEntry[];
  emailSent: boolean;
  lastGuid: string;
}

/**
 * Main changelog check function.
 * 1. Fetch RSS feed.
 * 2. Parse items.
 * 3. Load last seen GUID from KV.
 * 4. Collect all entries newer than the last GUID.
 * 5. If any new entries: send email via Resend, update KV.
 */
export async function checkShopifyChangelog(
  deps: ChangelogMonitorDeps,
  rssUrl = SHOPIFY_CHANGELOG_RSS_URL
): Promise<ChangelogCheckResult> {
  const fetchFn = deps.fetch ?? globalThis.fetch;

  // 1. Fetch RSS
  const response = await fetchFn(rssUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Shopify changelog RSS: ${response.status} ${response.statusText}`
    );
  }
  const xml = await response.text();

  // 2. Parse
  const items = parseRssItems(xml);
  if (items.length === 0) {
    return { newEntries: [], emailSent: false, lastGuid: '' };
  }

  // 3. Load last known GUID from KV
  const lastGuid = (await deps.kv.get(KV_LAST_GUID_KEY)) ?? '';

  // 4. Collect new entries (all entries with a different GUID than lastGuid,
  //    stopping at lastGuid so we only get items published after last check)
  const newEntries: ChangelogEntry[] = [];
  for (const item of items) {
    if (item.guid === lastGuid) break;
    newEntries.push(item);
  }

  // 5. Persist the newest GUID (first item in RSS is always newest)
  const newestGuid = items[0].guid;
  await deps.kv.put(KV_LAST_GUID_KEY, newestGuid);

  let emailSent = false;

  if (newEntries.length > 0) {
    await sendChangelogEmail(deps, newEntries);
    emailSent = true;

    log({
      step: 'changelog_monitor',
      status: 'new_entries',
      durationMs: 0,
      error: undefined,
      // extra metadata (non-sensitive)
    });
  }

  return { newEntries, emailSent, lastGuid: newestGuid };
}

/**
 * Send a digest email via Resend listing all new changelog entries.
 */
async function sendChangelogEmail(
  deps: ChangelogMonitorDeps,
  entries: ChangelogEntry[]
): Promise<void> {
  const fetchFn = deps.fetch ?? globalThis.fetch;

  const bulletPoints = entries
    .map(
      (e) =>
        `<li><strong>${e.title}</strong> — <a href="${e.link}">${e.link}</a><br/>${e.pubDate}<br/>${e.description.slice(0, 300)}</li>`
    )
    .join('\n');

  const html = `
    <h2>Shopify Partner Changelog — ${entries.length} new update(s)</h2>
    <ul>${bulletPoints}</ul>
    <p>Review each entry for breaking changes, deprecated endpoints, or new API features that may require action.</p>
    <p>Current pinned Shopify API version: <strong>2025-01</strong> (upgrade-by: 2025-10-01).<br/>
    See RUNBOOK.md "Quarterly Shopify API Version Upgrade" for the upgrade procedure.</p>
  `;

  const body = JSON.stringify({
    from: 'MailCraft Alerts <alerts@mailcraft-editor.pages.dev>',
    to: [deps.alertEmail],
    subject: `[MailCraft] Shopify changelog: ${entries.length} new update(s)`,
    html,
  });

  const res = await fetchFn('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${deps.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend email failed: ${res.status} ${text}`);
  }
}
