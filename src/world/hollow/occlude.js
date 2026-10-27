// @ts-check
// Walls in the way (doc 16, The camera below; H0, October 27, 2026): in the Hollow the camera never
// pulls in. A wall or pillar between the eye and the walker (or the locked target) fades to a soft
// outline instead, so the camera never lurches in a tight passage. Pure.

import { solidGap } from '../walk/solids.js';

/**
 * Does a solid stand between the eye and a point? The segment is sampled every stepM; it is in the
 * way where a sample is inside the solid's footprint (grown by marginM) and below its top.
 * @param {import('../walk/solids.js').Solid & { heightM: number }} s @param {number} baseY the ground under it
 * @param {ArrayLike<number>} eye @param {ArrayLike<number>} at @param {number} [marginM] @param {number} [stepM]
 */
export function inTheWay(s, baseY, eye, at, marginM = 0.25, stepM = 0.15) {
  const dx = at[0] - eye[0], dy = at[1] - eye[1], dz = at[2] - eye[2];
  const n = Math.max(2, Math.ceil(Math.hypot(dx, dy, dz) / stepM));
  // The last stretch next to the point itself is left out, so standing against a wall doesn't fade it.
  for (let i = 0; i < n - 1; i++) {
    const t = i / n, x = eye[0] + dx * t, y = eye[1] + dy * t, z = eye[2] + dz * t;
    if (y < baseY + s.heightM && solidGap(s, x, z) < marginM) return true;
  }
  return false;
}
