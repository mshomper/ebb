// @ts-check
// The pad's dashed edge (docs/future/13 section 3.1, CP-01). Pure.
//
// Only while a brush ring overlaps the pad does its edge draw, as a soft dashed circle on the
// ground (the terrain marks, src/render/passes/terrain.js setMarks). It fades in and out. A mark
// with a negative radius is the dashed style; its dash, gap and width come from the pad uniform.

/** Fade time (s) when the land recipe's camp.dash has no fadeS. */
export const DEFAULT_FADE_S = 0.3;

/**
 * True when the tool state paints with a brush ring: Sculpt (Raise, Lower, Flatten, Terrace, Cut,
 * Stone and the rest), Smooth, Paint and Water pour. Taps with their own small ring (loose stone,
 * pond stones, Steps, spring, net, raft, Plant, Feed) are not brushes.
 * @param {{ tool?: string | null, sculptMode?: string, waterMode?: string } | null | undefined} t
 */
export function isBrushTool(t) {
  if (!t || !t.tool) return false;
  if (t.tool === 'sculpt') return !['loosestone', 'pondstones', 'steps'].includes(t.sculptMode ?? '');
  if (t.tool === 'water') return (t.waterMode ?? 'pour') === 'pour';
  return t.tool === 'smooth' || t.tool === 'paint';
}

/**
 * The dashed edge's opacity to head for now: the recipe's dash opacity while a brush ring's center
 * is within its radius plus dash.showWithinM of the pad's center (doc 13: "ring center within brush
 * radius plus 4 m"; with showWithinM equal to the pad's 4 m radius that is the ring touching the
 * pad), else 0.
 * @param {import('./layout.js').Pad | null} pad
 * @param {{ x: number, z: number, radius: number, visible?: boolean } | null} ring  the brush ring
 * @param {{ tool?: string | null, sculptMode?: string, waterMode?: string } | null} t  the tools slice
 */
export function edgeTarget(pad, ring, t) {
  if (!pad || !pad.dash || !ring || ring.visible === false || !isBrushTool(t)) return 0;
  const d = Math.hypot(ring.x - pad.x, ring.z - pad.z);
  return d <= ring.radius + (pad.dash.showWithinM ?? pad.r) ? pad.dash.opacity : 0;
}

/**
 * One step of the fade toward a target opacity, linear over fadeS seconds for a full swing.
 * @param {number} current @param {number} target @param {number} dt seconds @param {number} full the full opacity
 * @param {number} [fadeS]
 */
export function stepEdge(current, target, dt, full, fadeS = DEFAULT_FADE_S) {
  const rate = fadeS > 0 ? (full || 1) / fadeS : Infinity;
  const step = rate * Math.max(0, dt);
  return target > current ? Math.min(target, current + step) : Math.max(target, current - step);
}

/**
 * The mark for setMarks: [x, z, -r, opacity] (a negative radius is the dashed style), or null
 * when it would not draw (an opacity of 0 ends the mark list, so it is left out).
 * @param {import('./layout.js').Pad | null} pad @param {number} opacity
 * @returns {number[] | null}
 */
export function edgeMark(pad, opacity) {
  if (!pad || !(opacity > 0.001)) return null;
  return [pad.x, pad.z, -pad.r, opacity];
}

/**
 * The trodden look at (x, z) (CP-02): `wear` on the pad, fading to 0 over edgeWearM outside it
 * (smoothstep). Mirrors campWear in terrain-draw.wgsl, for tests and CPU readers.
 * @param {import('./layout.js').Pad | null} pad @param {number} x @param {number} z
 */
export function padWear(pad, x, z) {
  if (!pad || !pad.wear) return 0;
  const d = Math.hypot(x - pad.x, z - pad.z);
  const e = Math.max(pad.edgeWearM ?? 0, 1e-4);
  const t = Math.min(1, Math.max(0, (d - pad.r) / e));
  return pad.wear * (1 - t * t * (3 - 2 * t));
}
