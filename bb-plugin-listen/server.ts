/**
 * Listen — offline speech for BB.
 *
 * The server entry is deliberately thin. It registers the plugin as BB's
 * transcription service, forwards the settings page to the host worker that
 * owns the models, and keeps the host's copy of the language setting current.
 * Nothing native and nothing large lives here.
 */

import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  hostContract,
  hostSignals,
  modelStateSchema,
  setupStateSchema,
  hostConfigSchema,
  voiceStateSchema,
} from "./contract.js";
import { shouldSpeak, speaksAloud, spokenText } from "./lib/speech/decide.js";
import { withLanguageRule } from "./lib/speech/language-rule.js";
import { chooseVoice, normalizePrefs, prefsSchema, sameScript, type Prefs } from "./lib/prefs.js";
import { pickModel, type PickedModel } from "./lib/speech/pick-model.js";
import { condenseWithApi, CondenseApiError } from "./lib/speech/condense-api.js";
import { previewText } from "./lib/speech/preview-text.js";
import { isSelectedForVoice, selectCommand, transcriptOrThrow } from "./lib/ai-service.js";

/** The AI-service id BB's voice selection names (`bb settings ai-services set voice listen`). */
export const SERVICE_ID = "listen";

/** Realtime channel the settings page refetches on. */
const CHANGED = "listen-changed";

/** Realtime channel that tells the app a clip is ready to play. */
const SPEAK = "listen-speak";

/**
 * What the hidden thread is told, unless the user replaced it.
 *
 * A setting rather than a constant because what makes a good spoken summary
 * is a matter of taste and of what you work on: someone reviewing prose wants
 * different emphasis than someone watching a refactor.
 */
export const DEFAULT_SUMMARY_PROMPT = [
  "Summarize the assistant message below for text-to-speech.",
  "",
  "Rules:",
  "- Two or three sentences, no more.",
  "- Plain spoken prose: no markdown, no lists, no code, no headings, no URLs.",
  "- Say what was done or found and what it means. Skip file names, commands and numbers unless they are the point.",
  "- Answer with the summary alone, nothing else.",
  "",
  "Message:",
].join("\n");

/**
 * What the composer's speaker button renders from. `available` is false while
 * speaking is not set up — no runtime, no Node, or the chosen voice not
 * installed — and the button then stays hidden rather than offering a switch
 * that would do nothing.
 */
const speechChoiceSchema = z.object({
  enabled: z.boolean(),
  available: z.boolean(),
});

/** The settings the page shows and edits; the rest stay in BB's generic form. */
const pageSettingsSchema = prefsSchema.extend({ hasApiKey: z.boolean() });

