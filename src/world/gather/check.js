// @ts-check
// The pack and gathering, run for tools/determinism.html (docs/future/13 section 4.5): everything
// they work out must come out the same on the page and in a worker, every time. Pure; runs as a
// worker job (src/core/workers.js) with plain-data arguments.
//   shares   what every ground spot holds, a year of days, with that year's weather
//   events   picked spots recorded through the year and dropped as their days pass
//   pack     a few hundred seeded adds and takes, in normal form
//   regrowth three reeds picked for their down, two buried by a raise and one of them brought back
//            by its undo, then three game days of hours, twice
// Each part gives a hash; the page compares page against worker, and the regrowth's two runs.

import { hash32, stream } from '../../core/rng.js';
import { dayRecord } from '../weather.js';
import { initialWorldState, makeEnv, runHour, hashWorldState } from '../../sim/tick.js';
import { HABITAT_CELLS, HABITAT_ORIGIN } from '../growth/habitat.js';
import { settleGrowth } from '../growth/coarse.js';
import { gatherSeed, KINDS, share } from './spots.js';
import { record, expire, periodOf, PERIOD } from './events.js';
import { pick } from './plants.js';
import { buryUnder, restoreBuried } from '../growth/bury.js';
import { makeKinds } from '../pack/kinds.js';
import { emptyPack, add, take } from '../pack/model.js';

/** A small text hash (FNV-1a), for comparing whole results. @param {string} s */
function textHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

/** A made-up habitat with a pond's margin across the middle, where reeds belong. */
function marginHabitat() {
  const N = HABITAT_CELLS;
  const hab = { n: N, depthCm: new Uint8Array(N * N), moisture: new Uint8Array(N * N), salt: new Uint8Array(N * N),
    still: new Uint8Array(N * N), sea: new Uint8Array(N * N), grass: new Uint8Array(N * N), open: new Uint8Array(N * N).fill(1), hash: 0x6a7e };
  for (let j = 0; j < N; j++) for (let i = 40; i < 46; i++) {
    const k = j * N + i;
    hab.depthCm[k] = 15; hab.moisture[k] = 255; hab.still[k] = 1;
  }
  return hab;
}

/**
 * @param {{ worldSeed: number, gather: any, pack: any, seasons: any, growth: any, flora: Record<string, any>, covers: Record<string, any> }} a
 * @returns {{ shares: number, events: number, pack: number, regrowth: number, regrowthAgain: number, hash: number,
 *   handfuls: number, picked: number, sizes: number[] }}
 */
export function gatherCheckJob(a) {
  const R = a.gather;
  const seed = gatherSeed(a.worldSeed);
  const weatherSeed = makeEnv(a.worldSeed, {}).weatherSeed;

  // A year of days for 120 spots of each kind (keys stand for plants, bins and stretches).
  let sh = 0x5eed, handfuls = 0;
  /** @type {number[]} */ let ev = [];
  for (let day = 0; day < 112; day++) {
    const season = Math.floor(day / 28) % 4;
    const today = dayRecord(weatherSeed, day, 0, a.seasons.weather), yesterday = dayRecord(weatherSeed, day - 1, 0, a.seasons.weather);
    const day0 = { ...today, day };
    const ctx = { seed, day, season, today: day0, yesterday, lines: [{ tideId: day * 2, level: 0.5, spring: 0.2, season, day: day0 }], center: [0, 0] };
    for (const kind of KINDS) {
      for (let key = 0; key < 120; key++) {
        const n = share(kind, key, periodOf(kind === 'drift-twigs' ? PERIOD.tide : PERIOD.day, kind === 'drift-twigs' ? day * 2 : day), ctx, R);
        handfuls += n;
        sh = hash32(sh, n);
        // Take a handful from every seventh spot that has one.
        if (n > 0 && key % 7 === 0) ev = record(ev, hash32(seed, KINDS.indexOf(kind), key), periodOf(PERIOD.day, day), 1);
      }
    }
    ev = expire(ev, { day });
  }

  // The pack: seeded adds and takes, as gathering and making would.
  const kinds = makeKinds(a.pack);
  const ids = ['sticks', 'drift-twigs', 'reeds.down', 'pebbles', 'flat-stones', 'wrack', 'kelp', 'clay'];
  const s = stream(seed, 0x9ac);
  let p = emptyPack();
  for (let i = 0; i < 400; i++) {
    const k = ids[Math.floor(s.next() * ids.length)];
    p = s.next() < 0.7 ? add(p, k, 1 + Math.floor(s.next() * 3), kinds, a.pack).pack : take(p, k, 1, kinds, a.pack).pack;
  }

  // Three reeds picked for their down in late autumn, then three game days of hours, twice.
  const regrow = () => {
    const recipes = { seasons: a.seasons, growth: a.growth, flora: a.flora, covers: a.covers, gather: R };
    const hab = marginHabitat();
    const env = { ...makeEnv(a.worldSeed, recipes), habitat: () => hab };
    let st = settleGrowth(initialWorldState(a.worldSeed), env);
    const x0 = HABITAT_ORIGIN + 43;
    const reeds = [0, 1, 2].map((n) => ({ id: 9000 + n, sp: 'reeds', x: x0, z: HABITAT_ORIGIN + 20 + n * 6, age: 4000, size: 1, best: 1, stage: 3, low: 0, drown: 0, last: 0 }));
    const plants = [...(st.growth?.plants ?? []), ...reeds];
    st = { ...st, growth: { ...st.growth, plants } };
    st = { ...st, growth: { ...st.growth, plants: st.growth.plants.map((/** @type {any} */ q) => (q.id >= 9000 ? pick(q, 'down', { flora: a.flora.reeds }, R) : q)) } };
    // A raise over the second and third reed buries them (growth/bury.js); its undo brings the
    // second back exactly, and the third stays under (P2a A5).
    if (a.growth.bury) {
      const zCut = HABITAT_ORIGIN + 23;
      const b = buryUnder(st.growth.plants, a.flora, a.growth.bury, () => 0, (_x, z) => (z > zCut ? 1 : 0),
        { x0: HABITAT_ORIGIN, z0: HABITAT_ORIGIN, x1: HABITAT_ORIGIN + HABITAT_CELLS, z1: HABITAT_ORIGIN + HABITAT_CELLS });
      const undone = b.buried.filter((/** @type {any} */ q) => q.id === 9001);
      st = { ...st, growth: { ...st.growth, plants: restoreBuried(b.kept, undone) } };
    }
    const h0 = 24 * 14 * 2 + 24 * 10;   // autumn, day 10
    for (let h = h0; h < h0 + 72; h++) st = runHour(st, h, env).state;
    return { hash: hashWorldState(st), sizes: st.growth.plants.filter((/** @type {any} */ q) => q.id >= 9000).map((/** @type {any} */ q) => Math.round(q.size * 1e6) / 1e6) };
  };
  const r1 = regrow(), r2 = regrow();

  const out = { shares: sh >>> 0, events: textHash(JSON.stringify(ev)), pack: textHash(JSON.stringify(p)), regrowth: r1.hash, regrowthAgain: r2.hash };
  return { ...out, hash: textHash(JSON.stringify(out)), handfuls, picked: ev.length / 3, sizes: r1.sizes };
}
