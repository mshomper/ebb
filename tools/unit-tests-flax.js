// @ts-check
// Flax and cloth (F1, Matt, October 30, 2026) for tools/unit-tests.html: the flax plant on the
// meadow islet and its pull window; retting (src/world/gather/retting.js): where a bundle may lie,
// three days from the hour it was laid whatever happened between, lifting it out a handful at a
// time, and the save keeping it; the minnows keeping clear of it; weaving two handfuls of fibre
// into cloth at the workbench; and the pieces round it (pack kinds, icons, journal, sketchbook).

import { cleanRetting, laySteep, liftOne, bundleAt, isRetted, hoursLeft, steepable, steepLine, avoidOf } from '../src/world/gather/retting.js';
import { cleanGather } from '../src/world/gather/events.js';
import { pickable } from '../src/world/gather/plants.js';
import { cleanCook, layout } from '../src/world/camp/making.js';
import { createSchool } from '../src/world/creatures/school.js';
import { ICON_NAMES } from '../src/ui/icons/icons.js';
import { itemIconFor } from '../src/ui/icons/item-registry.js';
import { hasItemIcon } from '../src/ui/icons/items.js';

const G = 'flax';
/** @param {string} p */
const load = async (p) => (await fetch(new URL(`../recipes/${p}.json`, import.meta.url))).json();

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addFlaxTests(test, assert, eq) {
  test(G, 'flax fills the islet\'s slot: a machair plant of its grassy patches, never volunteering, pulled from the end of summer', async () => {
    const [F, Gr, R, Ga] = await Promise.all([load('flora/flax'), load('world/growth'), load('land/meadow-islet'), load('world/gather')]);
    eq(F.id, 'flax', 'its recipe');
    assert(Gr.species.includes('flax'), "in growth's species list, so the islet plants it");
    assert(!Gr.volunteers.order.includes('flax'), 'never volunteers on the pond island');
    eq(F.plantTool, false, 'not in the Plant tool');
    assert(R.starters.clumps.some((/** @type {any} */ c) => c.sp === 'flax'), 'its starter slot on the islet');
    // Indexes are the draw channels: its own.
    const idx = await Promise.all(Gr.species.map(async (/** @type {string} */ sp) => (await load(`flora/${sp}`)).index));
    eq(new Set(idx).size, idx.length, 'every plant its own index');
    const part = Ga.plants.parts['flax.stems'];
    assert(part, 'its stems are a gather part');
    // The islet first shows on day 27 (season position 27/14): the stems are ready that autumn.
    const plant = { id: 1, sp: 'flax', size: 0.8, best: 0.8 };
    assert(pickable(plant, 'stems', { flora: F, pos: 27 / 14 + 0.05 }, Ga).ok, 'pulled just after the islet first shows');
    assert(!pickable(plant, 'stems', { flora: F, pos: 1.2 }, Ga).ok, 'not while green in early summer');
    assert(!pickable(plant, 'stems', { flora: F, pos: 3.5 }, Ga).ok, 'not in winter');
  });

  test(G, 'a bundle lies only in a pond\'s shallows, three at most', async () => {
    const S = (await load('world/gather')).retting;
    assert(steepable(0.2, true, S), 'still water a hand deep');
    assert(!steepable(0.2, false, S), 'never the sea or a running stream');
    assert(!steepable(0.01, true, S), 'not on the wet edge');
    assert(!steepable(0.9, true, S), 'not out of reach in the deep');
    let list = laySteep([], 1, 2, 10, 3, S);
    list = laySteep(list, 3, 2, 11, 2, S);
    list = laySteep(list, 5, 2, 12, 1, S);
    eq(list.length, 3, 'three laid');
    eq(laySteep(list, 7, 2, 13, 3, S), list, 'a fourth waits for room');
    eq(bundleAt(list, 3.3, 2.2, S), 1, 'a tap finds the nearest bundle');
    eq(bundleAt(list, 20, 20, S), -1, 'and none far off');
  });

  test(G, 'retting is ready three game days after it was laid, from the hour alone, and lifts out a handful at a time', async () => {
    const S = (await load('world/gather')).retting;
    eq(S.hours, 72, 'about three game days');
    const list = laySteep([], 4, 4, 100, 3, S), b = list[0];
    assert(!isRetted(b, 100 + 71.9, S), 'not ready an hour short');
    assert(isRetted(b, 172, S), 'ready at 72 hours');
    // A long away: the same hour gives the same answer however the hours were stepped.
    assert(isRetted(b, 100 + 24 * 40, S) && hoursLeft(b, 100 + 24 * 40, S) === 0, 'still waiting, ready, after forty days away');
    eq(liftOne(list, 0, 150, S), list, 'nothing lifts before it is ready');
    const a1 = liftOne(list, 0, 172, S), a2 = liftOne(a1, 0, 172, S), a3 = liftOne(a2, 0, 172, S);
    eq(a1[0][3], 2, 'one handful out');
    eq(a2[0][3], 1, 'two out');
    eq(a3.length, 0, 'the last handful takes the bundle away');
    const W = (await load('world/gather')).words.retting;
    eq(steepLine(b, 100, S, W), 'Steeping. About 3 days more.', 'its line when laid');
    eq(steepLine(b, 160, S, W), 'Steeping. A few hours more.', 'nearly there');
    eq(steepLine(b, 180, S, W), W.ready, 'ready');
  });

  test(G, 'the save keeps the bundles; an older save has none, and a bad entry is dropped', async () => {
    const S = (await load('world/gather')).retting;
    const list = laySteep([], 1.234, 5.678, 99.5, 2, S);
    const back = cleanGather(JSON.parse(JSON.stringify({ version: 1, events: [], retting: list })));
    eq(JSON.stringify(back.retting), JSON.stringify([[1.23, 5.68, 99.5, 2]]), 'kept to the cm');
    eq(cleanGather({ version: 1, events: [] }).retting, undefined, 'an older save: none steeping');
    eq(cleanRetting([[1, 2, 3], [1, 2, 3, 0], ['a', 2, 3, 1], [1, 2, 3, 2]]).length, 1, 'only whole entries with a handful');
  });

  test(G, 'a minnow school keeps clear of a steeping bundle', async () => {
    const M = (await load('species/minnow')).motion;
    assert(M.avoidSteeping && M.weights.avoid > 0, 'minnows turn away');
    const S = (await load('world/gather')).retting;
    const water = () => ({ surface: 0, depth: 0.8 });
    /** Fish inside the ring over the last part of a run. @param {any[]} avoid */
    const inside = (avoid) => {
      const s = createSchool({ id: 1, seed: 7, count: 12, home: { x: 0, z: 0 }, deep: { x: 0, z: 0 }, size: 1, M, env: { water, avoid: () => avoid } });
      let n = 0;
      for (let i = 0; i < 30 * 60; i++) {
        s.step(1 / 30);
        if (i > 30 * 20) n += s.fish.filter((f) => Math.hypot(f.x, f.z) < S.avoidM * 0.6).length;
      }
      return n;
    };
    const free = inside([]), kept = inside(avoidOf(laySteep([], 0, 0, 0, 3, S), S));
    assert(free > 0, 'with nothing steeping they swim over their home');
    assert(kept < free * 0.25, `with flax steeping at their home they keep off it (${kept} against ${free})`);
  });

  test(G, 'two handfuls of flax fibre weave cloth at the workbench, and nothing else takes fibre', async () => {
    const C = await load('world/cook');
    const L = layout(C, 'workbench', ['flax-fibre', 'flax-fibre'], cleanCook(null));
    assert(L.make === 'cloth' && L.complete, 'cloth');
    eq(C.makes.cloth.gives, 'cloth', 'into a pouch of cloth');
    const users = Object.entries(C.makes).filter(([, m]) => JSON.stringify(/** @type {any} */ (m).parts).includes('flax-fibre')).map(([id]) => id);
    eq(users.join(), 'cloth', 'only cloth uses flax fibre');
    assert(C.words.made.cloth && C.words.acts.weave, 'its made line and its Weave');
  });

  test(G, 'its pieces: pack kinds, drawn icons, a journal page, web ties, a sketch, a morning hint', async () => {
    const [P, J, Wb, Sk, H] = await Promise.all([load('world/pack'), load('world/journal'), load('world/journal-web'), load('world/sketchbook'), load('world/morning-hints')]);
    for (const k of ['flax.stems', 'flax-fibre', 'cloth']) {
      assert(P.kinds.some((/** @type {any} */ r) => r.id === k), `${k} is a pack kind`);
      assert(hasItemIcon(itemIconFor(k)), `${k} wears its own item glyph`);
    }
    for (const k of ['flax.stems', 'flax-fibre']) assert(P.pickups.kinds[k], `${k} is drawn lying in the water`);
    for (const n of ['flax', 'weave', 'steep']) assert(ICON_NAMES.includes(n), `the ${n} icon`);
    assert(J.species.flax && J.order.includes('flax'), 'a journal page');
    assert(J.species.flax.field.some((/** @type {any} */ f) => f.learn.includes('retted')), 'a field note learned by retting');
    assert(Wb.nodes.flax && Wb.links.some((/** @type {any} */ e) => e.b === 'flax'), 'a web node with its ties');
    assert(Sk.subjects.includes('flax'), 'a sketchbook subject');
    const hint = H.hints.find((/** @type {any} */ h) => h.id === 'flax');
    assert(hint && H.tests[hint.when] && H.tests[hint.done], 'a morning hint once it is pulled, until it is retted');
  });
}
