/**
 * Listen — the settings page.
 *
 * Everything a fresh install needs lives here, in the order someone new hits
 * it: install the runtime, download a model, point BB at it. Nothing in this
 * plugin requires editing a file or knowing npm, which is the whole reason
 * this page exists rather than a README.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  definePluginApp,
  useBbContext,
  useBbNavigate,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import type { ModelState, SetupState, VoiceState } from "./contract";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Check, Close, SpeakerOff, SpeakerOn } from "./components/speech-icons";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  createRowSync,
  rowStatuses,
  SPEAKER_ICON,
  type RowStatus,
} from "./lib/speech/thread-rows";

interface State {
  setup: SetupState;
  sttModels: ModelState[];
  voices: VoiceState[];
  config: { language: string; voiceModel: string; voiceSid: number };
  settings: PageSettings;
  transcriptionSetting: string;
  active: boolean;
}

type PageSettings = {
  primaryLanguage: string;
  secondaryLanguage: string;
  primaryVoice: { id: string; sid: number };
  secondaryVoice: { id: string; sid: number };
  model: string;
  summarize: boolean;
  summaryBackend: "thread" | "api";
  summaryThreadProvider: string;
  summaryThreadModel: string;
  summaryApiModel: string;
  summaryApiUrl: string;
  hasApiKey: boolean;
};

type Catalog = {
  providers: { id: string; name: string; available: boolean }[];
  models: { model: string; name: string; isDefault: boolean }[];
  automatic: { provider: string; model: string } | null;
};

/** The whole page's data, refetched whenever the host reports movement. */
function useListenState() {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);

  const report = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);
  const refetch = useCallback(() => {
    rpc.call("state", null).then((next) => {
      setState(next as State);
      setError(null);
    }, report);
  }, [rpc, report]);

  useEffect(refetch, [refetch]);
  // A download publishes about once a second; the page re-reads rather than
  // accumulating bytes from the signal, so a dropped one self-corrects.
  useRealtime("listen-changed", refetch);

  return { rpc, state, error, report, refetch };
}

