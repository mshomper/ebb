// @ts-check
// Soft rings on the plants a raising brush would cover (docs/future/13 PR-27; Matt, October 24:
// every plant that would go under, shrubs too). While a Sculpt brush that can raise the ground is
// out (Raise, Flatten, Terrace, Stone), each plant whose base reaches within the brush's radius plus
// bury.ringM of its middle shows a ring, nearest first, at most bury.rings of them, at
// bury.ringOpacity. Contextual, nothing to toggle; UI only, never saved. Pure.

import { baseRadius } from './bury.js';

/** The Sculpt modes that can raise the ground, so can bury. */
export const RAISING_MODES = ['raise', 'flatten', 'terrace', 'stone'];

/**
 * The rings to draw, as the terrain marks take them: [x, z, radius m, opacity].
 * @param {{ x: number, z: number, sp: string, size: number }[]} plants growth plants
 * @param {Record<string, any>} flora @param {{ x: number, z: number, radius: number, visible: boolean } | null} brush
 *   the brush ring now (terrain.ring) @param {any} B growth.json bury
 * @returns {number[][]}
 */
export function buryRings(plants, flora, brush, B) {
  if (!brush?.visible || !B) return [];
  const reach = brush.radius + (B.ringM ?? 0);
  /** @type {{ d: number, ring: number[] }[]} */ const out = [];
  for (const p of plants) {
    const base = baseRadius(flora[p.sp], p.size);
    const d = Math.hypot(p.x - brush.x, p.z - brush.z);
    if (d - base > reach) continue;
    out.push({ d, ring: [p.x, p.z, Math.max(B.ringRadiusM ?? 0.6, base + 0.25), B.ringOpacity ?? 0.45] });
  }
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, B.rings ?? 12).map((o) => o.ring);
}
