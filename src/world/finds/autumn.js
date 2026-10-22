// @ts-check
// Autumn's season markers (doc 13, The year, season by season; docs/future/11): fungi fruiting on
// kept logs, and dewy orb webs in tall grass on misty mornings. Both are finds worked out from the
// world, never saved. Pure: the live side is autumn-live.js; the meshes are autumn-meshes.js.
//
// Fungi: a kept log (driftwood carried off the strandline and set down, src/world/pieces) fruits on
// the first autumn day it has rested a few days out of the tide and the weather has been damp (the
// days' weather records, worked out again from the weather seed). Which kind, where on the log and how
// many is a seeded hash of the log's own seed; each fungus grows in over a day or two and fades in
// winter. Webs: on an autumn day whose weather is mist, a few cells of tall grass hold a web, seeded
// by the cell and the day; the dew on it follows the mist, so the webs bead in at dawn and fade as it
// lifts.

import { hash32 } from '../../core/rng.js';
import { seasonOf, SECONDS_PER_DAY, DAYS_PER_SEASON, SEASONS_PER_YEAR, HOURS_PER_DAY } from '../../core/clock.js';
import { dayRecord } from '../weather.js';

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;
/** @param {number[]} r @param {number} u */
const lerpIn = (r, u) => r[0] + (r[1] - r[0]) * u;
/** @param {number} x */
const smooth01 = (x) => { const t = x < 0 ? 0 : x > 1 ? 1 : x; return t * t * (3 - 2 * t); };
const AUTUMN = 2, WINTER = 3;
const TAU = 2 * Math.PI;

/**
 * The day records' moods, worked out once each (dayRecord is pure: the same seed, day and leaning
 * give the same day). @param {number} weatherSeed @param {number} lean @param {any} weather seasons.json weather
 * @returns {(day: number) => string}
 */
export function moodsOf(weatherSeed, lean, weather) {
  /** @type {Map<number, string>} */ const seen = new Map();
  return (day) => {
    let m = seen.get(day);
    if (m === undefined) { m = dayRecord(weatherSeed, day, lean, weather).mood; seen.set(day, m); }
    return m;
  };
}

/** The first day of this year's autumn, for a day in autumn or winter (else null). @param {number} day */
export function autumnStartOf(day) {
  const s = seasonOf(day * SECONDS_PER_DAY);
  if (s.index !== AUTUMN && s.index !== WINTER) return null;
  return (s.year * SEASONS_PER_YEAR + AUTUMN) * DAYS_PER_SEASON;
}

/**
 * Has the weather been damp enough for fungi by this day: at least damp.days of the damp.lookDays
 * days up to and including it were rain or mist? @param {number} day @param {(d: number) => string} moodOf @param {any} F autumn-finds.json fungi
 */
export function dampBy(day, moodOf, F) {
  let n = 0;
  for (let k = 0; k < F.damp.lookDays; k++) if (F.damp.moods.includes(moodOf(day - k))) n++;
  return n >= F.damp.days;
}

/**
 * When a kept log fruits this autumn: the first autumn day from startDay, up to today, by whose
 * start it has rested restDays and the weather has been damp; null if it has not (or it is spring or
 * summer). winter0 is the first day of the winter that fades them.
 * @param {{ dayNow: number, placedHour: number, moodOf: (d: number) => string, F: any }} p
 * @returns {{ day0: number, winter0: number } | null}
 */
export function fungiBloom(p) {
  const a0 = autumnStartOf(p.dayNow);
  if (a0 === null) return null;
  const last = Math.min(p.dayNow, a0 + DAYS_PER_SEASON - 1);
  for (let d = a0 + p.F.startDay; d <= last; d++) {
    if (d * HOURS_PER_DAY < p.placedHour + p.F.restDays * HOURS_PER_DAY) continue;
    if (dampBy(d, p.moodOf, p.F)) return { day0: d, winter0: a0 + DAYS_PER_SEASON };
  }
  return null;
}

/**
 * Does a kept log fruit at all this autumn (L2: age and damp make it likelier)? A seeded roll of the
 * log and the autumn against a chance of base, plus age (0..1, log-age.js) and damp (0..1) each
 * weighted: an old log, or one in damp ground, always can; a young log on dry ground some autumns
 * and not others. Pure. @param {number} seed the log's @param {number} autumn0 the autumn's first day
 * @param {number} age @param {number} damp @param {{ base: number, age: number, damp: number }} C autumn-finds.json fungi.chance
 */
export function fungiChance(seed, autumn0, age, damp, C) {
  const chance = Math.min(1, C.base + C.age * age + C.damp * damp);
  return chance >= 1 || u01(hash32(seed >>> 0, autumn0, 0xf1c)) < chance;
}

