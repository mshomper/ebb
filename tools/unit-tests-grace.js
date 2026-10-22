// @ts-check
// A9 for tools/unit-tests.html (docs 07, 12, 13): a settled group whose pool starts failing it grows
// uneasy, says why, and waits leaveGraceDays before it thins or moves on; it settles again if the
// pool comes right; a pool that is gone still sends it away at once. And catch-up's habitat follows
// the season day by day, so a rain-fed pond lowers for the creatures while you are away too.

import { swarmStep, whyFailing } from '../src/world/creatures/swarms.js';
import { habitatByDay, habitatDayOf } from '../src/world/growth/habitat-days.js';
import { buildIslandModel } from '../src/world/island-model.js';
import { landmarks } from '../src/world/terrain/landform.js';
import { waterCellOf } from '../src/world/water/grid.js';
import { WORLD_CELLS } from '../src/world/terrain/grid.js';
import { subSeed } from '../src/core/rng.js';
import { initialJournal, blank } from '../src/world/journal/observe.js';
import { describe } from '../src/world/journal/describe.js';

const G = 'grace';
const get = (/** @type {string} */ p) => fetch(`../recipes/${p}.json`).then((r) => r.json());

/**
 * A world with one settled group of dragonflies in pool 1, whose best square is 5 of a 4 x 4 grid.
 * @param {any} rec @param {any} pool
 */
function world(rec, pool) {
  const n = 4;
  return {
    seasons: { index: 1, dormant: {} },
    ecology: { dragonflies: { score: new Uint8Array(n * n).fill(200), pools: [{ id: 1, area: 30, room: 30, deepCm: 40, deepK: 5, best: 5, groups: [1], weed: 0, low: 'water', ...pool }] } },
    creatures: { dragonflies: { phase: 'settled', rightFor: 0, right: true, waited: 0, cooldownUntil: -1, lastLeft: -1, happyFor: 0, happy: false, dormant: false,
      arrivals: 1, nextId: 2, groups: [{ id: 1, k: 5, x: 0, z: 0, count: 6, mood: 0.8, low: 0, since: 0 }] } },
  };
}

