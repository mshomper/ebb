// @ts-check
// Growth tests (docs 10, 11) for tools/unit-tests.html: each species keeps to its own habitat, the
// Plant tool names the right need, and the hourly growth with every species is deterministic. A
// made-up shoreline habitat, the same along every row, from the sea in the west to a stream in the
// east, so the tests do not depend on the island's shape.

import { initialWorldState, makeEnv, runHour, hashWorldState } from '../src/sim/tick.js';
import { HABITAT_CELLS, HABITAT_ORIGIN } from '../src/world/growth/habitat.js';
import { suitability, plantSeed, settleGrowth } from '../src/world/growth/coarse.js';

const GROWTH = 'growth';

/**
 * Zones by cell column, west to east: [first column, last column, depthCm, moisture, salt, still, sea].
 * @type {Record<string, number[]>}
 */
const ZONES = {
  sea: [0, 19, 0, 255, 255, 0, 1],
  band: [20, 22, 0, 210, 230, 0, 0],      // the tide band
  shore: [23, 24, 0, 120, 180, 0, 0],     // salty, fairly dry
  dry: [25, 39, 0, 0, 0, 0, 0],
  bank: [40, 41, 0, 120, 0, 0, 0],        // moist, just above the pond
  edge: [42, 44, 15, 255, 0, 1, 0],       // the pond's shallow margin
  pond: [45, 60, 80, 255, 0, 1, 0],
  stream: [61, 70, 60, 255, 0, 0, 0],
};

/** The made-up habitat. @returns {import('../src/world/growth/habitat.js').Habitat} */
export function shoreline() {
  const N = HABITAT_CELLS;
  const hab = {
    n: N, depthCm: new Uint8Array(N * N), moisture: new Uint8Array(N * N), salt: new Uint8Array(N * N),
    still: new Uint8Array(N * N), sea: new Uint8Array(N * N), grass: new Uint8Array(N * N),
    open: new Uint8Array(N * N).fill(1), hash: 0x5eed,
  };
  for (const z of Object.values(ZONES)) {
    for (let j = 0; j < N; j++) {
      for (let i = z[0]; i <= z[1]; i++) {
        const k = j * N + i;
        hab.depthCm[k] = z[2]; hab.moisture[k] = z[3]; hab.salt[k] = z[4]; hab.still[k] = z[5]; hab.sea[k] = z[6];
      }
    }
  }
  return hab;
}

/** World x at the middle of a zone, and a z on the grid. @param {string} zone */
export const at = (zone) => [HABITAT_ORIGIN + (ZONES[zone][0] + ZONES[zone][1] + 1) / 2, 0];

/** The zone a world x lies in. @param {number} x */
function zoneOf(x) {
  const i = Math.floor(x - HABITAT_ORIGIN);
  return Object.keys(ZONES).find((z) => i >= ZONES[z][0] && i <= ZONES[z][1]) ?? 'dry';
}

/** @type {Promise<any> | null} */ let recipesPromise = null;
export function loadRecipes() {
  recipesPromise ??= (async () => {
    const get = (/** @type {string} */ p) => fetch(`../recipes/${p}.json`).then((r) => {
      if (!r.ok) throw new Error(`recipes/${p}.json: HTTP ${r.status}`);
      return r.json();
    });
    const growth = await get('world/growth');
    const flora = Object.fromEntries(await Promise.all(growth.species.map(async (/** @type {string} */ sp) => [sp, await get(`flora/${sp}`)])));
    return { seasons: await get('world/seasons'), growth, flora };
  })();
  return recipesPromise;
}

