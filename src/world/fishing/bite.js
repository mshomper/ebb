// @ts-check
// A bite (docs/future/17, "Odds, never gates"): which fish takes the bait, from the world seed, the
// cast's number, the water, the conditions now and the worm. A species' weight starts from its
// rarity's; each of its conditions that holds multiplies it, and the right worm doubles it; with
// none met it keeps its base weight, so a night fish can still bite at noon, just rarely. The
// conditions are read from the hour, the weather, yesterday's weather (after a storm, until F08's
// storms come), the tide, the season and a sign in the water nearby (F12 K8, a hook: always none
// yet). The waits are seeded too, so nothing here is random. Pure.

import { hash32 } from '../../core/rng.js';
import { allFish } from './roster.js';

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/**
 * @typedef {{ hourOfDay: number, season: string, rain: number, mist: number, cloud: number, wind: number,
 *   yRain: number, yWind: number, tideLevel: number, tideAmp: number, sign?: string | null }} Now
 *   the hour of the day (0..24), the season's name, this hour's weather (0..1), yesterday's rain and
 *   wind, the tide's level and amplitude (m), a sign in the water nearby
 */

/** Is an hour inside any of these [from, to) spans? @param {number} h @param {number[][]} spans */
const within = (h, spans) => spans.some(([a, b]) => h >= a && h < b);

/**
 * The conditions that hold now. Pure. @param {Now} n @param {any} W recipes/world/fishing.json when
 * @returns {Set<string>}
 */
export function conditionsNow(n, W) {
  const on = new Set();
  const night = within(n.hourOfDay, W.night);
  if (night) on.add('night');
  if (within(n.hourOfDay, W.dawn)) on.add('dawn');
  if (!night && n.rain < 0.05 && n.mist < W.mist && n.cloud < 0.4 && n.wind < W.calmWind) on.add('day');
  if (n.rain >= W.rain) on.add('rain');
  if (n.mist >= W.mist) on.add('mist');
  if (n.yRain >= W.stormRain && n.yWind >= W.stormWind) on.add('storm');
  if (n.tideLevel <= -W.tideShare * n.tideAmp) on.add('low');
  if (n.tideLevel >= W.tideShare * n.tideAmp) on.add('high');
  if (n.season) on.add(n.season);
  if (n.sign === 'sparkle') on.add('sparkle');
  return on;
}

/**
 * A species' weight in its water now. Pure.
 * @param {{ rarity: string, bait: string, when: string[] }} sp @param {Set<string>} on conditions now
 * @param {'small' | 'big'} worm the bait on the hook @param {any} O fishing.json odds
 */
export function weightOf(sp, on, worm, O) {
  let w = O.rarity[sp.rarity] ?? 0;
  for (const c of sp.when) if (on.has(c)) w *= O.condition;
  if (sp.bait === 'either' || sp.bait === worm) w *= O.bait;
  return w;
}

/** The worm a pouch kind is. @param {string} kind worms or bigworms @returns {'small' | 'big'} */
export const wormOf = (kind) => (kind === 'bigworms' ? 'big' : 'small');

/**
 * What bites on a cast: one fish of the water, picked by weight, its own seed, and the waits.
 * Pure. @param {{ seed: number, cast: number, water: string, now: Now, bait: string, rareBoost?: number }} p
 *   seed: subSeed(world seed, 'fishing'); cast: the island's cast count (kept in the save); bait: the
 *   pouch kind on the hook; rareBoost: the ?fishing=rare link's weight for every rare species
 * @param {import('./roster.js').RosterFish[]} fish every species the island has (roster.js allFish)
 * @param {any} FR fishing.json @param {boolean} [test] the ?fishing link's short waits
 * @returns {{ id: string, seed: number, waitS: number, weights: number[] } | null}
 */
export function biteOf(p, fish, FR, test = false) {
  const h = hash32(p.seed, p.cast, 0xb17e);
  const here = fish.filter((f) => f.water === p.water);
  if (!here.length) return null;
  const on = conditionsNow(p.now, FR.when), worm = wormOf(p.bait);
  const weights = here.map((f) => (p.rareBoost && f.kind === 'rare' ? p.rareBoost : weightOf(f, on, worm, FR.odds)));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = u01(hash32(h, 1)) * total, i = 0;
  for (; i < here.length - 1; i++) { if (t < weights[i]) break; t -= weights[i]; }
  const span = test ? FR.bite.testWaitS : FR.bite.waitS;
  return { id: here[i].id, seed: hash32(h, 2), waitS: span[0] + (span[1] - span[0]) * u01(hash32(h, 3)), weights };
}

/** The wait after a missed dip, seeded by the cast and how many dips came. @param {number} seed @param {number} cast @param {number} dips @param {any} FR */
export const missWaitS = (seed, cast, dips, FR) => FR.bite.missS[0] + (FR.bite.missS[1] - FR.bite.missS[0]) * u01(hash32(seed, cast, dips, 0x3155));

/**
 * Many bites over a run of casts as one hash (tools/determinism.html: the page and a worker must
 * agree), the island's fish rostered where it runs unless given. Worker job.
 * @param {{ seed: number, casts: number, worldSeed: number, FR: any, fish?: any[] }} a
 */
export function bitesJob(a) {
  const fish = a.fish ?? allFish(a.worldSeed, a.FR);
  let hash = 0x811c9dc5;
  const seasons = ['spring', 'summer', 'autumn', 'winter'];
  for (let c = 0; c < a.casts; c++) {
    const now = { hourOfDay: (c * 7) % 24, season: seasons[c % 4], rain: (c % 5) / 5, mist: (c % 3) / 3, cloud: (c % 4) / 4, wind: (c % 6) / 6,
      yRain: (c % 7) / 7, yWind: (c % 9) / 9, tideLevel: ((c % 11) - 5) / 8, tideAmp: 0.6, sign: null };
    const b = biteOf({ seed: a.seed, cast: c, water: a.FR.waters.order[c % 5], now, bait: c % 2 ? 'worms' : 'bigworms' }, fish, a.FR);
    const s = JSON.stringify(b ? [b.id, b.seed, Math.round(b.waitS * 1000)] : null);
    for (let i = 0; i < s.length; i++) hash = Math.imul(hash ^ s.charCodeAt(i), 16777619) >>> 0;
  }
  return { hash };
}