/** Run hours; returns the state and every event name with its hour. @param {any} s @param {any} rec @param {number} from @param {number} hours */
function run(s, rec, from, hours) {
  /** @type {string[]} */ const seen = [];
  for (let h = from; h < from + hours; h++) {
    const r = swarmStep(s, h, { seed: 7 }, rec);
    s = r.state;
    for (const e of r.events) seen.push(`${e.name}@${h}${e.payload.why ? `:${e.payload.why}` : ''}`);
  }
  return { s, seen };
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addGraceTests(test, assert, eq) {
  test(G, 'a pond whose shallow margin has dried: uneasy at once, gone only after the grace', async () => {
    const rec = await get('species/dragonfly');
    const A = rec.ecology.arrival;
    eq(A.leaveGraceDays, 3, 'three days of grace');
    // The margin dried in the heat: the pond no longer fits them (2 m² of margin left, 4 wanted).
    const dried = { bestScore: 0.6, fit: false, fish: false, margin: 2 };
    eq(whyFailing(dried, rec.ecology), 'margin', 'why: the margin');
    eq(whyFailing({ ...dried, fish: true }, rec.ecology), 'fish', 'why: fish');
    eq(whyFailing({ bestScore: 0.2, low: 'shelter' }, rec.ecology), 'shelter', 'why: the weakest need');
    const start = 24 * 20;
    const { s, seen } = run(world(rec, dried), rec, start, 24 * A.leaveGraceDays - 1);
    eq(seen.filter((x) => x.startsWith('creature:uneasy')).join(), `creature:uneasy@${start}:margin`, 'uneasy once, at once, saying why');
    assert(!seen.some((x) => x.startsWith('creature:left') || x.startsWith('creature:thinned')), `nobody goes during the grace: ${seen.join(' ')}`);
    eq(s.creatures.dragonflies.groups[0].count, 6, 'all six still there');
    const after = run(s, rec, start + 24 * A.leaveGraceDays - 1, 24 * 4);
    assert(after.seen.some((x) => x.startsWith('creature:thinned') || x.startsWith('creature:left')), 'after the grace they thin and go');
    const left = after.seen.find((x) => x.startsWith('creature:left'));
    assert(!left || left.endsWith(':margin'), `they leave saying why: ${left}`);
    return after.seen.filter((x) => !x.startsWith('creature:uneasy')).join(', ');
  });

  test(G, 'a pond put right within the grace: they settle again and stay', async () => {
    const rec = await get('species/dragonfly');
    const start = 24 * 20;
    let { s, seen } = run(world(rec, { bestScore: 0.6, fit: false, fish: false, margin: 2 }), rec, start, 30);
    assert(seen[0]?.startsWith('creature:uneasy'), 'uneasy first');
    // The player dug the margin out again: the pond fits.
    s = { ...s, ecology: { dragonflies: { ...s.ecology.dragonflies, pools: s.ecology.dragonflies.pools.map((/** @type {any} */ p) => ({ ...p, fit: true, margin: 6 })) } } };
    const r = run(s, rec, start + 30, 24 * 6);
    assert(r.seen.some((x) => x.startsWith('creature:eased')), `eased: ${r.seen.join(' ')}`);
    assert(!r.seen.some((x) => x.startsWith('creature:left')), 'nobody left');
    eq(r.s.creatures.dragonflies.groups[0].uneasy, undefined, 'no longer uneasy');
  });

  test(G, 'a pond filled in or drained: they go at once, as before', async () => {
    const rec = await get('species/dragonfly');
    const s = world(rec, {});
    s.ecology.dragonflies.pools = [];
    const { seen } = run(s, rec, 24 * 20, 1);
    assert(seen.some((x) => x.startsWith('creature:left')), `gone at once: ${seen.join(' ')}`);
  });

  test(G, 'every species with a grace has words for each reason, and a note when it settles again', async () => {
    const words = await get('world/journal');
    for (const [id, sp] of [['dragonfly', 'dragonflies'], ['damselfly', 'damselflies'], ['minnow', 'minnows']]) {
      const rec = await get(`species/${id}`);
      assert(rec.ecology.arrival.leaveGraceDays > 0, `${id} has a grace`);
      const U = words.species[sp].uneasy;
      assert(U?.habitat && U.water && U.food && U.shelter, `${sp}: words for each need`);
      if (rec.ecology.pond) assert(U.margin && U.shallow && U.fish, `${sp}: words for its pond rule`);
      assert(words.species[sp].notes.eased, `${sp}: a note when it settles again`);
    }
    assert(words.islandNote.showMeKinds.includes('uneasy'), 'an uneasy note offers Show me');
  });

  test(G, 'their page says why while they are uneasy, in summer words in summer', async () => {
    const words = await get('world/journal');
    const rec = await get('species/dragonfly');
    const j = initialJournal(0);
    j.species.dragonflies = { ...blank(), ever: true, seen: true };
    const s = world(rec, { bestScore: 0.6, fit: false, fish: false, margin: 2 });
    const calm = describe(j, 'dragonflies', s, null, words, 500).status;
    assert(!calm.includes('restless'), `no word of it while all is well: ${calm}`);
    s.creatures.dragonflies.groups[0] = { ...s.creatures.dragonflies.groups[0], uneasy: 480, why: 'margin' };
    const uneasy = describe(j, 'dragonflies', s, null, words, 500).status;
    assert(uneasy.includes(words.species.dragonflies.uneasy.marginSummer), `the page says why: ${uneasy}`);
    return uneasy;
  });

  test(G, "catch-up's habitat follows the season: a rain-fed marsh is lower in late summer than in spring", async () => {
    const [terrain, water, growth, land] = await Promise.all([get('world/terrain'), get('world/water'), get('world/growth'), get('land/two-ponds')]);
    const seed = 1;
    const m = buildIslandModel({ seed, terrain, land, water, growth });
    const springs = landmarks(land, subSeed(seed, 'terrain')).springs.map((p) => ({ cellX: waterCellOf(p.x), cellY: waterCellOf(p.z), rateLps: p.rateLps }));
    const byDay = habitatByDay({
      summary: { heightQ: m.heightQ, rect: m.summary.rect, springs, params: { ...water.summary, manningN: water.sim.manningN }, tide: water.tide },
      habitat: { material: m.material, materialCells: WORLD_CELLS, params: growth.habitat, heightQ: m.heightQ, baseQ: m.heightQ },
    });
    eq(habitatDayOf(24), 0, 'midnight still reads the day before');
    eq(habitatDayOf(25), 1, 'and the next hour the new day');
    const sum = (/** @type {any} */ hab) => hab.depthCm.reduce((/** @type {number} */ a, /** @type {number} */ b) => a + b, 0);
    const spring = byDay(24 * 5 + 10), late = byDay(24 * 25 + 10);
    eq(byDay(24 * 5 + 12), spring, 'one habitat a day, kept');
    assert(sum(late) < sum(spring), `the marshes stand lower for the creatures in late summer (${sum(spring)} to ${sum(late)} cm summed)`);
    return `water summed over the island: ${sum(spring)} cm in spring, ${sum(late)} cm in late summer`;
  });
}
