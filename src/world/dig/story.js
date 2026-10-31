// @ts-check
// The island's own past under the ground (docs/future/13 10.7.7, DR-24, D-78): the old keeper's
// hearths (discs about 3 m across, whose deep layer is the charcoal band) and the marked stone over
// the keeper's cache. They are placed by the island's seed on the island as it was generated (its
// base heights and paint, landform.js baseSampler), so every copy of an island has the same past:
// on soil ground, level, above the tide, off the camp pad, within reach of the camp; hearths near
// fresh water when they can be. The starter island has exactly one hearth and one cache (its land
// recipe's `story` block); other islands roll 0, 1 or 2 hearths. If the player has since turned a
// spot to water, rock or camp ground, it moves to the nearest diggable soil within moveM of where
// it was seeded, past that to the nearest diggable soil to the camp (liveSpot): worked out from the
// island as it is now, so live play and a load agree, and the cache can never be unreachable. Pure.

import { hash32, det } from '../../core/rng.js';
import { baseSampler, campOf, islandCenter, landmarks } from '../terrain/landform.js';

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/**
 * @typedef {{ x: number, z: number }} Spot
 * @typedef {{ hearths: Spot[], cache: Spot | null }} StorySpots
 */

/** The point the story is measured from: the camp pad's middle, or the island's middle. @param {any} land */
export function storyHome(land) {
  const c = campOf(land);
  return c ? { x: c.x, z: c.z, r: c.r + (c.blend ?? 0) } : { ...islandCenter(land), r: 0 };
}

/**
 * How many hearths an island has: the land's own count, or a weighted roll (story.hearths, weights
 * for 0, 1, 2). @param {any} S the land's story block @param {number} seed
 */
export function hearthCount(S, seed) {
  if (Number.isInteger(S.hearthCount)) return S.hearthCount;
  const w = S.hearths ?? [15, 60, 25];
  let t = u01(hash32(seed, 0x4ea7)) * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) { if (t < w[i]) return i; t -= w[i]; }
  return w.length - 1;
}

/**
 * The story spots as seeded on the island's base land. Null `cache` only when no soil at all lies
 * within reach. @param {any} land the land recipe (its `story` block; none: no story)
 * @param {number} terrainSeed subSeed(worldSeed, 'terrain') @param {number} worldSeed
 * @param {any} R recipes/world/dig.json story @returns {StorySpots}
 */
export function storySpots(land, terrainSeed, worldSeed, R) {
  const S = land?.story;
  if (!S) return { hearths: [], cache: null };
  const seed = hash32(worldSeed >>> 0, 0x5701);
  const base = baseSampler(land, terrainSeed);
  const home = storyHome(land);
  const lm = landmarks(land, terrainSeed);
  const waters = [...lm.basins.map((b) => ({ ...b, r: R.basinR })), ...lm.springs.map((s) => ({ x: s.x, z: s.z, r: 0 }))];
  /** Soil, above the tide, level within rM. @param {number} x @param {number} z @param {number} rM */
  const ground = (x, z, rM) => {
    const s = base(x, z);
    if (s[0] < R.minHeightM || s[1] + s[4] < R.soilMin || s[3] > R.rockMax) return false;
    for (const [dx, dz] of [[rM, 0], [-rM, 0], [0, rM], [0, -rM]]) {
      const e = base(x + dx, z + dz);
      if (Math.abs(e[0] - s[0]) / rM > R.maxSlope || e[0] < R.minHeightM) return false;
    }
    return true;
  };
  const nearWater = (/** @type {number} */ x, /** @type {number} */ z) => waters.some((w) => (w.x - x) ** 2 + (w.z - z) ** 2 <= (R.waterM + w.r) ** 2);
  /**
   * The seeded candidates in a ring round home, in their fixed order. @param {number[]} range m
   * @param {number} salt
   */
  const ring = (range, salt) => {
    /** @type {Spot[]} */ const out = [];
    for (let i = 0; i < R.candidates; i++) {
      const a = u01(hash32(seed, salt, i, 1)) * det.PI * 2;
      // Area-even in the ring: the radius from the square root of a uniform draw.
      const r0 = range[0] * range[0], r1 = range[1] * range[1];
      const r = Math.sqrt(r0 + (r1 - r0) * u01(hash32(seed, salt, i, 2)));
      out.push({ x: Math.round((home.x + det.cos(a) * r) * 100) / 100, z: Math.round((home.z + det.sin(a) * r) * 100) / 100 });
    }
    return out;
  };
  const offPad = (/** @type {Spot} */ p, /** @type {number} */ clearM) => (p.x - home.x) ** 2 + (p.z - home.z) ** 2 >= (home.r + clearM) ** 2;
  // Hearths: level discs, apart from each other, by water when one can be.
  const n = hearthCount(S, seed);
  /** @type {Spot[]} */ const hearths = [];
  const hc = ring(S.hearthFromCampM ?? R.hearthFromCampM, 0x4e41).filter((p) => offPad(p, R.hearthR) && ground(p.x, p.z, R.hearthR));
  for (const pool of [hc.filter((p) => nearWater(p.x, p.z)), hc]) {
    for (const p of pool) {
      if (hearths.length >= n) break;
      if (hearths.every((q) => (q.x - p.x) ** 2 + (q.z - p.z) ** 2 >= R.hearthGapM ** 2)) hearths.push(p);
    }
  }
  // The marked stone over the cache: soil, clear of the hearths.
  const cc = ring(S.cacheFromCampM ?? R.cacheFromCampM, 0xcac4).find((p) => offPad(p, 1) && ground(p.x, p.z, 1)
    && hearths.every((q) => (q.x - p.x) ** 2 + (q.z - p.z) ** 2 >= (R.hearthR + R.cacheClearM) ** 2));
  return { hearths, cache: cc ?? null };
}

