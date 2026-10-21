// @ts-check
// Growth tests (docs 10, 11) for tools/unit-tests.html: each species keeps to its own habitat, the
// Plant tool names the right need, and the hourly growth with every species is deterministic. A
// made-up shoreline habitat, the same along every row, from the sea in the west to a stream in the
// east, so the tests do not depend on the island's shape.

import { initialWorldState, makeEnv, runHour, hashWorldState } from '../src/sim/tick.js';
import { HABITAT_CELLS, HABITAT_ORIGIN } from '../src/world/growth/habitat.js';
import { lushField, lushLook, lushAt } from '../src/world/growth/lush.js';
import { suitability, plantSeed, plantCover, settleGrowth, coarseStep, STAGE } from '../src/world/growth/coarse.js';

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

/**
 * The recipes with one more starter species (growth.json starters), for tests of a starting cover
 * or a basin's own starters. @param {any} recipes @param {string} sp
 */
export const startersWith = (recipes, sp) => ({ ...recipes, growth: { ...recipes.growth, starters: [...recipes.growth.starters, sp] } });

/** Where each species belongs (suitability at least 0.9) and where it must not grow (under 0.2). */
const HOMES = {
  reeds: { home: ['edge'], never: ['dry', 'pond', 'sea'] },
  lilies: { home: ['pond'], never: ['dry', 'bank', 'edge', 'stream', 'sea', 'band'] },
  iris: { home: ['bank'], never: ['dry', 'pond', 'stream', 'sea', 'band'] },
  thrift: { home: ['band', 'shore'], never: ['dry', 'bank', 'edge', 'pond', 'sea'] },
  willow: { home: ['bank'], never: ['dry', 'edge', 'pond', 'stream', 'sea', 'band', 'shore'] },
  gorse: { home: ['dry'], never: ['bank', 'edge', 'pond', 'stream', 'sea', 'band', 'shore'] },
};

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addGrowthTests(test, assert, eq) {
  test(GROWTH, 'ground axes: sea campion takes rock above the thrift, refuses sand; thrift wants sand or rock low on the shore', async () => {
    const [campion, thrift, marigold] = await Promise.all(['campion', 'thrift', 'marigold'].map((s) => fetch(`../recipes/flora/${s}.json`).then((r) => r.json())));
    const N = HABITAT_CELLS;
    const hab = /** @type {any} */ (shoreline());
    hab.sand = new Uint8Array(N * N); hab.rock = new Uint8Array(N * N); hab.soil = new Uint8Array(N * N);
    hab.slopeDeg = new Uint8Array(N * N); hab.heightDm = new Int16Array(N * N);
    const [sx] = at('shore');
    const height = (/** @type {number} */ m) => hab.heightDm.fill(Math.round(m * 10));
    const suit = (/** @type {any} */ rec) => suitability(rec, hab, sx, 0);
    height(1.4);
    hab.sand.fill(255);
    eq(suit(campion).suit, 0, 'campion on sand');
    eq(suit(campion).worst, 'ground', 'campion on sand says the ground is wrong');
    hab.sand.fill(0); hab.rock.fill(255);
    const onRock = suit(campion).suit;
    assert(onRock > 0.5, `campion on rock 1.4 m above the sea: ${onRock}`);
    height(0.5);
    eq(suit(campion).suit, 0, 'campion on rock 0.5 m above the sea');
    eq(suit(campion).worst, 'low', 'low on the shore, where thrift grows');
    // Thrift: sand or rock 0.3 to 3 m above the sea, never soil; too low where the tide covers it.
    const thriftRock = suit(thrift).suit;
    hab.rock.fill(0); hab.sand.fill(255);
    const thriftSand = suit(thrift).suit;
    hab.sand.fill(0); hab.soil.fill(255);
    const thriftSoil = suit(thrift);
    assert(thriftRock > 0.9 && thriftSand > 0.9, `thrift on rock ${thriftRock.toFixed(2)}, sand ${thriftSand.toFixed(2)}`);
    assert(thriftSoil.suit === 0 && thriftSoil.worst === 'ground', `thrift on soil ${thriftSoil.suit} (${thriftSoil.worst})`);
    hab.soil.fill(0); hab.sand.fill(255); height(0);
    eq(suit(thrift).worst, 'low', 'thrift at mean sea level is too low');
    // Grass painted over the ground counts as soil (turf): marigold, which asks for no soil, is
    // unchanged, and the bank grows it flat but not steep.
    const [bx] = at('bank');
    hab.sand.fill(0); hab.grass.fill(255); hab.slopeDeg.fill(0);
    const flat = suitability(marigold, hab, bx, 0).suit;
    hab.slopeDeg.fill(40);
    const steep = suitability(marigold, hab, bx, 0);
    assert(flat > 0.5 && steep.suit === 0 && steep.worst === 'steep', `marigold flat ${flat}, steep ${steep.suit} (${steep.worst})`);
    return `campion on rock 1.4 m up ${onRock.toFixed(2)}; thrift on rock ${thriftRock.toFixed(2)}, sand ${thriftSand.toFixed(2)}, soil 0; marigold on a flat bank ${flat.toFixed(2)}`;
  });

  test(GROWTH, 'the older plants keep to earth and gentle ground: reeds, lilies, iris, rushes and grass refuse sand, rock and steep banks', async () => {
    const recipes = await loadRecipes();
    const N = HABITAT_CELLS;
    const hab = /** @type {any} */ (shoreline());
    hab.sand = new Uint8Array(N * N); hab.rock = new Uint8Array(N * N); hab.soil = new Uint8Array(N * N).fill(255);
    hab.slopeDeg = new Uint8Array(N * N); hab.heightDm = new Int16Array(N * N).fill(10);
    const homes = { reeds: 'edge', lilies: 'pond', iris: 'bank' };
    const lines = [];
    for (const [sp, zone] of Object.entries(homes)) {
      const s = () => suitability(recipes.flora[sp], hab, at(zone)[0], 0);
      const onSoil = s().suit;
      hab.soil.fill(0); hab.sand.fill(255);
      const onSand = s();
      hab.sand.fill(0); hab.rock.fill(255);
      const onRock = s();
      hab.rock.fill(0); hab.soil.fill(255);
      assert(onSoil >= 0.9, `${sp} on soil: ${onSoil.toFixed(2)}`);
      assert(onSand.suit < 0.2 && onSand.worst === 'ground', `${sp} on sand: ${onSand.suit.toFixed(2)} (${onSand.worst})`);
      assert(onRock.suit < 0.2 && onRock.worst === 'ground', `${sp} on rock: ${onRock.suit.toFixed(2)} (${onRock.worst})`);
      lines.push(`${sp} ${onSoil.toFixed(2)} on soil`);
    }
    hab.slopeDeg.fill(30);
    for (const sp of ['reeds', 'iris']) {
      const r = suitability(recipes.flora[sp], hab, at(homes[/** @type {'reeds'|'iris'} */ (sp)])[0], 0);
      assert(r.suit < 0.2 && r.worst === 'steep', `${sp} on a 30 degree bank: ${r.suit.toFixed(2)} (${r.worst})`);
    }
    const rush = suitability(recipes.covers.rushes, hab, at('edge')[0], 0);
    assert(rush.suit < 0.2 && rush.worst === 'steep', `rushes on a 30 degree bank: ${rush.suit.toFixed(2)}`);
    // Grass: full on gentle earth, gone on sand and past about 45 degrees.
    const env = { ...makeEnv(9, recipes), habitat: () => hab };
    const grassAt = (/** @type {any} */ h) => settleGrowth(initialWorldState(9), { ...env, habitat: () => h }).growth.grass[20 * N + ZONES.dry[0] + 5];
    hab.slopeDeg.fill(10);
    const gentle = grassAt(hab);
    hab.slopeDeg.fill(50);
    const cliff = grassAt(hab);
    hab.slopeDeg.fill(10); hab.soil.fill(0); hab.sand.fill(255);
    const beach = grassAt(hab);
    assert(gentle >= 250 && cliff === 0 && beach === 0, `grass on gentle earth ${gentle}, a 50 degree bank ${cliff}, sand ${beach}`);
    return `${lines.join(', ')}; grass ${gentle} on gentle earth, none on a cliff or sand`;
  });

  test(GROWTH, 'a new island starts with grass, reeds and lilies only; the rest arrive by themselves, the same way twice', async () => {
    const recipes = await loadRecipes();
    eq(JSON.stringify(recipes.growth.starters), JSON.stringify(['reeds', 'lilies']), 'growth.json starters');
    const hab = shoreline();
    const env = { ...makeEnv(9, recipes), habitat: () => hab };
    const start = settleGrowth(initialWorldState(9), env);
    const kinds = [...new Set(start.growth.plants.map((/** @type {any} */ p) => p.sp))].sort();
    eq(JSON.stringify(kinds), JSON.stringify(['lilies', 'reeds']), 'species on a new island');
    eq(start.growth.cover.rushes.reduce((/** @type {number} */ a, /** @type {number} */ b) => a + b, 0), 0, 'rushes on a new island');
    const V = recipes.growth.volunteers;
    const run = () => {
      let s = structuredClone(start);
      /** @type {string[]} */ const came = [];
      for (let h = 10; h < 10 + 400; h++) {
        const o = runHour(s, h, env);
        s = o.state;
        for (const e of o.events) if (e.name === 'growth:arrived') came.push(`${e.payload.species}@${h}`);
      }
      return { s, came };
    };
    const a = run(), b = run();
    eq(a.came.join(), b.came.join(), 'arrivals of two runs');
    eq(hashWorldState(a.s), hashWorldState(b.s), 'world hash of two runs');
    assert(a.came.length >= 3, `only ${a.came.length} arrivals in 400 hours: ${a.came.join(', ')}`);
    const hours = a.came.map((c) => Number(c.split('@')[1]));
    assert(hours[0] - 10 >= V.firstAfterH, `the first came at hour ${hours[0] - 10}`);
    for (let i = 1; i < hours.length; i++) assert(hours[i] - hours[i - 1] >= V.gapH, `two came ${hours[i] - hours[i - 1]} hours apart`);
    // In the recipe's order (this made-up shore has ground for every one of them).
    const order = a.came.map((c) => c.split('@')[0]);
    eq(order.join(), V.order.slice(0, order.length).join(), 'arrival order');
    for (const sp of order) assert(sp in a.s.growth.arrived, `${sp} recorded as arrived`);
    return `arrivals ${a.came.map((c) => c.replace(/@(\d+)/, (_, h) => ` at ${Number(h) - 10} h`)).join(', ')}`;
  });

  test(GROWTH, 'an older save keeps its plants: what is there counts as arrived, and only the missing ones come later', async () => {
    const recipes = await loadRecipes();
    const hab = shoreline();
    const env = { ...makeEnv(9, recipes), habitat: () => hab };
    let s = settleGrowth(initialWorldState(9), env);
    // An older save: iris planted, no arrived record and no first hour.
    s = plantSeed(s, 'iris', at('bank')[0], 0, env).state;
    const old = { ...s, growth: { ...s.growth } };
    delete old.growth.arrived; delete old.growth.since;
    const o = runHour(old, 500, env);
    const ar = o.state.growth.arrived;
    assert(ar.iris === 500 && ar.reeds === 500 && ar.lilies === 500, `arrived after the first hour: ${JSON.stringify(ar)}`);
    eq(o.state.growth.since, 500, 'the first hour of an older save');
    let t = o.state; /** @type {string[]} */ const came = [];
    for (let h = 501; h < 800; h++) { const r = runHour(t, h, env); t = r.state; for (const e of r.events) if (e.name === 'growth:arrived') came.push(e.payload.species); }
    assert(!came.includes('iris') && came.length > 0, `came later: ${came.join(', ')}`);
    return `iris, reeds and lilies count as arrived; later came ${came.join(', ')}`;
  });

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
    assert(at(36, 30) > 0.7, `2 m from the pond: ${at(36, 30).toFixed(2)}`);
    assert(at(38, 30) > 0.2 && at(38, 30) < 0.9, `4 m from the pond eases: ${at(38, 30).toFixed(2)}`);
    eq(at(45, 30), 0, 'lush 11 m from the pond');
    // Feathered: walking out from the pond, no square is more than a fifth lusher than the next.
    let steepest = 0;
    for (let i = 34; i < 46; i++) steepest = Math.max(steepest, at(i, 30) - at(i + 1, 30));
    assert(steepest < 0.2, `a sharp edge: ${steepest.toFixed(2)} between two squares`);
    assert(at(8, 50) > 0.1 && at(8, 50) < at(30, 30) && at(15, 50) < 0.02, `the damp hollow's ring: ${at(8, 50).toFixed(2)} on it, ${at(15, 50).toFixed(2)} at 7 m`);
    // Salt dries what would be lush: a pond cell's neighbor under the salty rows.
    hab.depthCm[3 * n + 30] = 60;
    const g = lushField(/** @type {any} */ (hab), L);
    const fresh = lushField(/** @type {any} */ ({ ...hab, salt: new Uint8Array(NN) }), L);
    assert(g[3 * n + 31] < 0.7 * fresh[3 * n + 31], `salt does not dry the shore: ${(g[3 * n + 31] / 255).toFixed(2)} against ${(fresh[3 * n + 31] / 255).toFixed(2)} without salt`);
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
    return `${cases.length} refusals and ${Object.keys(HOMES).length} plantings as expected`;
  });

  test(GROWTH, 'grey willow takes a damp, fresh bank of soil, and refuses salt, sand, rock, deep water, dry ground and steep banks', async () => {
    const recipes = await loadRecipes();
    const W = recipes.flora.willow;
    assert(W && recipes.growth.species.includes('willow'), 'willow is in growth.json species');
    assert(!recipes.growth.starters.includes('willow'), 'willow is no starter');
    const N = HABITAT_CELLS;
    const hab = /** @type {any} */ (shoreline());
    hab.sand = new Uint8Array(N * N); hab.rock = new Uint8Array(N * N); hab.soil = new Uint8Array(N * N).fill(255);
    hab.slopeDeg = new Uint8Array(N * N).fill(5); hab.heightDm = new Int16Array(N * N).fill(10);
    const env = { ...makeEnv(5, recipes), habitat: () => hab };
    const state = initialWorldState(5);
    const onBank = suitability(W, hab, at('bank')[0], 0).suit;
    assert(onBank >= 0.9, `willow on a damp bank of soil: ${onBank.toFixed(2)}`);
    /** @type {[string, string][]} */
    const refusals = [['dry', 'dry'], ['edge', 'deep'], ['pond', 'deep'], ['shore', 'salt'], ['band', 'salt']];
    for (const [zone, need] of refusals) {
      const r = plantSeed(state, 'willow', at(zone)[0], 0, env);
      assert(!r.ok, `willow should not take on ${zone}`);
      eq(r.reason, need, `willow on ${zone}:`);
    }
    hab.soil.fill(0); hab.sand.fill(255);
    eq(plantSeed(state, 'willow', at('bank')[0], 0, env).reason, 'ground', 'willow on a sandy bank');
    hab.sand.fill(0); hab.rock.fill(255);
    eq(plantSeed(state, 'willow', at('bank')[0], 0, env).reason, 'ground', 'willow on a rocky bank');
    hab.rock.fill(0); hab.soil.fill(255); hab.slopeDeg.fill(32);
    eq(plantSeed(state, 'willow', at('bank')[0], 0, env).reason, 'steep', 'willow on a 32 degree bank');
    hab.slopeDeg.fill(5);
    const first = plantSeed(state, 'willow', at('bank')[0], 0, env);
    assert(first.ok, `willow takes on the bank (${first.reason})`);
    eq(plantSeed(first.state, 'willow', at('bank')[0], 1, env).reason, 'crowded', 'a second willow a meter away');
    return `bank ${onBank.toFixed(2)}; refused ${refusals.map(([z, n]) => `${z} (${n})`).join(', ')}, sand, rock and a steep bank`;
  });

  test(GROWTH, 'grey willow grows slowly to a shrub over a season, seeds only in early summer, and stops at its cap', async () => {
    const recipes = await loadRecipes();
    const W = recipes.flora.willow;
    const hab = shoreline();
    // A wide damp bank, so seeds have room to land.
    for (let j = 0; j < hab.n; j++) for (let i = 28; i <= ZONES.bank[1]; i++) hab.moisture[j * hab.n + i] = 120;
    const env = { ...makeEnv(9, recipes), habitat: () => hab };
    const base = settleGrowth(initialWorldState(9), env);
    const season = (/** @type {number} */ pos) => ({ ...base.seasons, index: Math.floor(pos), phase: pos - Math.floor(pos) });
    // Pace: a seed beside a reed seed, in spring. Reeds stand within two days; willow is still young.
    let s = { ...base, seasons: season(0.5), growth: { ...base.growth, plants: [] } };
    s = plantSeed(s, 'willow', HABITAT_ORIGIN + 35.5, HABITAT_ORIGIN + 60.5, env).state;
    s = plantSeed(s, 'reeds', at('edge')[0], HABITAT_ORIGIN + 60.5, env).state;
    const size = (/** @type {any} */ st, /** @type {string} */ sp) => st.growth.plants.find((/** @type {any} */ p) => p.sp === sp)?.size ?? 0;
    /** @type {number[]} */ const willowAt = [];
    for (let h = 0; h < 14 * 24; h++) {
      s = coarseStep(s, h, env).state;
      if (h === 47) willowAt.push(size(s, 'willow'), size(s, 'reeds'));
    }
    const grown = s.growth.plants.find((/** @type {any} */ p) => p.sp === 'willow');
    assert(willowAt[1] >= recipes.flora.reeds.growth.stages.matureSize && willowAt[0] < 0.4, `after two days: reeds ${willowAt[1].toFixed(2)}, willow ${willowAt[0].toFixed(2)}`);
    assert(grown.size >= W.growth.stages.matureSize && grown.stage >= STAGE.mature, `after a season the willow is ${grown.size.toFixed(2)} (stage ${grown.stage})`);
    // Seeding: four grown willows on the bank, seed in their window only.
    /** @param {number} n @param {number} pos */
    const seeding = (n, pos) => {
      const plants = Array.from({ length: n }, (_, i) => ({ id: i + 1, sp: 'willow', x: HABITAT_ORIGIN + 34.5, z: HABITAT_ORIGIN + 10.5 + i * 3,
        age: 900, size: 0.95, best: 0.95, stage: STAGE.mature, low: 0, drown: 0, last: -1000 }));
      let t = { ...base, seasons: season(pos), growth: { ...base.growth, plants, nextId: 100 } };
      for (let h = 1000; h < 1000 + 240; h++) t = coarseStep(t, h, env).state;
      return t.growth.plants.filter((/** @type {any} */ p) => p.sp === 'willow');
    };
    const summer = seeding(4, 1.2);
    eq(seeding(4, 2.0).length, 4, 'willows seeding outside early summer');
    assert(summer.length > 4, `four willows dropped no seed that took in early summer (${summer.length})`);
    for (const p of summer) assert(suitability(W, hab, p.x, p.z).suit >= 0.5, `a seedling on poor ground at x ${p.x.toFixed(1)}`);
    for (let a = 0; a < summer.length; a++) for (let b = a + 1; b < summer.length; b++) {
      assert(Math.hypot(summer[a].x - summer[b].x, summer[a].z - summer[b].z) >= W.spread.minSpacingM - 1e-9, 'two willows closer than their spacing');
    }
    eq(seeding(W.spread.maxCount, 1.2).length, W.spread.maxCount, 'willows seeding past their cap');
    return `willow ${willowAt[0].toFixed(2)} at two days (reeds ${willowAt[1].toFixed(2)}), ${grown.size.toFixed(2)} after 14 days; 4 grew to ${summer.length} in ten early-summer days, none outside it or at the cap of ${W.spread.maxCount}`;
  });

  test(GROWTH, 'grey willow arrives by itself after marsh marigold, on a bank that suits it, the same way twice', async () => {
    const recipes = await loadRecipes();
    const V = recipes.growth.volunteers;
    eq(V.order.indexOf('willow'), V.order.indexOf('marigold') + 1, 'willow follows marigold in volunteers.order');
    const hab = shoreline();
    const env = { ...makeEnv(9, recipes), habitat: () => hab };
    const start = settleGrowth(initialWorldState(9), env);
    const run = () => {
      let s = structuredClone(start);
      /** @type {{ sp: string, h: number, x: number }[]} */ const came = [];
      for (let h = 10; h < 10 + 700 && !came.some((c) => c.sp === 'willow'); h++) {
        const o = runHour(s, h, env);
        s = o.state;
        for (const e of o.events) if (e.name === 'growth:arrived') came.push({ sp: e.payload.species, h, x: e.payload.x });
      }
      return { s, came };
    };
    const a = run(), b = run();
    eq(JSON.stringify(a.came), JSON.stringify(b.came), 'arrivals of two runs');
    eq(hashWorldState(a.s), hashWorldState(b.s), 'world hash of two runs');
    const w = a.came.find((c) => c.sp === 'willow');
    assert(w, `no willow in 700 hours: ${a.came.map((c) => c.sp).join(', ')}`);
    eq(zoneOf(w.x), 'bank', 'the willow landed on');
    const plant = a.s.growth.plants.find((/** @type {any} */ p) => p.sp === 'willow');
    assert(plant && plant.stage >= 1, 'it is a sprout on the island');
    return `willow came at ${w.h - 10} h, after ${a.came.slice(0, -1).map((c) => c.sp).join(', ')}`;
  });

  test(GROWTH, 'gorse takes dry, sunny soil or sand, a slope and some salt spray, and refuses wet ground, water, the tide band, strong salt and rock', async () => {
    const recipes = await loadRecipes();
    const G = recipes.flora.gorse;
    assert(G && recipes.growth.species.includes('gorse'), 'gorse is in growth.json species');
    assert(!recipes.growth.starters.includes('gorse'), 'gorse is no starter');
    eq(G.draw, 'shrub', 'gorse draws with');
    assert(!G.phenology && !G.dormant, 'gorse is evergreen: no phenology and no dormant window');
    const N = HABITAT_CELLS;
    const hab = /** @type {any} */ (shoreline());
    hab.sand = new Uint8Array(N * N); hab.rock = new Uint8Array(N * N); hab.soil = new Uint8Array(N * N).fill(255);
    hab.slopeDeg = new Uint8Array(N * N).fill(5); hab.heightDm = new Int16Array(N * N).fill(30);
    const env = { ...makeEnv(5, recipes), habitat: () => hab };
    const state = initialWorldState(5);
    const [dx] = at('dry');
    const onDry = suitability(G, hab, dx, 0).suit;
    assert(onDry >= 0.9, `gorse on dry soil: ${onDry.toFixed(2)}`);
    /** @type {[string, string][]} */
    const refusals = [['bank', 'wet'], ['edge', 'deep'], ['pond', 'deep'], ['sea', 'deep'], ['band', 'wet'], ['shore', 'wet']];
    for (const [zone, need] of refusals) {
      const r = plantSeed(state, 'gorse', at(zone)[0], 0, env);
      assert(!r.ok, `gorse should not take on ${zone}`);
      eq(r.reason, need, `gorse on ${zone}:`);
    }
    const plant = () => plantSeed(state, 'gorse', dx, 0, env);
    // Dry ground with salt: a little spray is fine, the tide band's salt is not.
    const salt = (/** @type {number} */ v) => { for (let j = 0; j < N; j++) for (let i = ZONES.dry[0]; i <= ZONES.dry[1]; i++) hab.salt[j * N + i] = v; };
    salt(100);
    assert(plant().ok, 'gorse takes on dry ground with some salt spray');
    salt(210);
    eq(plant().reason, 'salt', 'gorse on dry ground as salty as the tide band');
    salt(0);
    hab.soil.fill(0); hab.sand.fill(255);
    assert(plant().ok, 'gorse takes on dry sand');
    hab.sand.fill(0); hab.rock.fill(255);
    eq(plant().reason, 'ground', 'gorse on bare rock');
    hab.rock.fill(0); hab.soil.fill(255); hab.slopeDeg.fill(30);
    assert(plant().ok, 'gorse takes on a 30 degree slope');
    hab.slopeDeg.fill(50);
    eq(plant().reason, 'steep', 'gorse on a 50 degree face');
    hab.slopeDeg.fill(5);
    const first = plant();
    assert(first.ok, `gorse takes on dry ground (${first.reason})`);
    eq(plantSeed(first.state, 'gorse', dx, 1, env).reason, 'crowded', 'a second gorse a meter away');
    return `dry soil ${onDry.toFixed(2)}; refused ${refusals.map(([z, n]) => `${z} (${n})`).join(', ')}, tide-band salt, rock and a cliff; took sand, some salt and a 30 degree slope`;
  });

  test(GROWTH, 'gorse grows a little faster than willow, matures in about 10 to 14 days, seeds only in high summer and stops at its cap', async () => {
    const recipes = await loadRecipes();
    const G = recipes.flora.gorse;
    const hab = shoreline();
    const env = { ...makeEnv(9, recipes), habitat: () => hab };
    const base = settleGrowth(initialWorldState(9), env);
    const season = (/** @type {number} */ pos) => ({ ...base.seasons, index: Math.floor(pos), phase: pos - Math.floor(pos) });
    // A gorse seed on dry ground and a willow seed on the bank, in spring.
    let s = { ...base, seasons: season(0.3), growth: { ...base.growth, plants: [] } };
    s = plantSeed(s, 'gorse', at('dry')[0], HABITAT_ORIGIN + 60.5, env).state;
    s = plantSeed(s, 'willow', at('bank')[0], HABITAT_ORIGIN + 60.5, env).state;
    const plant = (/** @type {any} */ st, /** @type {string} */ sp) => st.growth.plants.find((/** @type {any} */ p) => p.sp === sp);
    /** @type {number[]} */ const at4 = [];
    let mature = -1;
    for (let h = 0; h < 14 * 24; h++) {
      s = coarseStep(s, h, env).state;
      if (h === 95) at4.push(plant(s, 'gorse').size, plant(s, 'willow').size);
      if (mature < 0 && plant(s, 'gorse').stage >= STAGE.mature) mature = h + 1;
    }
    assert(at4[0] > at4[1], `after four days gorse ${at4[0].toFixed(2)} is no larger than willow ${at4[1].toFixed(2)}`);
    assert(mature >= 9.5 * 24 && mature <= 14 * 24, `gorse matured at ${(mature / 24).toFixed(1)} days`);
    // Seeding: four grown bushes on the dry ground, seed in high summer only.
    /** @param {number} n @param {number} pos */
    const seeding = (n, pos) => {
      const plants = Array.from({ length: n }, (_, i) => ({ id: i + 1, sp: 'gorse', x: HABITAT_ORIGIN + 32.5, z: HABITAT_ORIGIN + 10.5 + i * 3,
        age: 900, size: 0.95, best: 0.95, stage: STAGE.mature, low: 0, drown: 0, last: -1000 }));
      let t = { ...base, seasons: season(pos), growth: { ...base.growth, plants, nextId: 100 } };
      for (let h = 1000; h < 1000 + 240; h++) t = coarseStep(t, h, env).state;
      return t.growth.plants.filter((/** @type {any} */ p) => p.sp === 'gorse');
    };
    const summer = seeding(4, 1.5);
    eq(seeding(4, 0.5).length, 4, 'gorse seeding in spring');
    eq(seeding(4, 2.5).length, 4, 'gorse seeding in autumn');
    assert(summer.length > 4, `four bushes dropped no seed that took in high summer (${summer.length})`);
    for (const p of summer) {
      eq(zoneOf(p.x), 'dry', 'a seedling landed on');
      const d = Math.min(...summer.filter((q) => q !== p).map((q) => Math.hypot(q.x - p.x, q.z - p.z)));
      assert(d >= G.spread.minSpacingM - 1e-9, `two gorse bushes ${d.toFixed(2)} m apart`);
    }
    eq(seeding(G.spread.maxCount, 1.5).length, G.spread.maxCount, 'gorse seeding past its cap');
    return `at four days gorse ${at4[0].toFixed(2)}, willow ${at4[1].toFixed(2)}; gorse mature at ${(mature / 24).toFixed(1)} days; 4 grew to ${summer.length} in ten summer days, none in spring, autumn or at the cap of ${G.spread.maxCount}`;
  });

  test(GROWTH, 'gorse arrives by itself after sea campion, on dry ground, the same way twice', async () => {
    const recipes = await loadRecipes();
    const V = recipes.growth.volunteers;
    eq(V.order.indexOf('gorse'), V.order.indexOf('campion') + 1, 'gorse follows campion in volunteers.order');
    eq(V.order[V.order.length - 1], 'gorse', 'gorse is the last volunteer');
    const hab = shoreline();
    const env = { ...makeEnv(9, recipes), habitat: () => hab };
    const start = settleGrowth(initialWorldState(9), env);
    const run = () => {
      let s = structuredClone(start);
      /** @type {{ sp: string, h: number, x: number }[]} */ const came = [];
      for (let h = 10; h < 10 + 1200 && !came.some((c) => c.sp === 'gorse'); h++) {
        const o = runHour(s, h, env);
        s = o.state;
        for (const e of o.events) if (e.name === 'growth:arrived') came.push({ sp: e.payload.species, h, x: e.payload.x });
      }
      return { s, came };
    };
    const a = run(), b = run();
    eq(JSON.stringify(a.came), JSON.stringify(b.came), 'arrivals of two runs');
    eq(hashWorldState(a.s), hashWorldState(b.s), 'world hash of two runs');
    const g = a.came.find((c) => c.sp === 'gorse');
    assert(g, `no gorse in 1200 hours: ${a.came.map((c) => c.sp).join(', ')}`);
    eq(a.came.map((c) => c.sp).join(), V.order.join(), 'arrival order');
    eq(zoneOf(g.x), 'dry', 'the gorse landed on');
    // It comes only in summer (gorse.json volunteer.seasons), so the year has a new plant then.
    eq(Math.floor(g.h / (14 * 24)) % 4, 1, 'the season gorse came in (0 spring, 1 summer)');
    return `gorse came at ${g.h - 10} h (day ${Math.floor(g.h / 24)}, summer), after ${a.came.slice(0, -1).map((c) => c.sp).join(', ')}`;
  });

  test(GROWTH, 'every species over 96 hours: two runs match, and every plant stays on its own ground', async () => {
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
    const recipes = startersWith(await loadRecipes(), 'rushes');
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
    const recipes = startersWith(await loadRecipes(), 'rushes');
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
    // Iris is a volunteer on the islands; here it is a starter too, to test a basin's starters.
    const recipes = startersWith(await loadRecipes(), 'iris');
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
    // On the islands iris is no starter, so a basin's iris waits to come by itself.
    const real = settleGrowth(initialWorldState(9), { ...makeEnv(9, { ...(await loadRecipes()), land: { basins: [basin] } }), habitat: () => hab });
    eq(near(real, 'iris').length, 0, 'iris starters in the basin when iris is no starter');
    for (const p of near(marsh, 'reeds')) eq(zoneOf(p.x), 'edge', 'a starter reed');
    for (const p of near(marsh, 'iris')) eq(zoneOf(p.x), 'bank', 'a starter iris');
    // The island-wide starters are the same either way.
    const first = (/** @type {any} */ st) => JSON.stringify(st.growth.plants.slice(0, plain.growth.plants.length));
    eq(first(marsh), first(plain), 'island-wide starters');
    eq(hashWorldState(settleGrowth(initialWorldState(9), env)), hashWorldState(marsh), 'the same twice');
    return `${reeds} reeds and ${iris} iris added in the basin; the island-wide starters unchanged`;
  });
}
