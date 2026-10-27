// @ts-check
// Plant rules (docs/future/13 section 5, P2a) for tools/unit-tests.html: how a picked, thin or
// drowned plant looks (A1); season words and winter picks (A2); held ground, clearance and the
// shared budget (A3); volunteers with a cause (A4); burying and undo under the bush rule (A5); the
// notices and journal line (A6); look, don't pick (A7); the brush rings.

import { plantLooks, pickShares } from '../src/world/growth/looks.js';
import { packLooks } from '../src/render/passes/flora.js';
import { loadShader } from '../src/core/gpu.js';
import { outOfSeasonLine, pickable, partsOf, windowsOf } from '../src/world/gather/plants.js';
import { heldMask, habitatCell, HABITAT_CELLS, HABITAT_ORIGIN } from '../src/world/growth/habitat.js';
import { gatherClear } from '../src/world/growth/rules.js';
import { causeOf } from '../src/world/growth/volunteers.js';
import { buryUnder, buryDepth, seatHeight, restoreBuried, removeBuried } from '../src/world/growth/bury.js';
import { buryRings, RAISING_MODES } from '../src/world/growth/rings.js';
import { buriedNotice, buriedLine } from '../src/world/journal/buried.js';
import { heightFromTiles, tilesArea } from '../src/world/terrain/undo.js';
import { TILE_CELLS, WORLD_ORIGIN, CELL, quantize } from '../src/world/terrain/grid.js';
import { coarseStep, initialGrowth } from '../src/world/growth/coarse.js';
import { initialWorldState, makeEnv } from '../src/sim/tick.js';
import { shoreline, at, loadRecipes } from './unit-tests-growth.js';
import { handfulsBySeason, restAfterPicks } from './gather-lab-model.js';

const G = 'plant rules';

