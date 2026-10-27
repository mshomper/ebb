// @ts-check
// Aiming in the Hollow (doc 16, Aiming: the floor dot; H0, October 27, 2026): a small dot on the floor
// in front of the walker, the way the camera faces. No ray is cast from the screen: how far down the
// camera looks sets how far out the dot is (farM at the camera's least tilt, nearM at its most), and
// the dot then walks out along the walk grid, stopping before a wall or a drop, so a move never fires
// into rock. Locked, the dot sits under the target instead. Pure: safe for tools pages and tests.

import { isOpen } from '../walk/path.js';

/**
 * The dot's range from the camera's tilt: farM at levelDeg, nearM at downDeg, straight between.
 * @param {number} pitchDeg how far down the camera looks @param {{ nearM: number, farM: number, levelDeg: number, downDeg: number }} D
 */
export function dotRange(pitchDeg, D) {
  const t = Math.min(1, Math.max(0, (pitchDeg - D.levelDeg) / Math.max(1e-6, D.downDeg - D.levelDeg)));
  return D.farM + (D.nearM - D.farM) * t;
}

/**
 * Walk the dot out from (x, z) along a unit way for up to rangeM, in stepM steps, and return where it
 * stops: the last point on open ground before a closed cell (a wall, a solid, deep water, too steep)
 * or a drop or rise of more than maxStepM between two steps.
 * @param {import('../walk/grid.js').WalkGrid} grid @param {import('../walk/path.js').WalkRules} rules
 * @param {number} x @param {number} z @param {number} wx @param {number} wz @param {number} rangeM @param {number} stepM
 * @returns {{ x: number, z: number, m: number, stopped: boolean }} m: how far out it went
 */
export function walkDot(grid, rules, x, z, wx, wz, rangeM, stepM) {
  const l = Math.hypot(wx, wz) || 1, ux = wx / l, uz = wz / l;
  let px = x, pz = z, m = 0;
  let k = grid.cellAt(px, pz), h = k >= 0 ? grid.height[k] : 0;
  while (m < rangeM - 1e-9) {
    const d = Math.min(stepM, rangeM - m), nx = px + ux * d, nz = pz + uz * d;
    const nk = grid.cellAt(nx, nz);
    if (nk < 0) return { x: px, z: pz, m, stopped: true };
    if (nk !== k) {
      if (!isOpen(grid, rules, nk) || Math.abs(grid.height[nk] - h) > rules.maxStepM) return { x: px, z: pz, m, stopped: true };
      k = nk; h = grid.height[nk];
    }
    px = nx; pz = nz; m += d;
  }
  return { x: px, z: pz, m, stopped: false };
}
