// @ts-check
// Steps (doc 13, the shaper's trail; doc 08, the Cliff tool's third mode): a flight of steps cut
// between two levels of ground, so the walker can climb from one terrace to the next. You drag from
// the upper shelf down to the ground below (or up); the flight runs along that line, as wide as
// steps.widthM, its rises even and never more than maxRiseM, its treads at least minTreadM, so the
// walker's step limit (walker.json grid.maxStepM over half a metre) always holds. The flight is
// written into the ground itself (heights and rock paint, saved with the chunk), and its record (a
// piece of kind 'steps') keeps it: the brushes skip its cells and every edit's end puts it back
// (terrain/index.js guard), so reshaping the cliff round it never breaks the stair. Each tread gets
// flat stone slabs (slabs.js) set a few centimetres proud.
//
// A record: { id, kind: 'steps', x, z, x2, z2, size, top, bottom, risers, seed, placedHour }: (x, z)
// the top end, (x2, z2) the bottom end, size the width (m), top and bottom the two levels (m), risers
// how many rises it was cut with.
// Plain arithmetic and Math.sqrt only (rng.js), so a flight is cut the same on every device. Pure.

import { CELL, WORLD_CELLS as N, WORLD_ORIGIN, quantize, dequantize } from '../terrain/grid.js';
import { paintRock } from '../terrain/boulder.js';
import { hash32 } from '../../core/rng.js';

/**
 * @typedef {{ id: string, kind: 'steps', x: number, z: number, x2: number, z2: number, size: number,
 *   top: number, bottom: number, risers?: number, seed: number, placedHour: number }} Flight
 * @typedef {{ ux: number, uz: number, len: number, risers: number, tread: number, rise: number, half: number, land: number }} FlightGeom
 *   ux, uz: the unit direction from the top end down; risers: how many; tread: each tread's depth (m)
 */

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/**
 * How a drag from a to b would be cut, or why it can't be: no drop to step down ('flat'), too short
 * for even, gentle steps ('short', with needM the run it wants), or across another flight ('overlap',
 * checked by the caller).
 * @param {number[]} a [x, z] where the drag began @param {number[]} b [x, z] where it ended
 * @param {number} ha ground at a @param {number} hb ground at b @param {any} R pieces.json steps
 * @returns {{ ok: true, x: number, z: number, x2: number, z2: number, top: number, bottom: number, risers: number }
 *   | { ok: false, reason: 'flat' | 'short', needM?: number }}
 */
export function planFlight(a, b, ha, hb, R) {
  const drop = Math.abs(ha - hb);
  if (drop < R.minDropM) return { ok: false, reason: 'flat' };
  const [p, q] = ha >= hb ? [a, b] : [b, a];
  const dx = q[0] - p[0], dz = q[1] - p[1];
  const len = Math.sqrt(dx * dx + dz * dz);
  const fewest = Math.ceil(drop / R.maxRiseM - 1e-9);
  const needM = Math.max(fewest * R.minTreadM, drop / R.maxPitch);
  if (len + 1e-6 < needM) return { ok: false, reason: 'short', needM };
  const risers = Math.max(fewest, Math.ceil(len / R.maxTreadM - 1e-9));
  return { ok: true, x: p[0], z: p[1], x2: q[0], z2: q[1], top: Math.max(ha, hb), bottom: Math.min(ha, hb), risers };
}

/** A flight's shape from its record. @param {Flight} f @param {any} R pieces.json steps @returns {FlightGeom} */
export function flightGeom(f, R) {
  const dx = f.x2 - f.x, dz = f.z2 - f.z;
  const len = Math.max(1e-6, Math.sqrt(dx * dx + dz * dz));
  const drop = f.top - f.bottom;
  // A flight keeps the rises it was cut with, so retuning the recipe never recuts it.
  const risers = f.risers ?? Math.max(1, Math.ceil(drop / R.maxRiseM - 1e-9), Math.ceil(len / R.maxTreadM - 1e-9));
  return { ux: dx / len, uz: dz / len, len, risers, tread: len / risers, rise: drop / risers, half: f.size / 2, land: R.landM };
}

/**
 * The flight's ground at a point, or null outside it. Along the line it is a half tread of the top
 * level, then each tread a rise lower, then a half tread of the bottom level; it runs on a little
 * past both ends (land) at those levels, so it meets the ground it joins.
 * @param {Flight} f @param {FlightGeom} g @param {number} x @param {number} z
 */
export function flightHeightAt(f, g, x, z) {
  const rx = x - f.x, rz = z - f.z;
  const t = rx * g.ux + rz * g.uz, u = -rx * g.uz + rz * g.ux;
  if (t < -g.land || t > g.len + g.land || u < -g.half || u > g.half) return null;
  const s = Math.min(g.risers, Math.max(0, Math.floor(t / g.tread + 0.5)));
  return f.top - s * g.rise;
}

/** The cell rect a flight covers (one cell of margin). @param {Flight} f @param {FlightGeom} g */
export function flightRect(f, g) {
  const ex = Math.abs(g.ux) * g.land + Math.abs(g.uz) * g.half, ez = Math.abs(g.uz) * g.land + Math.abs(g.ux) * g.half;
  const x0 = Math.min(f.x, f.x2) - ex, x1 = Math.max(f.x, f.x2) + ex, z0 = Math.min(f.z, f.z2) - ez, z1 = Math.max(f.z, f.z2) + ez;
  const i0 = Math.max(0, Math.floor((x0 - WORLD_ORIGIN) / CELL) - 1), j0 = Math.max(0, Math.floor((z0 - WORLD_ORIGIN) / CELL) - 1);
  const i1 = Math.min(N - 1, Math.ceil((x1 - WORLD_ORIGIN) / CELL) + 1), j1 = Math.min(N - 1, Math.ceil((z1 - WORLD_ORIGIN) / CELL) + 1);
  return { x: i0, y: j0, w: Math.max(0, i1 - i0 + 1), h: Math.max(0, j1 - j0 + 1) };
}

