// Bundles the e2e fixture app (CanvasView + fixed data, no plugin host) into
// a static bundle.js/bundle.css that Playwright's webServer serves as-is —
// no dev server, no watch mode, just what `index.html` loads.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));

await build({
  entryPoints: [`${dir}fixture-app.tsx`],
  bundle: true,
  outfile: `${dir}dist/bundle.js`,
  format: "esm",
  jsx: "automatic",
  loader: { ".css": "css" },
});
