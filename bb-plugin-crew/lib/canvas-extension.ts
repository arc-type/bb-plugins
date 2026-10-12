// BBP-174 spike: a prototype of the canvasExtension.describe/layer contract
// proposed for the standalone Canvas plugin. Crew would expose these instead
// of (or alongside) the existing `canvasLayer` RPC so a separate Canvas
// plugin can discover and pull Crew's layer without a hard-coded dependency.
import type { CrewCanvasLayer, CrewLinks } from "./canvas-layer";
import { crewCanvasLayer } from "./canvas-layer";
import type { MemberInfo } from "./contract";
import { CONTRACT_VERSION } from "./contract";
import type { CrewStatus } from "./store";

export type CanvasExtensionDescribe = {
  layers: { id: string; label: string; icon: string }[];
};

/** Static for this prototype: Crew offers exactly one layer, its own. A real
 *  implementation would also declare sidebar sections and edit tools (spec §1). */
export function canvasExtensionDescribe(): CanvasExtensionDescribe {
  return { layers: [{ id: "crew", label: "Crew", icon: "users" }] };
}

export function canvasExtensionLayer(
  scope: { projectId: string },
  crews: { name: string; status: CrewStatus }[],
  members: MemberInfo[],
  linksByCrew?: CrewLinks,
): { contractVersion: number } & CrewCanvasLayer {
  return { contractVersion: CONTRACT_VERSION, ...crewCanvasLayer(scope.projectId, crews, members, linksByCrew) };
}
