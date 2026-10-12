// Bounds for the resizable details sidebar (BBP-182). Narrower than 240px
// the meta grid wraps every value; wider than 640px it eats the canvas.
export const MIN_WIDTH = 240;
export const MAX_WIDTH = 640;
export const DEFAULT_WIDTH = 320;

/** Keeps a sidebar width inside the bounds. A non-finite value (a garbage
 *  stored width, a NaN from arithmetic) falls back to the default rather
 *  than snapping to an edge. */
export function clampWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));
}
