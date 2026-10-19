// @ts-check
// Growth tests (docs 10, 11) for tools/unit-tests.html: each species keeps to its own habitat, the
// Plant tool names the right need, and the hourly growth with every species is deterministic. A
// made-up shoreline habitat, the same along every row, from the sea in the west to a stream in the
// east, so the tests do not depend on the island's shape.

import { initialWorldState, makeEnv, runHour, hashWorldState } from '../src/sim/tick.js';
import { HABITAT_CELLS, HABITAT_ORIGIN } from '../src/world/growth/habitat.js';
import { lushField, lushLook, lushAt } from '../src/world/growth/lush.js';
import { suitability, plantSeed, plantCover, settleGrowth } from '../src/world/growth/coarse.js';

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
    const covers = Object.fromEntries(await Promise.all((growth.cover ?? []).map(async (/** @type {string} */ sp) => [sp, await get(`flora/${sp}`)])));
    return { seasons: await get('world/seasons'), growth, flora, covers };
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
  test(GROWTH, 'wet-to-dry grass: lush by the water out to 6 m, a smaller ring by damp hollows, dried by salt; straw on the dry rise in late summer', async () => {
    const grass = await fetch('../recipes/flora/grass.json').then((r) => r.json());
    const L = grass.lush;
    // A 60 m square: a pond in the middle (x 25..34), a damp hollow at (8, 50), salt along the top row.
    const n = 60, NN = n * n;
    const hab = { n, depthCm: new Uint8Array(NN), still: new Uint8Array(NN), sea: new Uint8Array(NN), salt: new Uint8Array(NN) };
    for (let j = 25; j < 35; j++) for (let i = 25; i < 35; i++) { hab.depthCm[j * n + i] = 60; hab.still[j * n + i] = 1; }
    hab.still[50 * n + 8] = 1;
    for (let i = 0; i < n; i++) for (let j = 0; j < 4; j++) hab.salt[j * n + i] = 255;
    const f = lushField(/** @type {any} */ (hab), L);
    const at = (/** @type {number} */ i, /** @type {number} */ j) => f[j * n + i] / 255;
    eq(at(30, 30), 1, 'lush in the pond');
    assert(at(36, 30) > 0.95, `2 m from the pond: ${at(36, 30).toFixed(2)}`);
    assert(at(38, 30) > 0.2 && at(38, 30) < 0.9, `4 m from the pond eases: ${at(38, 30).toFixed(2)}`);
    eq(at(41, 30), 0, 'lush 7 m from the pond');
    assert(at(9, 50) > 0.9 && at(11, 50) === 0, `the damp hollow's ring: ${at(9, 50).toFixed(2)} at 1 m, ${at(11, 50).toFixed(2)} at 3 m`);
    // Salt dries what would be lush: a pond cell's neighbor under the salty rows.
    hab.depthCm[3 * n + 30] = 60;
    const g = lushField(/** @type {any} */ (hab), L);
    assert(g[3 * n + 31] / 255 < 0.4, `salt does not dry the shore: ${(g[3 * n + 31] / 255).toFixed(2)}`);
    // The look: spring keeps the dry rise green (no cure); late summer cures it toward straw.
    const spring = lushLook(grass, 0.5), late = lushLook(grass, 1.95);
    const dist = (/** @type {number[]} */ a, /** @type {number[]} */ b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    eq(dist(spring.dry, spring.base.map((c, i) => c * L.dryTint[i])) < 1e-9, true, 'spring dry rise is only paler');
    assert(dist(late.dry, L.straw) < dist(spring.dry, L.straw), 'late summer is no nearer straw');
    const wet = lushAt(late, 1), mid = lushAt(late, L.mid), dry = lushAt(late, 0);
    assert(wet.height > mid.height && mid.height > dry.height, 'heights do not rise toward the water');
    eq(Math.abs(mid.height - 1) < 1e-9, true, "today's meadow at mid");
    return `pond ring to ${L.waterM} m, damp ring to ${L.dampM} m; heights ${dry.height.toFixed(2)} dry, 1 meadow, ${wet.height.toFixed(2)} wet`;
  });

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

  test(GROWTH, 'rushes cover the shallow still water and soaked ground, and fill in hour by hour', async () => {
    const recipes = await loadRecipes();
    assert(recipes.covers.rushes, 'recipes/flora/rushes.json is listed in growth.json cover');
    const hab = shoreline();
    const env = { ...makeEnv(9, recipes), habitat: () => hab };
    const settled = settleGrowth(initialWorldState(9), env);
    const rush = settled.growth.cover.rushes;
    const cell = (/** @type {string} */ zone) => rush[20 * HABITAT_CELLS + ZONES[zone][0] + 1];
    assert(cell('edge') >= 230, `rushes in the shallow margin: ${cell('edge')} of 255`);
    for (const z of ['sea', 'band', 'shore', 'dry', 'bank', 'pond', 'stream']) eq(cell(z), 0, `rushes on ${z}:`);
    return `margin ${cell('edge')} of 255 on a new island, none elsewhere`;
  });

  test(GROWTH, 'rushes spread from a stand, never out of nowhere; a seed now and then starts a new tussock', async () => {
    const recipes = await loadRecipes();
    const hab = shoreline();
    // Creeping only (no seed jumps), so the reach is the creep alone.
    const creep = { ...recipes, covers: { rushes: { ...recipes.covers.rushes, spread: { ...recipes.covers.rushes.spread, jumpPerH: 0 } } } };
    const env = { ...makeEnv(9, creep), habitat: () => hab };
    const settled = settleGrowth(initialWorldState(9), env);
    const col = ZONES.edge[0] + 1;
    const bare = { ...settled, growth: { ...settled.growth, cover: { rushes: new Uint8Array(settled.growth.cover.rushes.length) } } };
    let s = bare;
    for (let h = 0; h < 48; h++) s = runHour(s, h, env).state;
    eq(s.growth.cover.rushes.reduce((/** @type {number} */ a, /** @type {number} */ b) => a + b, 0), 0, 'rushes on a margin with none nearby after two days');
    // One tussock planted at row 20 creeps along the margin, about a meter a day.
    const planted = plantCover(bare, 'rushes', HABITAT_ORIGIN + col + 0.5, HABITAT_ORIGIN + 20.5, env);
    assert(planted.ok, `planting rushes in the margin: ${planted.reason}`);
    s = planted.state;
    for (let h = 0; h < 96; h++) s = runHour(s, h, env).state;
    const r = s.growth.cover.rushes;
    const row = (/** @type {number} */ j) => r[j * HABITAT_CELLS + col];
    let reach = 0;
    while (reach < 40 && row(20 + reach + 1) > 0) reach++;
    assert(row(20) > 128, `the planted tussock after four days: ${row(20)} of 255`);
    assert(reach >= 2 && reach <= 8, `crept ${reach} m along the margin in four days`);
    // With a seed carried off every hour, a tussock starts away from the stand.
    const jumpy = { ...recipes, covers: { rushes: { ...recipes.covers.rushes, spread: { ...recipes.covers.rushes.spread, jumpPerH: 1 } } } };
    const envJ = { ...makeEnv(9, jumpy), habitat: () => hab };
    let t = plantCover(bare, 'rushes', HABITAT_ORIGIN + col + 0.5, HABITAT_ORIGIN + 20.5, envJ).state;
    const events = [];
    for (let h = 0; h < 24; h++) { const o = runHour(t, h, envJ); t = o.state; events.push(...o.events); }
    let far = 0;
    t.growth.cover.rushes.forEach((/** @type {number} */ v, /** @type {number} */ k) => { if (v > 0 && Math.abs(Math.floor(k / HABITAT_CELLS) - 20) > 3) far++; });
    assert(far > 0, 'a seed started a tussock away from the stand');
    assert(events.some((e) => e.name === 'growth:spread' && e.payload.bySpecies.rushes), 'the journal hears that rushes spread');
    return `none from nowhere in two days; a planted tussock crept ${reach} m in four days; seeds started ${far} squares away`;
  });

  test(GROWTH, 'grass gives way to rushes on soaked ground; the Plant tool names what rushes need', async () => {
    const recipes = await loadRecipes();
    const hab = shoreline();
    // Make the bank soaked ground (no standing water): both grass and rushes like it.
    for (let j = 0; j < hab.n; j++) for (let i = ZONES.bank[0]; i <= ZONES.bank[1]; i++) { hab.moisture[j * hab.n + i] = 255; hab.still[j * hab.n + i] = 1; }
    const env = { ...makeEnv(9, recipes), habitat: () => hab };
    const st = settleGrowth(initialWorldState(9), env);
    const k = 20 * HABITAT_CELLS + ZONES.bank[0];
    const kd = 20 * HABITAT_CELLS + ZONES.dry[0] + 5;
    assert(st.growth.cover.rushes[k] > 200, `rushes on the soaked bank: ${st.growth.cover.rushes[k]}`);
    assert(st.growth.grass[k] < st.growth.grass[kd] / 2, `grass on the soaked bank ${st.growth.grass[k]} against ${st.growth.grass[kd]} on dry ground`);
    const plant = (/** @type {string} */ zone) => plantCover(st, 'rushes', at(zone)[0], 20.5 + HABITAT_ORIGIN, env);
    eq(plant('dry').reason, 'dry', 'planting rushes on dry ground');
    // A shallow stretch of the stream, so moving water is the need it misses most.
    for (let j = 0; j < hab.n; j++) for (let i = ZONES.stream[0]; i <= ZONES.stream[1]; i++) hab.depthCm[j * hab.n + i] = 10;
    eq(plant('stream').reason, 'flow', 'planting rushes in a shallow stream');
    eq(plant('edge').reason, 'crowded', 'planting rushes where they already stand');
    return `grass ${st.growth.grass[k]} on the soaked bank, ${st.growth.grass[kd]} on dry ground; refusals: dry, flow, crowded`;
  });

  test(GROWTH, 'a basin with starters of its own starts with them, on their own ground', async () => {
    const recipes = await loadRecipes();
    const hab = shoreline();
    const bx = at('edge')[0];
    const basin = { x: bx, z: 0, jitter: 0, outerRadius: 6, starters: { reeds: 3, iris: 2 } };
    const plain = settleGrowth(initialWorldState(9), { ...makeEnv(9, recipes), habitat: () => hab });
    const env = { ...makeEnv(9, { ...recipes, land: { basins: [basin] } }), habitat: () => hab };
    const marsh = settleGrowth(initialWorldState(9), env);
    const near = (/** @type {any} */ st, /** @type {string} */ sp) => st.growth.plants.filter((/** @type {any} */ p) => p.sp === sp && Math.hypot(p.x - bx, p.z) <= 6);
    const reeds = near(marsh, 'reeds').length - near(plain, 'reeds').length;
    const iris = near(marsh, 'iris').length - near(plain, 'iris').length;
    eq(reeds, 3, 'reeds added in the basin');
    eq(iris, 2, 'iris added in the basin');
    for (const p of near(marsh, 'reeds')) eq(zoneOf(p.x), 'edge', 'a starter reed');
    for (const p of near(marsh, 'iris')) eq(zoneOf(p.x), 'bank', 'a starter iris');
    // The island-wide starters are the same either way.
    const first = (/** @type {any} */ st) => JSON.stringify(st.growth.plants.slice(0, plain.growth.plants.length));
    eq(first(marsh), first(plain), 'island-wide starters');
    eq(hashWorldState(settleGrowth(initialWorldState(9), env)), hashWorldState(marsh), 'the same twice');
    return `${reeds} reeds and ${iris} iris added in the basin; the island-wide starters unchanged`;
  });
}