/**
 * How grown one fungus is, 0..1, at a game hour: growing in over growDays from its bloom (starting
 * up to spreadDays late, by its own stagger), fading over the winter's fadeDays.
 * @param {number} hourNow @param {{ day0: number, winter0: number }} bloom @param {number} grow 0..1 its stagger in
 * @param {number} fade 0..1 its stagger out @param {any} F autumn-finds.json fungi
 */
export function fungusSize(hourNow, bloom, grow, fade, F) {
  const t = hourNow / HOURS_PER_DAY;
  const g = smooth01((t - bloom.day0 - grow * F.spreadDays) / F.growDays);
  const w = smooth01((t - bloom.winter0 - fade * F.winter.spreadDays) / F.winter.fadeDays);
  return g * (1 - w);
}

/**
 * @typedef {{ t: number, a: number, mesh: string, size: number, yaw: number, grow: number, fade: number }} Fungus
 *   t: how far along the log (0..1 over its rings); a: the angle round it (radians: 0 its right
 *   flank, pi/2 its top, pi its left flank, in the log's own frame); mesh: bracket-<n> or cap-<n>;
 *   size: a multiplier of the mesh; yaw: a turn from square to the log (a bracket) or, for a cap,
 *   how it leans out from its tuft's middle (radians, about the tuft's own outward direction);
 *   grow, fade: its stagger in and out, 0..1
 * @typedef {{ t: number, a: number, members: Fungus[] }} FungusCluster t, a: its middle
 * @typedef {{ species: 'turkeytail' | 'sulphurtuft', clusters: FungusCluster[] }} FungiLayout
 */

/**
 * Which fungi a log grows and where: all from the log's own seed, so it fruits the same way on
 * every device. Pure. @param {{ seed: number, length: number }} log @param {any} F autumn-finds.json fungi
 * @returns {FungiLayout}
 */
export function fungiLayout(log, F) {
  const h0 = hash32(log.seed >>> 0, 0xf0a6);
  const species = u01(hash32(h0, 1)) < F.turkeyShare ? 'turkeytail' : 'sulphurtuft';
  const perM = lerpIn(F.clustersPerM, u01(hash32(h0, 2)));
  const n = Math.max(1, Math.min(F.clustersMax, Math.round(perM * log.length)));
  const len = Math.max(0.2, log.length);
  /** @type {FungusCluster[]} */ const clusters = [];
  const deg = Math.PI / 180;
  for (let c = 0; c < n; c++) {
    const hc = hash32(h0, 10, c);
    // Spread along the log: each cluster in its own stretch, somewhere within it.
    const [s0, s1] = F.alongShare;
    const t = s0 + (s1 - s0) * ((c + 0.15 + 0.7 * u01(hash32(hc, 1))) / n);
    /** @type {Fungus[]} */ const members = [];
    if (species === 'turkeytail') {
      const T = F.turkeytail;
      // The clusters take the flanks in turn (which first, by the seed), so a log seen from either
      // side shows some; up the flank toward the top, tier over tier.
      const right = (c + (u01(hash32(h0, 3)) < 0.5 ? 0 : 1)) % 2 === 0;
      const up = right ? 1 : -1;
      const base = (right ? 0 : Math.PI) + up * (T.flankDeg + (u01(hash32(hc, 3)) - 0.5) * 2 * T.jitterDeg) * deg;
      const count = T.count[0] + Math.floor(u01(hash32(hc, 4)) * (T.count[1] - T.count[0] + 1));
      for (let k = 0; k < count; k++) {
        const hm = hash32(hc, 20, k);
        const tier = Math.floor(k / 2), along = (k % 2 ? 1 : -1) * (0.3 + 0.7 * u01(hash32(hm, 1)));
        members.push({
          t: t + (along * T.spreadM * (k ? 1 : 0.2)) / len,
          a: base + up * (tier * T.tierDeg + u01(hash32(hm, 2)) * T.tierDeg * 0.4) * deg,
          mesh: `bracket-${Math.floor(u01(hash32(hm, 3)) * F.shape.bracket.variants)}`,
          size: lerpIn(T.size, u01(hash32(hm, 4))) * (1 - T.tierShrink * tier),
          yaw: (u01(hash32(hm, 5)) - 0.5) * 2 * T.yawDeg * deg,
          grow: u01(hash32(hm, 6)), fade: u01(hash32(hm, 7)),
        });
      }
      clusters.push({ t, a: base, members });
    } else {
      const S = F.sulphurtuft;
      const a = Math.PI / 2 + (u01(hash32(hc, 2)) - 0.5) * 2 * S.topDeg * deg;
      const count = S.count[0] + Math.floor(u01(hash32(hc, 4)) * (S.count[1] - S.count[0] + 1));
      const leans = F.shape.cap.leanDeg.length;
      for (let k = 0; k < count; k++) {
        const hm = hash32(hc, 20, k);
        // The first stands in the middle; the others round it, the outer ones leaning out more.
        const r = k ? Math.sqrt(0.25 + 0.75 * u01(hash32(hm, 1))) : 0, ang = u01(hash32(hm, 2)) * TAU;
        members.push({
          t: t + (Math.cos(ang) * r * S.spreadM) / len,
          a: a + Math.sin(ang) * r * S.spreadDeg * deg,
          mesh: `cap-${Math.min(leans - 1, Math.round(r * (leans - 1)))}`,
          size: lerpIn(S.size, u01(hash32(hm, 4))) * (1 - 0.25 * r),
          yaw: (u01(hash32(hm, 5)) - 0.5) * 0.6,
          grow: u01(hash32(hm, 6)), fade: u01(hash32(hm, 7)),
        });
      }
      clusters.push({ t, a, members });
    }
  }
  return { species, clusters };
}

