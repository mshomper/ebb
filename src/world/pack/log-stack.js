// @ts-check
// A stick pile built from one log, many times over (Matt, October 22, 2026): seeded copies laid side
// by side along x in rows, each row resting in the grooves of the row below, bottom row on the
// ground, so every log rests on the ground or on two logs under it and none floats or sinks into
// another. Each copy has its own seeded size, end-for-end flip, small turn and shade. The logs come
// in order from the bottom up, so a pile that is not yet full shows only its first ones. Pure and
// deterministic (src/core/rng.js).

import { hash32 } from '../../core/rng.js';

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/**
 * @typedef {{ x: number, y: number, z: number, yaw: number, size: number, tint: number }} StackedLog
 *   x, z: where the log's middle sits in the pile's frame (x along the logs); y: its underside's height
 *   (the log mesh has its underside on y = 0); yaw: its turn about y; size: its scale; tint: a shade
 */

/**
 * The pile's logs, bottom up.
 * @param {number} seed @param {number} radiusM the log mesh's radius at size 1
 * @param {{ rows: number[], sizeJitter: number, gapM: number, slideM: number, yawJitterDeg: number, tintJitter: number }} S
 *   pack.json piles.look.stack: rows, logs in each row from the bottom; sizeJitter, ± share of size;
 *   gapM, a little air between logs in the bottom row; slideM, ± along their length; yawJitterDeg, a
 *   small turn (it barely changes how a log rests); tintJitter, ± share of shade
 * @returns {StackedLog[]}
 */
export function logStack(seed, radiusM, S) {
  /** @type {StackedLog[]} */ const out = [];
  /** @type {{ z: number, cy: number, r: number }[]} */ let below = [];
  S.rows.forEach((count, row) => {
    /** @param {number} i @param {number} k */
    const u = (i, k) => u01(hash32(seed, row, i, k));
    const sizes = Array.from({ length: count }, (_, i) => 1 + (2 * u(i, 1) - 1) * S.sizeJitter);
    /** @type {{ z: number, cy: number, r: number }[]} */ const here = [];
    if (row === 0) {
      // Side by side on the ground, centred about z = 0, as far apart as the largest log needs, so
      // the logs resting in the grooves above never crowd each other either.
      const step = 2 * radiusM * (1 + S.sizeJitter) + S.gapM;
      sizes.forEach((s, i) => { const r = radiusM * s; here.push({ z: (i - (count - 1) / 2) * step, cy: r, r }); });
    } else {
      // Each in the groove between two logs of the row below: touching both.
      for (let i = 0; i < count; i++) {
        const a = below[i], b = below[i + 1], r = radiusM * sizes[i];
        here.push(restOn(a, b, r));
      }
    }
    // Within a row, the lower ones first, so the order is bottom up all the way.
    const row0 = out.length;
    here.forEach((h, i) => {
      out.push({ x: (2 * u(i, 2) - 1) * S.slideM, y: h.cy - h.r, z: h.z,
        yaw: (u(i, 3) < 0.5 ? 0 : Math.PI) + (2 * u(i, 4) - 1) * S.yawJitterDeg * Math.PI / 180,
        size: h.r / radiusM, tint: 1 + (2 * u(i, 5) - 1) * S.tintJitter });
    });
    const sorted = out.slice(row0).sort((p, q) => p.y - q.y || p.z - q.z);
    out.splice(row0, sorted.length, ...sorted);
    below = here;
  });
  return out;
}

/**
 * A log of radius r resting on two logs below (centres a, b in the z, y plane): the higher of the
 * two points that touch both.
 * @param {{ z: number, cy: number, r: number }} a @param {{ z: number, cy: number, r: number }} b @param {number} r
 */
export function restOn(a, b, r) {
  const ra = a.r + r, rb = b.r + r;
  const dz = b.z - a.z, dy = b.cy - a.cy, d = Math.hypot(dz, dy);
  // Along the line from a to b, then up off it.
  const t = (ra * ra - rb * rb + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, ra * ra - t * t));
  const ez = dz / d, ey = dy / d;
  return { z: a.z + ez * t - ey * h, cy: a.cy + ey * t + ez * h, r };
}

/**
 * How many of the pile's logs show at a fullness: the stage's share of them, at least one.
 * @param {number} total @param {number} share 0..1
 */
export const logsShown = (total, share) => Math.max(1, Math.min(total, Math.ceil(share * total)));
