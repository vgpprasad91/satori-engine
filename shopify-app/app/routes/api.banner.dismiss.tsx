/**
 * PR-025: Banner dismiss action — POST /api/banner/dismiss
 *
 * Sets a KV flag that suppresses the usage banner for the current billing
 * period. The flag expires after 32 days so it resets naturally next month.
 */

import type { ActionFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { shopifyAuth } from "../../src/auth.server.js";
import type { ShopifyEnv } from "../../src/auth.server.js";
import { dismissBanner } from "../../src/usage-banner.server.js";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = (
    context as {
      cloudflare: {
        env: ShopifyEnv & { KV_STORE: KVNamespace };
      };
    }
  ).cloudflare.env;

  const auth = await shopifyAuth(request, env);
  if (!auth) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  await dismissBanner(auth.shop, env.KV_STORE);

  return json({ ok: true });
}
