// @ts-check
// Waterfalls near the camera, for the island's sound (M2 Cliff tool; docs/07 "Waterfalls", doc 17).
// The falls pass reads back the lips its GPU finder found a couple of times a second
// (src/render/passes/falls.js, event 'falls:lips'); here they are joined into falls (lips side by
// side, falling from about the same height), each with a place, a height and a flow, and the
// nearest few to the camera target are kept for the sound. Pure, so the tests run it.
// Numbers: recipes/audio/game.json `falls`.

/** Floats per lip in the readback, as water-falls.wgsl writes them (struct Lip: a, b, c). */
export const LIP_FLOATS = 12;
/** Width of one lip: one water cell (m). */
const LIP_WIDTH_M = 0.5;

/**
 * @typedef {Object} Fall
 * @property {number[]} pos      [x, y, z] middle of the curtain, meters
 * @property {number} heightM    drop from the lip to where it lands
 * @property {number} flowM3s    water going over, m3/s
 * @property {number} widthM     across the lips
 */

/**
 * @typedef {Object} FallNear
 * @property {number[]} pos @property {number} heightM @property {number} flowM3s
 * @property {number} distM      from the camera target
 */

/**
 * Join lips into falls. A lip is a = (edge x, top, edge z, land), b = (dir x, dir z, throw speed,
 * flow q m2/s), c (unused here). Lips within joinM of each other across and topM in height are one
 * fall (single linkage, in the order given, so the same lips give the same falls).
 * @param {Float32Array | number[]} lips LIP_FLOATS per lip
 * @param {number} count
 * @param {{ joinM: number, topM: number }} R
 * @returns {Fall[]}
 */
export function groupFalls(lips, count, R) {
  const n = Math.min(count, Math.floor(lips.length / LIP_FLOATS));
  const parent = Array.from({ length: n }, (_, i) => i);
  /** @param {number} i */
  const root = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const j2 = R.joinM * R.joinM;
  for (let i = 0; i < n; i++) {
    const a = i * LIP_FLOATS;
    for (let k = i + 1; k < n; k++) {
      const b = k * LIP_FLOATS;
      if (Math.abs(lips[a + 1] - lips[b + 1]) > R.topM) continue;
      if ((lips[a] - lips[b]) ** 2 + (lips[a + 2] - lips[b + 2]) ** 2 > j2) continue;
      const ra = root(i), rb = root(k);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    }
  }
  /** @type {Map<number, {w: number, x: number, y: number, z: number, h: number, q: number, lips: number}>} */
  const sums = new Map();
  for (let i = 0; i < n; i++) {
    const a = i * LIP_FLOATS;
    const top = lips[a + 1], land = lips[a + 3], q = Math.max(0, lips[a + 7]);
    const h = Math.max(0, top - land);
    // Weighted by flow, with a floor so a fall of threads still has a middle.
    const w = q + 1e-6;
    const r = root(i);
    const s = sums.get(r) ?? { w: 0, x: 0, y: 0, z: 0, h: 0, q: 0, lips: 0 };
    s.w += w; s.x += w * lips[a]; s.y += w * (top + land) / 2; s.z += w * lips[a + 2]; s.h += w * h;
    s.q += q * LIP_WIDTH_M; s.lips++;
    sums.set(r, s);
  }
  return [...sums.values()].map((s) => ({
    pos: [s.x / s.w, s.y / s.w, s.z / s.w], heightM: s.h / s.w, flowM3s: s.q, widthM: s.lips * LIP_WIDTH_M,
  }));
}

/**
 * The falls within reachM of a point, nearest first, at most `voices` of them.
 * @param {Fall[]} falls @param {number} x @param {number} y @param {number} z
 * @param {{ reachM: number, voices: number, minFlowM3s: number }} R
 * @returns {FallNear[]}
 */
export function fallsNear(falls, x, y, z, R) {
  /** @type {FallNear[]} */
  const out = [];
  for (const f of falls) {
    if (f.flowM3s < R.minFlowM3s) continue;
    const d = Math.hypot(f.pos[0] - x, f.pos[1] - y, f.pos[2] - z);
    if (d > R.reachM) continue;
    out.push({ pos: f.pos.slice(), heightM: f.heightM, flowM3s: f.flowM3s, distM: d });
  }
  out.sort((a, b) => a.distM - b.distM);
  return out.slice(0, R.voices);
}
