/**
 * Content-Security-Policy headers for Shopify embedded apps.
 *
 * Required by Shopify App Store review to ensure the app can only
 * be framed within the Shopify admin.
 */

const CSP_DIRECTIVES = [
  "frame-ancestors https://*.myshopify.com https://admin.shopify.com",
  "script-src 'self' 'unsafe-inline' https://cdn.shopify.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https: blob:",
  "connect-src 'self' https://*.shopify.com https://*.myshopify.com wss://*.shopify.com",
].join("; ");

/**
 * Apply CSP headers to any Response. Call this in the app's
 * entry.server or as middleware wrapping every response.
 */
export function withCspHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", CSP_DIRECTIVES);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * CSP header value for use in meta tags or manual header setting.
 */
export const CSP_HEADER_VALUE = CSP_DIRECTIVES;
