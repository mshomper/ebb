// @ts-check
// Life under a log (docs/future/11 L3a): what a Lift on foot finds under a kept log or a loose stone.
// Woodlice cluster under any kept log on soil or grass after a couple of days; the violet ground beetle
// hides under logs on grass, late spring to autumn, by day. Each Lift is a seeded roll of the log's
// seed, the game day and the ground (damp, shade, near water, the log's age), so the same lift on the
// same day finds the same thing on every device and after time away; nothing is saved. Numbers live in
// recipes/species/under-log.json. Pure.

import { hash32 } from '../../core/rng.js';
import { HABITAT_ORIGIN } from '../growth/habitat.js';
import { logAge } from '../pieces/log-age.js';

/** The kinds that live underneath, in the order they are rolled (a kind's place salts its roll). */
export const UNDER_KINDS = /** @type {const} */ (['woodlice', 'beetle']);
/** Their journal pages (recipes/world/journal.json species). */
export const UNDER_PAGES = { woodlice: 'woodlice', beetle: 'groundbeetle' };

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;
/** Smooth 0..1 step. @param {number} x @param {number} a @param {number} b */
const smooth = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * @typedef {{ damp: number, shade: number, nearWater: number, grass: number, soil: number, wet: boolean }} Ground
 *   each 0..1: damp under it, shade over it, fresh water near, the painted grass and soil shares;
 *   wet: standing water or the sea there (nothing lives under a log in the water)
 */

/**
 * The ground under a piece, from the habitat grid and the plants round it: damp from the grid's
 * moisture, shade from tall plants within shade.radiusM (each plant's weight times its size, the same
 * weights as L2's dampShade in src/world/pieces/log-age.js, which reads the water summary instead).
 * @param {{ hab: any, plants: { sp: string, x: number, z: number, size: number }[], x: number, z: number, G: any }} p
 *   G: under-log.json ground
 * @returns {Ground}
 */
export function groundUnder(p) {
  const { hab, G } = p, n = hab.n;
  const i0 = Math.floor(p.x - HABITAT_ORIGIN), j0 = Math.floor(p.z - HABITAT_ORIGIN);
  const k0 = i0 >= 0 && j0 >= 0 && i0 < n && j0 < n ? j0 * n + i0 : -1;
  if (k0 < 0) return { damp: 0, shade: 0, nearWater: 0, grass: 0, soil: 0, wet: true };
  const wet = !!hab.sea[k0] || hab.depthCm[k0] > 0;
  // Fresh water within nearM, by the nearest square of it.
  const r = Math.ceil(G.nearWaterM);
  let best = Infinity;
  for (let j = Math.max(0, j0 - r); j <= Math.min(n - 1, j0 + r); j++) {
    for (let i = Math.max(0, i0 - r); i <= Math.min(n - 1, i0 + r); i++) {
      const k = j * n + i;
      if (hab.sea[k] || !(hab.depthCm[k] > 0)) continue;
      best = Math.min(best, Math.hypot(i - i0, j - j0));
    }
  }
  let cover = 0;
  const R2 = G.shade.radiusM * G.shade.radiusM;
  for (const q of p.plants) {
    const w = G.shade.plants[q.sp];
    if (!w) continue;
    const d2 = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
    if (d2 > R2) continue;
    cover += w * Math.min(1, q.size) * (1 - Math.sqrt(d2) / G.shade.radiusM);
  }
  return {
    damp: hab.moisture[k0] / 255,
    shade: smooth(cover, 0, G.shade.full),
    nearWater: best === Infinity ? 0 : 1 - smooth(best, G.nearWaterFullM, G.nearWaterM),
    grass: (hab.grass?.[k0] ?? 0) / 255,
    soil: (hab.soil?.[k0] ?? 0) / 255,
    wet,
  };
}

/**
 * How long a kept log has lain, in game days since it was set down (a kind's minDays), and how aged it
 * is, 0..1, by L2's own ageing (log-age.js logAge: the same age that darkens it and brings its moss).
 * @param {number} placedHour @param {number} hourNow @param {{ startDays: number, fullDays: number } | null} [A] pieces.json driftwood.age
 * @returns {{ days: number, age?: number }}
 */
export function keptAge(placedHour, hourNow, A) {
  const days = Math.max(0, (hourNow - placedHour) / 24);
  return A ? { days, age: logAge(placedHour, hourNow, A) } : { days };
}

/**
 * Does a kind live on this ground? soil: not sand, rock or water; grass: the grass share is at least
 * grassMin. @param {string[]} kinds the kind's ground list @param {Ground} g @param {any} G under-log.json ground
 */
export function onGround(kinds, g, G) {
  if (g.wet) return false;
  if (kinds.includes('grass') && g.grass >= G.grassMin) return true;
  return kinds.includes('soil') && g.soil + g.grass >= G.soilMin;
}

