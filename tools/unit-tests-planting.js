// @ts-check
// Planting from below (P2g) for tools/unit-tests.html: the seed tin also holds the pack's saved seed,
// seed balls, clumps and withies; a seed ball's cluster lies the same way every time; a grown plant
// goes in through the growth system's own planting path at its size, a cutting under its island cap,
// a ball on slightly poorer ground; a plant lifts out whole; a clump keeps its size in the pack; seed
// and clumps go to the hamper; seed balls take any saved seed; seed saving is offered on look-only
// plants; the gestures are there. Pure; no page needed.

import { tinItems, ballSpots, itemLabel } from '../src/world/sowing/model.js';
import { plantSeed, liftPlant } from '../src/world/growth/coarse.js';
import { initialWorldState, makeEnv } from '../src/sim/tick.js';
import { shoreline, at, loadRecipes } from './unit-tests-growth.js';
import { emptyPack, noteClump, takeClump, cleanPack } from '../src/world/pack/model.js';
import { routeOf } from '../src/world/pack/route.js';
import { layout, cleanCook, givesOf } from '../src/world/camp/making.js';
import { partsOf, pickable } from '../src/world/gather/plants.js';
import { gestureLength, actLength } from '../src/world/figure/acts.js';
import { itemIconFor } from '../src/ui/icons/item-registry.js';

const G = 'planting';
const json = (/** @type {string} */ p) => fetch(`../${p}`).then((r) => r.json());

