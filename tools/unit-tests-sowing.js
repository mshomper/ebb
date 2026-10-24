// @ts-check
// Planting on foot (D1a; Matt, October 24, 2026) for tools/unit-tests.html: the sowing ring is inked
// where a seed would take and says why not elsewhere, changing nothing; only reeds, water lilies and
// sea thrift live endlessly in the seed tin; each gift waits on the gift spot with a recipe count to
// place; a toss drops near you and arcs further out; and islands saved before format 10 are set
// aside for a fresh start. The net's ring at the tide now is in unit-tests-nets.js. Pure; no page needed.

import { tinItems, isEndless, giftItems, notePlaced, tossPlan, tossAt, landing, itemLabel, samePick } from '../src/world/sowing/model.js';
import { createPlantTool } from '../src/world/growth/plant-tool.js';
import { plantSeed, plantCover } from '../src/world/growth/coarse.js';
import { initialWorldState, makeEnv } from '../src/sim/tick.js';
import { shoreline, at, loadRecipes } from './unit-tests-growth.js';
import { FORMAT, FRESH_FROM, setAsideFormat, migrate, MIGRATIONS } from '../src/save/migrate.js';
import { readCopy } from '../src/save/recover.js';
import { ICON_NAMES } from '../src/ui/icons/icons.js';
import { gestureLength } from '../src/world/figure/acts.js';

const G = 'sowing';
const sowingRecipe = () => fetch('../recipes/world/sowing.json').then((r) => r.json());

