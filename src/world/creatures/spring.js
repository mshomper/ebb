// @ts-check
// Spring at the pond in the hourly tick (doc 13, The year, season by season): frogspawn that
// hatches into tadpoles and leaves as froglets (a field on the frogs, recipes/species/frogspawn.json),
// and the common toad's night walk back to the pond (a find, recipes/species/toad.json). Neither has
// needs or a gift; both are season markers. Pure and worker-safe: seeded randomness only (core/rng.js
// streams keyed by purpose and day), so an hour watched and an hour simulated while away agree.
//
// State (state.spring): see SpringState. The toad's walk reads state.basks, the stones and logs the
// player set (written by the live pieces watcher, src/world/creatures/spring-live.js), since pieces
// are not part of the world state.
//
// Events (catch-up keeps creature:*): creature:spawned, creature:hatched, creature:froglets and
// creature:gone with species 'frogspawn'; creature:walking with species 'toads'.

import { stream, subSeed, hash32 } from '../../core/rng.js';
import { HOURS_PER_DAY } from '../../core/clock.js';
import { cellCenter } from '../ecology/habitat.js';
import { HABITAT_ORIGIN } from '../growth/habitat.js';

/**
 * @typedef {Object} Clump
 * @property {number} id
 * @property {number} x @property {number} z  world meters
 * @property {'spawn'|'tadpoles'|'froglets'} stage
 * @property {number} laidH  hour it was laid
 * @property {number} hatchH hour it hatches (or did)
 * @property {number} tadpoles how many are left (0 before it hatches)
 * @property {number} froglets how many climbed out (froglets stage)
 * @property {number} leaveH  hour the last froglets are gone (froglets stage)
 */

/**
 * @typedef {Object} ToadWalk
 * @property {number} fromX @property {number} fromZ  where it set out (a stone or log)
 * @property {number} toX @property {number} toZ      the pond's edge
 * @property {number} startH @property {number} endH  game hours it walks between (fractional)
 * @property {number} goneH  when it slips into the water and is gone
 * @property {number} seed   its look
 */

/**
 * @typedef {Object} SpringState
 * @property {number} year     the year these clumps belong to
 * @property {number} nextId
 * @property {Clump[]} clumps  this year's, until gone
 * @property {number} laid     clumps laid this year
 * @property {ToadWalk | null} toad  tonight's walk, if any
 */

/** @returns {SpringState} */
export function initialSpring() {
  return { year: 0, nextId: 1, clumps: [], laid: 0, toad: null };
}

/** The hour of the day dusk falls, as the frogs reckon it. @param {any} seasons @param {any} frog frog.json */
export function springDusk(seasons, frog) {
  const dayLength = seasons?.dayLengthH ?? 12;
  return Math.floor(12 + dayLength / 2 + (frog?.ecology?.arrival?.duskOffsetH ?? 1)) % HOURS_PER_DAY;
}

/** A habitat cell's index for a world point, or -1. @param {any} hab @param {number} x @param {number} z */
function cellOf(hab, x, z) {
  const i = Math.floor(x - HABITAT_ORIGIN), j = Math.floor(z - HABITAT_ORIGIN);
  return i < 0 || j < 0 || i >= hab.n || j >= hab.n ? -1 : j * hab.n + i;
}

/** Still fresh standing water at a cell, this deep in cm. @param {any} hab @param {number} k */
const freshCm = (hab, k) => (k >= 0 && hab.open[k] && !hab.sea[k] && hab.still[k] ? hab.depthCm[k] : 0);

/**
 * Cells warm and sunny enough for spawn: still fresh water depthCm deep, near a frog's home, out of
 * any willow's shade. Pure. @param {any} hab @param {any[]} plants state.growth.plants
 * @param {{ x: number, z: number }[]} frogs @param {any} L frogspawn.json lay
 * @returns {number[]} cell indices, in grid order
 */
