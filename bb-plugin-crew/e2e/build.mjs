// Bundles the e2e fixture app into dist/bundle.{js,css} — no dev server, no
// plugin build pipeline, same spirit as bb-canvas/e2e/build.mjs. The plugin's
// own `@/*` path alias (tsconfig.json) isn't something esbuild knows about on
// its own, hence the small resolver plugin below.
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("..", import.meta.url));

/** `@/components/ui/icon` -> the actual file, trying the extensions esbuild
 *  itself would for an extensionless import. */
function resolveAtPath(relative) {
  const base = `${root}${relative}`;
  for (const extension of ["", ".tsx", ".ts"]) {
    if (existsSync(`${base}${extension}`)) return `${base}${extension}`;
  }
  return base;
}

const atAlias = {
  name: "at-alias",
  setup(build) {
    build.onResolve({ filter: /^@\// }, (args) => ({
      path: resolveAtPath(args.path.slice(2)),
    }));
  },
};

await build({
  entryPoints: [`${dir}fixture-app.tsx`],
  bundle: true,
  outfile: `${dir}dist/bundle.js`,
  format: "esm",
  jsx: "automatic",
  loader: { ".css": "css" },
  plugins: [atAlias],
});