/** Where each species belongs (suitability at least 0.9) and where it must not grow (under 0.2). */
const HOMES = {
  reeds: { home: ['edge'], never: ['dry', 'pond', 'sea'] },
  lilies: { home: ['pond'], never: ['dry', 'bank', 'edge', 'stream', 'sea', 'band'] },
  iris: { home: ['bank'], never: ['dry', 'pond', 'stream', 'sea', 'band'] },
  thrift: { home: ['band', 'shore'], never: ['dry', 'bank', 'edge', 'pond', 'sea'] },
};

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addGrowthTests(test, assert, eq) {
  test(GROWTH, 'every species likes its own ground and not the others', async () => {
    const { flora } = await loadRecipes();
    const hab = shoreline();
    const lines = [];
    for (const [sp, H] of Object.entries(HOMES)) {
      const rec = flora[sp];
      assert(rec, `recipes/flora/${sp}.json is listed in growth.json`);
      for (const z of H.home) {
        const s = suitability(rec, hab, at(z)[0], at(z)[1]).suit;
        assert(s >= 0.9, `${sp} on ${z}: ${s.toFixed(2)}, wanted at least 0.9`);
      }
      for (const z of H.never) {
        const s = suitability(rec, hab, at(z)[0], at(z)[1]).suit;
        assert(s < 0.2, `${sp} on ${z}: ${s.toFixed(2)}, wanted under 0.2`);
      }
      lines.push(`${sp} on ${H.home.join(' and ')}`);
    }
    return lines.join('; ');
  });

  test(GROWTH, 'the Plant tool names the need the ground misses most', async () => {
    const recipes = await loadRecipes();
    const hab = shoreline();
    const env = { ...makeEnv(5, recipes), habitat: () => hab };
    const state = initialWorldState(5);
    /** @type {[string, string, string][]} */
    const cases = [
      ['reeds', 'dry', 'dry'], ['reeds', 'pond', 'deep'],
      ['lilies', 'dry', 'shallow'], ['lilies', 'stream', 'flow'], ['lilies', 'bank', 'shallow'],
      ['iris', 'pond', 'deep'], ['iris', 'dry', 'dry'],
      ['thrift', 'dry', 'fresh'], ['thrift', 'pond', 'deep'],
    ];
    for (const [sp, zone, need] of cases) {
      const r = plantSeed(state, sp, at(zone)[0], at(zone)[1], env);
      assert(!r.ok, `${sp} should not take on ${zone}`);
      eq(r.reason, need, `${sp} on ${zone}:`);
    }
    for (const [sp, H] of Object.entries(HOMES)) {
      const r = plantSeed(state, sp, at(H.home[0])[0], at(H.home[0])[1], env);
      assert(r.ok, `${sp} takes on ${H.home[0]} (${r.reason})`);
    }
    return `${cases.length} refusals and 4 plantings as expected`;
  });

  test(GROWTH, 'four species over 96 hours: two runs match, and every plant stays on its own ground', async () => {
    const recipes = await loadRecipes();
    const hab = shoreline();
    const env = { ...makeEnv(9, recipes), habitat: () => hab };
    let start = settleGrowth(initialWorldState(9), env);
    for (const [sp, H] of Object.entries(HOMES)) {
      const r = plantSeed(start, sp, at(H.home[0])[0], at(H.home[0])[1] + 20, env);
      assert(r.ok, `${sp} seed takes`);
      start = r.state;
    }
    const count = (/** @type {any} */ s, /** @type {string} */ sp) => s.growth.plants.filter((/** @type {any} */ p) => p.sp === sp).length;
    const before = Object.fromEntries(Object.keys(HOMES).map((sp) => [sp, count(start, sp)]));
    const run = () => {
      let s = structuredClone(start);
      for (let h = 0; h < 96; h++) s = runHour(s, h, env).state;
      return s;
    };
    const a = run();
    const b = run();
    eq(hashWorldState(a), hashWorldState(b), 'world hash of the two runs');
    const lines = [];
    for (const [sp, H] of Object.entries(HOMES)) {
      const after = count(a, sp);
      assert(after >= before[sp], `${sp}: ${before[sp]} plants at the start, ${after} after`);
      for (const p of a.growth.plants.filter((/** @type {any} */ q) => q.sp === sp)) {
        const z = zoneOf(p.x);
        assert(!H.never.includes(z), `a ${sp} plant grew on ${z} at x ${p.x.toFixed(2)}`);
      }
      lines.push(`${sp} ${before[sp]} to ${after}`);
    }
    return lines.join(', ');
  });
}