export function warmShallows(hab, plants, frogs, L) {
  const n = hab.n, out = [];
  const shade = plants.filter((p) => p.sp === 'willow').map((p) => ({ x: p.x, z: p.z, r: L.shadeM * Math.min(1, Math.max(0.3, p.size)) }));
  const [lo, hi] = L.depthCm, near = L.nearFrogM * L.nearFrogM;
  for (let k = 0; k < n * n; k++) {
    const d = freshCm(hab, k);
    if (d < lo || d > hi) continue;
    const [x, z] = cellCenter(k, n);
    if (!frogs.some((f) => (f.x - x) ** 2 + (f.z - z) ** 2 <= near)) continue;
    if (shade.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 <= s.r * s.r)) continue;
    out.push(k);
  }
  return out;
}

/**
 * The nearest still fresh water to a point within reach, as the cell's middle, or null.
 * @param {any} hab @param {number} x @param {number} z @param {number} reachM @param {number} minCm
 */
export function nearestPond(hab, x, z, reachM, minCm) {
  const n = hab.n, r = Math.ceil(reachM);
  const i0 = Math.floor(x - HABITAT_ORIGIN), j0 = Math.floor(z - HABITAT_ORIGIN);
  let best = null, bestD = reachM * reachM;
  for (let j = Math.max(0, j0 - r); j <= Math.min(n - 1, j0 + r); j++) {
    for (let i = Math.max(0, i0 - r); i <= Math.min(n - 1, i0 + r); i++) {
      if (freshCm(hab, j * n + i) < minCm) continue;
      const [cx, cz] = cellCenter(j * n + i, n);
      const d = (cx - x) ** 2 + (cz - z) ** 2;
      if (d < bestD || (d === bestD && best && j * n + i < best.k)) { bestD = d; best = { x: cx, z: cz, k: j * n + i }; }
    }
  }
  return best;
}

/** Rounded to centimeters, so saves and fingerprints stay short. @param {number} v */
const cm = (v) => Math.round(v * 100) / 100;

/**
 * One game hour of spring at the pond.
 * @param {any} state @param {number} hourIndex @param {any} env
 * @returns {{ state: any, events: { name: string, payload: any }[] }}
 */
