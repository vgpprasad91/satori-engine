/**
 * PR-020: Embedded app shell — Polaris + App Bridge navigation wrapper
 *
 * Wraps all authenticated app routes with:
 *  - Polaris AppProvider (i18n, theme)
 *  - Polaris Frame with top-level Navigation
 *  - Main content area with proper ARIA landmarks
 *  - Error boundary with Polaris Banner fallback
 */

import React, { Suspense } from "react";
import {
  AppProvider,
  Frame,
  Navigation,
  SkeletonPage,
  SkeletonBodyText,
  SkeletonDisplayText,
  Banner,
  Text,
  Box,
  InlineStack,
  Link,
} from "@shopify/polaris";
import { useLocation, useNavigate } from "@remix-run/react";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import type { NavItem } from "../../src/app-shell.server.js";
import { NAV_ITEMS, navLandmarkA11y, mainContentA11y } from "../../src/app-shell.server.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AppShellProps {
  apiKey: string;
  host: string;
  children: React.ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  error: unknown;
}

// ---------------------------------------------------------------------------
// Error boundary (class component — required for componentDidCatch)
// ---------------------------------------------------------------------------

export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  AppErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // Surface to Sentry if available in browser context
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    if (g?.Sentry?.captureException) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      g.Sentry.captureException(error, { extra: info });
    }
  }

  override render() {
    if (this.state.hasError) {
      const msg =
        this.state.error instanceof Error
          ? this.state.error.message
          : "An unexpected error occurred. Please refresh the page.";

      // Polaris Banner used for Polaris-style error display (no unsupported role/aria props)
      return (
        <Box padding="400">
          <div role="alert" aria-label="Application error banner">
            <Banner
              title="Something went wrong"
              tone="critical"
              action={{
                content: "Reload page",
                // globalThis.location is available in browser environments
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onAction: () => (globalThis as any).location?.reload?.(),
              }}
            >
              <Text as="p">{msg}</Text>
            </Banner>
          </div>
        </Box>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Loading skeleton for data-fetching routes
// ---------------------------------------------------------------------------

export function RouteLoadingSkeleton() {
  return (
    <div role="status" aria-label="Loading page content" aria-live="polite">
      <SkeletonPage primaryAction>
        <Box paddingBlockEnd="400">
          <SkeletonDisplayText size="small" />
        </Box>
        <SkeletonBodyText lines={3} />
        <Box paddingBlockStart="400">
          <SkeletonBodyText lines={6} />
        </Box>
      </SkeletonPage>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Navigation item builder
// ---------------------------------------------------------------------------

function buildNavItems(
  items: readonly NavItem[],
  currentPath: string,
  navigate: (url: string) => void
) {
  return items.map((item) => ({
    label: item.label,
    url: item.url,
    selected: currentPath.startsWith(item.url),
    onClick: () => navigate(item.url),
    accessibilityLabel: item.ariaLabel,
  }));
}

// ---------------------------------------------------------------------------
// Main AppShell component
// ---------------------------------------------------------------------------

export function AppShell({ apiKey: _apiKey, host: _host, children }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const navItems = buildNavItems(NAV_ITEMS, location.pathname, navigate);

  const navigationMarkup = (
    <nav {...navLandmarkA11y()}>
      <Navigation location={location.pathname}>
        <Navigation.Section items={navItems} />
      </Navigation>
    </nav>
  );

  return (
    <AppProvider i18n={polarisTranslations}>
      <Frame navigation={navigationMarkup}>
        <AppErrorBoundary>
          <main {...mainContentA11y()}>
            <Suspense fallback={<RouteLoadingSkeleton />}>
              {children}
            </Suspense>
          </main>
          {/* Legal footer — links open in new tab outside embedded app frame */}
          <Box
            paddingInlineStart="400"
            paddingInlineEnd="400"
            paddingBlockStart="300"
            paddingBlockEnd="300"
          >
            <InlineStack gap="400" align="center">
              <Text as="span" variant="bodySm" tone="subdued">
                &copy; {new Date().getFullYear()} MailCraft
              </Text>
              <Link
                url="https://legal.mailcraft-editor.pages.dev/privacy-policy.html"
                external
                monochrome
              >
                Privacy Policy
              </Link>
              <Link
                url="https://legal.mailcraft-editor.pages.dev/terms-of-service.html"
                external
                monochrome
              >
                Terms of Service
              </Link>
            </InlineStack>
          </Box>
        </AppErrorBoundary>
      </Frame>
    </AppProvider>
  );
}

export default AppShell;