/**
 * @typedef {{ key: string, x: number, z: number, yaw: number, r: number, hub: number, seed: number }} Web
 *   r: hub to rim (m); hub: the hub's height over the ground at its foot (m); seed: its own threads
 */

/**
 * The orb webs in the tall grass near a point on one misty day: each square meter of thick, lush
 * grass may hold one, by a seeded hash of the cell and the day. Nearest first, at most W.max. Pure.
 * @param {{ seed: number, day: number, x: number, z: number, nearM: number, grass: ArrayLike<number> | null,
 *   lush: ArrayLike<number> | null, cells: number, origin: number, W: any }} p
 *   grass, lush: 0..255 a square meter on the growth grid (cells across, from origin m); lush left
 *   out: any grass will do
 * @returns {Web[]}
 */
export function websNear(p) {
  const W = p.W, G = p.grass;
  if (!G) return [];
  const minG = W.minGrass * 255, minL = W.minLush * 255;
  const i0 = Math.max(0, Math.floor(p.x - p.nearM - p.origin)), i1 = Math.min(p.cells - 1, Math.floor(p.x + p.nearM - p.origin));
  const j0 = Math.max(0, Math.floor(p.z - p.nearM - p.origin)), j1 = Math.min(p.cells - 1, Math.floor(p.z + p.nearM - p.origin));
  /** @type {(Web & { d: number })[]} */ const out = [];
  const near2 = p.nearM * p.nearM;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = j * p.cells + i;
    if (G[k] < minG || (p.lush && p.lush[k] < minL)) continue;
    const h = hash32(p.seed, k, p.day, 0x3eb);
    if (u01(h) >= W.density) continue;
    const x = p.origin + i + 0.15 + 0.7 * u01(hash32(h, 1)), z = p.origin + j + 0.15 + 0.7 * u01(hash32(h, 2));
    const d = (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z);
    if (d > near2) continue;
    const r = lerpIn(W.radiusM, u01(hash32(h, 4)));
    out.push({ key: `webs:${k}:${p.day}`, x, z, yaw: u01(hash32(h, 3)) * TAU, r, hub: r + lerpIn(W.hubM, u01(hash32(h, 5))), seed: hash32(h, 6) >>> 0, d });
  }
  out.sort((a, b) => a.d - b.d || (a.key < b.key ? -1 : 1));
  return out.slice(0, W.max).map(({ d, ...w }) => w);
}

/**
 * How dewy the webs are now, 0..1: only on an autumn day whose weather is mist, following the mist
 * as it thickens and lifts. @param {{ season: number, mood: string | null, mist: number }} now @param {any} W autumn-finds.json webs
 */
export function webDew(now, W) {
  if (now.season !== AUTUMN || now.mood !== 'mist') return 0;
  return smooth01((now.mist - W.dewMist[0]) / (W.dewMist[1] - W.dewMist[0]));
}

/**
 * The first misty autumn morning from a day on whose day a log set down long ago has fungi grown in
 * (they bloomed at least growDays + spreadDays before): for the `?autumn` test link and the debug
 * jump, so both fungi and webs are there to see. Searches up to `years` years ahead. Pure.
 * @param {{ fromDay: number, moodOf: (d: number) => string, F: any, years?: number }} p
 * @returns {number | null}
 */
export function mistyAutumnMorning(p) {
  const year = DAYS_PER_SEASON * SEASONS_PER_YEAR;
  const ready = Math.ceil(p.F.growDays + p.F.spreadDays);
  for (let y = Math.floor(p.fromDay / year); y < Math.floor(p.fromDay / year) + (p.years ?? 40); y++) {
    const a0 = y * year + AUTUMN * DAYS_PER_SEASON;
    const bloom = fungiBloom({ dayNow: a0 + DAYS_PER_SEASON - 1, placedHour: -Infinity, moodOf: p.moodOf, F: p.F });
    if (!bloom) continue;
    for (let d = Math.max(p.fromDay, bloom.day0 + ready); d < a0 + DAYS_PER_SEASON; d++) if (p.moodOf(d) === 'mist') return d;
  }
  return null;
}