/** @param {string} path */
const json = (path) => fetch(new URL(`../recipes/${path}.json`, import.meta.url)).then((r) => r.json());

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addPlantRulesTests(test, assert, eq) {
  // Within float32 rounding (the packed looks are a Float32Array).
  const near = (/** @type {number} */ a, /** @type {number} */ b, /** @type {string} */ msg) => assert(Math.abs(a - b) < 1e-6, `${msg}: expected ${b}, got ${a}`);

  test(G, 'looks: one full pick reads 1, half a pick 0.5, a whole plant 0', async () => {
    const gather = await json('world/gather');
    const takes = pickShares(gather);
    const take = takes.get('reeds');
    assert(take && take > 0, 'reeds give down, so they have a pick share');
    const rec = { growth: { lowHours: 72, drownHours: 48 } };
    const L = { thinRampH: 24 };
    const full = { size: 0.95, best: 0.95, low: 0, drown: 0 };
    eq(plantLooks(full, rec, L, take)[0], 0, 'whole');
    near(plantLooks({ ...full, size: 0.95 * (1 - take) }, rec, L, take)[0], 1, 'one pick');
    near(plantLooks({ ...full, size: 0.95 * (1 - take / 2) }, rec, L, take)[0], 0.5, 'half a pick');
    eq(plantLooks({ ...full, size: 0.2 }, rec, L, take)[0], 1, 'never past 1');
    eq(plantLooks({ ...full, size: 0.5 }, rec, L, undefined)[0], 0, 'a species with no gather part never looks picked');
    return `reeds take ${take}`;
  });

  test(G, 'looks: thin ramps over thinRampH after lowHours and hides the picked look; drowned is drown over drownHours', () => {
    const rec = { growth: { lowHours: 72, drownHours: 48 } };
    const L = { thinRampH: 24 };
    const p = { size: 0.5, best: 0.9, low: 72, drown: 0 };
    eq(plantLooks(p, rec, L, 0.33)[1], 0, 'not thin at lowHours');
    near(plantLooks({ ...p, low: 84 }, rec, L, 0.33)[1], 0.5, 'half way up the ramp');
    eq(plantLooks({ ...p, low: 200 }, rec, L, 0.33)[1], 1, 'fully thin');
    eq(plantLooks({ ...p, low: 84 }, rec, L, 0.33)[0], 0, 'a thin plant does not also look picked');
    near(plantLooks({ ...p, drown: 12 }, rec, L, 0.33)[2], 0.25, 'drowned a quarter');
    eq(plantLooks({ ...p, drown: 99 }, rec, L, 0.33)[2], 1, 'drowned never past 1');
  });

  test(G, 'the draw numbers: 12 floats a plant, lib-flora reads three vec4f, the looks pack in its order', async () => {
    const lib = await loadShader('lib-flora');
    assert(/const FLORA_STRIDE: u32 = 3u;/.test(lib), 'lib-flora reads three vec4f a plant');
    assert(/@group\(2\) @binding\(4\) var<uniform> floraLooks/.test(lib), 'the looks at binding 4');
    for (const s of ['flora-draw', 'flora-iris', 'flora-thrift', 'flora-shrub', 'flora-lilies', 'flora-pondweed']) {
      const src = await loadShader(s);
      assert(!/plants\[ii \* 2u/.test(src), `${s} no longer reads two vec4f a plant`);
    }
    const growth = await json('world/growth');
    const L = growth.looks;
    const f = packLooks(L);
    eq(f.length, 12, 'three vec4f');
    near(f[0], L.pickHeads, 'pick.x'); near(f[1], L.pickTrim, 'pick.y'); near(f[2], L.cutFrom, 'pick.z'); near(f[3], L.cutBlades, 'pick.w');
    near(f[4], L.thinPale, 'thin.x'); near(f[5], L.thinSparse, 'thin.y');
    near(f[8], L.drownLean, 'drown.x'); near(f[9], L.drownDark, 'drown.y'); near(f[10], L.drownDroop, 'drown.z');
    eq(packLooks(undefined)[0], 0, 'no looks recipe: no look');
  });

  // ---- A2: winter and season words, winter picks ----
  test(G, 'season words: a dormant plant rests; out of season says when its part comes; winter picks open', async () => {
    const gather = await json('world/gather');
    eq(outOfSeasonLine({ stage: 5 }, 'thrift', 'flowers', gather, 3.5), gather.words.resting, 'dormant');
    const withies = outOfSeasonLine({ stage: 3 }, 'willow', 'withies', gather, 1.5);
    eq(withies, `${gather.words.nothingNow} The withies are ready in early winter.`, 'summer');
    eq(outOfSeasonLine({ stage: 3 }, 'willow', 'withies', gather, 2.85), `${gather.words.nothingNow} The withies are ready in a few days.`, 'two days before winter');
    eq(outOfSeasonLine({ stage: 3 }, 'reeds', 'down', gather, 1.5), `${gather.words.nothingNow} The down comes in early autumn.`, 'summer reeds');
    // Matt's click test: autumn day 6 shows brown seed heads, and the down is there to gather.
    const reeds = { growth: { stages: { matureSize: 0.6 } } };
    eq(pickable({ id: 3, sp: 'reeds', size: 0.9, best: 0.9 }, 'down', { flora: reeds, pos: 2 + 6.4 / 14 }, gather).ok, true, 'reed down on autumn day 6');
    const flora = { growth: { stages: { matureSize: 0.6 } } };
    const bush = { id: 7, sp: 'willow', size: 0.9, best: 0.9 };
    eq(pickable(bush, 'withies', { flora, pos: 3.5 }, gather).ok, true, 'willow withies in winter');
    eq(pickable(bush, 'bark', { flora, pos: 3.5 }, gather).ok, true, 'willow bark in winter');
    eq(pickable(bush, 'withies', { flora, pos: 1.5 }, gather).why, 'season', 'no withies in summer');
    for (const pos of [0.2, 1.2, 2.2, 3.2]) eq(pickable({ ...bush, sp: 'gorse' }, 'flowers', { flora, pos }, gather).ok, true, `gorse flowers at ${pos}`);
    return withies;
  });

  test(G, 'every half day from autumn to the end of spring: gathering opens and closes where the words say, and they never name now as still to come', async () => {
    const gather = await json('world/gather');
    const W = gather.words;
    /** @type {Record<string, any>} */
    const floraOf = { willow: await json('flora/willow'), reeds: await json('flora/reeds'), gorse: await json('flora/gorse'), nettle: await json('flora/nettle') };
    const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
    /** @type {string[]} */ const opened = [];
    // Nettle tops (P2b) have two windows, spring and again in autumn.
    for (const [sp, part] of [['willow', 'withies'], ['willow', 'bark'], ['reeds', 'down'], ['gorse', 'flowers'], ['nettle', 'tops']]) {
      const flora = floraOf[sp];
      const ws = windowsOf(gather.plants.parts[`${sp}.${part}`].window);
      let days = 0;
      // Autumn day 0 to spring day 13, every game hour on the hour of noon and of midnight.
      for (let h = 0; h < 3 * 14 * 2; h++) {
        const pos = (2 + h / 28) % 4;
        const day = `${SEASONS[Math.floor(pos)]} day ${Math.floor((pos % 1) * 14)}`;
        const plant = { id: 31, sp, size: 0.95, best: 0.95, stage: 3 };
        const r = pickable(plant, part, { flora, pos }, gather);
        const inside = ws.some((w) => (w[1] > w[0] ? pos >= w[0] && pos < w[1] : pos >= w[0] || pos < w[1]));
        eq(r.ok, inside, `${sp} ${part} on ${day}`);
        if (r.ok) { if (h % 2 === 0) days++; continue; }
        const line = outOfSeasonLine(plant, sp, part, gather, pos);
        const nowThird = W.when[Math.floor(pos * 3) % 12];
        assert(!line.includes(`${nowThird}.`), `${sp} ${part} on ${day}: "${line}" names now as still to come`);
        const named = SEASONS.find((s) => line.includes(` ${s}.`) || line.includes(` ${s} `));
        if (named === SEASONS[Math.floor(pos)]) assert(line.includes('later this'), `${sp} ${part} on ${day}: "${line}"`);
      }
      opened.push(`${sp} ${part} ${days} of 42 days`);
    }
    // Every day of winter, withies and bark; reed down all autumn and winter but the last day or so.
    assert(opened[0].startsWith('willow withies 14 ') && opened[1].startsWith('willow bark 14 '), opened.join('; '));
    // Nettle tops: most of autumn, then most of spring; after autumn's, the words point to spring.
    assert(opened[4].startsWith('nettle tops 2'), opened.join('; '));
    const afterAutumn = outOfSeasonLine({ stage: 3 }, 'nettle', 'tops', gather, 2.9);
    assert(/spring/.test(afterAutumn), `nettle tops at the end of autumn: "${afterAutumn}"`);
    const summer = outOfSeasonLine({ stage: 3 }, 'nettle', 'tops', gather, 1.5);
    assert(/autumn/.test(summer), `nettle tops in summer: "${summer}"`);
    return opened.join('; ');
  });

  // ---- A3: caps, clear ground, the shared budget ----
  test(G, 'held ground: a stone holds its square, a log holds the squares along its length, nothing else', () => {
    const x = HABITAT_ORIGIN + 50.5, z = HABITAT_ORIGIN + 50.5;
    const held = heldMask([{ kind: 'stone', x, z, yaw: 0, size: 0.6 }, { kind: 'log', x: x + 10, z, yaw: 0, size: 0.3, length: 3 }]);
    eq(held[habitatCell(x, z)], 1, 'under the stone');
    eq(held[habitatCell(x + 2, z)], 0, '2 m from the stone');
    for (const dz of [-1.2, 0, 1.2]) eq(held[habitatCell(x + 10, z + dz)], 1, `along the log (${dz} m)`);
    eq(held[habitatCell(x + 10, z + 2.6)], 0, 'past the log\'s end');
    eq(held[habitatCell(x + 11.5, z)], 0, 'beside the log');
  });

  test(G, 'gather plants keep clearM from any plant, stay off held squares and out of thick rushes', () => {
    const N = HABITAT_CELLS;
    const hab = /** @type {any} */ ({ n: N, held: new Uint8Array(N * N) });
    const x = HABITAT_ORIGIN + 60.5, z = HABITAT_ORIGIN + 60.5;
    const plants = [{ x: x + 0.3, z, sp: 'reeds' }];
    const index = new Map([[habitatCell(x + 0.3, z), [0]]]);
    const GA = { clearM: 0.45, rushBlock: 0.5 };
    eq(gatherClear(hab, x, z, index, plants, GA, null), false, '0.3 m from a reed');
    eq(gatherClear(hab, x - 0.2, z, index, plants, GA, null), true, '0.5 m from it');
    eq(gatherClear(hab, x - 0.2, z, index, plants, GA, null, [{ x: x - 0.4, z }]), false, 'a newborn this hour counts');
    hab.held[habitatCell(x - 0.2, z)] = 1;
    eq(gatherClear(hab, x - 0.2, z, index, plants, GA, null), false, 'held');
    const rush = new Uint8Array(N * N);
    rush[habitatCell(x - 3, z)] = 128;
    eq(gatherClear(hab, x - 3, z, index, plants, GA, rush), false, 'rushes at half cover');
    rush[habitatCell(x - 3, z)] = 100;
    eq(gatherClear(hab, x - 3, z, index, plants, GA, rush), true, 'thin rushes');
  });

  test(G, 'the shared budget stops a gather plant spreading; others are unchanged', async () => {
    const base = await loadRecipes();
    const herb = { ...base.flora.gorse, id: 'herb', tags: ['gather'], index: 99,
      spread: { kind: 'rhizome', everyH: 1, distanceM: [0.6, 0.9], minSuit: 0.1, minSpacingM: 0.45, maxCount: 999 } };
    const run = (/** @type {number} */ budget) => {
      const recipes = { ...base, growth: { ...base.growth, gather: { budget, clearM: 0.45, rushBlock: 0.5 }, volunteers: { order: [] } }, flora: { ...base.flora, herb } };
      const hab = shoreline();
      const env = { ...makeEnv(4242, recipes), habitat: () => hab };
      const [x0] = at('dry');
      const plants = [0, 1, 2, 3].map((n) => ({ id: 100 + n, sp: 'herb', x: x0, z: HABITAT_ORIGIN + 20 + n * 8, age: 2000, size: 0.95, best: 0.95, stage: 3, low: 0, drown: 0, last: 0 }));
      let st = { ...initialWorldState(4242), growth: { ...initialGrowth(), starterDone: true, plants, nextId: 200 } };
      for (let h = 1000; h < 1040; h++) st = coarseStep(st, h, env).state;
      return st.growth.plants.filter((/** @type {any} */ p) => p.sp === 'herb').length;
    };
    const capped = run(6), roomy = run(40);
    eq(capped, 6, 'spread stops at the budget');
    assert(roomy > 6, `with room it spreads on (${roomy})`);
    return `budget 6: ${capped}; budget 40: ${roomy}`;
  });

  // ---- A4: volunteers with a cause ----
  test(G, 'causes: nettles wait for 3 lit days, then land only within 4 m of the ring; land plants wait', () => {
    const N = HABITAT_CELLS;
    const rec = { volunteer: { cause: { kind: 'fire', reachM: 4, days: 3 } } };
    const fx = HABITAT_ORIGIN + 80.5, fz = HABITAT_ORIGIN + 80.5;
    eq(causeOf(rec, /** @type {any} */ ({ n: N })), false, 'no ring');
    eq(causeOf(rec, /** @type {any} */ ({ n: N, fire: { x: fx, z: fz, days: 2 } })), false, 'two lit days');
    const f = causeOf(rec, /** @type {any} */ ({ n: N, fire: { x: fx, z: fz, days: 3 } }));
    assert(typeof f === 'function', 'three lit days: a filter');
    const ok = /** @type {(k: number) => boolean} */ (f);
    eq(ok(habitatCell(fx + 3, fz)), true, '3 m off');
    eq(ok(habitatCell(fx + 5, fz)), false, '5 m off');
    eq(causeOf({ volunteer: { cause: { kind: 'perch' } } }, /** @type {any} */ ({ n: N })), false, 'perch waits');
    eq(causeOf({}, /** @type {any} */ ({ n: N })), null, 'no cause: no filter');
    const camp = /** @type {(k: number) => boolean} */ (causeOf({ volunteer: { cause: { kind: 'camp', reachM: 8 } } }, /** @type {any} */ ({ n: N, pad: { x: fx, z: fz, r: 4 } })));
    eq(camp(habitatCell(fx + 11, fz)), true, '7 m past the pad edge'); eq(camp(habitatCell(fx + 13, fz)), false, '9 m past it');
  });

  // ---- A5: burying and undo, with the bush rule ----
  test(G, 'burying: a herb at 0.14 m stays and at 0.16 m goes; a willow re-seats under a side raise and goes past 0.75 m', async () => {
    const { flora, growth } = await loadRecipes();
    const B = growth.bury;
    const area = { x0: -100, z0: -100, x1: 100, z1: 100 };
    const flat = () => 1;
    const herb = { id: 1, sp: 'thrift', x: 0, z: 0, size: 0.9, best: 0.9, age: 900, stage: 3, low: 0, drown: 0, last: 0 };
    eq(buryUnder([herb], flora, B, flat, () => 1.14, area).buried.length, 0, '0.14 m');
    eq(buryUnder([herb], flora, B, flat, () => 1.16, area).buried.length, 1, '0.16 m');
    const willow = { ...herb, id: 2, sp: 'willow', size: 1 };
    near(buryDepth(flora.willow, 1, B), 0.75, 'a full willow\'s depth');
    // A raise of 0.5 m lapping the east side of its base: it stays, on the higher seat.
    const side = (/** @type {number} */ x) => (x > 0.1 ? 1.5 : 1);
    eq(buryUnder([willow], flora, B, flat, side, area).buried.length, 0, 'side raise');
    assert(seatHeight(willow, flora.willow, B, side) > 1.3, 'the seat rose with the raised side');
    eq(seatHeight(willow, flora.willow, B, flat), 1, 'flat ground: the middle');
    eq(buryUnder([willow], flora, B, flat, () => 1.8, area).buried.length, 1, '0.8 m: under whole');
    eq(buryUnder([willow], flora, B, flat, () => 1.6, area).buried.length, 0, '0.6 m: rides up');
    eq(buryUnder([herb], flora, B, flat, () => 2, { x0: 5, z0: 5, x1: 9, z1: 9 }).buried.length, 0, 'outside the stroke');
  });

  test(G, 'undo brings buried plants back exactly; redo takes them again; a gentle natural slope keeps the middle', async () => {
    const { flora, growth } = await loadRecipes();
    const plants = [1, 2, 3].map((id) => ({ id, sp: 'iris', x: id, z: 0, age: 400 + id, size: 0.7 + id / 100, best: 0.8, stage: 3, low: 2, drown: 0, last: 9 }));
    const r = buryUnder(plants, flora, growth.bury, () => 0, (x) => (x > 1.5 ? 1 : 0), { x0: -10, z0: -10, x1: 10, z1: 10 });
    eq(r.buried.map((p) => p.id).join(), '2,3', 'two under');
    const back = restoreBuried(r.kept, r.buried);
    eq(JSON.stringify(back), JSON.stringify(plants), 'back exactly, in id order');
    eq(restoreBuried(back, r.buried), back, 'nothing doubles');
    eq(removeBuried(back, r.buried).map((p) => p.id).join(), '1', 'redo');
    const slope = (/** @type {number} */ x) => x * 0.3;   // about 17 degrees
    near(seatHeight({ x: 0, z: 0, size: 1 }, flora.willow, growth.bury, slope), 0, 'a natural slope keeps the middle');
  });

  test(G, 'a stroke\'s tiles give heights before and after, and the ground outside falls back', () => {
    const T = TILE_CELLS;
    const h = new Uint16Array(T * T).fill(quantize(2));
    const tile = { tx: 10, tz: 10, h, m: new Uint8Array(T * T * 4) };
    const sample = heightFromTiles([tile], () => -1);
    const x = WORLD_ORIGIN + (10 * T + 3.5) * CELL, z = WORLD_ORIGIN + (10 * T + 5.5) * CELL;
    near(Math.round(sample(x, z) * 1000) / 1000, 2, 'inside the tile');
    eq(sample(x - T * CELL, z), -1, 'outside it');
    const a = tilesArea([tile]);
    near(a.x1 - a.x0, T * CELL, 'the area is one tile wide');
  });

  // ---- A6: notices and the journal line ----
  test(G, 'notices: three gather plants in a stroke name the kind and its place; the session notice once; the journal line', async () => {
    const words = await json('world/journal');
    const B = (await json('world/growth')).bury;
    const p = { gatherCount: 3, bySpecies: { iris: { count: 3, x: 0, z: 0, gather: true }, reeds: { count: 1, x: 0, z: 0, gather: false } } };
    const r = buriedNotice(p, { count: 0, shown: false }, B, null, words);
    assert(r.text && r.text.includes('yellow flag iris') && r.text.includes(words.species.iris.place) && r.text.includes('one other plant') && r.text.endsWith('Undo brings them back.'), r.text ?? 'none');
    eq(buriedNotice({ ...p, gatherCount: 2 }, { count: 0, shown: false }, B, null, words).text, null, 'two: no notice');
    const s = buriedNotice({ ...p, gatherCount: 2 }, { count: 6, shown: false }, B, null, words);
    eq(s.text, words.buried.session, 'the session notice at eight');
    eq(buriedNotice({ ...p, gatherCount: 2 }, s.session, B, null, words).text, null, 'only once a session');
    const line = buriedLine('iris', 0, 0, null, words);
    assert(line === `The yellow flag iris ${words.species.iris.place}, went under the new ground.`, String(line));
    return r.text;
  });

  // ---- A7: look, don't pick ----
  test(G, 'look, don\'t pick: iris and marsh marigold are look-only, and their pages learn why', async () => {
    const gather = await json('world/gather');
    const words = await json('world/journal');
    for (const sp of ['iris', 'marigold']) {
      assert(gather.lookOnly.includes(sp), `${sp} is look-only`);
      assert(gather.words.refused[sp], `${sp} has a refusal line`);
      assert(words.species[sp].likes.some((/** @type {any} */ l) => l.learn.includes('pick:refused')), `${sp}'s page learns from pick:refused`);
    }
    assert(partsOf('iris', gather).join() === 'seed' && partsOf('marigold', gather).join() === 'seed', 'nothing to pick, only their seed to save (P2g)');
  });

  // ---- A8: the gather lab's model ----
  test(G, 'gather lab: nothing out of season, rain shortens the rest, the same run twice', async () => {
    const gather = await json('world/gather');
    const gorse = await json('flora/gorse'), willow = await json('flora/willow');
    const w = handfulsBySeason('willow', 'withies', willow, gather);
    eq(w.dry[1], 0, 'no withies in summer');
    assert(w.dry[3] > 0, 'withies in winter');
    const dry = restAfterPicks('gorse', 'flowers', gorse, gather, 1.5, 0), wet = restAfterPicks('gorse', 'flowers', gorse, gather, 1.5, 1);
    assert(dry.inARow >= 1 && dry.restH !== null && wet.restH !== null && wet.restH < dry.restH, `gorse rests ${dry.restH} h dry, ${wet.restH} h in rain`);
    eq(JSON.stringify(handfulsBySeason('gorse', 'flowers', gorse, gather)), JSON.stringify(handfulsBySeason('gorse', 'flowers', gorse, gather)), 'the same twice');
    return `gorse: ${dry.inARow} in a row, rest ${dry.restH} h dry, ${wet.restH} h wet`;
  });

  // ---- brush rings ----
  test(G, 'brush rings: every plant the brush would cover, shrubs too, nearest first, at most twelve', async () => {
    const { flora, growth } = await loadRecipes();
    const plants = Array.from({ length: 20 }, (_, i) => ({ id: i, sp: i % 2 ? 'willow' : 'thrift', x: i * 0.1, z: 0, size: 1 }));
    const rings = buryRings(plants, flora, { x: 0, z: 0, radius: 1, visible: true }, growth.bury);
    eq(rings.length, 12, 'at most twelve');
    eq(rings[0][0], 0, 'nearest first');
    assert(rings.every((r) => r[3] === growth.bury.ringOpacity), 'soft');
    eq(buryRings(plants, flora, { x: 50, z: 0, radius: 1, visible: true }, growth.bury).length, 0, 'none far off');
    eq(buryRings(plants, flora, { x: 0, z: 0, radius: 1, visible: false }, growth.bury).length, 0, 'none with no brush');
    assert(RAISING_MODES.includes('raise') && !RAISING_MODES.includes('lower') && !RAISING_MODES.includes('cut'), 'only raising modes');
  });
}
