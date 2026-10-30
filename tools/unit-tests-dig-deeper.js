// @ts-check
// Digging deeper tests for tools/unit-tests.html (B1 D1; docs/future/13 10.3, 10.6.3-10.6.8, 10.7.5,
// 10.7.7): story spots placed the same from the same seed, in their rings and on soil, one hearth on
// the starter island, moved off ground turned to water; the cache found once; layer 3 only with the
// blade (deeper clay, the charcoal band at a hearth), the stones word under it; sherds only near a
// hearth once a pot is fired; the sleeping toad's rule (winter, a pond, once a year, 1.5 m kept,
// spring frees it); the dig section's new fields saved and read back; the sherd family's numbers,
// mesh and words; the cache letter as a keeper page; the toad's sleeping pose on its rig.

import { storySpots, liveSpot, storyAt, storyHome, hearthCount, cacheDue } from '../src/world/dig/story.js';
import { nextLayer, cellOf, cellCenter } from '../src/world/dig/layers.js';
import { digFinds, digFamily, digRarityWeights } from '../src/world/dig/finds.js';
import { sleeperCellOf, sleeperAt, sleeperNear, yearOf, nearestSleeper } from '../src/world/dig/sleepers.js';
import { cleanDig, emptyDig } from '../src/world/dig/rest.js';
import { digCheckJob } from '../src/world/dig/check.js';
import { FAMILIES } from '../src/world/keepsakes/families/index.js';
import { withCacheLetters, keeperPagesHad } from '../src/ui/journal-keeper.js';
import { toadSleepMoves } from '../src/world/creatures/toad-walk.js';
import { legsOf } from '../src/world/creatures/motion.js';
import { bodyFor, skeletonOf, MAX_BONES } from '../src/world/creatures/bodies.js';
import { poseSkeleton } from '../src/world/creatures/pose.js';
import { subSeed } from '../src/core/rng.js';
import { DAYS_PER_SEASON } from '../src/core/clock.js';
import { HABITAT_CELLS, HABITAT_ORIGIN } from '../src/world/growth/habitat.js';

const G = 'dig-deeper';
/** @param {string} path */
const json = (path) => fetch(new URL(`../recipes/${path}.json`, import.meta.url)).then((r) => r.json());

