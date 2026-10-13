import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mirror the `@/*` alias from tsconfig so component tests resolve the
  // vendored UI the same way `bb plugin build` does.
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup-plugin-runtime.ts"],
    // The suites that capture the plugin app import `../app` statically, not
    // with `loadPluginApp(() => import("../app"))` in `beforeAll`: under load
    // the cold transform of the whole bundle exceeded the hook timeout and the
    // hook skipped its tests (BBP-260). A skipped hook does not fail loudly — a
    // green run that quietly tested nothing is worse than a slow one.
    hookTimeout: 30_000,
  },
});
