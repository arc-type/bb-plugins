// Crew's part of the shared canvas (BBP-131): crews and their members as
// bb-canvas nodes, served as the `canvasLayer` RPC so graph-studio can draw
// them on its page. Pure, so the mapping is testable without a store.
//
// One page only: graph-studio shows the canvas whenever it is active and
// pulls this layer in; crew shows it itself only while graph-studio is not.
import type { CanvasLayer } from "../vendor/bb-canvas/lib/layer";
import { projectNodeId } from "../vendor/bb-canvas/lib/layer";
import type { CanvasStatus } from "../vendor/bb-canvas/lib/types";
import type { MemberInfo } from "./contract";
import type { CrewStatus } from "./store";

export const crewNodeId = (crew: string): string => `crew:${crew}`;
export const memberNodeId = (address: string): string => `member:${address}`;

const CREW_STATUS: Record<CrewStatus, CanvasStatus> = {
  stopped: "idle",
  starting: "waiting",
  running: "running",
  degraded: "failed",
};

const ACTIVITY_STATUS: Record<string, CanvasStatus> = {
  working: "running",
  idle: "idle",
  "needs-you": "waiting",
  error: "failed",
};

export function crewCanvasLayer(
  projectId: string,
  crews: { name: string; status: CrewStatus }[],
  members: MemberInfo[],
): CanvasLayer {
  const layer: CanvasLayer = { nodes: [], edges: [], expanded: [] };
  for (const crew of crews) {
    const id = crewNodeId(crew.name);
    layer.nodes.push({
      id,
      kind: "crew",
      label: crew.name,
      status: CREW_STATUS[crew.status],
      parentId: projectNodeId(projectId),
      meta: { crew: crew.name, status: crew.status },
    });
    // A stopped crew stays folded: its members have nothing to show.
    if (crew.status !== "stopped") layer.expanded.push(id);
    for (const member of members.filter((entry) => entry.crew === crew.name)) {
      const status = ACTIVITY_STATUS[member.activity];
      layer.nodes.push({
        id: memberNodeId(member.address),
        kind: "member",
        label: member.key,
        ...(status ? { status } : {}),
        parentId: id,
        meta: { address: member.address, role: member.role, lead: member.lead, threadId: member.threadId, activity: member.activity },
      });
    }
  }
  return layer;
}

export const GRAPH_STUDIO_PLUGIN_ID = "graph-studio";

/** Plugin states in which graph-studio is (or is about to be) serving its page. */
const ACTIVE = new Set(["running", "starting", "degraded", "needs-configuration"]);

/** `bb.sdk.plugins.list()` entries; true when crew must show the canvas page itself. */
export function crewOwnsCanvasPage(plugins: { id: string; enabled: boolean; status: string }[]): boolean {
  return !plugins.some((plugin) => plugin.id === GRAPH_STUDIO_PLUGIN_ID && plugin.enabled && ACTIVE.has(plugin.status));
}
