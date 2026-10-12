// The page a Playwright run drives (BBP-171): CrewFrameEditor alone, no
// plugin host — `installTestPluginRuntime()` is just plain JS (sets
// `globalThis.__bbPluginRuntime`), so it works the same in a real browser as
// in vitest, and gives the Inspector's Icon/ProviderModelPicker something to
// resolve to without a full BB host.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { CrewFrameEditor } from "../components/crew-frame-editor";

installTestPluginRuntime();

function FixturePage() {
  const [yaml, setYaml] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    fetch("/api/crew")
      .then((response) => response.json())
      .then((result: { yaml: string }) => setYaml(result.yaml));
  }, []);

  if (yaml === null) return <p>Loading…</p>;

  return (
    <div>
      <CrewFrameEditor
        yaml={yaml}
        onChange={(next) => {
          setYaml(next);
          setApplied(false);
        }}
      />
      <button
        type="button"
        onClick={() => {
          void fetch("/api/apply", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ yaml }),
          }).then(() => setApplied(true));
        }}
      >
        Apply
      </button>
      {applied ? <p data-applied>Applied</p> : null}
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(<FixturePage />);