export function coarseStep(state, hourIndex, env) {
  const hab = env.habitat?.();
  const R = env.recipes?.species?.frogspawn, T = env.recipes?.species?.toad, frog = env.recipes?.species?.frog;
  if (!hab || !R || !frog || !state.seasons) return { state, events: [] };
  const prev = state.spring ?? null;
  /** @type {{ name: string, payload: any }[]} */ const events = [];
  const season = state.seasons.index, year = state.seasons.year ?? 0;
  /** @type {SpringState} */
  let S = prev ? { ...prev, clumps: prev.clumps.map((c) => ({ ...c })) } : initialSpring();
  if (S.year !== year) S = { ...initialSpring(), nextId: S.nextId, year };
  const day = Math.floor(hourIndex / HOURS_PER_DAY), hourOfDay = hourIndex % HOURS_PER_DAY;
  const dusk = hourOfDay === springDusk(state.seasons, frog);
  const seed = subSeed(env.seed, 'frogspawn');
  const spawnPay = (/** @type {any} */ p) => ({ species: 'frogspawn', ...p });

  // Water gone from under a clump (drained, or dried in summer): it is gone with it.
  const dried = S.clumps.filter((c) => freshCm(hab, cellOf(hab, c.x, c.z)) <= 0);
  if (dried.length) {
    S.clumps = S.clumps.filter((c) => !dried.includes(c));
    for (const c of dried) events.push({ name: 'creature:gone', payload: spawnPay({ id: c.id, x: c.x, z: c.z, why: 'dry' }) });
  }

  if (dusk) {
    // Hatching, thinning and climbing out, oldest first.
    for (const c of S.clumps) {
      // On the day it is due, at that day's dusk (which moves as the days lengthen).
      if (c.stage === 'spawn' && day >= Math.floor(c.hatchH / HOURS_PER_DAY)) {
        c.stage = 'tadpoles'; c.tadpoles = R.hatch.tadpoles;
        events.push({ name: 'creature:hatched', payload: spawnPay({ id: c.id, x: c.x, z: c.z, count: c.tadpoles }) });
      } else if (c.stage === 'tadpoles') {
        const TP = R.tadpoles;
        let eat = 0;
        for (const g of state.creatures?.minnows?.groups ?? []) {
          if ((g.x - c.x) ** 2 + (g.z - c.z) ** 2 > TP.eatReachM * TP.eatReachM) continue;
          eat += TP.eatShare * Math.min(1, g.count / TP.schoolFull);
        }
        c.tadpoles = Math.max(0, Math.floor(c.tadpoles * (1 - TP.lossShare - Math.min(0.5, eat))));
        if (season >= 1 && (season > 1 || state.seasons.day >= R.froglets.day)) {
          c.stage = 'froglets';
          c.froglets = Math.min(R.froglets.most, Math.ceil(c.tadpoles * R.froglets.share));
          c.tadpoles = 0;
          c.leaveH = hourIndex + R.froglets.leaveH;
          if (c.froglets > 0) events.push({ name: 'creature:froglets', payload: spawnPay({ id: c.id, x: c.x, z: c.z, count: c.froglets }) });
        }
      }
    }
    // Laying: spring, happy frogs, room for more clumps this year.
    const F = state.creatures?.frogs, L = R.lay;
    const frogs = F?.frogs ?? [];
    const most = Math.min(L.maxClumps, Math.floor(frogs.length / 2));
    const inDays = season === 0 && state.seasons.day >= L.days[0] && state.seasons.day <= L.days[1];
    if (inDays && F?.happy && !F.dormant && frogs.length >= L.minFrogs && S.laid < most) {
      const rng = stream(seed, 0x1a7, day);
      if (rng.next() < L.chance) {
        const cells = warmShallows(hab, state.growth?.plants ?? [], frogs, L);
        const want = Math.min(most - S.laid, L.perDusk[0] + rng.int(L.perDusk[1] - L.perDusk[0] + 1));
        for (let i = 0; i < want && cells.length; i++) {
          const first = S.clumps[0];
          // Frogs lay together: beside the first clump when that shallow will do, else the seeded best.
          const near = first ? cells.filter((k) => { const [x, z] = cellCenter(k, hab.n); return (x - first.x) ** 2 + (z - first.z) ** 2 <= (L.clusterM + 0.75) ** 2; }) : [];
          const pool = near.length ? near : cells;
          let k = pool[0], kh = hash32(seed, day, i, pool[0]);
          for (const q of pool) { const h = hash32(seed, day, i, q); if (h < kh) { kh = h; k = q; } }
          const [cx, cz] = cellCenter(k, hab.n);
          const jx = ((hash32(kh, 1) >>> 8) / 16777216 - 0.5) * 0.6, jz = ((hash32(kh, 2) >>> 8) / 16777216 - 0.5) * 0.6;
          const c = { id: S.nextId++, x: cm(cx + jx), z: cm(cz + jz), stage: /** @type {const} */ ('spawn'), laidH: hourIndex,
            hatchH: hourIndex + R.hatch.days * HOURS_PER_DAY, tadpoles: 0, froglets: 0, leaveH: 0 };
          S.clumps.push(c);
          S.laid++;
          events.push({ name: 'creature:spawned', payload: spawnPay({ id: c.id, x: c.x, z: c.z, first: S.laid === 1 }) });
        }
      }
    }
  }
  // The last froglets have climbed out, or no tadpoles are left: the clump is done.
  const done = S.clumps.filter((c) => (c.stage === 'froglets' && hourIndex >= c.leaveH) || (c.stage === 'tadpoles' && c.tadpoles <= 0));
  if (done.length) {
    S.clumps = S.clumps.filter((c) => !done.includes(c));
    for (const c of done) events.push({ name: 'creature:gone', payload: spawnPay({ id: c.id, x: c.x, z: c.z, why: c.stage === 'froglets' ? 'left' : 'eaten' }) });
  }

  // The common toad's night walk: on a spring night, from a stone or log near the pond to the water.
  if (S.toad && hourIndex >= S.toad.goneH) S.toad = null;
  if (T && season === 0 && hourOfDay === T.walk.startH && !S.toad) {
    const W = T.walk;
    const rng = stream(subSeed(env.seed, 'toads'), 0x70ad, day);
    const rain = state.weather?.today?.mood === 'rain';
    const inDays = state.seasons.day >= W.days[0] && state.seasons.day <= W.days[1];
    if (inDays && rng.next() < (rain ? W.rainChance : W.chance)) {
      /** @type {{ x: number, z: number, pond: { x: number, z: number } }[]} */ const from = [];
      for (const b of state.basks ?? []) {
        const p = nearestPond(hab, b.x, b.z, W.reachM, W.pondCm);
        if (p && (p.x - b.x) ** 2 + (p.z - b.z) ** 2 >= W.minWalkM * W.minWalkM) from.push({ x: b.x, z: b.z, pond: p });
      }
      if (from.length) {
        const b = from[rng.int(from.length)];
        // It stops at the water's edge: half a cell short of the pond square's middle.
        const dx = b.pond.x - b.x, dz = b.pond.z - b.z, d = Math.hypot(dx, dz);
        const toX = b.pond.x - (dx / d) * 0.5, toZ = b.pond.z - (dz / d) * 0.5;
        const startH = hourIndex + rng.next() * 0.5;
        const walkH = Math.min(W.mostH, (d - 0.5) / W.mPerH);
        S.toad = { fromX: cm(b.x), fromZ: cm(b.z), toX: cm(toX), toZ: cm(toZ), startH: Math.round(startH * 100) / 100,
          endH: Math.round((startH + walkH) * 100) / 100, goneH: Math.round(startH + walkH + W.sitH), seed: rng.nextU32() };
        events.push({ name: 'creature:walking', payload: { species: 'toads', x: S.toad.fromX, z: S.toad.fromZ } });
      }
    }
  }

  const changed = !prev || events.length || S.year !== prev.year || S.toad !== prev.toad
    || S.clumps.some((c, i) => JSON.stringify(c) !== JSON.stringify(prev.clumps[i]));
  if (!changed) return { state, events };
  return { state: { ...state, spring: S }, events };
}

