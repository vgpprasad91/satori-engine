import { defineConfig } from "vite";
import { vitePlugin as remix } from "@remix-run/dev";
import { cloudflareDevProxyVitePlugin as remixCloudflare } from "@remix-run/dev";

declare module "@remix-run/cloudflare" {
  interface Future {
    v3_singleFetch: true;
  }
}

export default defineConfig({
  plugins: [
    remixCloudflare(),
    remix({
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
        v3_singleFetch: true,
        v3_lazyRouteDiscovery: true,
      },
    }),
  ],
  build: {
    target: "ES2022",
    minify: true,
    sourcemap: true,
  },
  ssr: {
    target: "webworker",
    noExternal: true,
    resolve: {
      conditions: ["worker", "browser"],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react/jsx-runtime",
      ],
    },
  },
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["tests/setup.ts"],
  },
});
