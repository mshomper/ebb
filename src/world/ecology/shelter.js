// @ts-check
// Shelter under the pieces (docs/future/10 "Pieces write into the grid", docs/future/11 L3a): every
// square of the 1 m habitat grid a kept log or loose stone lies on is shelter under, and those of
// them that are damp (by water, or in a damp hollow: the grid's moisture) are damp underneath. The
// toad's spring walk sets out from damp shelter (spring.js); L3b's centipede and slow worm, and later
// the hedgehog's day nest, read the same two fields. Read from state.basks (spring-live.js), so the
// same pieces give the same fields, live or while away. Pure and worker-safe.

import { HABITAT_ORIGIN } from '../growth/habitat.js';

/**
 * The squares a stone or log covers: a stone its own square; a log every square along its length.
 * @param {{ x: number, z: number, kind: string, len?: number, yaw?: number }} b @param {number} n
 * @returns {number[]}
 */
export function coveredCells(b, n) {
  const at = (/** @type {number} */ x, /** @type {number} */ z) => {
    const i = Math.floor(x - HABITAT_ORIGIN), j = Math.floor(z - HABITAT_ORIGIN);
    return i < 0 || j < 0 || i >= n || j >= n ? -1 : j * n + i;
  };
  if (b.kind !== 'log' || !(b.len && b.len > 0)) { const k = at(b.x, b.z); return k >= 0 ? [k] : []; }
  const ax = Math.sin(b.yaw ?? 0), az = Math.cos(b.yaw ?? 0);
  const steps = Math.max(1, Math.ceil(b.len / 0.5));
  /** @type {Set<number>} */ const out = new Set();
  for (let s = 0; s <= steps; s++) {
    const t = (s / steps - 0.5) * b.len;
    const k = at(b.x + ax * t, b.z + az * t);
    if (k >= 0) out.add(k);
  }
  return [...out].sort((a, b2) => a - b2);
}

/**
 * Shelter under (255 on each square a kept log or loose stone covers) and damp underneath (those
 * squares' moisture, 0..255), or null when there are no logs or stones. Reed rafts and pond stones
 * are not shelter: there is nothing dry to creep under.
 * @param {{ x: number, z: number, kind: string, len?: number, yaw?: number }[] | undefined} basks state.basks
 * @param {{ n: number, moisture: Uint8Array }} hab the habitat grid
 * @returns {{ shelterUnder: Uint8Array, dampUnder: Uint8Array } | null}
 */
export function shelterFields(basks, hab) {
  const list = (basks ?? []).filter((b) => b.kind === 'log' || b.kind === 'stone');
  if (!list.length) return null;
  const n = hab.n;
  const shelterUnder = new Uint8Array(n * n), dampUnder = new Uint8Array(n * n);
  for (const b of list) {
    for (const k of coveredCells(b, n)) { shelterUnder[k] = 255; dampUnder[k] = hab.moisture[k]; }
  }
  return { shelterUnder, dampUnder };
}

/**
 * How damp it is under a log or stone, 0..1: the best of the squares it covers (0 when it covers none).
 * @param {{ x: number, z: number, kind: string, len?: number, yaw?: number }} b
 * @param {{ shelterUnder: Uint8Array, dampUnder: Uint8Array } | null | undefined} f shelterFields
 * @param {number} n
 */
export function dampUnderAt(b, f, n) {
  if (!f) return 0;
  let best = 0;
  for (const k of coveredCells(b, n)) if (f.shelterUnder[k]) best = Math.max(best, f.dampUnder[k]);
  return best / 255;
}