/**
 * Where the toad is at a game hour (fractional) on its walk, and how far along (0..1), or null when
 * none is out. Pure. @param {ToadWalk | null} w @param {number} h
 */
export function toadAt(w, h) {
  if (!w || h < w.startH || h >= w.goneH) return null;
  const t = Math.min(1, (h - w.startH) / Math.max(1e-6, w.endH - w.startH));
  return { x: w.fromX + (w.toX - w.fromX) * t, z: w.fromZ + (w.toZ - w.fromZ) * t, t, yaw: Math.atan2(w.toX - w.fromX, w.toZ - w.fromZ) };
}

/**
 * Spots to show for a spring page (Show me): each clump for frogspawn (whatever stage); for the toad,
 * the middle of tonight's walk with a ring (r) that takes in all of it. Pure.
 * @param {string} sp 'frogspawn' | 'toads' @param {any} state
 * @returns {{ x: number, z: number, r?: number }[]}
 */
export function springSpots(sp, state) {
  const S = state?.spring;
  if (!S) return [];
  if (sp === 'frogspawn') return S.clumps.map((/** @type {Clump} */ c) => ({ x: c.x, z: c.z }));
  const w = S.toad;
  if (sp === 'toads' && w) return [{ x: (w.fromX + w.toX) / 2, z: (w.fromZ + w.toZ) / 2, r: Math.hypot(w.toX - w.fromX, w.toZ - w.fromZ) / 2 + 0.4 }];
  return [];
}

/**
 * The tadpoles as a field for the minnows (0..255 per square), or null when there are none.
 * Pure. @param {any} state @param {number} n @param {any} R frogspawn.json
 */
export function tadpoleField(state, n, R) {
  const list = (state?.spring?.clumps ?? []).filter((/** @type {Clump} */ c) => c.stage === 'tadpoles' && c.tadpoles > 0);
  if (!list.length || !R) return null;
  const f = new Uint8Array(n * n), r = R.tadpoles.fieldR;
  for (const c of list) {
    const i0 = Math.floor(c.x - HABITAT_ORIGIN), j0 = Math.floor(c.z - HABITAT_ORIGIN);
    const v = Math.min(255, Math.round((c.tadpoles * R.tadpoles.fieldPer) / ((2 * r + 1) ** 2)));
    for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      f[j * n + i] = Math.min(255, f[j * n + i] + v);
    }
  }
  return f;
}
