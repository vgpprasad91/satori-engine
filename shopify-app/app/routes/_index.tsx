import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { json, redirect } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import { shopifyAuth } from "../../src/auth.server.js";
import type { ShopifyEnv } from "../../src/auth.server.js";

export const meta: MetaFunction = () => [
  { title: "Shopify App" },
  { name: "description", content: "Your Shopify embedded app." },
];

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context as { cloudflare: { env: ShopifyEnv } }).cloudflare.env;
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return json({ authenticated: false as const, shop: null, scopes: null });
  }

  // Enforce OAuth session — redirect to /auth if session missing/expired
  const auth = await shopifyAuth(request, env);
  if (!auth) {
    return redirect(`/auth?shop=${shop}`);
  }

  return json({
    authenticated: true as const,
    shop: auth.shop,
    scopes: env.SHOPIFY_SCOPES ?? "(not set)",
  });
}

export default function Index() {
  const data = useLoaderData<typeof loader>();

  if (!data.authenticated) {
    return (
      <main
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          background: "#f6f6f7",
        }}
      >
        <div
          style={{
            background: "#fff",
            borderRadius: 8,
            padding: "2rem 2.5rem",
            maxWidth: 540,
            width: "100%",
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          }}
        >
          <h1 style={{ marginTop: 0, color: "#1a1a1a" }}>Shopify App</h1>
          <p style={{ color: "#555" }}>
            Install this app on a Shopify store to get started.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#f6f6f7",
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: "2rem 2.5rem",
          maxWidth: 540,
          width: "100%",
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        }}
      >
        <h1 style={{ marginTop: 0, color: "#1a1a1a" }}>Shopify App</h1>
        <p style={{ color: "#555" }}>
          Connected to <strong>{data.shop}</strong>
        </p>

        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginTop: "1.5rem",
            fontSize: 14,
          }}
        >
          <tbody>
            <tr>
              <td
                style={{
                  padding: "0.5rem 0.75rem",
                  color: "#666",
                  fontWeight: 600,
                  width: 140,
                  borderBottom: "1px solid #eee",
                }}
              >
                Shop
              </td>
              <td
                style={{
                  padding: "0.5rem 0.75rem",
                  color: "#333",
                  borderBottom: "1px solid #eee",
                  fontFamily: "monospace",
                  wordBreak: "break-all",
                }}
              >
                {data.shop}
              </td>
            </tr>
            <tr>
              <td
                style={{
                  padding: "0.5rem 0.75rem",
                  color: "#666",
                  fontWeight: 600,
                }}
              >
                Scopes
              </td>
              <td
                style={{
                  padding: "0.5rem 0.75rem",
                  color: "#333",
                  fontFamily: "monospace",
                }}
              >
                {data.scopes}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>
  );
}
