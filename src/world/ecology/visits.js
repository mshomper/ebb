// @ts-check
// Visits (doc 13 "Shaped, not found", rule 1; B3 S0): before its home exists, a seasonal newcomer
// comes now and then in its season and shows itself for a short while; the next morning a hint
// note comes (src/world/hints/morning.js, a hint with `visit`), and the journal page's pencil
// circle carries the same hint (its hints' `<sp>:visited`). Visits stop once the ground the player
// shaped makes its home (shaped.js homeOf), or once it has come to live here.
//
// Which days bring a visit is worked out from the seed alone, so a visit that fell while the island
// was away still counts: it leaves its flags and its hint, only nobody saw it. Trust is never
// touched. The block lives in each species recipe (ecology.visit), docs/11 "Visits and shaped homes":
//   seasons    [0..3]  seasons it may come in (0 spring .. 3 winter)
//   everyDays  n       days are cut into windows this long; at most one visit in each
//   chance     0..1    the chance a window in season brings one (the seed decides which day)
//   hours      [a, b]  the game hours a visit may start in (b not included)
//   fromDay    n       no visit before this game day (optional)
//   show       { kind, lastsH, where, ... }  the species' own appearance, passed on as it is in
//              `visit:start`; where (shore, sea, pond or strand) picks the spot it shows at
//   home       { check, need, max }  the home that ends the visits (shaped.js homeOf)
// Flags it sets in the journal: `<sp>:visited` (the first visit), `<sp>:home` (the home is made).
// Memory (save section `shaped`, part `visits`): lookedH, and by species { last, x, z, n }.

import { hash32, subSeed } from '../../core/rng.js';
import { seasonOf, SECONDS_PER_DAY } from '../../core/clock.js';
import { HABITAT_ORIGIN } from '../growth/habitat.js';
import { openBox } from './fields.js';
import { homeOf } from './shaped.js';

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/** The species' own salt for visit rolls. @param {number} seed @param {string} sp */
const visitSeed = (seed, sp) => subSeed(seed, `visit:${sp}`);

/**
 * The visit (if any) in the window holding game day `day`: { day, hour } or null. Pure: the same
 * seed, species and window give the same answer on every device.
 * @param {number} seed the world seed @param {string} sp @param {number} day @param {any} V ecology.visit
 * @returns {{ day: number, hour: number } | null}
 */
export function visitInWindow(seed, sp, day, V) {
  const every = Math.max(1, V.everyDays ?? 7);
  const w = Math.floor(day / every), s = visitSeed(seed, sp);
  if (u01(hash32(s, w, 1)) >= (V.chance ?? 1)) return null;
  const d = w * every + Math.floor(u01(hash32(s, w, 2)) * every);
  if (d < (V.fromDay ?? 0)) return null;
  if (!(V.seasons ?? [0, 1, 2, 3]).includes(seasonOf(d * SECONDS_PER_DAY + 43200).index)) return null;
  const [a, b] = V.hours ?? [8, 17];
  return { day: d, hour: d * 24 + a + Math.floor(u01(hash32(s, w, 3)) * Math.max(1, b - a)) };
}

/**
 * Every visit starting after game hour h0 up to h1 (h0 < hour <= h1), in order. Pure.
 * @param {number} seed @param {string} sp @param {any} V @param {number} h0 @param {number} h1
 */
export function visitsBetween(seed, sp, V, h0, h1) {
  /** @type {{ day: number, hour: number }[]} */ const out = [];
  if (h1 <= h0) return out;
  const every = Math.max(1, V.everyDays ?? 7);
  const w0 = Math.floor(Math.floor(h0 / 24) / every), w1 = Math.floor(Math.floor(h1 / 24) / every);
  for (let w = w0; w <= w1; w++) {
    const v = visitInWindow(seed, sp, w * every, V);
    if (v && v.hour > h0 && v.hour <= h1) out.push(v);
  }
  return out;
}

/**
 * Where a visit shows itself, seeded by the visit's day: a land square on the waterline (shore), a
 * sea square beside it (sea), the deepest square of the largest pond (pond), or a square of the
 * tide band (strand). Null where the island has none. Pure.
 * @param {any} hab @param {string} where @param {number} seed @param {string} sp @param {number} day
 * @returns {{ x: number, z: number } | null}
 */