/** @type {import('./unit-tests-parallel.js').AddTests} */
export function addPlantingTests(test, assert, eq) {
  test(G, 'G1-G5: the tin holds saved seed, seed balls, clumps (one a pouch) and withies from the pack', async () => {
    const R = await json('recipes/world/sowing.json');
    const tin = tinItems(R, [{ kind: 'campion.seed', handfuls: 2, name: 'Sea campion seed' }, { kind: 'campion.seed', handfuls: 3 }, { kind: 'iris.clump', handfuls: 3, name: 'Yellow flag iris, lifted' },
      { kind: 'thrift.ball', handfuls: 1, name: 'Sea thrift seed balls' }, { kind: 'willow.withies', handfuls: 2 }, { kind: 'pebbles', handfuls: 3 }]);
    const mine = tin.filter((i) => !i.endless);
    eq(mine.map((i) => `${i.kind}:${i.species}:${i.left}`).join(), 'seed:campion:5,clump:iris:1,ball:thrift:1,cutting:willow:2', 'two campion pouches as one, a clump a pouch, a ball, two withies');
    eq(itemLabel(R, mine[3]), 'A willow withy, half a pouch', 'a withy by its own name');
    for (const i of mine) assert(itemIconFor(/** @type {string} */ (i.from)), `${i.from} has a drawn glyph`);
  });

  test(G, 'G5: a seed ball lands as the same small cluster every time, round the spot', async () => {
    const a = ballSpots(12.3, -4.56, 3, 0.5), b = ballSpots(12.3, -4.56, 3, 0.5), c = ballSpots(2, 9, 3, 0.5);
    eq(JSON.stringify(a), JSON.stringify(b), 'the same spot, the same cluster');
    assert(JSON.stringify(a) !== JSON.stringify(c), 'another spot lies another way');
    for (const [x, z] of a) assert(Math.abs(Math.hypot(x - 12.3, z + 4.56) - 0.5) < 1e-9, 'each seed the spacing from the middle');
    assert(Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]) > 0.8, 'and well apart from each other');
  });

  test(G, 'G2, G3, G5: grown plants go in through the planting path; a cutting keeps the island cap; a ball takes poorer ground', async () => {
    const recipes = await loadRecipes();
    const env = { ...makeEnv(9, recipes), habitat: shoreline };
    const s0 = initialWorldState(9);
    const [bx, bz] = at('bank');
    const r = plantSeed(s0, 'iris', bx, bz, env, { size: 0.55, best: 0.8 });
    assert(r.ok, `a clump of iris set on the bank (${r.reason ?? ''})`);
    const p = r.state.growth.plants.at(-1);
    eq([p.size, p.best, p.stage].join(), '0.55,0.8,2', 'at the size it was lifted, its best kept, young');
    assert(p.age >= recipes.flora.iris.growth.stages.sproutH, 'past sprouting');
    const lifted = liftPlant(r.state, p.id);
    eq(lifted.plant?.id, p.id, 'lifted whole');
    eq(lifted.state.growth.plants.length, r.state.growth.plants.length - 1, 'gone from the island');
    eq(lifted.state.growth.nextId, r.state.growth.nextId, 'no id reused');
    // The island cap: willow's spread.maxCount counts a cutting.
    const cap = recipes.flora.willow.spread.maxCount;
    const full = { ...s0, growth: { ...(s0.growth ?? {}), nextId: 99, plants: Array.from({ length: cap }, (_, i) => ({ id: i + 1, sp: 'willow', x: -50 - i * 5, z: -50, age: 100, size: 0.9, best: 0.9, stage: 3, low: 0, drown: 0, last: 0 })) } };
    const cut = plantSeed(full, 'willow', bx, bz, env, { size: 0.2, capped: true });
    eq(cut.reason, 'full', `${cap} willows: a cutting would not take`);
    // A ball's seed takes where a seed's suitability is under 0.2 but over the ball's own floor.
    const R = await json('recipes/world/sowing.json');
    assert(R.ball.minSuit < 0.2 && R.ball.seeds === 3, 'a ball holds three seeds and takes on poorer ground');
  });

  test(G, 'G2: a clump keeps its size in the pack, oldest first, and a save keeps it', async () => {
    let p = noteClump(noteClump(emptyPack(), 'iris', 0.5, 0.8), 'iris', 0.3, 0.3);
    p = noteClump(p, 'campion', 0.6, 0.7);
    const t = takeClump(p, 'iris');
    eq(JSON.stringify(t.clump), JSON.stringify(['iris', 0.5, 0.8]), 'the oldest iris first');
    eq(JSON.stringify(cleanPack(JSON.parse(JSON.stringify(t.pack))).clumps), JSON.stringify([['iris', 0.3, 0.3], ['campion', 0.6, 0.7]]), 'the rest saved and read back');
    eq(takeClump(emptyPack(), 'iris').clump, null, 'none: null');
    eq('clumps' in takeClump(takeClump(noteClump(emptyPack(), 'iris', 1, 1), 'iris').pack, 'iris').pack, false, 'an empty list is left out of the save');
  });

  test(G, 'G6 and G5: seed and clumps go to the hamper; seed balls take any saved seed and are of its species', async () => {
    eq(routeOf('pouch', { rack: false, hamper: true }).join(), 'hamper', 'with a hamper, into it');
    eq(routeOf('pouch', { rack: true, hamper: false }).join(), 'piles', 'without one, the pouch waits (the piles say so)');
    const C = await json('recipes/world/cook.json'), s = cleanCook(null);
    const L = layout(C, 'workbench', ['clay', 'iris.seed'], s);
    assert(L.make === 'seed-balls' && L.complete, 'clay and iris seed make seed balls');
    eq(givesOf(C.makes['seed-balls'], 'seed-balls', ['clay', 'iris.seed']), 'iris.ball', 'iris seed balls');
    eq(layout(C, 'workbench', ['clay'], s).make, 'cup', 'clay alone is still the cup');
  });

  test(G, 'G1: every gather herb, iris, marigold, campion, rushes and gorse give seed past bloom', async () => {
    const R = await json('recipes/world/gather.json');
    for (const sp of ['watermint', 'meadowsweet', 'nettle', 'chamomile', 'marram', 'iris', 'marigold', 'campion', 'gorse']) assert(partsOf(sp, R).includes('seed'), `${sp} seed`);
    assert(R.cover.species.rushes.seedWindow, 'rushes seed, from the stand');
    const flora = await json('recipes/flora/iris.json');
    const plant = { id: 1, sp: 'iris', size: 0.9, best: 0.9, stage: 3 };
    assert(pickable(plant, 'seed', { flora, pos: 2.0 }, R).ok, 'iris seed in late summer');
    assert(!pickable(plant, 'seed', { flora, pos: 0.8 }, R).ok, 'not while it flowers');
  });

  test(G, 'the gestures: Lift with the shovel, Set and Push in are real motions', async () => {
    const F = await json('recipes/world/figure.json');
    assert(actLength(F.poses, 'liftClump') > 1, 'the lift plays');
    assert(gestureLength(F.poses, 'setClump') > 1.5 && gestureLength(F.poses, 'pushIn') > 1.5, 'set and push in play');
    const S = await json('recipes/world/sowing.json');
    assert(gestureLength(F.poses, 'setClump') <= S.set.setS + 0.2 && gestureLength(F.poses, 'pushIn') <= S.set.pushS + 0.2, 'each fits the kneel that holds it');
  });
}
