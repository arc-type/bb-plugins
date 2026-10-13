import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    // Suites import `../app` statically, not with `loadPluginApp(() => import("../app"))`
    // inside a test: under gate load the cold transform of the whole bundle ran
    // inside the 5 s test timeout and failed the first test of the file (BBP-261).
    // A cold Vite cache can exceed the 10 s default when a suite loads the app bundle.
    hookTimeout: 30_000,
  },
});