function Section({
  title,
  description,
  collapsible = false,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** Starts collapsed; the title becomes the toggle. */
  collapsible?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(!collapsible);
  return (
    <section className="mt-6 first:mt-0">
      <h3 className="text-sm font-medium">
        {collapsible ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="flex items-center gap-1.5 text-left"
          >
            <span
              aria-hidden
              className={cn("inline-block text-xs transition-transform", open && "rotate-90")}
            >
              ▸
            </span>
            {title}
          </button>
        ) : (
          title
        )}
      </h3>
      {open && description !== undefined ? (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      ) : null}
      {open ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}

function formatMB(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/** Five dots, filled to the rating — the catalog's own scale. */
function Rating({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1" title={`${label}: ${value} of 5`}>
      <span className="text-muted-foreground">{label}</span>
      <span aria-label={`${value} of 5`}>
        {"●".repeat(value)}
        <span className="text-muted-foreground/40">{"○".repeat(5 - value)}</span>
      </span>
    </span>
  );
}

function SetupCard({
  setup,
  transcriptionSetting,
  active,
  onInstall,
}: {
  setup: SetupState;
  transcriptionSetting: string;
  active: boolean;
  onInstall: () => void;
}) {
  const { runtime, device } = setup;
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      {runtime.unsupported === null ? null : (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {runtime.unsupported}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            Speech runtime{" "}
            {runtime.installed ? (
              <span className="text-muted-foreground">
                — installed
                {runtime.source === "pi" ? " (using your pi-listen copy)" : ""}
              </span>
            ) : (
              <span className="text-muted-foreground">— not installed</span>
            )}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            sherpa-onnx, about 33 MB. Downloaded once per machine, into this
            plugin's own directory.
          </p>
        </div>
        {runtime.installed ? (
          <Check className="size-5 text-muted-foreground" />
        ) : (
          <Button
            onClick={onInstall}
            disabled={runtime.installing || runtime.unsupported !== null}
          >
            {runtime.installing ? "Installing…" : "Install runtime"}
          </Button>
        )}
      </div>

      {runtime.error === null ? null : (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {runtime.error}
        </p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Machine</dt>
          <dd>
            {device.platform}/{device.arch}, {device.cpus} cores
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Memory</dt>
          <dd>{formatMB(device.totalRamMB)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Free disk</dt>
          <dd>{device.freeDiskMB === 0 ? "unknown" : formatMB(device.freeDiskMB)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">ffmpeg</dt>
          <dd>{setup.ffmpeg ? "found" : "not on PATH"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Node</dt>
          <dd>{setup.node === null ? "not on PATH" : "found"}</dd>
        </div>
      </dl>

      {setup.node !== null ? null : (
        <p className="mt-3 text-sm text-muted-foreground">
          Speaking needs Node on PATH. BB's own binary is Electron, which
          refuses the audio buffers the speech engine produces, so synthesis
          runs in a separate Node process. Recognition works without it.
        </p>
      )}

      {setup.ffmpeg ? null : (
        <p className="mt-3 text-sm text-muted-foreground">
          BB records compressed audio, which needs ffmpeg to decode. Install it
          (<code>brew install ffmpeg</code> on macOS) or transcription will fail
          with that message.
        </p>
      )}

      <div className="mt-4 border-t border-border pt-4">
        <p className="text-sm font-medium">
          Point BB at this plugin{" "}
          {active ? (
            <span className="text-muted-foreground">— active</span>
          ) : (
            <span className="text-muted-foreground">— not active yet</span>
          )}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick Listen for voice input in Settings → AI services, or run this
          command. The microphone in the composer then uses the model below.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Input
            readOnly
            value={transcriptionSetting}
            aria-label="Command that selects this plugin"
            className="font-mono text-xs"
          />
          <Button
            variant="secondary"
            onClick={() => {
              void navigator.clipboard.writeText(transcriptionSetting);
            }}
          >
            Copy
          </Button>
        </div>
      </div>
    </div>
  );
}

function ModelRow({
  model,
  active,
  runtimeReady,
  onUse,
  onDownload,
  onCancel,
  onDelete,
}: {
  model: ModelState;
  active: boolean;
  runtimeReady: boolean;
  onUse: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const percent =
    model.progress === null || model.progress.totalBytes === 0
      ? 0
      : Math.min(
          100,
          Math.round(
            (model.progress.downloadedBytes / model.progress.totalBytes) * 100,
          ),
        );
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-medium">{model.name}</span>
          {active ? (
            <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
              in use
            </span>
          ) : null}
          {model.recommended ? (
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              recommended
            </span>
          ) : null}
          {model.source === "pi" ? (
            <span className="ml-2 text-xs text-muted-foreground">from pi-listen</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {model.progress !== null ? (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          ) : model.installed ? (
            <>
              {active ? null : (
                <Button variant="secondary" size="sm" onClick={onUse}>
                  Use
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={onDelete}>
                Delete
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={onDownload}
              disabled={!runtimeReady}
              aria-label={
                runtimeReady
                  ? `Download ${model.name}`
                  : `Install the runtime before downloading ${model.name}`
              }
            >
              Download {model.size}
            </Button>
          )}
        </div>
      </div>

      <p className="mt-1 text-sm text-muted-foreground">{model.notes}</p>

      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{model.languages}</span>
        <Rating label="accuracy" value={model.accuracy} />
        <Rating label="speed" value={model.speed} />
        <span className="font-mono">{model.id}</span>
      </div>

      {model.progress === null ? null : (
        <div className="mt-2">
          <div
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 w-full overflow-hidden rounded bg-muted"
          >
            <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Downloading… {percent}%</p>
        </div>
      )}

      {model.error === null ? null : (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {model.error}
        </p>
      )}
    </li>
  );
}

/** One language slot a voice can be assigned to. */
type VoiceRole = {
  slot: "primary" | "secondary";
  /** The language's name, e.g. "Ukrainian". */
  label: string;
  /** Whether this voice says that language at all. */
  supported: boolean;
  /** The speaker currently assigned to the slot, when it is this voice. */
  sid: number | null;
};

function VoiceRow({
  voice,
  roles,
  runtimeReady,
  onUse,
  onDownload,
  onCancel,
  onDelete,
  onPreview,
}: {
  voice: VoiceState;
  roles: VoiceRole[];
  runtimeReady: boolean;
  onUse: (slot: VoiceRole["slot"], sid: number) => void;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onPreview: (sid: number) => void;
}) {
  const [sid, setSid] = useState(voice.defaultSid);
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-medium">{voice.name}</span>
          {roles
            .filter((role) => role.sid !== null)
            .map((role) => (
              <span
                key={role.slot}
                className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary"
              >
                {role.label}
              </span>
            ))}
          {voice.recommended ? (
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              recommended
            </span>
          ) : null}
          {voice.source === "pi" ? (
            <span className="ml-2 text-xs text-muted-foreground">from pi-listen</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {voice.installed && voice.voices.length > 1 ? (
            <select
              value={sid}
              onChange={(event) => setSid(Number(event.target.value))}
              aria-label={`Voice within ${voice.name}`}
              className="h-7 rounded border border-border bg-background px-1 text-xs"
            >
              {voice.voices.map((option) => (
                <option key={option.sid} value={option.sid}>
                  {option.name}
                </option>
              ))}
            </select>
          ) : null}
          {voice.installed ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => onPreview(sid)}>
                Preview
              </Button>
              {roles
                .filter((role) => role.supported && role.sid !== sid)
                .map((role) => (
                  <Button
                    key={role.slot}
                    variant="secondary"
                    size="sm"
                    onClick={() => onUse(role.slot, sid)}
                  >
                    Use for {role.label}
                  </Button>
                ))}
              <Button variant="ghost" size="sm" onClick={onDelete}>
                Delete
              </Button>
            </>
          ) : voice.progress !== null ? (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={onDownload}
              disabled={!runtimeReady}
            >
              Install {voice.size}
            </Button>
          )}
        </div>
      </div>

      <p className="mt-1 text-sm text-muted-foreground">{voice.notes}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 text-xs text-muted-foreground">
        <span>{voice.languages.join(", ")}</span>
        <span>{voice.license}</span>
        <span className="font-mono">{voice.id}</span>
      </div>

      {voice.progress === null ? null : (
        <p className="mt-2 text-xs text-muted-foreground">
          {voice.progress.phase === "download"
            ? `Downloading… ${
                voice.progress.totalBytes === 0
                  ? ""
                  : `${Math.round((voice.progress.bytes / voice.progress.totalBytes) * 100)}%`
              }`
            : `${voice.progress.phase}…`}
        </p>
      )}

      {voice.error === null ? null : (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {voice.error}
        </p>
      )}
    </li>
  );
}

const selectClass =
  "h-8 w-full max-w-xs rounded border border-border bg-background px-2 text-sm";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="mt-3 block first:mt-0">
      <span className="block text-sm">{label}</span>
      {children}
      {hint === undefined ? null : (
        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      )}
    </label>
  );
}

const LANGUAGES: [string, string][] = [
  ["en", "English"],
  ["de", "Deutsch"],
  ["fr", "Français"],
  ["es", "Español"],
  ["it", "Italiano"],
  ["pt", "Português"],
  ["nl", "Nederlands"],
  ["pl", "Polski"],
  ["uk", "Українська"],
  ["ru", "Русский"],
  ["ja", "日本語"],
  ["zh", "中文"],
];

function languageName(code: string): string {
  return LANGUAGES.find(([known]) => known === code)?.[1] ?? code;
}

function voiceRoles(voice: VoiceState, settings: PageSettings): VoiceRole[] {
  const slots = [
    { slot: "primary" as const, language: settings.primaryLanguage, assigned: settings.primaryVoice },
    ...(settings.secondaryLanguage === ""
      ? []
      : [
          {
            slot: "secondary" as const,
            language: settings.secondaryLanguage,
            assigned: settings.secondaryVoice,
          },
        ]),
  ];
  return slots.map(({ slot, language, assigned }) => ({
    slot,
    label: languageName(language),
    supported: voice.languages.some(
      (tag) => tag.split(/[-_]/)[0]!.toLowerCase() === language,
    ),
    sid: assigned.id === voice.id ? assigned.sid : null,
  }));
}

function LanguageSelect({
  value,
  optional = false,
  onChange,
}: {
  value: string;
  optional?: boolean;
  onChange: (code: string) => void;
}) {
  return (
    <select className={selectClass} value={value} onChange={(event) => onChange(event.target.value)}>
      {optional ? <option value="">None</option> : null}
      {value !== "" && !LANGUAGES.some(([code]) => code === value) ? (
        <option value={value}>{value}</option>
      ) : null}
      {LANGUAGES.map(([code, name]) => (
        <option key={code} value={code}>
          {name}
        </option>
      ))}
    </select>
  );
}

const API_PRESETS = [
  { label: "Ollama (this computer)", url: "http://127.0.0.1:11434/v1" },
  { label: "LM Studio (this computer)", url: "http://127.0.0.1:1234/v1" },
];

/** What a person reads at a glance, before any control. */
function describeCondensing(settings: PageSettings): string {
  if (!settings.summarize) return "off — answers are read in full";
  if (settings.summaryBackend === "api") {
    return `own endpoint — ${settings.summaryApiModel || "no model set"} at ${settings.summaryApiUrl}`;
  }
  const provider = settings.summaryThreadProvider || "any available provider";
  const model = settings.summaryThreadModel || "small model chosen automatically";
  return `connected models — ${provider}, ${model}`;
}

function voiceSummary(state: State): [string, string][] {
  const { settings } = state;
  const line = (assigned: { id: string; sid: number }) => {
    const voice = state.voices.find((entry) => entry.id === assigned.id);
    return voice === undefined
      ? `${assigned.id} (not in the catalog)`
      : `${voice.name}${voice.installed ? "" : " — not installed yet"}`;
  };
  return [
    [`Speaks ${languageName(settings.primaryLanguage)}`, line(settings.primaryVoice)],
    ...(settings.secondaryLanguage === ""
      ? []
      : [[`Speaks ${languageName(settings.secondaryLanguage)}`, line(settings.secondaryVoice)] as [string, string]]),
  ];
}

function CurrentSettings({ state }: { state: State }) {
  const { settings } = state;
  const model = state.sttModels.find((entry) => entry.id === settings.model);
  const rows: [string, string][] = [
    [
      "Listening",
      model === undefined
        ? `${settings.model} (not in the catalog)`
        : `${model.name}${model.installed ? "" : " — not downloaded yet"}`,
    ],
    ...voiceSummary(state),
    ["Condensing", describeCondensing(settings)],
  ];
  return (
    <section className="mb-6 rounded-md border border-border p-3">
      <h3 className="text-sm font-medium">Current settings</h3>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function SpokenAnswers({
  settings,
  save,
}: {
  settings: PageSettings;
  save: (values: Partial<PageSettings> & { summaryApiKey?: string }) => void;
}) {
  const mode = !settings.summarize ? "off" : settings.summaryBackend === "api" ? "api" : "connected";
  return (
    <div>
      <Field
        label="Condense answers before speaking"
        hint="A long reply is boiled down to two or three plain sentences first."
      >
        <select
          className={selectClass}
          value={mode}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "off") save({ summarize: false });
            else save({ summarize: true, summaryBackend: next === "api" ? "api" : "thread" });
          }}
        >
          <option value="off">Off — read answers in full</option>
          <option value="connected">Use connected models</option>
          <option value="api">Use my own endpoint (Ollama, LM Studio…)</option>
        </select>
      </Field>
      {mode === "connected" ? <ConnectedModelPicker settings={settings} save={save} /> : null}
      {mode === "api" ? <ApiPicker settings={settings} save={save} /> : null}
    </div>
  );
}

function ConnectedModelPicker({
  settings,
  save,
}: {
  settings: PageSettings;
  save: (values: Partial<PageSettings>) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const providerId = settings.summaryThreadProvider;

  useEffect(() => {
    let current = true;
    rpc.call("modelCatalog", { providerId: providerId === "" ? null : providerId }).then(
      (next) => {
        if (!current) return;
        setCatalog(next);
        setFailure(null);
      },
      (cause: unknown) => {
        if (current) setFailure(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      current = false;
    };
  }, [rpc, providerId]);

  const providers = catalog?.providers.filter((entry) => entry.available) ?? [];
  const models = catalog?.models ?? [];
  // A saved choice the catalog no longer lists stays visible instead of
  // silently showing "Automatic" while a different value is stored.
  const providerMissing = providerId !== "" && !providers.some((entry) => entry.id === providerId);
  const modelMissing =
    settings.summaryThreadModel !== "" &&
    catalog !== null &&
    !models.some((entry) => entry.model === settings.summaryThreadModel);

  return (
    <div className="mt-3">
      {failure === null ? null : (
        <p role="alert" className="mb-2 text-sm text-destructive">
          Could not list providers: {failure}
        </p>
      )}
      <Field label="Provider">
        <select
          className={selectClass}
          value={providerId}
          // A model belongs to one provider, so changing it clears the model.
          onChange={(event) =>
            save({ summaryThreadProvider: event.target.value, summaryThreadModel: "" })
          }
        >
          <option value="">Automatic — first available provider</option>
          {providerMissing ? <option value={providerId}>{providerId} (unavailable)</option> : null}
          {providers.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Model"
        hint={
          settings.summaryThreadModel === ""
            ? "Automatic takes the cheapest-looking model of the provider: one whose name contains haiku, mini, flash, nano, lite, small or fast, otherwise the provider's default model. A short summary does not need a big model."
            : undefined
        }
      >
        <select
          className={selectClass}
          value={settings.summaryThreadModel}
          disabled={providerId === ""}
          onChange={(event) => save({ summaryThreadModel: event.target.value })}
        >
          <option value="">
            {catalog?.automatic
              ? `Automatic — now ${catalog.automatic.model} (${catalog.automatic.provider})`
              : catalog === null
                ? "Automatic"
                : "Automatic — no provider found, the project default is used"}
          </option>
          {modelMissing ? (
            <option value={settings.summaryThreadModel}>{settings.summaryThreadModel} (unavailable)</option>
          ) : null}
          {models.map((entry) => (
            <option key={entry.model} value={entry.model}>
              {entry.name}
              {entry.isDefault ? " (default)" : ""}
            </option>
          ))}
        </select>
        {providerId === "" ? (
          <span className="mt-1 block text-xs text-muted-foreground">
            Choose a provider to pick one of its models yourself.
          </span>
        ) : null}
      </Field>
    </div>
  );
}

function ApiPicker({
  settings,
  save,
}: {
  settings: PageSettings;
  save: (values: Partial<PageSettings> & { summaryApiKey?: string }) => void;
}) {
  const preset = API_PRESETS.find((entry) => entry.url === settings.summaryApiUrl);
  const [url, setUrl] = useState(settings.summaryApiUrl);
  const [model, setModel] = useState(settings.summaryApiModel);
  const [key, setKey] = useState("");
  // Text boxes save when left, not on every key, so a half-typed address is
  // never stored.
  return (
    <div className="mt-3">
      <Field label="Server">
        <select
          className={selectClass}
          value={preset?.url ?? "custom"}
          onChange={(event) => {
            if (event.target.value === "custom") return;
            setUrl(event.target.value);
            save({ summaryApiUrl: event.target.value });
          }}
        >
          {API_PRESETS.map((entry) => (
            <option key={entry.url} value={entry.url}>
              {entry.label}
            </option>
          ))}
          <option value="custom">Other address…</option>
        </select>
      </Field>
      {preset === undefined ? (
        <Field label="Address" hint="Any OpenAI-compatible endpoint, including the version path (…/v1).">
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onBlur={() => url !== settings.summaryApiUrl && save({ summaryApiUrl: url })}
          />
        </Field>
      ) : null}
      <Field label="Model name" hint="The name the server knows, e.g. gemma3:4b.">
        <Input
          value={model}
          onChange={(event) => setModel(event.target.value)}
          onBlur={() => model !== settings.summaryApiModel && save({ summaryApiModel: model })}
        />
      </Field>
      <Field
        label="API key"
        hint={
          settings.hasApiKey
            ? "A key is saved. Type a new one to replace it. Local servers need none."
            : "Leave empty for local servers."
        }
      >
        <Input
          type="password"
          value={key}
          autoComplete="off"
          onChange={(event) => setKey(event.target.value)}
          onBlur={() => {
            if (key === "") return;
            save({ summaryApiKey: key });
            setKey("");
          }}
        />
      </Field>
    </div>
  );
}

function ListenSettings() {
  const { rpc, state, error, report, refetch } = useListenState();
  const [query, setQuery] = useState("");

  if (state === null) {
    return (
      <p className="text-sm text-muted-foreground">
        {error ?? "Loading the speech runtime state…"}
      </p>
    );
  }

  const run = (promise: Promise<unknown>) => {
    promise.then(refetch, report);
  };
  const save = (values: Partial<PageSettings> & { summaryApiKey?: string }) =>
    rpc.call("updateSettings", values);
  const needle = query.trim().toLowerCase();
  const models =
    needle === ""
      ? state.sttModels
      : state.sttModels.filter((model) =>
          `${model.name} ${model.languages} ${model.notes} ${model.id}`
            .toLowerCase()
            .includes(needle),
        );

  return (
    <div className="max-w-3xl">
      {error === null ? null : (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {error}
        </p>
      )}

      <CurrentSettings state={state} />

      <Section
        title="Languages"
        description="Answers are read in the language they are written in, with the voice you assign to it below."
      >
        <Field
          label="Primary language"
          hint="Also the language the microphone listens for."
        >
          <LanguageSelect
            value={state.settings.primaryLanguage}
            onChange={(code) => run(save({ primaryLanguage: code }))}
          />
        </Field>
        <Field
          label="Secondary language"
          hint="Told apart from the primary one by script, so pick one that is written differently — Ukrainian and English, not English and German."
        >
          <LanguageSelect
            value={state.settings.secondaryLanguage}
            optional
            onChange={(code) => run(save({ secondaryLanguage: code }))}
          />
        </Field>
      </Section>

      <Section
        title="Spoken answers"
        description="What happens to an answer before it is read aloud."
      >
        <SpokenAnswers settings={state.settings} save={(values) => run(save(values))} />
      </Section>

      <Section
        title="Setup"
        description="Speech recognition runs entirely on this machine. Nothing is sent anywhere."
      >
        <SetupCard
          setup={state.setup}
          transcriptionSetting={state.transcriptionSetting}
          active={state.active}
          onInstall={() => run(rpc.call("installRuntime", null))}
        />
      </Section>

      <Section
        title="Voices"
        collapsible
        description={
          <>
            Each thread starts silent — press the speaker beside the
            microphone to hear its answers
            {state.settings.summarize
              ? ", condensed to two or three sentences first."
              : " in full — turn on condensing under “Spoken answers” above for a short spoken summary instead."}{" "}
            Install a voice, then press “Use for” the language it should read.
          </>
        }
      >
        <ul className="divide-y divide-border">
          {state.voices.map((voice) => (
            <VoiceRow
              key={voice.id}
              voice={voice}
              roles={voiceRoles(voice, state.settings)}
              runtimeReady={state.setup.runtime.installed}
              onUse={(slot, sid) =>
                run(save(slot === "primary" ? { primaryVoice: { id: voice.id, sid } } : { secondaryVoice: { id: voice.id, sid } }))
              }
              onDownload={() => run(rpc.call("downloadVoice", { modelId: voice.id }))}
              onCancel={() => run(rpc.call("cancelVoiceDownload", { modelId: voice.id }))}
              onDelete={() => run(rpc.call("deleteVoice", { modelId: voice.id }))}
              onPreview={(sid) => {
                rpc
                  .call("preview", { modelId: voice.id, sid })
                  .then((clip) => {
                    void new Audio(`data:audio/wav;base64,${clip.wavBase64}`).play();
                  }, report);
              }}
            />
          ))}
        </ul>
      </Section>

      <Section
        title="Recognition models"
        collapsible
        description={
          <>
            Open models from the sherpa-onnx catalog. Download one, then press
            Use to make it the model BB's microphone transcribes with.
          </>
        }
      >
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by name, language or size…"
          aria-label="Filter models"
        />
        {models.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No model matches “{query}”.
          </p>
        ) : (
          <ul className={cn("mt-2 divide-y divide-border")}>
            {models.map((model) => (
              <ModelRow
                key={model.id}
                model={model}
                active={model.id === state.settings.model}
                onUse={() => run(save({ model: model.id }))}
                runtimeReady={state.setup.runtime.installed}
                onDownload={() => run(rpc.call("downloadModel", { modelId: model.id }))}
                onCancel={() => run(rpc.call("cancelDownload", { modelId: model.id }))}
                onDelete={() => run(rpc.call("deleteModel", { modelId: model.id }))}
              />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

/**
 * The bridge between the player, which knows what to mark, and the content
 * script, which holds the host's row-status setter. Either may start first,
 * so the latest statuses wait here until the setter arrives.
 */
let latestRowStatuses = new Map<string, RowStatus>();
let applyRowStatuses: ((next: Map<string, RowStatus>) => void) | null = null;

function showRowStatuses(next: Map<string, RowStatus>) {
  latestRowStatuses = next;
  applyRowStatuses?.(next);
}

/**
 * Plays what the server announces, and shows that it is doing so.
 *
 * Mounted app-wide rather than in the thread: an answer can finish while the
 * user is looking at another thread, and they should still hear it. The clip
 * is claimed over RPC, so with two windows open exactly one speaks.
 */
function SpeechPlayer() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [speaking, setSpeaking] = useState<{
    text: string;
    threadId: string;
    threadTitle: string | null;
  } | null>(null);
  const [marked, setMarked] = useState<string[]>([]);

  const refetchMarked = useCallback(() => {
    rpc.call("speakingThreads", null).then(
      ({ threadIds }) => setMarked(threadIds),
      () => setMarked([]),
    );
  }, [rpc]);
  useEffect(refetchMarked, [refetchMarked]);
  useRealtime("listen-changed", refetchMarked);

  const speakingThreadId = speaking?.threadId ?? null;
  useEffect(() => {
    showRowStatuses(rowStatuses(marked, speakingThreadId));
  }, [marked, speakingThreadId]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setSpeaking(null);
  }, []);

  useRealtime(
    "listen-speak",
    useCallback(
      (payload: unknown) => {
        const id = (payload as { id?: unknown } | null)?.id;
        if (typeof id !== "string") return;
        void (async () => {
          const clip = await rpc.call("takeSpeech", { id });
          // Another window got there first; it is speaking, we are not.
          if (clip === null) return;

          audioRef.current?.pause();
          const audio = new Audio(`data:audio/wav;base64,${clip.wavBase64}`);
          audioRef.current = audio;
          setSpeaking({
            text: clip.text,
            threadId: clip.threadId,
            threadTitle: clip.threadTitle,
          });
          audio.addEventListener("ended", () => {
            if (audioRef.current === audio) stop();
          });
          try {
            await audio.play();
          } catch {
            // Autoplay can be refused before any interaction with the window.
            // The badge stays up with a play button rather than failing mute.
          }
        })();
      },
      [rpc, stop],
    ),
  );

  if (speaking === null) return null;
  return (
    <div className="pointer-events-auto fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-2 rounded-lg border border-border bg-card p-3 shadow-lg">
      <SpeakerOn className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-sm">{speaking.text}</p>
        <button
          type="button"
          className="mt-1 max-w-full truncate text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => navigate.toThread(speaking.threadId)}
        >
          {speaking.threadTitle ?? "Open thread"}
        </button>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        aria-label="Stop speaking"
        onClick={stop}
      >
        <Close className="size-4" />
      </Button>
    </div>
  );
}

/**
 * The speaker button, beside BB's own microphone.
 *
 * Per thread on purpose: whether you want an answer read to you depends on
 * what you are doing in *this* conversation, not on a global preference.
 * Every thread starts silent — like a monitor you switch on for the one
 * conversation you want to hear, instead of hearing every thread you forgot
 * to mute.
 */
function SpeechToggle() {
  const rpc = useRpc<typeof rpcContract>();
  const { threadId } = useBbContext();
  const [state, setState] = useState<{
    enabled: boolean;
    available: boolean;
  } | null>(null);

  const refetch = useCallback(() => {
    if (threadId === null) return;
    rpc.call("threadSpeech", { threadId }).then(setState, () => setState(null));
  }, [rpc, threadId]);

  useEffect(refetch, [refetch]);
  useRealtime("listen-changed", refetch);

  // No speaker while speaking is not set up: a switch that cannot make a
  // sound is noise. `listen-changed` brings it back once a voice installs.
  if (threadId === null || state === null || !state.available) return null;

  const set = (enabled: boolean) => {
    rpc.call("setThreadSpeech", { threadId, enabled }).then(setState, refetch);
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("size-7", state.enabled ? undefined : "text-muted-foreground")}
      aria-pressed={state.enabled}
      aria-label={
        state.enabled
          ? `Reading answers aloud in this thread — click to stop`
          : `Not reading answers aloud in this thread — click to start`
      }
      onClick={() => set(!state.enabled)}
    >
      {state.enabled ? (
        <SpeakerOn className="size-4" />
      ) : (
        <SpeakerOff className="size-4" />
      )}
    </Button>
  );
}

export default definePluginApp((app) => {
  // BB's icon set has no speaker, and the row status only takes a name.
  app.experimental_icons.register({ name: SPEAKER_ICON, component: SpeakerOn });
  app.contentScripts.register({
    id: "listen-thread-rows",
    mount(context) {
      const set = context.experimental_setThreadRowStatus;
      // Older clients without row statuses simply show no marker.
      if (set === undefined) return;
      const sync = createRowSync(set);
      applyRowStatuses = sync;
      sync(latestRowStatuses);
      return () => {
        if (applyRowStatuses === sync) applyRowStatuses = null;
      };
    },
  });
  app.slots.settingsSection({
    id: "listen-setup",
    title: "Speech runtime and models",
    description:
      "Install the offline speech runtime and manage recognition models.",
    component: ListenSettings,
  });
  app.slots.experimental_appOverlay({
    id: "listen-speech",
    component: SpeechPlayer,
  });
  // Rendered just before BB's own voice and submit buttons.
  app.composer.customize({
    id: "listen-speech-toggle",
    // Not on the new-thread composer: there is no thread to switch yet, and
    // every new thread starts silent anyway.
    scopes: ["thread"],
    actions: [{ id: "speech", component: SpeechToggle }],
  });
});
