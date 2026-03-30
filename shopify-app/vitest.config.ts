import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // Only enforce thresholds on the business logic in src/ (not app/ JSX routes
      // which require a browser DOM environment to execute).
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
      thresholds: {
        // Global statement coverage floor for src/ — PRs that regress below
        // these values will fail in CI (npx vitest run --coverage).
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90,
      },
      reporter: ["text", "lcov", "json-summary"],
    },
  },
});