/**
 * Where a spot is now: where it was seeded while the ground there can still be dug, else the
 * nearest diggable point within moveM (rings stepM apart, nearest first, in a fixed order), else the
 * nearest diggable point to home. Null if there is none. @param {Spot} spot
 * @param {(x: number, z: number) => boolean} ok diggable soil now @param {{ x: number, z: number }} home
 * @param {any} R dig.json story @returns {Spot | null}
 */
export function liveSpot(spot, ok, home, R) {
  if (ok(spot.x, spot.z)) return spot;
  /** @param {Spot} from @param {number} reach */
  const search = (from, reach) => {
    for (let r = R.stepM; r <= reach + 1e-6; r += R.stepM) {
      const k = Math.max(8, Math.round((det.PI * 2 * r) / R.stepM));
      for (let i = 0; i < k; i++) {
        const a = (i / k) * det.PI * 2;
        const x = Math.round((from.x + det.cos(a) * r) * 100) / 100, z = Math.round((from.z + det.sin(a) * r) * 100) / 100;
        if (ok(x, z)) return { x, z };
      }
    }
    return null;
  };
  return search(spot, R.moveM) ?? search(home, R.farM);
}

/**
 * What the story makes of a point: on a hearth disc (its deep layer is the charcoal band), near
 * one (sherds may lean in), at the cache (within cacheM of the marked stone).
 * @param {number} x @param {number} z @param {StorySpots} live @param {any} R dig.json story
 */
export function storyAt(x, z, live, R) {
  let hearth = -1, near = false;
  live.hearths.forEach((h, i) => {
    const d2 = (h.x - x) ** 2 + (h.z - z) ** 2;
    if (d2 <= R.hearthR * R.hearthR && hearth < 0) hearth = i;
    if (d2 <= R.nearHearthM * R.nearHearthM) near = true;
  });
  const c = live.cache;
  const cache = !!c && (c.x - x) ** 2 + (c.z - z) ** 2 <= R.cacheM * R.cacheM;
  return { hearth: hearth >= 0, hearthIndex: hearth, nearHearth: near, cache };
}

/**
 * Does this dig reach the keeper's cache? A second-layer dig within cacheM of the marked stone,
 * while it has not been found (once per island: dig.cache, the hour it was found, or null).
 * @param {number} depth the layer this dig reaches @param {{ cache: boolean }} st storyAt here
 * @param {number | null} found
 */
export const cacheDue = (depth, st, found) => depth === 2 && st.cache && found === null;

/**
 * Is the marked stone there yet? Once shown it stays (the firsts keep `stone:shown`); before that it
 * shows when every layer in story.cacheAfter has been dug (the subsoil and the blue-grey clay), the
 * clay asked only of an island that has a damp bank to dig. @param {string[]} firsts dig.firsts
 * @param {boolean} bank the island has damp-bank ground @param {any} S dig.json story
 */
