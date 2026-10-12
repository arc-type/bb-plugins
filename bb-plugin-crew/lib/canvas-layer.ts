// Crew's part of the shared canvas (BBP-131): crews and their members as
// bb-canvas nodes, served as the `canvasLayer` RPC so graph-studio can draw
// them on its page. Pure, so the mapping is testable without a store.
//
// One page only: graph-studio shows the canvas whenever it is active and
// pulls this layer in; crew shows it itself only while graph-studio is not.
import type { CanvasLayer } from "../vendor/bb-canvas/lib/layer";
import { projectNodeId } from "../vendor/bb-canvas/lib/layer";
import type { CanvasEdge, CanvasFrame, CanvasNode, CanvasStatus } from "../vendor/bb-canvas/lib/types";
import { crewLayers, pathBetween, placeLayers, type CrewMemberRef } from "./canvas-layout";
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

/** A crew's declared links (BBP-170 WI6): drawn as message-styled edges
 *  between the same member nodes the tree already shows, so the topology
 *  reads on the same page instead of only in the old full-screen editor. */
export type CrewLinks = Record<string, readonly { from: string; to: string; kind: string }[]>;

export function crewCanvasLayer(
  projectId: string,
  crews: { name: string; status: CrewStatus }[],
  members: MemberInfo[],
  linksByCrew: CrewLinks = {},
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
    const crewMembers = members.filter((entry) => entry.crew === crew.name);
    const byKey = new Map(crewMembers.map((entry) => [entry.key, entry]));
    for (const member of crewMembers) {
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
    // Both ends must still be members of this crew: a link surviving a
    // removed member, or naming the wrong crew's key, is dropped rather than
    // drawn to a node that is not there.
    for (const link of linksByCrew[crew.name] ?? []) {
      const from = byKey.get(link.from);
      const to = byKey.get(link.to);
      if (!from || !to) continue;
      layer.edges.push({ from: memberNodeId(from.address), to: memberNodeId(to.address), variant: "message", label: link.kind });
    }
  }
  return layer;
}

export type CrewTopology = { frames: CanvasFrame[]; nodes: (CanvasNode & { frameId: string })[]; edges: CanvasEdge[] };

export const crewFrameId = (crew: string): string => `frame:${crew}`;

/**
 * One crew's topology as a bb-canvas frame (BBP-163): the lead and its
 * members inside one frame, in canvas-layout's row order (lead first, then
 * the groups in file order), and the crew's links as edges. A link that
 * points back up (pathBetween's "back" shape) becomes a back edge, the rest
 * flow edges. Links to unknown members or to oneself are dropped.
 */
export function crewTopologyFrame(
  crew: string,
  members: readonly CrewMemberRef[],
  links: readonly { from: string; to: string; kind: string }[],
): CrewTopology {
  const frameId = crewFrameId(crew);
  const nodeId = (key: string) => memberNodeId(`${key}@${crew}`);
  const layers = crewLayers(members);
  const placed = placeLayers(layers, { width: 1, height: 1 });
  const boxes = new Map(placed.boxes.map((box) => [box.id, box]));
  const byKey = new Map(members.map((member) => [member.key, member]));
  const nodes = placed.boxes.map((box) => {
    const member = byKey.get(box.id)!;
    return {
      id: nodeId(member.key),
      kind: "member" as const,
      label: member.key,
      parentId: null,
      frameId,
      meta: { lead: member.lead, groupId: member.groupId, layer: box.layer },
    };
  });
  const edges: CanvasEdge[] = links
    .filter((link) => link.from !== link.to && boxes.has(link.from) && boxes.has(link.to))
    .map((link) => ({
      from: nodeId(link.from),
      to: nodeId(link.to),
      variant: pathBetween(boxes.get(link.from)!, boxes.get(link.to)!).shape === "back" ? "back" : "flow",
      label: link.kind,
    }));
  return { frames: [{ id: frameId, parentId: null, label: crew }], nodes, edges };
}

export const GRAPH_STUDIO_PLUGIN_ID = "graph-studio";

/** Plugin states in which graph-studio is (or is about to be) serving its page. */
const ACTIVE = new Set(["running", "starting", "degraded", "needs-configuration"]);

/** `bb.sdk.plugins.list()` entries; true when crew must show the canvas page itself. */
export function crewOwnsCanvasPage(plugins: { id: string; enabled: boolean; status: string }[]): boolean {
  return !plugins.some((plugin) => plugin.id === GRAPH_STUDIO_PLUGIN_ID && plugin.enabled && ACTIVE.has(plugin.status));
}
