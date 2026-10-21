// @ts-check
// A living catch's moment on the tray (docs/future/12, K6): its baked mesh bent a little each frame
// so it reads as alive. Fish flex from head to tail, a flatfish ripples its edges, a shrimp flicks
// its tail, a crab steps on the finds' leg rig, and a jelly pulses its bell. Only positions move
// (normals stay, which is plenty at tray size). Pure, apart from a cache of crab rigs.

import { legRig, legBones } from '../world/finds/leg-rig.js';

/** @type {WeakMap<object, import('../world/finds/leg-rig.js').LegRig>} */
const RIGS = new WeakMap();

/**
 * The mesh bent for time t (seconds), into `out` (same layout and length as the base vertices).
 * @param {{ vertices: Float32Array, count: number, indices: Uint32Array }} base
 * @param {{ lengthM: number, w?: number }} n @param {'swim' | 'ripple' | 'flick' | 'walk' | 'pulse'} motion
 * @param {number} t @param {Float32Array} [out]
 * @returns {{ vertices: Float32Array, count: number, indices: Uint32Array }}
 */
export function bendCatch(base, n, motion, t, out = new Float32Array(base.vertices.length)) {
  const V = base.vertices, L = n.lengthM;
  out.set(V);
  const each = (/** @type {(i: number) => void} */ f) => { for (let i = 0; i < base.count; i++) f(i * 9); };
  if (motion === 'swim') {
    const s = Math.sin(t * 6.5);
    each((k) => {
      const along = Math.min(1, Math.max(0, 0.5 - V[k + 2] / L));
      out[k] += 0.07 * L * Math.sin(t * 6.5 - along * 5) * along * along + 0.008 * L * s;
    });
  } else if (motion === 'ripple') {
    const half = Math.max(1e-6, ((n.w ?? 0.6) * L) / 2 + 0.05 * L);
    each((k) => { const e = Math.min(1, Math.abs(V[k]) / half); out[k + 1] += 0.05 * L * Math.sin(t * 4 + (V[k + 2] / L) * 7) * e * e; });
  } else if (motion === 'flick') {
    // Rests, then flicks its tail under, now and then.
    const ph = (t * 0.9) % 1, f = ph < 0.18 ? Math.sin((ph / 0.18) * Math.PI) : 0;
    each((k) => { const back = Math.max(0, -V[k + 2] / L - 0.02); out[k + 1] -= f * 0.7 * L * back * back; out[k + 2] += f * 0.25 * L * back * back; });
  } else if (motion === 'pulse') {
    const p = Math.sin(t * 2.2);
    each((k) => { out[k] *= 1 - 0.06 * p; out[k + 1] *= 1 + 0.16 * p; out[k + 2] *= 1 - 0.06 * p; });
  } else if (motion === 'walk') {
    let rig = RIGS.get(base);
    if (!rig) { rig = legRig(base, { shellShare: 0.55 }); RIGS.set(base, rig); }
    const M = legBones(rig, t * 7, { liftDeg: 18, sweepDeg: 14, clawShare: 0.3 });
    each((k) => {
      const i = k / 9, j = rig.joints[i * 4 + 1], w = rig.weights[i * 4 + 1] / 255;
      if (!w) return;
      const o = j * 16, x = V[k], y = V[k + 1], z = V[k + 2];
      out[k] = x + w * (M[o] * x + M[o + 4] * y + M[o + 8] * z + M[o + 12] - x);
      out[k + 1] = y + w * (M[o + 1] * x + M[o + 5] * y + M[o + 9] * z + M[o + 13] - y);
      out[k + 2] = z + w * (M[o + 2] * x + M[o + 6] * y + M[o + 10] * z + M[o + 14] - z);
    });
  }
  return { vertices: out, count: base.count, indices: base.indices };
}

/**
 * The middle and size a mesh is fitted by, so a moving catch does not swim in and out of frame.
 * @param {{ vertices: Float32Array, count: number }} m @returns {{ c: number[], ext: number }}
 */
export function fitOf(m) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.count; i++) for (let r = 0; r < 3; r++) { lo[r] = Math.min(lo[r], m.vertices[i * 9 + r]); hi[r] = Math.max(hi[r], m.vertices[i * 9 + r]); }
  return { c: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2], ext: Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1 };
}
