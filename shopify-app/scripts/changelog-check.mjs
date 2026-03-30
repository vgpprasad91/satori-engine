#!/usr/bin/env node
/**
 * PR-037: Shopify Partner Changelog check script
 *
 * Runs inside GitHub Actions (changelog-check.yml).
 * Uses the Cloudflare KV REST API to read/write the last-seen GUID,
 * fetches the Shopify changelog RSS feed, diffs, and emails via Resend.
 *
 * Required environment variables:
 *   CLOUDFLARE_ACCOUNT_ID
 *   CLOUDFLARE_API_TOKEN
 *   KV_NAMESPACE_ID       — production KV namespace for changelog state
 *   RESEND_API_KEY
 *   ALERT_EMAIL
 */

import { writeFileSync } from 'fs';

const {
  CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN,
  KV_NAMESPACE_ID,
  RESEND_API_KEY,
  ALERT_EMAIL,
} = process.env;

const SHOPIFY_CHANGELOG_RSS = 'https://changelog.shopify.com/rss.xml';
const KV_LAST_GUID_KEY = 'changelog:last_guid';
const CF_KV_BASE = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}`;

// ---------------------------------------------------------------------------
// KV helpers
// ---------------------------------------------------------------------------

async function kvGet(key) {
  const res = await fetch(`${CF_KV_BASE}/values/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`KV GET failed: ${res.status}`);
  return res.text();
}

async function kvPut(key, value) {
  const body = new FormData();
  body.append('value', value);
  body.append('metadata', '{}');
  const res = await fetch(`${CF_KV_BASE}/values/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` },
    body,
  });
  if (!res.ok) throw new Error(`KV PUT failed: ${res.status}`);
}

// ---------------------------------------------------------------------------
// RSS parser (no DOM, regex only)
// ---------------------------------------------------------------------------

function parseRssItems(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRe.exec(xml)) !== null) {
    const body = match[1];
    const guid = extractTag(body, 'guid') ?? extractTag(body, 'id') ?? '';
    const title = stripCdata(extractTag(body, 'title') ?? '');
    const link = extractTag(body, 'link') ?? '';
    const pubDate = extractTag(body, 'pubDate') ?? extractTag(body, 'updated') ?? '';
    const description = stripCdata(extractTag(body, 'description') ?? '');
    if (guid) items.push({ guid, title, link, pubDate, description });
  }
  return items;
}

function extractTag(xml, tag) {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml);
  return m ? m[1].trim() : null;
}

function stripCdata(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

// ---------------------------------------------------------------------------
// Email via Resend
// ---------------------------------------------------------------------------

async function sendEmail(entries) {
  const bullets = entries
    .map(
      (e) =>
        `<li><strong>${e.title}</strong><br/><a href="${e.link}">${e.link}</a><br/><em>${e.pubDate}</em><br/>${e.description.slice(0, 400)}</li>`
    )
    .join('\n');

  const html = `
    <h2>Shopify Partner Changelog — ${entries.length} new update(s)</h2>
    <ul>${bullets}</ul>
    <hr/>
    <p>Current pinned Shopify API version: <strong>2025-01</strong> (upgrade-by: 2025-10-01).</p>
    <p>See <code>RUNBOOK.md</code> → "Quarterly Shopify API Version Upgrade" for the upgrade procedure.</p>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'MailCraft Alerts <alerts@mailcraft-editor.pages.dev>',
      to: [ALERT_EMAIL],
      subject: `[MailCraft] Shopify changelog: ${entries.length} new update(s)`,
      html,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend email failed: ${res.status} ${text}`);
  }
  console.log('Email sent via Resend');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Fetching Shopify partner changelog RSS...');
  const rssRes = await fetch(SHOPIFY_CHANGELOG_RSS);
  if (!rssRes.ok) throw new Error(`RSS fetch failed: ${rssRes.status}`);
  const xml = await rssRes.text();

  const items = parseRssItems(xml);
  console.log(`Parsed ${items.length} RSS items`);

  if (items.length === 0) {
    console.log('No items in feed — exiting');
    // Set GitHub Actions output
    writeFileSync(process.env.GITHUB_OUTPUT ?? '/dev/null', 'new_count=0\n', { flag: 'a' });
    return;
  }

  const lastGuid = await kvGet(KV_LAST_GUID_KEY);
  console.log(`Last seen GUID from KV: ${lastGuid ?? '(none)'}`);

  const newEntries = [];
  for (const item of items) {
    if (item.guid === lastGuid) break;
    newEntries.push(item);
  }

  console.log(`New entries since last check: ${newEntries.length}`);

  // Always update KV to newest
  await kvPut(KV_LAST_GUID_KEY, items[0].guid);

  // Write artifact for GitHub Actions
  const diffPath = '/tmp/changelog-diff.json';
  writeFileSync(diffPath, JSON.stringify({ newEntries, checkedAt: new Date().toISOString() }, null, 2));

  // Set GitHub Actions output variable
  const ghOutput = process.env.GITHUB_OUTPUT ?? '/dev/null';
  writeFileSync(ghOutput, `new_count=${newEntries.length}\n`, { flag: 'a' });

  if (newEntries.length > 0) {
    console.log('Sending email digest...');
    await sendEmail(newEntries);
  } else {
    console.log('No new entries — skipping email');
  }

  console.log('Done');
}

main().catch((err) => {
  console.error('changelog-check failed:', err);
  process.exit(1);
});
