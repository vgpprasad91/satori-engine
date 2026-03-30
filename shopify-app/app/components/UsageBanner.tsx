/**
 * PR-025: UsageBanner — renders at top of every embedded app page.
 *
 * Warning  (>= 80%):  "You've used X of Y images this month — upgrade to avoid interruption"
 * Critical (>= 100%): "Image generation paused — upgrade your plan to resume"
 *
 * Dismissible per billing period via a server action that sets a KV flag.
 */

import { useFetcher } from "@remix-run/react";
import { Banner, Text } from "@shopify/polaris";

export interface UsageBannerProps {
  state: "warning" | "critical" | null;
  currentUsage: number;
  monthlyLimit: number;
}

export function UsageBanner({ state, currentUsage, monthlyLimit }: UsageBannerProps) {
  const fetcher = useFetcher();

  if (!state) return null;

  const handleDismiss = () => {
    fetcher.submit(null, { method: "POST", action: "/api/banner/dismiss" });
  };

  const isCritical = state === "critical";

  const title = isCritical
    ? "Image generation paused"
    : "Approaching image limit";

  const message = isCritical
    ? `Image generation paused — upgrade your plan to resume.`
    : `You've used ${currentUsage.toLocaleString()} of ${monthlyLimit.toLocaleString()} images this month — upgrade to avoid interruption.`;

  return (
    <div
      role="alert"
      aria-live="polite"
      aria-label={`Usage limit banner: ${title}`}
      style={{ marginBottom: "1rem" }}
    >
      <Banner
        title={title}
        tone={isCritical ? "critical" : "warning"}
        onDismiss={handleDismiss}
        action={{
          content: "Upgrade plan",
          url: "/app/billing",
        }}
      >
        <Text as="p" variant="bodyMd">
          {message}
        </Text>
      </Banner>
    </div>
  );
}