export const rpcContract = defineRpcContract({
  /** Change settings from the page; an absent field is left alone. */
  updateSettings: {
    input: prefsSchema.extend({ summaryApiKey: z.string() }).partial(),
    output: z.object({ ok: z.boolean() }),
  },
  /** Providers BB can run, and the models of one of them. */
  modelCatalog: {
    input: z.object({ providerId: z.string().nullable() }),
    output: z.object({
      providers: z.array(z.object({ id: z.string(), name: z.string(), available: z.boolean() })),
      models: z.array(z.object({ model: z.string(), name: z.string(), isDefault: z.boolean() })),
      /** What "Automatic" resolves to right now; null when nothing is installed. */
      automatic: z.object({ provider: z.string(), model: z.string() }).nullable(),
    }),
  },
  state: {
    input: z.null(),
    output: z.object({
      setup: setupStateSchema,
      sttModels: z.array(modelStateSchema),
      voices: z.array(voiceStateSchema),
      config: hostConfigSchema,
      /** Current values of the settings the page edits; the API key is never sent. */
      settings: pageSettingsSchema,
      /** The command that points BB's voice input here, assembled for copying. */
      transcriptionSetting: z.string(),
      /** Whether BB's voice task is pinned to this plugin. */
      active: z.boolean(),
    }),
  },
  installRuntime: { input: z.null(), output: z.object({ started: z.boolean() }) },
  downloadModel: {
    input: z.object({ modelId: z.string() }),
    output: z.object({ started: z.boolean() }),
  },
  cancelDownload: {
    input: z.object({ modelId: z.string() }),
    output: z.object({ cancelled: z.boolean() }),
  },
  deleteModel: {
    input: z.object({ modelId: z.string() }),
    output: z.object({ deleted: z.boolean() }),
  },
  downloadVoice: {
    input: z.object({ modelId: z.string() }),
    output: z.object({ started: z.boolean() }),
  },
  cancelVoiceDownload: {
    input: z.object({ modelId: z.string() }),
    output: z.object({ cancelled: z.boolean() }),
  },
  deleteVoice: {
    input: z.object({ modelId: z.string() }),
    output: z.object({ deleted: z.boolean() }),
  },
  /** Speak a sample, for the settings page's preview button. */
  preview: {
    input: z.object({ modelId: z.string(), sid: z.number() }),
    output: z.object({ wavBase64: z.string() }),
  },
  /**
   * Collect the clip a `listen-speak` signal announced. Returns null when
   * another window already took it, which is how only one of them speaks.
   */
  takeSpeech: {
    input: z.object({ id: z.string() }),
    output: z
      .object({
        wavBase64: z.string(),
        text: z.string(),
        threadId: z.string(),
        threadTitle: z.string().nullable(),
      })
      .nullable(),
  },

  /** Threads that chose to speak with the composer button. */
  speakingThreads: {
    input: z.null(),
    output: z.object({ threadIds: z.array(z.string()) }),
  },

  /** Whether this thread speaks, for the composer button to render from. */
  threadSpeech: {
    input: z.object({ threadId: z.string() }),
    output: speechChoiceSchema,
  },

  /** `enabled: null` drops the thread's choice; every thread starts silent. */
  setThreadSpeech: {
    input: z.object({ threadId: z.string(), enabled: z.boolean().nullable() }),
    output: speechChoiceSchema,
  },
});

