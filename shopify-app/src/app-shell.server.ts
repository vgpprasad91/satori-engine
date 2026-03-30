/**
 * PR-020: Embedded app shell — server-side helpers
 *
 * Provides pure functions for extracting App Bridge params from URL,
 * building navigation config, and determining accessibility hints.
 * These are intentionally side-effect free for easy unit testing.
 */

// ---------------------------------------------------------------------------
// App Bridge param extraction
// ---------------------------------------------------------------------------

export interface AppBridgeParams {
  apiKey: string;
  host: string;
}

/**
 * Extract the `apiKey` and `host` query params that Shopify injects into
 * every embedded app URL.  Returns null if either is missing.
 */
export function extractAppBridgeParams(
  url: string | URL,
  fallbackApiKey?: string
): AppBridgeParams | null {
  const parsed = typeof url === "string" ? new URL(url) : url;
  const host = parsed.searchParams.get("host");
  const apiKey =
    parsed.searchParams.get("apiKey") ??
    parsed.searchParams.get("api_key") ??
    fallbackApiKey ??
    null;

  if (!host || !apiKey) return null;

  return { host, apiKey };
}

// ---------------------------------------------------------------------------
// Navigation config
// ---------------------------------------------------------------------------

export interface NavItem {
  label: string;
  url: string;
  icon: string;
  ariaLabel: string;
  accessKey?: string;
}

/**
 * Top-level navigation items for the embedded app.
 * Order matches the PR-020 spec: Dashboard, Products, Templates, Settings, Billing.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    label: "Dashboard",
    url: "/app/dashboard",
    icon: "HomeMinor",
    ariaLabel: "Navigate to Dashboard",
    accessKey: "d",
  },
  {
    label: "Products",
    url: "/app/products",
    icon: "ProductsMinor",
    ariaLabel: "Navigate to Products",
    accessKey: "p",
  },
  {
    label: "Templates",
    url: "/app/templates",
    icon: "TemplateMinor",
    ariaLabel: "Navigate to Templates",
    accessKey: "t",
  },
  {
    label: "Settings",
    url: "/app/settings",
    icon: "SettingsMinor",
    ariaLabel: "Navigate to Settings",
    accessKey: "s",
  },
  {
    label: "Billing",
    url: "/app/billing",
    icon: "BillingStatementDollarMinor",
    ariaLabel: "Navigate to Billing",
    accessKey: "b",
  },
] as const;

// ---------------------------------------------------------------------------
// Accessibility helpers
// ---------------------------------------------------------------------------

/**
 * Returns a standard set of ARIA attributes for interactive nav items.
 * All custom components must include aria-label, role, and tabIndex per spec.
 */
export function navItemA11y(item: NavItem, isActive: boolean) {
  return {
    "aria-label": item.ariaLabel,
    "aria-current": isActive ? ("page" as const) : undefined,
    role: "link" as const,
    tabIndex: 0,
  } as const;
}

/**
 * Returns accessibility props for the top-level navigation landmark.
 */
export function navLandmarkA11y() {
  return {
    role: "navigation" as const,
    "aria-label": "Main navigation",
  } as const;
}

/**
 * Returns accessibility props for the main content area.
 */
export function mainContentA11y() {
  return {
    role: "main" as const,
    "aria-label": "Main content",
    tabIndex: -1,
    id: "main-content",
  } as const;
}

// ---------------------------------------------------------------------------
// Error message categorisation
// ---------------------------------------------------------------------------

export interface AppError {
  title: string;
  message: string;
  status?: "critical" | "warning" | "info";
}

/**
 * Map a raw error to a user-friendly AppError structure
 * suitable for display in a Polaris Banner.
 */
export function mapErrorToBanner(err: unknown): AppError {
  if (err instanceof Response) {
    const status = err.status;
    if (status === 401 || status === 403) {
      return {
        title: "Authentication required",
        message: "Your session has expired. Please refresh the page to log in again.",
        status: "warning",
      };
    }
    if (status === 404) {
      return {
        title: "Not found",
        message: "The requested resource could not be found.",
        status: "warning",
      };
    }
    if (status >= 500) {
      return {
        title: "Server error",
        message: "Something went wrong on our end. Please try again in a moment.",
        status: "critical",
      };
    }
  }

  if (err instanceof Error) {
    if (err.message.includes("quota_exceeded")) {
      return {
        title: "Monthly quota reached",
        message: "You've reached your monthly image generation limit. Upgrade your plan to continue.",
        status: "warning",
      };
    }
    return {
      title: "Unexpected error",
      message: err.message,
      status: "critical",
    };
  }

  return {
    title: "Unexpected error",
    message: "An unknown error occurred. Please refresh the page.",
    status: "critical",
  };
}

// ---------------------------------------------------------------------------
// Route code-splitting hints (consumed by Vite / Remix)
// ---------------------------------------------------------------------------

/** Route segments that should be lazy-loaded for <3s first paint */
export const LAZY_ROUTES = [
  "app.dashboard",
  "app.products",
  "app.templates",
  "app.settings",
  "app.billing",
] as const;
