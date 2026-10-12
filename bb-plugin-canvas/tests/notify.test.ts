// BBP-174 spike 2: notify-Prototyp mit Caller-Prüfung.
//
// Nutzt die echte SDK-Testing-Harness (createFakePluginHost), nicht eine
// selbstgebaute Attrappe: `harness.callRpc(method, input, options)` validiert
// Ein-/Ausgabe wie der echte Host und setzt `experimental_caller` exakt so,
// wie `bb.sdk.plugins.callRpc` es laut SDK-Doku serverseitig täte (SDK
// >= 0.6.15; in der von crew/graph-studio genutzten 0.5.29 existiert dieser
// Mechanismus nicht — das war der Fund aus Spike 1).
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCanvasNotify, startPollingFallback, type ReloadTracker } from "../lib/notify";

function setup() {
  const { bb, harness } = createFakePluginHost();
  const reloads: { pluginId: string; scope: unknown }[] = [];
  const tracker: ReloadTracker = {
    reload: (pluginId, scope) => {
      reloads.push({ pluginId, scope });
    },
  };
  registerCanvasNotify(bb, tracker, { knownExtensions: new Set(["crew"]) });
  return { harness, reloads };
}

describe("canvas.notify Caller-Prüfung (BBP-174 Spike 2, Kriterium 3)", () => {
  it("akzeptiert einen echten Plugin-Aufruf mit passender pluginId und löst einen Reload aus", async () => {
    const { harness, reloads } = setup();
    const result = await harness.callRpc("canvas.notify", { pluginId: "crew" }, { experimental_caller: { kind: "plugin", pluginId: "crew" } });
    expect(result).toEqual({ accepted: true });
    await vi.waitFor(() => expect(reloads).toEqual([{ pluginId: "crew", scope: undefined }]));
  });

  it("negativ: lehnt einen gefälschten Aufruf ab (Caller behauptet eine andere pluginId als er ist) und löst keinen Reload aus", async () => {
    const { harness, reloads } = setup();
    const result = await harness.callRpc("canvas.notify", { pluginId: "crew" }, { experimental_caller: { kind: "plugin", pluginId: "evil" } });
    expect(result).toEqual({ accepted: false });
    expect(reloads).toEqual([]);
  });

  it("negativ: lehnt einen Aufruf ohne Plugin-Identität ab (kind: client, z.B. direkt aus der UI oder der CLI)", async () => {
    const { harness, reloads } = setup();
    const result = await harness.callRpc("canvas.notify", { pluginId: "crew" }, { experimental_caller: { kind: "client" } });
    expect(result).toEqual({ accepted: false });
    expect(reloads).toEqual([]);
  });

  it("negativ: lehnt eine nicht beim Canvas angemeldete Erweiterung ab, auch mit echter Caller-Identität", async () => {
    const { harness, reloads } = setup();
    const result = await harness.callRpc("canvas.notify", { pluginId: "unregistered" }, { experimental_caller: { kind: "plugin", pluginId: "unregistered" } });
    expect(result).toEqual({ accepted: false });
    expect(reloads).toEqual([]);
  });
});

describe("Entprellung (600ms, BBP-174 Spike 2)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fasst mehrere notifies für dasselbe Plugin/Scope innerhalb von 600ms zu einem Reload zusammen", async () => {
    const { harness, reloads } = setup();
    const caller = { experimental_caller: { kind: "plugin" as const, pluginId: "crew" } };
    void harness.callRpc("canvas.notify", { pluginId: "crew" }, caller);
    await vi.advanceTimersByTimeAsync(200);
    void harness.callRpc("canvas.notify", { pluginId: "crew" }, caller);
    await vi.advanceTimersByTimeAsync(200);
    void harness.callRpc("canvas.notify", { pluginId: "crew" }, caller);
    await vi.advanceTimersByTimeAsync(600);
    expect(reloads).toEqual([{ pluginId: "crew", scope: undefined }]);
  });

  it("negativ: zwei notifies mehr als 600ms auseinander lösen zwei Reloads aus", async () => {
    const { harness, reloads } = setup();
    const caller = { experimental_caller: { kind: "plugin" as const, pluginId: "crew" } };
    void harness.callRpc("canvas.notify", { pluginId: "crew" }, caller);
    await vi.advanceTimersByTimeAsync(600);
    void harness.callRpc("canvas.notify", { pluginId: "crew" }, caller);
    await vi.advanceTimersByTimeAsync(600);
    expect(reloads).toEqual([{ pluginId: "crew", scope: undefined }, { pluginId: "crew", scope: undefined }]);
  });
});

describe("10s-Polling-Rückfall für Erweiterungen ohne notify (BBP-174 Spike 2)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("lädt alle 10s neu, solange die Ansicht sichtbar ist", async () => {
    const reloads: { pluginId: string; scope: unknown }[] = [];
    const stop = startPollingFallback("graph-studio", { projectId: "p1" }, {
      reload: (pluginId, scope) => reloads.push({ pluginId, scope }),
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reloads).toEqual([
      { pluginId: "graph-studio", scope: { projectId: "p1" } },
      { pluginId: "graph-studio", scope: { projectId: "p1" } },
    ]);
    stop();
  });

  it("negativ: nach dem Stop (Ansicht verlassen) lädt es nicht mehr nach", async () => {
    const reloads: unknown[] = [];
    const stop = startPollingFallback("graph-studio", {}, { reload: () => reloads.push(true) });
    stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reloads).toEqual([]);
  });
});
