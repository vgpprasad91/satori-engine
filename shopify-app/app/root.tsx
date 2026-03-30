import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
} from "@remix-run/react";
import type { LinksFunction } from "@remix-run/cloudflare";

export const links: LinksFunction = () => [
  {
    rel: "stylesheet",
    href: "https://unpkg.com/@shopify/polaris@latest/build/esm/styles.css",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* CSP for Shopify embedded app — full directives also set via server middleware */}
        <meta
          httpEquiv="Content-Security-Policy"
          content="frame-ancestors https://*.myshopify.com https://admin.shopify.com; script-src 'self' 'unsafe-inline' https://cdn.shopify.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; connect-src 'self' https://*.shopify.com https://*.myshopify.com wss://*.shopify.com"
        />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

// ---------------------------------------------------------------------------
// Root error boundary — accessible Polaris-inspired fallback.
// All custom interactive elements have aria-label, role, and tabIndex.
// ---------------------------------------------------------------------------

export function ErrorBoundary() {
  const error = useRouteError();

  let title = "Something went wrong";
  let message = "An unexpected error occurred. Please refresh the page.";
  let statusCode: number | null = null;

  if (isRouteErrorResponse(error)) {
    statusCode = error.status;
    if (error.status === 404) {
      title = "Page not found";
      message = "The page you were looking for doesn't exist.";
    } else if (error.status === 401 || error.status === 403) {
      title = "Authentication required";
      message = "Your session has expired. Please refresh to log in again.";
    } else {
      message = typeof error.data === "string" ? error.data : message;
    }
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Error — Shopify App</title>
        <Links />
      </head>
      <body>
        <div
          role="alert"
          aria-label="Application error"
          tabIndex={-1}
          style={{
            fontFamily: "system-ui, -apple-system, sans-serif",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            margin: 0,
            background: "#f6f6f7",
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 8,
              padding: "2rem 2.5rem",
              maxWidth: 480,
              width: "100%",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
              borderLeft: "4px solid #d82c0d",
            }}
          >
            {statusCode && (
              <p
                style={{ margin: "0 0 0.5rem", color: "#d82c0d", fontWeight: 700, fontSize: 14 }}
                aria-label={`HTTP error ${statusCode}`}
              >
                Error {statusCode}
              </p>
            )}
            <h1
              style={{ color: "#202223", marginTop: 0, fontSize: "1.25rem" }}
              tabIndex={-1}
            >
              {title}
            </h1>
            <p style={{ color: "#6d7175" }}>{message}</p>
            <a
              href="/"
              tabIndex={0}
              role="link"
              aria-label="Return to home page"
              style={{
                display: "inline-block",
                marginTop: "1rem",
                padding: "0.5rem 1.25rem",
                background: "#008060",
                color: "#fff",
                borderRadius: 4,
                textDecoration: "none",
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              Go home
            </a>
          </div>
        </div>
        <Scripts />
      </body>
    </html>
  );
}
