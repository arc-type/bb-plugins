import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
  },
  webServer: {
    // The fixture bundle is static; build it once, then serve the folder with
    // the no-dependency server in `serve.mjs`.
    command: "node build.mjs && node serve.mjs",
    cwd: "./e2e",
    url: "http://127.0.0.1:4173/index.html",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