/** Soil everywhere, with a pond; set cells to change it. */
function habitat() {
  const N = HABITAT_CELLS * HABITAT_CELLS, z = () => new Uint8Array(N);
  const h = /** @type {any} */ ({ n: HABITAT_CELLS, open: z().fill(1), depthCm: z(), moisture: z().fill(80), salt: z(), still: z(), sea: z(), grass: z().fill(200), band: z(), sand: z(), rock: z(), soil: z(), clear: z(), hash: 0 });
  for (let j = 84; j < 92; j++) for (let i = 100; i < 106; i++) { h.depthCm[j * HABITAT_CELLS + i] = 40; h.still[j * HABITAT_CELLS + i] = 1; }
  return h;
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addDigDeeperTests(test, assert, eq) {
  const RP = json('world/dig'), KP = json('world/keepsakes'), LP = json('land/starter-island-2'), L1 = json('land/starter-island'), L2 = json('land/two-ponds');

  test(G, 'story spots: the same seed places them the same; one hearth 8 to 20 m and the stone 12 to 30 m from camp, on level soil', async () => {
    const R = await RP, S = R.story;
    for (const land of [await LP, await L1]) {
      const home = storyHome(land);
      for (const seed of [1207, 42, 99991, 7, 31337]) {
        const a = storySpots(land, subSeed(seed, 'terrain'), seed, S), b = storySpots(land, subSeed(seed, 'terrain'), seed, S);
        eq(JSON.stringify(a), JSON.stringify(b), `seed ${seed}: the same twice`);
        eq(a.hearths.length, 1, `seed ${seed}: exactly one hearth on the starter island`);
        const dh = Math.hypot(a.hearths[0].x - home.x, a.hearths[0].z - home.z);
        assert(dh >= 8 - 0.01 && dh <= 20 + 0.01, `seed ${seed}: hearth ${dh.toFixed(1)} m from camp`);
        assert(!!a.cache, `seed ${seed}: a marked stone`);
        const dc = Math.hypot(/** @type {any} */ (a.cache).x - home.x, /** @type {any} */ (a.cache).z - home.z);
        assert(dc >= 12 - 0.01 && dc <= 30 + 0.01, `seed ${seed}: stone ${dc.toFixed(1)} m from camp`);
      }
      const c = storySpots(land, subSeed(1207, 'terrain'), 1207, S), d = storySpots(land, subSeed(1208, 'terrain'), 1208, S);
      assert(JSON.stringify(c) !== JSON.stringify(d), 'another island seed, another past');
    }
    // Other islands roll 0, 1 or 2 hearths by their weights.
    const counts = [0, 0, 0];
    for (let s = 0; s < 400; s++) counts[hearthCount((await L2).story, s * 7919)]++;
    assert(counts[0] > 20 && counts[1] > counts[0] && counts[1] > counts[2] && counts[2] > 40, `0, 1, 2 hearths: ${counts}`);
  });

  test(G, 'story spots move when the ground there is turned to water, and back when it is not; storyAt reads the disc, the 6 m reach and the cache', async () => {
    const R = await RP, S = R.story;
    const spot = { x: 10, z: 10 }, home = { x: 0, z: 0 };
    let wet = (/** @type {number} */ x, /** @type {number} */ z) => Math.hypot(x - 10, z - 10) < 3;
    const ok = (/** @type {number} */ x, /** @type {number} */ z) => !wet(x, z);
    eq(JSON.stringify(liveSpot({ x: 20, z: 0 }, ok, home, S)), JSON.stringify({ x: 20, z: 0 }), 'diggable: stays');
    const moved = /** @type {any} */ (liveSpot(spot, ok, home, S));
    const d = Math.hypot(moved.x - 10, moved.z - 10);
    assert(d >= 3 && d <= 3.6, `moved to the nearest diggable ground (${d.toFixed(2)} m)`);
    eq(JSON.stringify(liveSpot(spot, ok, home, S)), JSON.stringify(moved), 'the same from the same ground');
    wet = (x, z) => Math.hypot(x - 10, z - 10) < 20;
    const far = /** @type {any} */ (liveSpot(spot, ok, home, S));
    assert(ok(far.x, far.z) && Math.hypot(far.x, far.z) < 6.5 && Math.hypot(far.x - 10, far.z - 10) > 12, 'past moveM: the nearest diggable ground to the camp');
    const live = { hearths: [{ x: 0, z: 0 }], cache: { x: 30, z: 0 } };
    const on = storyAt(1, 0, live, S), near = storyAt(4, 0, live, S), off = storyAt(9, 0, live, S), c = storyAt(30.5, 0, live, S);
    assert(on.hearth && on.nearHearth && !near.hearth && near.nearHearth && !off.nearHearth, 'the disc and the reach');
    assert(c.cache && !storyAt(31.5, 0, live, S).cache, 'the cache within cacheM of the stone');
  });

  test(G, 'the cache: once, at layer 2 by the stone; found is saved and read back', async () => {
    eq(cacheDue(2, { cache: true }, null), true, 'layer 2 by the stone');
    eq(cacheDue(1, { cache: true }, null), false, 'not at layer 1');
    eq(cacheDue(2, { cache: false }, null), false, 'not away from the stone');
    eq(cacheDue(2, { cache: true }, 312), false, 'never twice');
    const back = cleanDig(JSON.parse(JSON.stringify({ ...emptyDig(), cache: 312 })));
    eq(back.cache, 312, 'the hour found comes back');
    eq(cleanDig({ version: 1, events: [], firsts: [] }).cache, null, 'an older save: not found');
    eq(cleanDig({ version: 1, cache: -4 }).cache, null, 'a bad value: not found');
  });

  test(G, 'layer 3 waits for the blade: deeper clay under a bank, the charcoal band at a hearth, stones under soil', async () => {
    const R = await RP;
    eq(JSON.stringify(nextLayer('bank', 2, R)), JSON.stringify({ bottom: 'harder' }), 'bank, no blade: harder');
    eq(JSON.stringify(nextLayer('bank', 2, R, { blade: true })), JSON.stringify({ layer: 'deepclay', depth: 3 }), 'bank with the blade');
    eq(JSON.stringify(nextLayer('soil', 2, R, { hearth: true })), JSON.stringify({ bottom: 'harder' }), 'hearth, no blade: harder');
    eq(JSON.stringify(nextLayer('soil', 2, R, { hearth: true, blade: true })), JSON.stringify({ layer: 'charcoal', depth: 3 }), 'hearth with the blade');
    eq(JSON.stringify(nextLayer('soil', 2, R, { blade: true })), JSON.stringify({ bottom: 'stones' }), 'plain soil: stones, blade or not');
    eq(JSON.stringify(nextLayer('soil', 3, R, { hearth: true, blade: true })), JSON.stringify({ bottom: 'stones' }), 'under the charcoal: stones');
    eq(JSON.stringify(nextLayer('sand', 1, R, { hearth: true, blade: true })), JSON.stringify({ bottom: 'sand' }), 'sand stays one layer');
    // Depth 3's rarity: very rare and once in a lifetime open (the latter on a frost day or after rain).
    const at = { seed: 1, cell: 1, day: 1, layer: 'charcoal', depth: 3, season: 3, moisture: 0, rainBefore: false, frost: false, thin: 1, budgetLeft: 1 };
    const w = digRarityWeights(at, R), wf = digRarityWeights({ ...at, frost: true }, R);
    assert(w[3] > 0 && wf[4] > 0, 'very rare at depth 3; once in a lifetime on a frost day');
    assert(digRarityWeights({ ...at, layer: 'subsoil', depth: 2 }, R)[3] === 0 && digRarityWeights({ ...at, layer: 'subsoil', depth: 2, hearth: true }, R)[3] > 0, 'very rare at depth 2 only on a hearth');
    // Deeper clay gives a handful, not in winter; the charcoal band gives none.
    const K = await KP;
    eq(digFinds({ ...at, layer: 'deepclay', season: 1 }, R, K).clay, 'yes', 'deeper clay in summer');
    eq(digFinds({ ...at, layer: 'deepclay', season: 3 }, R, K).clay, 'winter', 'deeper clay in winter');
    eq(digFinds({ ...at, season: 1 }, R, K).clay, null, 'no clay in the charcoal band');
  });

  test(G, 'sherds: only once a pot is fired, only near a hearth or in the charcoal band', async () => {
    const R = await RP, K = await KP;
    const base = { seed: subSeed(1207, 'dig'), cell: 0, day: 3, layer: 'subsoil', depth: 2, season: 0, moisture: 0, rainBefore: false, frost: false, thin: 1, budgetLeft: 2 };
    for (let u = 0; u < 1; u += 0.01) {
      eq(digFamily({ ...base, nearHearth: true, potFired: false }, u, R), 'stone', 'no pot: stones only near the hearth');
      eq(digFamily({ ...base, potFired: true }, u, R), 'stone', 'away from a hearth: stones');
      assert(digFamily({ ...base, layer: 'charcoal', depth: 3, potFired: false }, u, R) === 'stone', 'charcoal band before the pot: stones');
    }
    let near = 0, coal = 0;
    for (let i = 0; i < 100; i++) {
      if (digFamily({ ...base, nearHearth: true, potFired: true }, i / 100, R) === 'sherd') near++;
      if (digFamily({ ...base, layer: 'charcoal', depth: 3, potFired: true }, i / 100, R) === 'sherd') coal++;
    }
    eq(near, 40, 'near a hearth, 0.4 of the subsoil keepsakes'); eq(coal, 75, 'the charcoal band, 0.75');
    // Rolled through: a charcoal-band dig with the pot fired gives a sherd somewhere in a season of cells.
    let sherds = 0, wrong = 0;
    for (let c = 0; c < 4000; c++) {
      const f = digFinds({ ...base, cell: c, layer: 'charcoal', depth: 3, hearth: true, nearHearth: true, potFired: true }, R, K);
      if (f.keepsake?.family === 'sherd') sherds++;
      const g = digFinds({ ...base, cell: c, layer: 'charcoal', depth: 3, hearth: true, nearHearth: true, potFired: false }, R, K);
      if (g.keepsake?.family === 'sherd') wrong++;
    }
    assert(sherds > 100, `sherds come (${sherds} in 4000)`); eq(wrong, 0, 'never before the pot');
  });

  test(G, 'the sleeping toad: winter by a pond, its seeded cell, once a year; none dug within 1.5 m until spring', async () => {
    const R = await RP, S = R.sleeper, hab = habitat(), seed = subSeed(1207, 'dig');
    const winterDay = DAYS_PER_SEASON * 3 + 2;
    const near = nearestSleeper(seed, winterDay, HABITAT_ORIGIN + 103, HABITAT_ORIGIN + 88, 20, hab, () => true, S);
    assert(near >= 0, 'a sleeper lies somewhere near the pond');
    eq(sleeperCellOf(seed, yearOf(winterDay), near, S), near, 'its own patch draws it');
    eq(sleeperAt(seed, winterDay, near, hab, [], S), true, 'a dig in its cell finds it');
    eq(sleeperAt(seed, winterDay, near, hab, [{ c: near, y: yearOf(winterDay) }], S), false, 'found once this winter');
    const [x, z] = cellCenter(near);
    assert(!!sleeperNear([{ c: near, y: yearOf(winterDay) }], x + 1.2, z, winterDay, true, S), 'within 1.5 m: something sleeps here');
    assert(!sleeperNear([{ c: near, y: yearOf(winterDay) }], x + 1.7, z, winterDay, true, S), 'past 1.5 m: dig away');
    assert(!sleeperNear([{ c: near, y: yearOf(winterDay) }], x + 0.5, z, winterDay + DAYS_PER_SEASON, false, S), 'spring frees the ground');
    // Far from any pond, never.
    const far = cellOf(HABITAT_ORIGIN + 20.5, HABITAT_ORIGIN + 20.5);
    let any = false;
    for (let c = far; c < far + 40; c++) if (sleeperAt(seed, winterDay, c, hab, [], S)) any = true;
    eq(any, false, 'none far from a pond');
    // About a third of patches by a pond hold one.
    let held = 0;
    for (let p = 0; p < 300; p++) if (sleeperCellOf(seed, p, near, S) >= 0) held++;
    assert(held > 75 && held < 135, `about 0.35 of years for one patch (${held} of 300)`);
    const back = cleanDig(JSON.parse(JSON.stringify({ ...emptyDig(), sleepers: [{ c: near, y: 0 }, { c: -1, y: 0 }] })));
    eq(JSON.stringify(back.sleepers), JSON.stringify([{ c: near, y: 0 }]), 'sleepers saved; a bad one left out');
  });

  test(G, 'the deeper season runs the same twice (the determinism job), with sherds and sleepers', async () => {
    const a = { worldSeed: 99, dig: await RP, keepsakes: await KP, land: await LP };
    const r = digCheckJob(a);
    eq(r.first, r.again, 'the same season twice'); eq(r.story, r.storyAgain, 'the story spots twice');
    assert(r.sherds >= 1 && r.sleepers >= 1, `sherds ${r.sherds}, sleepers ${r.sleepers}`);
  });

  test(G, 'the sherd family: numbers from the seed, a closed curved piece with no bad numbers, words, and its trail entry', async () => {
    const K = await KP, B = await json('world/beachcomber');
    for (const [i, r] of ['common', 'uncommon', 'rare', 'veryRare', 'lifetime'].entries()) {
      const n = FAMILIES.sherd.numbers(4000 + i, r, K), n2 = FAMILIES.sherd.numbers(4000 + i, r, K);
      eq(JSON.stringify(n), JSON.stringify(n2), `${r}: the same from its seed`);
      const m = FAMILIES.sherd.mesh(n, K);
      let bad = 0, hi = -Infinity;
      for (let v = 0; v < m.vertices.length; v++) if (!Number.isFinite(m.vertices[v])) bad++;
      for (let v = 0; v < m.count; v++) hi = Math.max(hi, m.vertices[v * 9], m.vertices[v * 9 + 2]);
      eq(bad, 0, `${r}: finite`); assert(hi < 0.1 && hi > 0.01, `${r}: hand-sized (${hi.toFixed(3)})`);
      assert(m.indices.length % 3 === 0 && Math.max(...m.indices) < m.count, `${r}: indices in range`);
      const w = FAMILIES.sherd.words(n, K);
      assert(/fired clay/.test(w) && !/genuine/i.test(w), `${r}: words "${w}"`);
    }
    let prints = 0;
    for (let s = 0; s < 2000; s++) if (FAMILIES.sherd.numbers(s, 'lifetime', K).mark === 'fingerprint') prints++;
    assert(prints > 300, `the fingerprint leans in at the top tier (${prints} of 2000)`);
    eq(B.words.familyTotal, 14, 'the family count rose by one');
    eq(B.stops.find((/** @type {any} */ s) => s.id === 'cabinet').need.families, 14, 'the cabinet needs every family');
    assert(B.words.families.sherd && B.words.marks['sherd:fingerprint'], 'trail words');
  });

  test(G, 'the cache letter: under 80 words, a keeper page once its flag is held', async () => {
    const K = await json('world/keeper-pages'), C = await json('world/keeper-cache');
    for (const [key, l] of Object.entries(C.letters)) {
      const words = /** @type {any} */ (l).body.join(' ').split(/\s+/).filter(Boolean).length;
      assert(words < 80, `${key}: ${words} words`);
      assert(!/genuine/i.test(/** @type {any} */ (l).body.join(' ')), `${key}: no "genuine"`);
    }
    const all = withCacheLetters(K, C);
    eq(keeperPagesHad(all, ['keeper:first']).length, 1, 'not had before it is found');
    eq(keeperPagesHad(all, ['keeper:first', 'keeper:cache-starter']).map((/** @type {any} */ p) => p.id).join(), 'first,cache-starter', 'had after');
    for (const land of [await LP, await L1, await L2]) assert(!!C.letters[land.story.letter], `${land.story.letter}: a letter`);
  });

  test(G, 'the toad asleep: posed on its rig, tucked, eyes shut, breathing slowly; never a blink', async () => {
    const T = await json('species/toad');
    const prims = bodyFor('toad', T.body, 0).prims;
    const skel = skeletonOf('toad', prims);
    const tip = (/** @type {string} */ s) => prims.find((/** @type {any} */ q) => q.bone === `foot.${s}`).b;
    const legs = legsOf(skel, { l: tip('l'), r: tip('r') });
    const eye = skel.findIndex((b) => b.name === 'eye.l'), torso = skel.findIndex((b) => b.name === 'torso');
    /** @type {number[]} */ const breaths = [];
    for (let t = 0; t < 12; t += 0.25) {
      const m = toadSleepMoves(skel, legs, 7, t, T.motion);
      assert(m[eye]?.s?.[1] === T.motion.sleep.eyeShut, 'eyes shut');
      assert(m[legs[0].thigh]?.q && m[legs[0].shank]?.q, 'hind legs posed by IK');
      breaths.push(m[torso]?.s?.[0] ?? 1);
      const out = new Float32Array(MAX_BONES * 16);
      poseSkeleton(skel, m, out, 0);
      assert(out.every((v) => Number.isFinite(v)), 'its bones pose to finite matrices');
    }
    assert(Math.max(...breaths) > Math.min(...breaths), 'it breathes');
  });
}