/** @type {import('./unit-tests-parallel.js').AddTests} */
export function addSowingTests(test, assert, eq) {
  test(G, 'the seed tin holds only reeds, water lilies and sea thrift for good; gathered pouches join it later', async () => {
    const R = await sowingRecipe();
    const tin = tinItems(R);
    eq(tin.map((i) => i.species).join(), 'reeds,lilies,thrift', 'the endless three');
    assert(tin.every((i) => i.endless && i.left === Infinity), 'endless');
    for (const sp of ['iris', 'marigold', 'campion', 'rushes', 'gorse', 'willow', 'pondweed', 'watermint']) assert(!isEndless(R, sp), `${sp} is deliberate, never endless`);
    // D1b's hook: a gathered pouch is sown the same way, with how many it holds.
    const more = tinItems(R, [{ species: 'iris', left: 3 }, { species: 'gorse', left: 0 }, { species: 'reeds', left: 2 }]);
    eq(more.length, 4, 'one pouch with seed in it; an empty pouch and an endless kind add nothing');
    eq(JSON.stringify(more[3]), JSON.stringify({ kind: 'seed', id: 'pouch:iris', species: 'iris', icon: 'iris', endless: false, left: 3 }), 'the iris pouch');
    assert(itemLabel(R, more[3]).endsWith(', 3 left'), 'its label counts what is left');
    eq(itemLabel(R, tin[0]), 'Reeds', 'an endless seed is only its name');
  });

  test(G, 'a gift waits on the gift spot with a few to place, counted down as each is placed, then gone', async () => {
    const R = await sowingRecipe();
    eq(giftItems(R, {}).length, 0, 'nothing given: an empty spot');
    const weed = R.gifts.find((/** @type {any} */ g) => g.id === 'pondweed'), raft = R.gifts.find((/** @type {any} */ g) => g.id === 'raft');
    assert(weed.count > 1 && weed.count <= 12 && raft.count >= 1 && raft.count <= 3, 'a few of each');
    let u = /** @type {any} */ ({ seeds: { pondweed: true }, earned: {} });
    eq(JSON.stringify(giftItems(R, u)), JSON.stringify([{ kind: 'gift', id: 'pondweed', place: 'plant', species: 'pondweed', icon: 'pondweed', left: weed.count }]), "the minnows' pondweed");
    u = { ...u, raft: true };
    eq(giftItems(R, u).map((g) => `${g.id}:${g.left}`).join(), `pondweed:${weed.count},raft:${raft.count}`, "and the turtles' raft");
    let earned = {};
    for (let i = 0; i < weed.count; i++) earned = notePlaced(earned, 'pondweed');
    eq(/** @type {any} */ (earned).placed.pondweed, weed.count, 'counted for good in the saved unlocks');
    eq(giftItems(R, { ...u, earned }).map((g) => g.id).join(), 'raft', 'all the pondweed placed: only the raft waits');
    const before = { placed: { raft: 1 }, kept: ['x'] };
    const after = notePlaced(before, 'raft');
    eq(JSON.stringify(before), '{"placed":{"raft":1},"kept":["x"]}', 'pure: the input stays');
    eq(JSON.stringify(after), '{"placed":{"raft":2},"kept":["x"]}', 'the rest of the unlocks stay');
    assert(samePick({ kind: 'gift', id: 'raft' }, { kind: 'gift', id: 'raft' }) && !samePick({ kind: 'seed', id: 'raft' }, { kind: 'gift', id: 'raft' }), 'a pick is its kind and id');
  });

  test(G, 'the ring is inked where a seed would take, and names the need where not, without planting anything', async () => {
    const recipes = await loadRecipes();
    const hab = shoreline();
    const env = { ...makeEnv(9, recipes), habitat: () => hab };
    const world = { state: initialWorldState(9), env };
    // The growth's check() (src/world/growth/index.js): plant() without keeping the result.
    const growth = { check: (/** @type {string} */ sp, /** @type {number} */ x, /** @type {number} */ z) => (recipes.covers?.[sp] ? plantCover : plantSeed)(world.state, sp, x, z, env) };
    const tool = createPlantTool({ growth: /** @type {any} */ (growth), world, flora: recipes.flora, recipe: recipes.growth.marks });
    const state0 = world.state;
    const p = (/** @type {string} */ zone) => [at(zone)[0], 0, at(zone)[1]];
    assert(tool.check('reeds', p('edge')).ok, 'reeds at the pond edge: inked');
    const dry = tool.check('reeds', p('dry'));
    assert(!dry.ok && dry.message === 'Reeds need wetter ground', `reeds on dry ground: ${dry.message}`);
    const lilies = tool.check('lilies', p('pond'));
    assert(lilies.ok, 'lilies on the pond: inked');
    assert(!tool.check('lilies', p('dry')).ok, 'lilies on dry ground: crossed');
    assert(tool.check('thrift', p('shore')).ok, 'sea thrift on the salty shore: inked');
    const fresh = tool.check('thrift', p('bank'));
    assert(!fresh.ok && /sea thrift/i.test(fresh.message), `sea thrift on the pond bank says why: ${fresh.message}`);
    eq(world.state, state0, 'the ring changed nothing');
    eq((world.state.growth?.plants ?? []).length, 0, 'no plant went in');
  });

  test(G, 'a toss drops close by within 2 m and arcs further out, from the hand to the very spot', async () => {
    const R = await sowingRecipe(), T = R.toss;
    eq(T.nearM, 2, 'close sowing reaches 2 m');
    const hand = [0, 1, 0];
    const near = tossPlan(hand, [1.5, 0, 0], T), far = tossPlan(hand, [12, 0, 0], T);
    assert(near.near && !far.near, 'near and far');
    eq(near.s, T.nearS, 'a short drop');
    assert(far.riseM > near.riseM && far.riseM <= T.arcMaxM && far.riseM >= T.arcMinM, 'the far toss arcs higher, within its bounds');
    assert(far.s >= T.flightS[0] && far.s <= T.flightS[1], 'its flight time within bounds');
    assert(tossPlan(hand, [400, 0, 0], T).riseM === T.arcMaxM && tossPlan(hand, [400, 0, 0], T).s === T.flightS[1], 'anywhere in view: the arc and the flight are capped, not the reach');
    eq(JSON.stringify(tossAt(hand, [12, 0, 4], far, 0)), JSON.stringify([0, 1, 0]), 'it leaves the hand');
    eq(JSON.stringify(tossAt(hand, [12, 0, 4], far, 1)), JSON.stringify([12, 0, 4]), 'it lands on the spot');
    const top = tossAt(hand, [12, 0, 4], far, 0.5);
    assert(Math.abs(top[1] - (0.5 + far.riseM)) < 1e-9, 'half way it is riseM over the straight line');
    eq(landing(0.3, false, R.splash).kind, 'splash', 'on water, a splash');
    eq(/** @type {any} */ (landing(0.3, false, R.splash)).rings, R.splash.farRings, 'rings of it further out');
    eq(/** @type {any} */ (landing(0.3, true, R.splash)).rings, R.splash.nearRings, 'a little one close by');
    eq(landing(0, true, R.splash).kind, 'puff', 'on land, a puff of soil');
  });

  test(G, 'the bar and the walker are ready: drawn icons for the tin, the gift spot and every item, and the sow flick', async () => {
    const R = await sowingRecipe();
    for (const name of ['seed-tin', 'gift-spot', 'net', ...tinItems(R).map((i) => i.icon), ...R.gifts.map((/** @type {any} */ g) => g.icon)]) assert(ICON_NAMES.includes(name), `icon ${name}`);
    for (const sp of R.tin.endless) assert(R.words.names[sp], `${sp} has a name`);
    const fig = await fetch('../recipes/world/figure.json').then((r) => r.json());
    const len = gestureLength(fig.poses, 'sow');
    assert(len > R.flickS && len < 1, `the seed leaves the hand (${R.flickS} s) within the flick (${len} s)`);
    assert(R.ring.checkHz >= 4 && R.ring.radiusM > 0, 'the ring follows the pointer');
  });

  test(G, `islands saved before format ${FRESH_FROM} are set aside for a fresh start; this build writes ${FORMAT}`, async () => {
    eq(FORMAT, 10, 'this build writes format 10');
    assert(setAsideFormat(9) && setAsideFormat(1), 'format 9 and older are set aside');
    assert(!setAsideFormat(10) && !setAsideFormat(NaN), 'this format, and a header without one, are not');
    eq(MIGRATIONS.filter((m) => m.from === 9 && m.to === 10).length, 1, 'one step 9 to 10, for files the tools read');
    const s = { meta: { worldT: 3 }, unlocks: { shells: true } };
    eq(JSON.stringify(migrate(structuredClone(s), 9)), JSON.stringify(s), 'the step changes nothing');
    // What the load reads to decide: the newest copy's header (recover.js setAsideOlder).
    const old = await readCopy(/** @type {any} */ ({ gen: 4, codec: 'raw', raw: { header: { format: 9 }, sections: [['meta', { worldT: 1 }], ['world', {}]] } }));
    assert(old.header && setAsideFormat(old.header.format), 'a format 9 copy is set aside');
    const now = await readCopy(/** @type {any} */ ({ gen: 5, codec: 'raw', raw: { header: { format: FORMAT }, sections: [['meta', { worldT: 1 }], ['world', {}]] } }));
    assert(now.ok && !setAsideFormat(now.header.format), 'a copy from this build opens');
    const words = await fetch('../recipes/world/save.json').then((r) => r.json());
    assert(typeof words.recovered.setAside === 'string' && words.recovered.setAside.length > 20, 'a calm line for the new island');
  });
}
