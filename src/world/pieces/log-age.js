// @ts-check
// A kept log ages where it lies (docs/future/11, L2): over game weeks it darkens and softens, and
// where the ground is damp and shaded, moss creeps over its top. All worked out from the world
// (when it was set down, the water summary, the plants round it and the land), never saved, so an
// island looks the same after time away as if you had watched. Age and damp are also what make
// fungi likelier (src/world/finds/autumn.js fungiChance), and later what lives underneath (L3). Pure.

import { WATER_CLASS } from '../water/summary.js';
import { waterCellOf, waterCellCenter } from '../water/grid.js';

/** Smooth 0..1 step. @param {number} x @param {number} a @param {number} b */
const smooth = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * How aged a kept log is, 0 just set down .. 1 fully weathered where it lies.
 * @param {number} placedHour @param {number} hourNow @param {{ startDays: number, fullDays: number }} A pieces.json driftwood.age
 */
export const logAge = (placedHour, hourNow, A) => smooth((hourNow - placedHour) / 24, A.startDays, A.fullDays);

/**
 * How damp and how shaded the ground under a log is, each 0..1.
 * Damp: a damp hollow under it, or fresh water near (a pond or stream, off the tide band), fading
 * out to nearM. Shade: tall plants round it (each plant's weight times its size, fading out to
 * radiusM), or a bank rising over it on several sides.
 * @param {{ x: number, z: number, summary: any, plants: { sp: string, x: number, z: number, size: number }[],
 *   ground: (x: number, z: number) => number, A: any }} p A: pieces.json driftwood.age
 * @returns {{ damp: number, shade: number }}
 */
export function dampShade(p) {
  const A = p.A, s = p.summary;
  let damp = 0;
  if (s) {
    const R = s.rect, ci = waterCellOf(p.x) - R.x, cj = waterCellOf(p.z) - R.y;
    const reach = Math.ceil(A.damp.nearM / 0.5);
    for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= R.w || j >= R.h) continue;
      const k = j * R.w + i, c = s.cls[k];
      if (s.band[k]) continue;
      const dx = waterCellCenter(R.x + i) - p.x, dz = waterCellCenter(R.y + j) - p.z, d2 = dx * dx + dz * dz;
      if (c === WATER_CLASS.damp && d2 < 0.6 * 0.6) damp = Math.max(damp, 1);
      else if (c === WATER_CLASS.still || c === WATER_CLASS.slow || c === WATER_CLASS.running) damp = Math.max(damp, 1 - smooth(Math.sqrt(d2), A.damp.fullM, A.damp.nearM));
    }
  }
  let cover = 0;
  const r2 = A.shade.radiusM * A.shade.radiusM;
  for (const q of p.plants) {
    const w = A.shade.plants[q.sp];
    if (!w) continue;
    const dx = q.x - p.x, dz = q.z - p.z, d2 = dx * dx + dz * dz;
    if (d2 > r2) continue;
    cover += w * Math.min(1, q.size) * (1 - Math.sqrt(d2) / A.shade.radiusM);
  }
  // A bank: ground rising more than bankM over it, at bankAtM, on enough of eight sides.
  const y0 = p.ground(p.x, p.z);
  let sides = 0;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * 2 * Math.PI;
    if (p.ground(p.x + Math.cos(a) * A.shade.bankAtM, p.z + Math.sin(a) * A.shade.bankAtM) - y0 > A.shade.bankM) sides++;
  }
  const shade = Math.min(1, Math.max(smooth(cover, 0, A.shade.full), smooth(sides, 1, 4) * A.shade.bank));
  return { damp, shade };
}

/**
 * How mossy a kept log has grown, 0..1: only in damp shade, starting after startDays and reaching
 * its most by fullDays. @param {number} placedHour @param {number} hourNow @param {{ damp: number, shade: number }} ds
 * @param {any} M pieces.json driftwood.age.moss
 */
export function logMoss(placedHour, hourNow, ds, M) {
  const days = (hourNow - placedHour) / 24;
  const where = smooth(Math.sqrt(ds.damp * ds.shade), M.where[0], M.where[1]);
  return M.most * where * smooth(days, M.startDays, M.fullDays);
}
