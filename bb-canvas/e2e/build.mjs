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

// Its own entry point (BBP-173/WI7): a page that must not share
// fixture-app.tsx's fixed-size wrapper, since the whole point is to render
// with no ancestor height at all.
await build({
  entryPoints: [`${dir}height-fixture.tsx`],
  bundle: true,
  outfile: `${dir}dist/height.js`,
  format: "esm",
  jsx: "automatic",
  loader: { ".css": "css" },
});
