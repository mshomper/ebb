// @ts-check
// The rye (F20; recipes/flora/rye.json, recipes/land/meadow-islet.json rye): where the wild stalks
// stand at the stone's foot, which ripe plants a cut takes and how they stand up in stooks, how
// long a stook takes to dry, and the strip a handful of seed sows. Pure: no store, no GPU, seeded.

import { hash32 } from '../../core/rng.js';

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/** Season position (0 spring .. 4) inside a [from, to) window, wrapping. @param {number} pos @param {number[]} w */
export const inWindow = (pos, w) => (w[1] > w[0] ? pos >= w[0] && pos < w[1] : pos >= w[0] || pos < w[1]);

/**
 * The wild stalks' spots: round the stone's foot on the side it leans toward (away from the
 * midsummer spot), each a seeded angle and distance. @param {{ x: number, z: number, yaw: number }} st
 * @param {any} W rye.wild @returns {{ x: number, z: number }[]}
 */
export function wildSpots(st, W) {
  // The lean runs along the frame's +z: (sin yaw, cos yaw) in the world.
  const a0 = Math.atan2(Math.cos(st.yaw), Math.sin(st.yaw)), out = [];
  for (let i = 0; i < W.count; i++) {
    const r = (/** @type {number} */ k) => u01(hash32(W.seed, i, k));
    const a = a0 + ((i + 0.5) / W.count - 0.5) * 2 * (W.aroundDeg * Math.PI / 180) + (r(1) - 0.5) * 0.2;
    const d = W.ringM[0] + (W.ringM[1] - W.ringM[0]) * r(2);
    out.push({ x: st.x + Math.cos(a) * d, z: st.z + Math.sin(a) * d });
  }
  return out;
}

/**
 * What a cut takes: every grown rye plant (ripe: the cut is only offered in its window) within reachM
 * of where it was asked, never the wild stalks within wildM of the stone.
 * @param {{ id: number, sp: string, x: number, z: number, stage: number }[]} plants
 * @param {{ x: number, z: number }} at @param {{ x: number, z: number } | null} stone @param {any} C rye.cut
 * @param {(p: { stage: number }) => boolean} grown is the plant grown (mature or in ear, not a shoot)
 */
export function cutTakes(plants, at, stone, C, grown) {
  return plants.filter((p) => p.sp === 'rye' && grown(p) && (p.x - at.x) ** 2 + (p.z - at.z) ** 2 <= C.reachM ** 2
    && !(stone && (p.x - stone.x) ** 2 + (p.z - stone.z) ** 2 <= C.wildM ** 2));
}

/**
 * The stooks a cut stands up: the cut plants in runs of perStook along the line they lie on, each
 * stook at its run's middle, the straw and seed shared out from the first.
 * @param {{ id: number, x: number, z: number }[]} cut @param {any} C rye.cut @param {number} hour
 * @returns {{ x: number, z: number, yaw: number, cutH: number, straw: number, seed: number, wetH: number }[]}
 */
export function stooksOf(cut, C, hour) {
  if (!cut.length) return [];
  // Along the cut's longer spread, so a strip's stooks stand in a row down it.
  const xs = cut.map((p) => p.x), zs = cut.map((p) => p.z);
  const along = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs) ? 'x' : 'z';
  const sorted = [...cut].sort((a, b) => a[along] - b[along] || a.id - b.id);
  const runs = [];
  for (let i = 0; i < sorted.length; i += C.perStook) runs.push(sorted.slice(i, i + C.perStook));
  const straw = Math.max(1, Math.round(cut.length / C.strawPer)), seed = Math.max(1, Math.round(cut.length / C.seedPer));
  return runs.map((run, i) => {
    const x = run.reduce((s, p) => s + p.x, 0) / run.length, z = run.reduce((s, p) => s + p.z, 0) / run.length;
    const share = (/** @type {number} */ n) => Math.floor(n / runs.length) + (i < n % runs.length ? 1 : 0);
    return { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, yaw: u01(hash32(run[0].id, 0x5700)) * 6.283, cutH: hour, straw: share(straw), seed: share(seed), wetH: 0 };
  });
}

/** Game hours a stook still needs before it can be taken up (0: dry). @param {{ cutH: number, wetH: number }} s @param {number} hour @param {any} K rye.stooks */
export const stookLeftH = (s, hour, K) => Math.max(0, s.cutH + K.dryH + s.wetH * K.rainH - hour);

/**
 * The seed spots of one sown strip: rows across widthM and seeds along lengthM, laid along the line
 * from the walker to where the handful lands (centred there), each nudged a little by the seed.
 * @param {number[]} from the walker [x, z] @param {number[]} at where it lands [x, z] @param {any} T sowing.json strips.rye
 * @param {number} seed @returns {number[][]} [x, z] each
 */
export function stripSpots(from, at, T, seed) {
  let dx = at[0] - from[0], dz = at[1] - from[1];
  const l = Math.hypot(dx, dz);
  if (l < 1e-3) { dx = 0; dz = 1; } else { dx /= l; dz /= l; }
  const out = [];
  for (let i = 0; i < T.rows; i++) for (let j = 0; j < T.perRow; j++) {
    const k = i * T.perRow + j, r = (/** @type {number} */ q) => (u01(hash32(seed, k, q)) - 0.5) * T.jitterM;
    const a = ((j + 0.5) / T.perRow - 0.5) * T.lengthM + r(1), b = ((i + 0.5) / T.rows - 0.5) * T.widthM + r(2);
    out.push([at[0] + dx * a - dz * b, at[1] + dz * a + dx * b]);
  }
  return out;
}