export function visitSpot(hab, where, seed, sp, day) {
  if (!hab) return null;
  const n = hab.n, b = openBox(hab, 1);
  /** @type {number[]} */ const list = [];
  const sea = (/** @type {number} */ k) => k >= 0 && k < n * n && hab.sea[k];
  const nextToSea = (/** @type {number} */ k) => sea(k - 1) || sea(k + 1) || sea(k - n) || sea(k + n);
  const nextToLand = (/** @type {number} */ k) => [k - 1, k + 1, k - n, k + n].some((q) => q >= 0 && q < n * n && hab.open[q] && !hab.sea[q]);
  if (where === 'pond') {
    let best = -1, bestD = 0;
    for (let j = b.j0; j <= b.j1; j++) for (let k = j * n + b.i0; k <= j * n + b.i1; k++) {
      if (hab.open[k] && !hab.sea[k] && hab.still[k] && hab.depthCm[k] > bestD) { bestD = hab.depthCm[k]; best = k; }
    }
    if (best >= 0) list.push(best);
  } else {
    for (let j = b.j0; j <= b.j1; j++) for (let k = j * n + b.i0; k <= j * n + b.i1; k++) {
      if (!hab.open[k]) continue;
      if (where === 'sea' ? hab.sea[k] && nextToLand(k) : where === 'strand' ? hab.band?.[k] && !hab.sea[k] : !hab.sea[k] && hab.depthCm[k] === 0 && nextToSea(k)) list.push(k);
    }
  }
  if (!list.length) return null;
  const k = list[Math.floor(u01(hash32(visitSeed(seed, sp), day, 4)) * list.length)];
  return { x: HABITAT_ORIGIN + (k % n) + 0.5, z: HABITAT_ORIGIN + Math.floor(k / n) + 0.5 };
}

/**
 * The species that visit: every recipe with an ecology.visit block, by its journal page's id
 * (ecology.visit.sp, else the recipe's own id). @param {Record<string, any>} recipes species recipes by id
 * @returns {{ sp: string, V: any }[]}
 */
export const visitorsOf = (recipes) => Object.entries(recipes).filter(([, r]) => r?.ecology?.visit).map(([id, r]) => ({ sp: r.ecology.visit.sp ?? id, V: r.ecology.visit }));

/**
 * One look: the visits since the last look, which of them to show now (the look came within
 * awayGapH of the last, so the island was watched), and the flags to set. Pure.
 * @param {{ seed: number, nowH: number, lookedH: number | null, by: Record<string, any>, visitors: { sp: string, V: any }[],
 *   report: any, hab: any, flags: string[], ever: (sp: string) => boolean, awayGapH: number }} o
 * @returns {{ by: Record<string, any>, show: { sp: string, show: any, x: number, z: number, hour: number, day: number }[], flags: string[] }}
 */
export function visitStep(o) {
  const by = structuredClone(o.by ?? {});
  /** @type {{ sp: string, show: any, x: number, z: number, hour: number, day: number }[]} */ const show = [];
  /** @type {string[]} */ const flags = [];
  // A new island (or an older one meeting visits for the first time) starts looking from now.
  const from = o.lookedH ?? o.nowH;
  const watched = o.nowH - from <= o.awayGapH;
  for (const { sp, V } of o.visitors) {
    const home = homeOf(o.report, V.home);
    if (home.met) { if (!o.flags.includes(`${sp}:home`)) flags.push(`${sp}:home`); continue; }
    if (o.ever(sp) || o.flags.includes(`${sp}:home`)) continue;
    for (const v of visitsBetween(o.seed, sp, V, from, o.nowH)) {
      const at = visitSpot(o.hab, V.show?.where ?? 'shore', o.seed, sp, v.day);
      by[sp] = { last: v.day, x: at?.x ?? null, z: at?.z ?? null, n: (by[sp]?.n ?? 0) + 1 };
      if (!o.flags.includes(`${sp}:visited`) && !flags.includes(`${sp}:visited`)) flags.push(`${sp}:visited`);
      if (watched && at) show.push({ sp, show: V.show ?? {}, x: at.x, z: at.z, hour: v.hour, day: v.day });
    }
  }
  return { by, show, flags };
}