/** @param {{ x: number, y: number, w: number, h: number }} a @param {{ x: number, y: number, w: number, h: number }} b */
const overlap = (a, b) => {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
};

/**
 * Set a flight's cells to its steps, within rect (all of it when left out). Heights go in quantized,
 * as the save keeps them. Returns whether any cell changed.
 * @param {{ heightQ: Uint16Array, heightF: Float32Array }} m @param {Flight} f @param {any} R
 * @param {{ x: number, y: number, w: number, h: number }} [rect]
 */
export function carveFlight(m, f, R, rect) {
  const g = flightGeom(f, R);
  const r = rect ? overlap(flightRect(f, g), rect) : flightRect(f, g);
  let changed = false;
  for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) {
    const h = flightHeightAt(f, g, WORLD_ORIGIN + (i + 0.5) * CELL, WORLD_ORIGIN + (j + 0.5) * CELL);
    if (h === null) continue;
    const k = j * N + i, q = quantize(h);
    if (m.heightQ[k] === q) continue;
    m.heightQ[k] = q;
    m.heightF[k] = dequantize(q);
    changed = true;
  }
  return changed;
}

/**
 * Paint a newly cut flight rock: its own cells, and the cells beside it left on a sheer drop (the
 * walls of the cut), so they draw as stone and erosion keeps them standing.
 * @param {{ heightF: Float32Array, material: Uint8Array }} m @param {Flight} f @param {any} R
 */
export function paintFlight(m, f, R) {
  const g = flightGeom(f, R), r = flightRect(f, g);
  for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) {
    const k = j * N + i;
    if (flightHeightAt(f, g, WORLD_ORIGIN + (i + 0.5) * CELL, WORLD_ORIGIN + (j + 0.5) * CELL) !== null) { paintRock(m.material, k * 4, R.rockShare); continue; }
    let drop = 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni >= 0 && nj >= 0 && ni < N && nj < N) drop = Math.max(drop, Math.abs(m.heightF[k] - m.heightF[nj * N + ni]));
    }
    if (drop > R.faceDropM) paintRock(m.material, k * 4, R.rockShare);
  }
}

/**
 * Mark the flights' cells in the brushes' guard mask (1 guarded), within rect.
 * @param {Uint8Array} mask N x N @param {Flight[]} flights @param {any} R
 * @param {{ x: number, y: number, w: number, h: number }} rect
 */
export function markGuard(mask, flights, R, rect) {
  for (let j = rect.y; j < rect.y + rect.h; j++) mask.fill(0, j * N + rect.x, j * N + rect.x + rect.w);
  for (const f of flights) {
    const g = flightGeom(f, R), r = overlap(flightRect(f, g), rect);
    for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) {
      if (flightHeightAt(f, g, WORLD_ORIGIN + (i + 0.5) * CELL, WORLD_ORIGIN + (j + 0.5) * CELL) !== null) mask[j * N + i] = 1;
    }
  }
}

/**
 * Does a new flight cross a cell any other flight guards? @param {Uint8Array} mask @param {Flight} f @param {any} R
 */
export function crossesGuard(mask, f, R) {
  const g = flightGeom(f, R), r = flightRect(f, g);
  for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) {
    if (mask[j * N + i] && flightHeightAt(f, g, WORLD_ORIGIN + (i + 0.5) * CELL, WORLD_ORIGIN + (j + 0.5) * CELL) !== null) return true;
  }
  return false;
}

/**
 * The slabs on a flight's treads: R.slab.perTread side by side on every tread between the top and
 * bottom levels, each a seeded one of the slab shapes, turned across the flight with a little
 * jitter and sized to its share of the tread; its top is slab.riseM over the tread.
 * @param {Flight} f @param {any} R @param {{ hx: number, hz: number }[]} shapes slabs.js
 * @returns {{ x: number, z: number, y: number, top: number, yaw: number, size: number, shape: number }[]}
 */
export function treadSlabs(f, R, shapes) {
  const g = flightGeom(f, R), S = R.slab;
  const out = [];
  // Across the flight: its own z runs along (-uz, ux), which a yaw turns to (sin yaw, cos yaw).
  const across = Math.atan2(-g.uz, g.ux);
  for (let s = 1; s < g.risers; s++) {
    const y = f.top - s * g.rise, t = s * g.tread;
    for (let c = 0; c < S.perTread; c++) {
      const h = hash32(f.seed, s, c);
      const shape = h % shapes.length, sh = shapes[shape];
      const share = (2 * g.half) / S.perTread;
      // Its length across the flight, its width along the tread: both must fit.
      const size = Math.min(share * S.fill, (g.tread * S.fill) / (2 * sh.hx));
      const u = -g.half + share * (c + 0.5) + (u01(hash32(h, 1)) - 0.5) * share * (1 - S.fill);
      const tt = t + (u01(hash32(h, 2)) - 0.5) * g.tread * (1 - S.fill) * 0.5;
      const yaw = across + (u01(hash32(h, 3)) - 0.5) * (S.yawJitterDeg * Math.PI) / 90;
      out.push({ x: f.x + g.ux * tt - g.uz * u, z: f.z + g.uz * tt + g.ux * u, y, top: y + S.riseM, yaw, size, shape });
    }
  }
  return out;
}
