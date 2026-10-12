import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4174",
  },
  webServer: {
    // The fixture bundle is static; build it once, then the in-memory
    // server in `server.mjs` serves it and the two stand-in RPC routes.
    command: "node build.mjs && node server.mjs",
    cwd: "./e2e",
    url: "http://127.0.0.1:4174/index.html",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