export default async function plugin(bb: BbPluginApi) {

  // Only what has no place on the Listen page lives in BB's generic form: a
  // secret, a prompt and a number. Everything the page edits with a dropdown
  // is in `prefs` (lib/prefs.ts), so it is not shown twice.
  const bbSettings = bb.settings.define({
    summaryApiKey: {
      type: "string",
      label: "API key",
      secret: true,
      description: "Only for “Use my own endpoint”. Leave empty for local servers, which need none.",
    },
    summaryPrompt: {
      type: "string",
      label: "Condensing prompt",
      experimental_multiline: true,
      description:
        "What the hidden thread is told. The answer is appended below it. Leave empty to use the built-in prompt.",
      default: DEFAULT_SUMMARY_PROMPT,
    },
    voiceSpeed: {
      type: "number",
      label: "Speaking rate",
      description: "1 is the model's natural pace; 1.2 is noticeably brisker.",
      default: 1,
    },
  });

  const PREFS_KEY = "prefs";
  const readPrefs = async (): Promise<Prefs> =>
    normalizePrefs(await bb.storage.kv.get<unknown>(PREFS_KEY));

  /** Both stores as one object, so a reader does not care where a value lives. */
  const settings = {
    async get() {
      const [prefs, rest] = await Promise.all([readPrefs(), bbSettings.get()]);
      return {
        ...rest,
        ...prefs,
        // What the microphone and the one-voice paths (CLI, preview) use.
        language: prefs.primaryLanguage,
        voiceModel: prefs.primaryVoice.id,
        voiceSid: prefs.primaryVoice.sid,
      };
    },
  };

  const host = bb.hosts.experimental_client({
    contract: hostContract,
    experimental_signals: hostSignals,
  });

  // Every host signal is an invalidation: the page refetches rather than
  // trusting a payload, so a missed signal costs a stale second, not a lie.
  const unsubscribe = host.experimental_onSignal("changed", () => {
    bb.realtime.publish(CHANGED, {});
  });

  /**
   * The host runs on the primary host — the same one core calls for
   * transcription. Resolved per call rather than cached: hosts can be
   * re-enrolled while the plugin is loaded.
   */
  async function hostId(): Promise<string> {
    const config = await bb.sdk.system.config();
    const id = config.primaryHostId;
    if (id === null) {
      throw new Error("BB has no primary host, so the speech runtime has nowhere to run.");
    }
    return id;
  }

  async function callHost<Method extends keyof typeof hostContract>(
    method: Method,
    input: Parameters<typeof host.call<Method>>[1],
  ) {
    return host.call(method, input, { hostId: await hostId() });
  }

  // BB offers a service for voice input when it declares `transcribe`; the
  // recording is decoded and recognised on the host, where the native runtime
  // and the models live. Speaking aloud is not an AI-service task — BB has no
  // such slot — so it stays the plugin's own feature.
  bb.experimental_aiServices.register({
    id: SERVICE_ID,
    displayName: "Listen (offline speech)",
    transcribe: async (audio, { signal }) => {
      const { model } = await settings.get();
      const result = await host.call(
        "transcribeAudio",
        {
          audioBase64: Buffer.from(await audio.arrayBuffer()).toString("base64"),
          mimeType: audio.type || "audio/webm",
          modelId: model,
        },
        { hostId: await hostId(), signal },
      );
      return transcriptOrThrow(result);
    },
  });

  /** Push what the host cannot be told per call. */
  async function pushConfig(): Promise<void> {
    const values = await settings.get();
    await callHost("setConfig", {
      language: values.language,
      voiceModel: values.voiceModel,
      voiceSid: values.voiceSid,
      voiceSpeed: values.voiceSpeed,
    });
  }

  /**
   * A project id for the diagnostic condense command.
   *
   * The thread route has to spawn its worker somewhere, and a command line
   * has no thread to inherit from. Any project does — the worker is hidden,
   * archived and stopped straight after.
   */
  async function currentProjectId(): Promise<string> {
    const projects = await bb.sdk.projects.list();
    const first = projects[0];
    if (first === undefined) {
      throw new Error("There is no project to run the condensing thread in.");
    }
    return first.id;
  }

  /** The answer both the composer button and the settings page render. */
  async function describeThreadSpeech(
    threadId: string,
  ): Promise<z.infer<typeof speechChoiceSchema>> {
    const override = await readThreadSpeech(threadId);
    return {
      // Every thread starts silent; only its own button turns speaking on.
      enabled: speaksAloud({ enabled: false, override }),
      available: await speechAvailable(),
    };
  }

  /**
   * Whether an answer could be spoken right now. A host that cannot be
   * reached counts as not set up: the button would fail either way.
   */
  async function speechAvailable(): Promise<boolean> {
    try {
      const [{ setup, voices }, prefs] = await Promise.all([callHost("state", null), readPrefs()]);
      const chosen = [prefs.primaryVoice.id, ...(prefs.secondaryLanguage === "" ? [] : [prefs.secondaryVoice.id])];
      return (
        setup.runtime.installed &&
        setup.node !== null &&
        voices.some((voice) => chosen.includes(voice.id) && voice.installed)
      );
    } catch {
      return false;
    }
  }

  // ─── Reading answers aloud ────────────────────────────────────────────────

  /**
   * The last spoken clip, waiting to be collected.
   *
   * Audio does not travel on the realtime channel: that is an app-wide
   * broadcast, and a WAV is not a notification. The signal carries an id and
   * the browser fetches the bytes over RPC — so a second window that also
   * hears the signal collects nothing and stays quiet.
   */
  let pending: {
    id: string;
    wavBase64: string;
    text: string;
    threadId: string;
    threadTitle: string | null;
  } | null = null;

  /** Hidden threads we started, so their own idle events do not loop back. */
  const ourWorkers = new Set<string>();

  /**
   * Per-thread speaking choices, from the speaker button in each composer.
   *
   * Kept in plugin storage rather than on the thread: this SDK version has no
   * thread plugin-metadata API. A thread missing from the map has made no
   * choice and follows the setting — which is why the value is a tri-state
   * and not a boolean with a default.
   */
  const THREAD_SPEECH_KEY = "thread-speech";

  async function readAllThreadSpeech(): Promise<Record<string, boolean>> {
    return (await bb.storage.kv.get<Record<string, boolean>>(THREAD_SPEECH_KEY)) ?? {};
  }

  async function readThreadSpeech(threadId: string): Promise<boolean | null> {
    return (await readAllThreadSpeech())[threadId] ?? null;
  }

  async function writeThreadSpeech(
    threadId: string,
    enabled: boolean | null,
  ): Promise<void> {
    const all = await readAllThreadSpeech();
    // Clearing removes the entry entirely, so the thread goes back to
    // following the setting instead of freezing today's value.
    if (enabled === null) delete all[threadId];
    else all[threadId] = enabled;
    await bb.storage.kv.set(THREAD_SPEECH_KEY, all);
  }

  /**
   * Condense an answer through a hidden thread.
   *
   * Returns null when the summary cannot be had — the caller then speaks the
   * filtered original rather than nothing, because silence reads as a broken
   * feature while a long answer merely reads as a long answer.
   */
  /**
   * Condense through whichever backend is configured.
   *
   * Both paths return null on failure and log why: the caller speaks the
   * filtered original instead, because silence reads as a broken feature.
   */
  async function condense(
    answer: string,
    source: { projectId: string; prompt: string },
  ): Promise<string | null> {
    const summary = await condenseUnchecked(answer, {
      ...source,
      prompt: withLanguageRule(source.prompt),
    });
    // A small model sometimes answers in English whatever it is told. Better
    // to speak the original than to read a translation with the wrong voice.
    if (summary !== null && !sameScript(answer, summary)) {
      bb.log.warn("the condensed answer switched language; speaking the original instead");
      return null;
    }
    return summary;
  }

  async function condenseUnchecked(
    answer: string,
    source: { projectId: string; prompt: string },
  ): Promise<string | null> {
    const values = await settings.get();
    if (values.summaryBackend === "api") {
      if (values.summaryApiModel.trim() === "") {
        bb.log.warn(
          "condensing through an API needs a model name in the plugin's settings",
        );
        return null;
      }
      try {
        return await condenseWithApi(source.prompt, answer, {
          url: values.summaryApiUrl,
          model: values.summaryApiModel,
          apiKey: values.summaryApiKey,
        });
      } catch (cause) {
        bb.log.warn(
          `could not condense through the API: ${
            cause instanceof CondenseApiError ? cause.message : String(cause)
          }`,
        );
        return null;
      }
    }
    return condenseInThread(answer, {
      ...source,
      model: values.summaryThreadModel.trim(),
      providerId: values.summaryThreadProvider.trim(),
    });
  }

  // Read at most once a minute: answers can finish back to back, and the set
  // of installed providers does not change that fast.
  const autoPicks = new Map<string, { at: number; picked: PickedModel | null }>();
  async function autoPickModel(onlyProvider: string): Promise<PickedModel | null> {
    const cached = autoPicks.get(onlyProvider);
    if (cached && Date.now() - cached.at < 60_000) return cached.picked;
    try {
      const providers = (await bb.sdk.providers.list()).filter(
        (entry) => onlyProvider === "" || entry.id === onlyProvider,
      );
      const picked = await pickModel(providers, async (providerId) =>
        (await bb.sdk.providers.models({ providerId })).models,
      );
      autoPicks.set(onlyProvider, { at: Date.now(), picked });
      return picked;
    } catch (cause) {
      bb.log.warn(`could not list providers to pick a condensing model: ${String(cause)}`);
      return null;
    }
  }

  async function condenseInThread(
    answer: string,
    source: { projectId: string; prompt: string; model: string; providerId: string },
  ): Promise<string | null> {
    let workerId: string | null = null;
    try {
      // No model chosen: use a small model of the chosen provider, or of any installed one, and only
      // when none can be found fall through to the project default.
      if (source.model === "") {
        const picked = await autoPickModel(source.providerId);
        if (picked !== null) source = { ...source, ...picked };
      }
      const worker = await bb.sdk.threads.spawn({
        projectId: source.projectId,
        environment: { type: "project-default" },
        prompt: `${source.prompt}\n${answer}`,
        title: "Listen: spoken summary",
        visibility: "hidden",
        // Omitted rather than passed empty: BB then resolves the project's
        // own defaults, which is what "no opinion" has to mean here.
        ...(source.model === "" ? {} : { model: source.model }),
        ...(source.providerId === "" ? {} : { providerId: source.providerId }),
        pluginMetadata: { purpose: "spoken-summary" },
      });
      workerId = worker.id;
      ourWorkers.add(worker.id);

      await bb.sdk.threads.wait({ threadId: worker.id, status: "idle" });
      const { output } = await bb.sdk.threads.output({ threadId: worker.id });
      const summary = output?.trim() ?? "";
      return summary === "" ? null : summary;
    } catch (cause) {
      bb.log.warn(`could not condense an answer for speech: ${String(cause)}`);
      return null;
    } finally {
      if (workerId !== null) {
        ourWorkers.delete(workerId);
        // A hidden worker holds an agent process until it is stopped.
        await bb.sdk.threads.archive({ threadId: workerId }).catch(() => {});
        await bb.sdk.threads.stop({ threadId: workerId }).catch(() => {});
      }
    }
  }

  bb.events.on("thread.idle", ({ thread, lastAssistantText }) => {
    void (async () => {
      const values = await settings.get();
      const decision = shouldSpeak(thread, {
        enabled: false,
        override: await readThreadSpeech(thread.id),
        lastAssistantText,
        ourWorkers,
      });
      if (!decision.speak) return;
      // `shouldSpeak` already established the answer is there.
      const answer = lastAssistantText as string;

      try {
        const summary = values.summarize
          ? await condense(answer, {
              projectId: thread.projectId,
              prompt:
                values.summaryPrompt.trim() === ""
                  ? DEFAULT_SUMMARY_PROMPT
                  : values.summaryPrompt,
            })
          : null;
        // The voice follows the language of what is said, not of the setting:
        // an English summary of a Ukrainian thread is read by the English voice.
        const prefs = await readPrefs();
        const choice = chooseVoice(prefs, summary ?? answer);
        const spoken = spokenText(summary, answer, choice.language);
        if (spoken === null) return;

        const audio = await callHost("speak", {
          text: spoken.text,
          modelId: choice.voice.id,
          sid: choice.voice.sid,
          language: choice.language,
        });
        pending = {
          id: randomUUID(),
          wavBase64: audio.wavBase64,
          text: spoken.text,
          threadId: thread.id,
          threadTitle: thread.title ?? null,
        };
        bb.realtime.publish(SPEAK, { id: pending.id, threadId: thread.id });
      } catch (cause) {
        bb.log.warn(`could not speak an answer: ${String(cause)}`);
      }
    })();
  });

  bb.rpc.register(rpcContract, {
    state: async () => {
      const [state, config, values] = await Promise.all([
        callHost("state", null),
        bb.sdk.system.aiServices(),
        settings.get(),
      ]);
      return {
        ...state,
        transcriptionSetting: selectCommand(SERVICE_ID),
        active: isSelectedForVoice(config.selections.voice, bb.pluginId, SERVICE_ID),
        settings: {
          ...(await readPrefs()),
          hasApiKey: (values.summaryApiKey ?? "") !== "",
        },
      };
    },
    installRuntime: async () => callHost("installRuntime", null),
    downloadModel: async ({ modelId }) => callHost("downloadModel", { modelId }),
    cancelDownload: async ({ modelId }) => callHost("cancelDownload", { modelId }),
    deleteModel: async ({ modelId }) => callHost("deleteModel", { modelId }),
    downloadVoice: async ({ modelId }) => callHost("downloadVoice", { modelId }),
    cancelVoiceDownload: async ({ modelId }) =>
      callHost("cancelVoiceDownload", { modelId }),
    deleteVoice: async ({ modelId }) => callHost("deleteVoice", { modelId }),
    preview: async ({ modelId, sid }) => {
      // The sample has to be in the voice's own language — see preview-text.ts.
      const { voices } = await callHost("state", null);
      const model = voices.find((voice) => voice.id === modelId);
      const audio = await callHost("speak", {
        text: previewText(model, sid),
        modelId,
        sid,
      });
      return { wavBase64: audio.wavBase64 };
    },
    updateSettings: async ({ summaryApiKey, ...changes }) => {
      if (summaryApiKey !== undefined) {
        await bbSettings.experimental_set({ summaryApiKey });
      }
      if (Object.keys(changes).length > 0) {
        await bb.storage.kv.set(PREFS_KEY, { ...(await readPrefs()), ...changes });
      }
      await pushConfig().catch((cause) => {
        bb.log.warn(`could not send changed settings to the host: ${String(cause)}`);
      });
      bb.realtime.publish(CHANGED, {});
      return { ok: true };
    },
    modelCatalog: async ({ providerId }) => {
      const providers = await bb.sdk.providers.list();
      const models =
        providerId === null ? [] : (await bb.sdk.providers.models({ providerId })).models;
      const picked = await autoPickModel(providerId ?? "");
      let automatic: { provider: string; model: string } | null = null;
      if (picked !== null) {
        const pickedModels =
          picked.providerId === providerId
            ? models
            : (await bb.sdk.providers.models({ providerId: picked.providerId })).models;
        automatic = {
          provider:
            providers.find((entry) => entry.id === picked.providerId)?.displayName ??
            picked.providerId,
          model:
            pickedModels.find((entry) => entry.model === picked.model)?.displayName ??
            picked.model,
        };
      }
      return {
        automatic,
        providers: providers.map((entry) => ({
          id: entry.id,
          name: entry.displayName,
          available: entry.available,
        })),
        models: models.map((entry) => ({
          model: entry.model,
          name: entry.displayName,
          isDefault: entry.isDefault,
        })),
      };
    },
    threadSpeech: async ({ threadId }) => describeThreadSpeech(threadId),
    setThreadSpeech: async ({ threadId, enabled }) => {
      await writeThreadSpeech(threadId, enabled);
      // The settings page shows the same state; tell every open window.
      bb.realtime.publish(CHANGED, {});
      return describeThreadSpeech(threadId);
    },
    takeSpeech: ({ id }) => {
      if (pending === null || pending.id !== id) return null;
      const clip = pending;
      pending = null;
      return {
        wavBase64: clip.wavBase64,
        text: clip.text,
        threadId: clip.threadId,
        threadTitle: clip.threadTitle,
      };
    },
    speakingThreads: async () => {
      const all = await readAllThreadSpeech();
      return {
        threadIds: Object.keys(all).filter((threadId) => all[threadId] === true),
      };
    },
  });

  // The same operations as the settings page, for a terminal — and the only
  // way to reach them while BB's window is not open.
  const usage = [
    "Usage:",
    "  bb listen status            Runtime, models and what BB is pointed at",
    "  bb listen install-runtime   Install the native speech runtime",
    "  bb listen download <model>  Download a recognition model",
    "  bb listen delete <model>    Remove a downloaded model",
    "  bb listen transcribe <file> [model]  Transcribe an audio file",
    "  bb listen voices            List installed voices",
    "  bb listen voice-download <id>  Install a voice",
    "  bb listen voice-delete <id>    Remove a voice",
    "  bb listen speak <text>      Synthesize speech to a WAV file",
    "  bb listen condense <text>   Run the configured summarizer on a text",
  ].join("\n");

  bb.cli.register({
    name: "listen",
    summary: "Manage the offline speech runtime and its models",
    commands: [
      { name: "status", summary: "Show runtime and model state", usage: "bb listen status [--json]" },
      { name: "install-runtime", summary: "Install the speech runtime", usage: "bb listen install-runtime" },
      { name: "download", summary: "Download a model", usage: "bb listen download <model-id>" },
      { name: "delete", summary: "Delete a model", usage: "bb listen delete <model-id>" },
      { name: "voices", summary: "List installed voices", usage: "bb listen voices [--json]" },
      { name: "voice-download", summary: "Install a voice", usage: "bb listen voice-download <id>" },
      { name: "voice-delete", summary: "Remove a voice", usage: "bb listen voice-delete <id>" },
      { name: "speak", summary: "Synthesize speech to a WAV file", usage: "bb listen speak <text>" },
      {
        name: "condense",
        summary: "Run the configured summarizer on a text, to try a prompt or model",
        usage: "bb listen condense <text> [--json]",
      },
      {
        name: "transcribe",
        summary: "Transcribe an audio file — the microphone path, without a microphone",
        usage: "bb listen transcribe <file> [model-id]",
      },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const [command, ...args] = argv.filter((arg) => arg !== "--json");
      const modelId = args[0];

      switch (command) {
        case undefined:
        case "help":
        case "--help":
          return { exitCode: 0, stdout: usage };

        case "status": {
          const state = await callHost("state", null);
          const values = await settings.get();
          const services = await bb.sdk.system.aiServices();
          const voice = services.selections.voice;
          const active = isSelectedForVoice(voice, bb.pluginId, SERVICE_ID);
          const command = selectCommand(SERVICE_ID);
          if (json) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ ...state, transcriptionSetting: command, active, model: values.model }),
            };
          }
          const installed = state.sttModels.filter((model) => model.installed);
          const running = state.sttModels.filter((model) => model.progress !== null);
          return {
            exitCode: 0,
            stdout: [
              `runtime:       ${state.setup.runtime.installed ? `installed (${state.setup.runtime.source})` : "not installed"}`,
              `ffmpeg:        ${state.setup.ffmpeg ? "found" : "not on PATH"}`,
              `language:      ${state.config.language}`,
              `BB voice:      ${voice.mode === "service" ? `${voice.pluginId}/${voice.serviceId}` : voice.mode}${active ? "" : `  (run \`${command}\` to use this plugin)`}`,
              `model:         ${values.model}`,
              `models ready:  ${installed.length === 0 ? "none" : installed.map((model) => `${model.id} (${model.source})`).join(", ")}`,
              ...(running.length === 0
                ? []
                : [`downloading:   ${running.map((model) => model.id).join(", ")}`]),
            ].join("\n"),
          };
        }

        case "install-runtime": {
          const { started } = await callHost("installRuntime", null);
          return {
            exitCode: 0,
            stdout: started
              ? "Installing the speech runtime. Watch `bb listen status` for the result."
              : "An install is already running.",
          };
        }

        case "download": {
          if (modelId === undefined) break;
          const { started } = await callHost("downloadModel", { modelId });
          return {
            exitCode: 0,
            stdout: started
              ? `Downloading ${modelId}. Watch \`bb listen status\` for progress.`
              : `${modelId} is already downloading.`,
          };
        }

        case "transcribe": {
          const file = args[0];
          if (file === undefined) break;
          const values = await settings.get();
          const result = await callHost("transcribeFile", {
            path: resolve(file),
            modelId: args[1] ?? values.model,
          });
          if (json) return { exitCode: 0, stdout: JSON.stringify(result) };
          return result.error === null
            ? {
                exitCode: 0,
                stdout: `${result.text}\n\n(${(result.milliseconds / 1000).toFixed(1)}s)`,
              }
            : { exitCode: 1, stderr: result.error };
        }

        case "voices": {
          const state = await callHost("state", null);
          if (json) return { exitCode: 0, stdout: JSON.stringify(state.voices) };
          const installed = state.voices.filter((voice) => voice.installed);
          return {
            exitCode: 0,
            stdout:
              installed.length === 0
                ? "No voice installed. Install one on the Listen settings page, or run `bb listen voice-download <id>`."
                : installed
                    .map(
                      (voice) =>
                        `${voice.id === state.config.voiceModel ? "*" : " "} ${voice.id}  ${voice.languages.join(",")}  (${voice.source})`,
                    )
                    .join("\n"),
          };
        }

        case "voice-delete": {
          if (modelId === undefined) break;
          const { deleted } = await callHost("deleteVoice", { modelId });
          return deleted
            ? { exitCode: 0, stdout: `Deleted voice ${modelId}.` }
            : { exitCode: 1, stderr: `${modelId} is not installed by this plugin.` };
        }

        case "voice-download": {
          if (modelId === undefined) break;
          const { started } = await callHost("downloadVoice", { modelId });
          return {
            exitCode: 0,
            stdout: started
              ? `Installing voice ${modelId}. Watch \`bb listen voices\` for the result.`
              : `${modelId} is already installing.`,
          };
        }

        case "condense": {
          // Try the configured summarizer on a text without ending a turn —
          // the only way to check a prompt or a model change quickly.
          const text = args.join(" ").trim();
          if (text === "") break;
          const values = await settings.get();
          if (!values.summarize) {
            return {
              exitCode: 1,
              stderr: "Condensing is switched off (setting: summarize).",
            };
          }
          const started = Date.now();
          const project = await currentProjectId();
          const summary = await condense(text, {
            projectId: project,
            prompt:
              values.summaryPrompt.trim() === ""
                ? DEFAULT_SUMMARY_PROMPT
                : values.summaryPrompt,
          });
          const seconds = ((Date.now() - started) / 1000).toFixed(1);
          // Show what would actually be *spoken*, not the raw reply: the
          // filter still runs over a summary, and seeing the unfiltered text
          // here would send anyone tuning a prompt after the wrong problem.
          const spoken = spokenText(summary, text, values.language);
          if (json) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ summary, spoken: spoken?.text ?? null, seconds }),
            };
          }
          return spoken === null
            ? {
                exitCode: 1,
                stderr: `Nothing to speak after ${seconds}s — see the plugin log for why.`,
              }
            : {
                exitCode: 0,
                stdout: `${spoken.text}\n\n(${values.summaryBackend}, ${spoken.source}, ${seconds}s)`,
              };
        }

        case "speak": {
          // `--voice <id>` tries one voice without changing the setting —
          // the quickest way to tell a broken voice from a broken runtime.
          const voiceAt = args.indexOf("--voice");
          const voice = voiceAt === -1 ? null : (args[voiceAt + 1] ?? null);
          const text = args
            .filter((_, index) => voiceAt === -1 || (index !== voiceAt && index !== voiceAt + 1))
            .join(" ")
            .trim();
          if (text === "") break;
          const audio = await callHost("speak", { text, modelId: voice, sid: null });
          const file = join(tmpdir(), `listen-speak-${Date.now()}.wav`);
          writeFileSync(file, Buffer.from(audio.wavBase64, "base64"));
          if (json) return { exitCode: 0, stdout: JSON.stringify({ file, ...audio, wavBase64: undefined }) };
          return {
            exitCode: 0,
            stdout: `${file}\n(${(audio.milliseconds / 1000).toFixed(1)}s to synthesize, ${audio.sampleRate} Hz)`,
          };
        }

        case "delete": {
          if (modelId === undefined) break;
          const { deleted } = await callHost("deleteModel", { modelId });
          return deleted
            ? { exitCode: 0, stdout: `Deleted ${modelId}.` }
            : { exitCode: 1, stderr: `${modelId} is not downloaded here.` };
        }
      }
      return { exitCode: 1, stderr: usage };
    },
  });

  // Language and voice live in two places: BB's settings and the host's own
  // config file. Without this, changing a setting left the host speaking the
  // old language until the next plugin reload.
  bbSettings.onChange(() => {
    void pushConfig().catch((cause) => {
      bb.log.warn(`could not send changed settings to the host: ${String(cause)}`);
    });
    bb.realtime.publish(CHANGED, {});
  });

  // Host calls are rejected while the plugin is still a load candidate, so
  // the first push waits for registration to commit.
  bb.background.service("config-sync", {
    async start(signal) {
      if (signal.aborted) return;
      try {
        await pushConfig();
      } catch (cause) {
        bb.log.warn(`could not send settings to the host: ${String(cause)}`);
      }
    },
  });

  bb.onDispose(() => {
    unsubscribe();
  });
}