export function stoneShown(firsts, bank, S) {
  if (firsts.includes('stone:shown')) return true;
  return (S.cacheAfter ?? []).every((/** @type {string} */ l) => firsts.includes(`layer:${l}`) || (l === 'clay' && !bank));
}

/**
 * Where the old keeper's way down lies (the spring-ore plan, O2): on the rise just above the
 * spring's head, where the water starts. From the first spring, aboveM uphill toward the rise's
 * middle (the spring sits on its flank), then the nearest point in rings stepM apart, out to
 * searchM, on soil above the tide, level across rM (the spring's own outcrop of rock is never it).
 * Placed from the island's base land, like the hearths and the marked stone, so every copy of an
 * island has the same one; null on an island with no spring. Pure.
 * @param {any} land the land recipe @param {number} terrainSeed subSeed(worldSeed, 'terrain')
 * @param {any} R recipes/world/dig.json story (its `spring` block, and the ground rules)
 * @returns {Spot | null}
 */
export function springSpot(land, terrainSeed, R) {
  const SP = R.spring;
  if (!SP || !land?.story) return null;
  const lm = landmarks(land, terrainSeed), s = lm.spring;
  if (!s) return null;
  const base = baseSampler(land, terrainSeed);
  const dx = lm.rise.x - s.x, dz = lm.rise.z - s.z, l = Math.hypot(dx, dz) || 1;
  const from = { x: s.x + (dx / l) * SP.aboveM, z: s.z + (dz / l) * SP.aboveM };
  /** Soil above the tide, level across rM, uphill of the spring. @param {number} x @param {number} z */
  const ok = (x, z) => {
    const g = base(x, z);
    if (g[0] < R.minHeightM || g[1] + g[4] < R.soilMin || g[3] > R.rockMax) return false;
    for (const [ox, oz] of [[SP.rM, 0], [-SP.rM, 0], [0, SP.rM], [0, -SP.rM]]) {
      const e = base(x + ox, z + oz);
      if (Math.abs(e[0] - g[0]) / SP.rM > SP.maxSlope) return false;
    }
    return base(x, z)[0] >= base(s.x, s.z)[0];
  };
  const round = (/** @type {number} */ v) => Math.round(v * 100) / 100;
  if (ok(from.x, from.z)) return { x: round(from.x), z: round(from.z) };
  for (let r = SP.stepM; r <= SP.searchM + 1e-6; r += SP.stepM) {
    const k = Math.max(8, Math.round((det.PI * 2 * r) / SP.stepM));
    for (let i = 0; i < k; i++) {
      const a = (i / k) * det.PI * 2, x = from.x + det.cos(a) * r, z = from.z + det.sin(a) * r;
      if (ok(x, z)) return { x: round(x), z: round(z) };
    }
  }
  return { x: round(from.x), z: round(from.z) };
}

/**
 * Where the cairn trail ends (O2): trailBackM short of the way down, on the line back toward the
 * trail's start, so the last cairn stands just below the worn mark and never on it.
 * @param {Spot} spot @param {{ x: number, z: number }} start @param {number} backM @returns {Spot}
 */
export function trailEndFor(spot, start, backM) {
  const dx = start.x - spot.x, dz = start.z - spot.z, l = Math.hypot(dx, dz) || 1;
  return { x: Math.round((spot.x + (dx / l) * backM) * 100) / 100, z: Math.round((spot.z + (dz / l) * backM) * 100) / 100 };
}

/**
 * Does this dig open the way down? A first-layer dig within digM of the worn mark, once the cairns'
 * letter has sent you there, while the ground has not given way yet (once per island: dig.spring).
 * @param {number} depth the layer this dig reaches @param {number} x @param {number} z
 * @param {Spot | null} spot @param {boolean} sent the cairns letter read @param {any} done dig.spring
 * @param {any} SP dig.json story.spring
 */
export const caveInDue = (depth, x, z, spot, sent, done, SP) => depth === 1 && !!spot && sent && !done
  && (spot.x - x) ** 2 + (spot.z - z) ** 2 <= SP.digM * SP.digM;
