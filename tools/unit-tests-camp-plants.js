// @ts-check
// The camp ground stays clear of plants (docs/future/13 section 3.1, CP-16) for tools/unit-tests.html:
// the habitat's clear mask covers the pad, and no seed, spread, volunteer or hand planting takes on
// it, while ground just outside it is unchanged; grass stays (the grass shader keeps it short).
// With no pad nothing changes.

import { initialWorldState, makeEnv } from '../src/sim/tick.js';
import { buildHabitat, padClearMask, habitatCell, HABITAT_CELLS, HABITAT_ORIGIN } from '../src/world/growth/habitat.js';
import { suitability, plantSeed, plantCover, settleGrowth } from '../src/world/growth/coarse.js';
import { volunteerAt } from '../src/world/growth/volunteers.js';
import { shoreline, at, loadRecipes } from './unit-tests-growth.js';

const G = 'camp plants';

/** A shoreline habitat with a pad of radius r centered on a zone's middle. @param {string} zone @param {number} r */
function withPad(zone, r) {
  const hab = /** @type {any} */ (shoreline());
  const pad = { x: at(zone)[0], z: 0.5, r };
  hab.clear = padClearMask(pad);
  return { hab, pad };
}

/** A tiny made-up island for buildHabitat: all open dry land. @param {any} [pad] */
function smallHabitat(pad) {
  const N = HABITAT_CELLS;
  const eco = { x: 0, y: 0, w: N, h: N, depthCm: new Uint8Array(N * N), cls: new Uint8Array(N * N), band: new Uint8Array(N * N) };
  const material = new Uint8Array(N * N * 4);
  for (let k = 0; k < N * N; k++) material[k * 4] = 255;
  return buildHabitat({ eco, material, materialCells: N, params: { bankM: 6, saltM: 8, bandMoisture: 200, bandSalt: 200 }, pad });
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addCampPlantsTests(test, assert, eq) {
  test(G, 'the clear mask covers every cell that reaches onto the pad, and none 2 m past its edge', () => {
    const pad = { x: 12.3, z: -7.6, r: 4 };
    const m = padClearMask(pad);
    let on = 0;
    for (let a = 0; a < 360; a += 7.5) {
      for (const f of [0, 0.3, 0.7, 0.999]) {
        const x = pad.x + Math.cos(a * Math.PI / 180) * pad.r * f, z = pad.z + Math.sin(a * Math.PI / 180) * pad.r * f;
        eq(m[habitatCell(x, z)], 1, `(${x.toFixed(2)}, ${z.toFixed(2)}) on the pad is clear`);
      }
      const x = pad.x + Math.cos(a * Math.PI / 180) * (pad.r + 2), z = pad.z + Math.sin(a * Math.PI / 180) * (pad.r + 2);
      eq(m[habitatCell(x, z)], 0, `(${x.toFixed(2)}, ${z.toFixed(2)}), 2 m outside, is not`);
    }
    for (const v of m) on += v;
    assert(on >= 50 && on <= 80, `${on} clear cells for a 4 m pad`);
    eq(JSON.stringify(Array.from(padClearMask({ ...pad }))), JSON.stringify(Array.from(m)), 'the same every time');
    return `${on} clear cells under a 4 m pad`;
  });

  test(G, 'with no pad the habitat is unchanged; a pad adds the mask and changes only the hash', () => {
    const none = smallHabitat(undefined), nul = smallHabitat(null), padded = smallHabitat({ x: 0, z: 0, r: 4 });
    assert(none.clear === undefined && nul.clear === undefined, 'no clear mask without a pad');
    eq(none.hash, nul.hash, 'hash with pad null and with none');
    assert(padded.clear instanceof Uint8Array, 'a pad gives a clear mask');
    assert(padded.hash !== none.hash, 'the pad joins the hash');
    for (const key of ['depthCm', 'moisture', 'salt', 'still', 'sea', 'grass', 'open']) {
      eq(JSON.stringify(Array.from(/** @type {any} */ (padded)[key])), JSON.stringify(Array.from(/** @type {any} */ (none)[key])), `${key} is the same`);
    }
    eq(smallHabitat({ x: 0, z: 0, r: 4 }).hash, padded.hash, 'the same pad, the same hash');
  });

  test(G, 'the Plant tool refuses seeds and tussocks on the pad, and plants them just outside', async () => {
    const recipes = await loadRecipes();
    // Iris on the bank, rushes in the pond's shallow margin; the shoreline is the same along every row.
    for (const [sp, zone] of [['iris', 'bank'], ['rushes', 'edge']]) {
      const { hab, pad } = withPad(zone, 4);
      const env = { ...makeEnv(9, recipes), habitat: () => hab };
      const s = settleGrowth(initialWorldState(9), env);
      const plant = (/** @type {number} */ z) => (recipes.covers[sp] ? plantCover(s, sp, pad.x, z, env) : plantSeed(s, sp, pad.x, z, env));
      for (const z of [pad.z, pad.z + 2, pad.z - 3.9]) {
        const r = plant(z);
        assert(!r.ok && r.reason === 'camp', `${sp} at z ${z} on the pad: ${r.ok ? 'planted' : r.reason}`);
      }
      eq(suitability(recipes.flora[sp] ?? recipes.covers[sp], hab, pad.x, pad.z).worst, 'camp', `${sp}: the need on the pad`);
      const out = plant(pad.z + pad.r + 2);
      assert(out.ok, `${sp} 2 m past the pad's edge: ${out.reason}`);
      // Without the pad the same spot on it takes.
      const bare = { ...env, habitat: () => shoreline() };
      const r0 = recipes.covers[sp] ? plantCover(settleGrowth(initialWorldState(9), bare), sp, pad.x, pad.z, bare) : plantSeed(settleGrowth(initialWorldState(9), bare), sp, pad.x, pad.z, bare);
      assert(r0.ok, `${sp} without a pad: ${r0.reason}`);
    }
  });

  test(G, 'starters and the first cover keep off the pad; the grass cover stays', async () => {
    const recipes = await loadRecipes();
    // A long pad down the pond's margin, where the reeds start; the rushes start there too.
    const { hab } = withPad('edge', 30);
    const withRushes = { ...recipes, growth: { ...recipes.growth, starters: [...recipes.growth.starters, 'rushes'] } };
    const env = { ...makeEnv(9, withRushes), habitat: () => hab };
    const s = settleGrowth(initialWorldState(9), env).growth;
    const onPad = s.plants.filter((/** @type {any} */ p) => hab.clear[habitatCell(p.x, p.z)]);
    eq(onPad.length, 0, `starters on the pad (${onPad.map((/** @type {any} */ p) => p.sp).join(', ')})`);
    assert(s.plants.some((/** @type {any} */ p) => p.sp === 'reeds'), 'reeds still start beside it');
    let rushOn = 0, rushOff = 0, grassDiff = 0;
    for (let k = 0; k < hab.clear.length; k++) {
      if (hab.clear[k]) rushOn += s.cover.rushes[k]; else rushOff += s.cover.rushes[k];
    }
    // Grass (with the usual starters, so no rushes for it to give way to) is the same with the pad.
    const base = makeEnv(9, recipes);
    const padded = settleGrowth(initialWorldState(9), { ...base, habitat: () => hab }).growth;
    const bare = settleGrowth(initialWorldState(9), { ...base, habitat: () => shoreline() }).growth;
    for (let k = 0; k < hab.clear.length; k++) if (padded.grass[k] !== bare.grass[k]) grassDiff++;
    eq(rushOn, 0, 'rush cover on the pad');
    assert(rushOff > 0, 'rushes cover the margin outside the pad');
    eq(grassDiff, 0, 'cells where the pad changed the grass cover');
  });

  test(G, 'a volunteer never lands on the pad', () => {
    const N = HABITAT_CELLS;
    const hab = /** @type {any} */ (shoreline());
    // Only a 9 x 9 square is open, and a pad covers most of it.
    hab.open.fill(0);
    const ci = 100, cj = 100;
    for (let j = cj - 4; j <= cj + 4; j++) for (let i = ci - 4; i <= ci + 4; i++) hab.open[j * N + i] = 1;
    const pad = { x: HABITAT_ORIGIN + ci + 0.5, z: HABITAT_ORIGIN + cj + 0.5, r: 3 };
    hab.clear = padClearMask(pad);
    const env = { seed: 77, recipes: { growth: { volunteers: { order: ['x'], firstAfterH: 0, gapH: 0, chancePerH: 1, minSuit: 0.5 } }, flora: { x: {} } } };
    const g = { arrived: {}, since: 0 };
    let landed = 0;
    for (let h = 1; h < 200; h++) {
      const v = volunteerAt(g, hab, env, h, () => 1, () => false);
      assert(v, `hour ${h}: a volunteer lands on the open ground beside the pad`);
      if (!v) continue;
      eq(hab.clear[v.k], 0, `hour ${h}: cell ${v.k} is on the pad`);
      landed++;
    }
    // With the whole open square under the pad, none lands at all.
    hab.clear = padClearMask({ ...pad, r: 8 });
    eq(volunteerAt(g, hab, env, 5, () => 1, () => false), null, 'all of the open ground is pad');
    return `${landed} volunteers, none on the pad`;
  });
}