/**
 * Is it the time of year and day for a kind? @param {any} K the kind's recipe
 * @param {{ season: number, phase: number, hourOfDay: number }} t
 */
export function inTime(K, t) {
  if (K.seasons && !K.seasons.includes(t.season)) return false;
  if (K.spring && t.season === 0 && t.phase < K.spring.fromPhase) return false;
  if (K.hours && (t.hourOfDay < K.hours[0] || t.hourOfDay >= K.hours[1])) return false;
  return true;
}

/**
 * The chance a kind is under this piece now, 0..most: nothing off its ground, out of its time or too
 * new; else its base and each of damp, shade, near water and the log's age adding its share.
 * @param {any} K the kind's recipe
 * @param {{ kind: string, days: number, age?: number, ground: Ground, season: number, phase: number, hourOfDay: number }} c
 *   age: the log's own age 0..1 (L2's logAge, src/world/pieces/log-age.js); without it, ageFullDays past minDays
 * @param {any} G under-log.json ground
 */
export function chanceOf(K, c, G) {
  if (!K.on.includes(c.kind) || !onGround(K.ground, c.ground, G) || !inTime(K, c)) return 0;
  if (c.days < (K.minDays ?? 0)) return 0;
  const C = K.chance, g = c.ground;
  const age = c.age ?? smooth(c.days, K.minDays ?? 0, (K.minDays ?? 0) + G.ageFullDays);
  return Math.min(G.most, C.base + C.damp * g.damp + C.shade * g.shade + C.nearWater * g.nearWater + C.age * age);
}

/**
 * @typedef {{ sp: 'woodlice' | 'beetle', u: number, v: number, yaw: number, r: number, key: string }} UnderOne
 *   u: along the piece (-0.5..0.5 of its length, 0 for a stone); v: across, in meters from its middle line;
 *   yaw: its turn in the piece's frame; r: a seeded 0..1 for its look and its run
 */

/**
 * What a Lift finds under one piece on one game day. Pure: the same seed, piece, day and ground give
 * the same finds.
 * @param {number} seed the world's under-log seed
 * @param {{ id: string, kind: string, seed: number, length?: number, size: number }} piece
 * @param {{ day: number, days: number, age?: number, ground: Ground, season: number, phase: number, hourOfDay: number }} c
 *   day: the game day (its index); days: how long the log has been kept; age: its own age 0..1 (chanceOf)
 * @param {any} R recipes/species/under-log.json
 * @returns {{ found: UnderOne[], counts: Record<string, number>, chances: Record<string, number> }}
 */
export function rollUnder(seed, piece, c, R) {
  /** @type {UnderOne[]} */ const found = [];
  /** @type {Record<string, number>} */ const counts = {}, chances = {};
  const len = piece.kind === 'log' ? piece.length ?? 1 : 0;
  const half = piece.kind === 'log' ? piece.size * 0.5 : piece.size * 0.35;
  UNDER_KINDS.forEach((sp, salt) => {
    const K = R[sp];
    counts[sp] = 0;
    chances[sp] = K ? chanceOf(K, { kind: piece.kind, ...c }, R.ground) : 0;
    if (!chances[sp]) return;
    const h0 = hash32(seed, piece.seed >>> 0, c.day, (salt + 1) * 7919);
    if (u01(h0) >= chances[sp]) return;
    const n = K.count[0] + Math.floor(u01(hash32(h0, 1)) * (K.count[1] - K.count[0] + 1));
    counts[sp] = n;
    // A cluster round a seeded spot along the log (woodlice huddle together); the beetle anywhere.
    const at = (u01(hash32(h0, 2)) - 0.5) * 0.7;
    for (let i = 0; i < n; i++) {
      const h = hash32(h0, 3, i);
      const u = len ? Math.max(-0.45, Math.min(0.45, at + (u01(h) - 0.5) * K.clusterShare)) : 0;
      const v = (u01(hash32(h, 1)) - 0.5) * 2 * half * 0.8;
      found.push({ sp, u, v, yaw: u01(hash32(h, 2)) * Math.PI * 2, r: u01(hash32(h, 3)), key: `${sp}:${piece.id}:${c.day}:${i}` });
    }
  });
  return { found, counts, chances };
}

/**
 * A piece-frame spot (u along, v across) in world meters. @param {{ x: number, z: number, yaw: number, length?: number, kind: string }} p
 * @param {number} u @param {number} v
 */
export function underToWorld(p, u, v) {
  const len = p.kind === 'log' ? p.length ?? 1 : 0;
  const ax = Math.sin(p.yaw), az = Math.cos(p.yaw);
  return [p.x + ax * u * len + az * v, p.z + az * u * len - ax * v];
}
