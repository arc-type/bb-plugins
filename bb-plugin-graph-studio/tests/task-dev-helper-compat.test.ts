import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { compileRunSpec } from "../lib/task-dev";
import { emptyRunState, parseFields, resolveNext } from "../lib/graph";

it.each(["error", "red", ""])("preserves fatal helper failures unless classified as error: %s", kind => {
  const root = mkdtempSync(join(tmpdir(), "td-helper-compat-"));
  try {
    const helper = join(root, "helper.sh");
    const output = JSON.stringify({ ok: false, ...(kind ? { kind } : {}) });
    writeFileSync(helper, `#!/bin/sh\nprintf '%s\\n' '${output}'\nexit 2\n`);
    chmodSync(helper, 0o755);
    const spec = JSON.parse(readFileSync(new URL("./fixtures/task-dev/demo/demo.run-spec.json", import.meta.url), "utf8"));
    const compiled = compileRunSpec(spec, { helper });
    if (!compiled.ok) throw new Error(compiled.errors.join());
    const preflight = compiled.run.graph.nodes.find(n => n.id === "preflight")!;
    const result = spawnSync("bash", ["-c", preflight.command], { encoding: "utf8" });
    expect(preflight.failOnExit).toBe(true);
    expect(result.status).toBe(kind === "error" ? 0 : 2);
    expect(JSON.parse(result.stdout.trim())).toEqual(JSON.parse(output));
    if (kind === "error") {
      const state = emptyRunState("");
      state.fields.preflight = parseFields(preflight.fields, result.stdout);
      expect(resolveNext(compiled.run.graph, "preflight", state)).toBe("preflight-ask");
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
