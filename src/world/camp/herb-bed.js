// @ts-check
// The camp's herb bed (docs/future/13 C-24, slot table `bed` off the pad; B1 C1), pure. A strip of
// plain ground just off the pad (offPad.bed, w along u, d along v): outside the pad's lock, so the
// shovel and planting work there as on any soil. Once the first plant stands in it (set, sown, or
// grown there), edging pebbles are drawn round it, for good (the camp section's `bed.edged`, the game
// hour). The camp page names what grows in it now. Numbers: recipes/world/camp.json `bed`.

import { padToWorld } from './layout.js';
import { hash32 } from '../../core/rng.js';

/** 0..1 from a hash. @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/**
 * @typedef {{ edged: number | null }} Bed  edged: the hour the edging was first drawn, or null
 * @typedef {{ x: number, z: number, yaw: number, size: number, seed: number }} Pebble
 */

/** A saved (or missing) bed record made safe. @param {any} v @returns {Bed} */
export const cleanBed = (v) => ({ edged: v && Number.isFinite(v.edged) ? v.edged : null });

/** The bed's rectangle in the pad's frame, or null when the land has none. @param {any} pad layout.js Pad */
export const bedOf = (pad) => pad?.camp?.offPad?.bed ?? null;

/**
 * Is a ground point in the herb bed? In the pad's frame: u along the strip, v across it.
 * @param {any} pad @param {number} x @param {number} z @param {number} [marginM] grow the strip by this much
 */
export function inBed(pad, x, z, marginM = 0) {
  const b = bedOf(pad);
  if (!pad || !b) return false;
  const dx = x - pad.x, dz = z - pad.z;
  // The inverse of padToWorld: u = d . (fx, fz), v = d . (fz, -fx).
  const u = dx * pad.fx + dz * pad.fz, v = dx * pad.fz - dz * pad.fx;
  return Math.abs(u - b.u) <= b.w / 2 + marginM && Math.abs(v - b.v) <= b.d / 2 + marginM;
}

/**
 * What grows in the bed now: each species once, in the order first planted (lowest id first).
 * @param {any} pad @param {{ id: number, sp: string, x: number, z: number }[]} plants
 * @returns {string[]}
 */
export function bedSpecies(pad, plants) {
  const out = [];
  for (const p of [...plants].sort((a, b) => a.id - b.id)) if (inBed(pad, p.x, p.z) && !out.includes(p.sp)) out.push(p.sp);
  return out;
}

/**
 * The edging pebbles round the bed, seeded: spaced along its four sides, just outside the strip,
 * each a little off the line, turned and sized by its seed.
 * @param {any} pad @param {number} seed @param {{ spacingM: number, outM: number, jitterM: number, sizeM: number[] }} E camp.json bed.edging
 * @returns {Pebble[]}
 */
export function edgingPebbles(pad, seed, E) {
  const b = bedOf(pad);
  if (!pad || !b) return [];
  const hw = b.w / 2 + E.outM, hd = b.d / 2 + E.outM;
  /** The four sides as corners in the pad's frame, walked round. */
  const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  /** @type {Pebble[]} */ const out = [];
  let i = 0;
  for (let s = 0; s < 4; s++) {
    const [a0, b0] = corners[s], [a1, b1] = corners[(s + 1) % 4];
    const len = Math.hypot(a1 - a0, b1 - b0), n = Math.max(2, Math.round(len / E.spacingM));
    for (let k = 0; k < n; k++, i++) {
      const u = (/** @type {number} */ q) => u01(hash32(seed, i, q));
      const t = (k + 0.5 * u(1)) / n;
      const du = a0 + (a1 - a0) * t + (u(2) - 0.5) * 2 * E.jitterM, dv = b0 + (b1 - b0) * t + (u(3) - 0.5) * 2 * E.jitterM;
      const [x, z] = padToWorld(pad, b.u + du, b.v + dv);
      out.push({ x, z, yaw: u(4) * 2 * Math.PI, size: E.sizeM[0] + (E.sizeM[1] - E.sizeM[0]) * u(5), seed: hash32(seed, i) >>> 0 });
    }
  }
  return out;
}
