// @ts-check
// The underground spring (the spring-ore plan, Matt, October 30, 2026). O1: the new pack kinds and
// their drawn icons; twisted sticks and planks at the workbench; the clay furnace built from deep
// clay, sand and marram, dry after a night, ore and charcoal in at dusk and metal by morning, nails
// at once; every make's parts unique and no workbench make over its three spots; the deeper clay
// fills its own pouch.

import { cleanCook, layout, partKinds } from '../src/world/camp/making.js';
import { cleanCamp } from '../src/world/camp/model.js';
import { morningAfter, furnaceState, furnaceDry, layLoad, cleanLoad } from '../src/world/camp/furnace.js';
import { itemIconFor, makeIcon } from '../src/ui/icons/item-registry.js';
import { ITEM_ICON_NAMES } from '../src/ui/icons/items.js';
import { ICON_NAMES } from '../src/ui/icons/icons.js';

const G = 'ore';
/** @param {string} p */
const load = async (p) => (await fetch(new URL(`../recipes/${p}.json`, import.meta.url))).json();
const NEW_KINDS = ['deep-clay', 'iron-ore', 'copper-ore', 'iron', 'copper', 'nails', 'twisted-sticks', 'planks'];

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addOreTests(test, assert, eq) {
  test(G, 'O1: the new kinds are in the pack, each with its own drawn icon in the item family', async () => {
    const P = await load('world/pack');
    for (const k of NEW_KINDS) {
      const kind = P.kinds.find((/** @type {any} */ q) => q.id === k);
      assert(kind && kind.name && kind.line && kind.group, `${k} is a pack kind`);
      eq(itemIconFor(k), k, `${k} wears its own glyph`);
      assert(ITEM_ICON_NAMES.includes(k), `${k} is drawn`);
    }
    assert(ITEM_ICON_NAMES.includes('clay-furnace') && ITEM_ICON_NAMES.includes('keepers-pan'), 'the furnace and the pan are drawn');
    eq(makeIcon('clay-furnace'), 'clay-furnace', 'the furnace in the makes');
    for (const a of ['smelt', 'draw', 'pan', 'climbdown', 'climbup']) assert(ICON_NAMES.includes(a), `the ${a} action is drawn`);
    return `${NEW_KINDS.length} kinds`;
  });

  test(G, 'O1: twisted sticks from two sticks, planks from twisted sticks and nails; the rack and nest box keep their own', async () => {
    const C = await load('world/cook'), s = cleanCook(null), ctx = { filled: () => true };
    const tw = layout(C, 'workbench', ['sticks', 'sticks'], s, ctx);
    assert(tw.make === 'twisted-sticks' && tw.complete, `two sticks twist (${tw.make})`);
    const pl = layout(C, 'workbench', ['twisted-sticks', 'nails'], s, ctx);
    assert(pl.make === 'planks' && pl.complete, 'twisted sticks and nails make a plank');
    eq(layout(C, 'workbench', ['sticks', 'sticks', 'rush-cord'], s, ctx).make, 'rack', 'two sticks and cord are still the rack');
    eq(layout(C, 'workbench', ['sticks', 'rushes.stems', 'rushes.stems'], s, ctx).make, 'nest-box', 'the nest box keeps its parts');
  });

  test(G, 'O1: every make and build has its own set of parts, and no make needs more spots than its station has', async () => {
    const C = await load('world/cook'), camp = await load('world/camp');
    /** @type {Map<string, string>} */ const seen = new Map();
    const all = [...Object.entries(C.makes).map(([id, m]) => [id, /** @type {any} */ (m).parts]),
      ...Object.entries(C.builds).map(([id, b]) => [id, /** @type {any} */ (b).parts.flatMap((/** @type {[string, number]} */ [k, n]) => Array(n).fill(k))])];
    // The older pairs that share parts: the workbench and the hearth stones (two flat stones), the cup and the bowl (clay alone).
    const allowed = new Set(['hearth-stones|workbench', 'bowl|cup']);
    const clash = [];
    for (const [id, parts] of all) {
      const key = parts.map((/** @type {any} */ p) => partKinds(p).slice().sort().join('|')).sort().join(' + ');
      const other = seen.get(key);
      if (other && !allowed.has([other, id].sort().join('|'))) clash.push(`${other} = ${id}`);
      seen.set(key, id);
    }
    eq(clash.join(', '), '', 'no two makes share a set of parts');
    for (const [id, m] of Object.entries(C.makes)) {
      const spots = camp.stations[/** @type {any} */ (m).at]?.spots ?? 2;
      assert(/** @type {any} */ (m).parts.length <= spots, `${id}: ${/** @type {any} */ (m).parts.length} parts on ${spots} spots`);
    }
    eq(JSON.stringify(C.builds.furnace.parts), JSON.stringify([['deep-clay', 2], ['sand', 1], ['marram.leaves', 1]]), 'the furnace: two deep clay, sand, marram');
    return `${all.length} makes and builds`;
  });

  test(G, 'O1: the furnace dries a night; ore in at dusk is metal by morning; one load at a time', async () => {
    const F = (await load('world/cook')).furnace;
    eq(morningAfter(18, 7, 8), 31, 'in at six in the evening, ready at seven next morning');
    eq(morningAfter(2, 7, 8), 31, 'in at two in the morning, the next morning but one (eight hours first)');
    eq(morningAfter(24 * 5 + 20, 7, 8), 24 * 6 + 7, 'day five at dusk, day six at seven');
    const rec = { placedHour: 24 * 3 + 15, load: /** @type {any} */ (null) };
    eq(furnaceState(rec, 24 * 3 + 20, F), 'drying', 'built in the afternoon, drying that evening');
    assert(!furnaceDry(rec, 24 * 4 + F.readyHour - 0.5, F) && furnaceDry(rec, 24 * 4 + F.readyHour, F), 'dry by the next morning');
    eq(furnaceState(rec, 24 * 4 + 12, F), 'empty', 'cold and ready');
    rec.load = layLoad('smelt-iron', { gives: 'iron', count: 1 }, 24 * 4 + 19);
    eq(furnaceState(rec, 24 * 4 + 23, F), 'burning', 'burning through the night');
    eq(furnaceState(rec, 24 * 5 + F.readyHour, F), 'done', 'done by morning');
    eq(furnaceState(null, 0, F), 'none', 'no furnace');
    // The load keeps through the save's cleaner, a bad one is dropped.
    const c = cleanCamp({ slots: [{ slot: 'furnace', kind: 'furnace', seed: 1, placedHour: 10, load: rec.load }, { slot: 'workbench', kind: 'workbench', seed: 2, placedHour: 1, load: rec.load }] });
    eq(JSON.stringify(c.slots[0].load), JSON.stringify(rec.load), 'the furnace keeps its load');
    eq(c.slots[1].load, undefined, 'no other slot takes one');
    eq(cleanLoad({ id: 'x' }), null, 'a broken load is dropped');
  });

  test(G, 'O1: the furnace makes: smelt takes ore and charcoal; nails take iron or copper; it stands in the work corner', async () => {
    const C = await load('world/cook'), s = cleanCook(null), ctx = { filled: () => true };
    eq(layout(C, 'furnace', ['iron-ore', 'charcoal-sticks'], s, ctx).make, 'smelt-iron', 'black sand and charcoal smelt iron');
    eq(layout(C, 'furnace', ['copper-ore', 'charcoal-sticks'], s, ctx).make, 'smelt-copper', 'copper ore and charcoal smelt copper');
    for (const metal of ['iron', 'copper']) {
      const L = layout(C, 'furnace', [metal], s, ctx);
      assert(L.make === 'nails' && L.complete && C.makes.nails.gives === 'nails', `${metal} draws out into nails`);
    }
    for (const land of ['starter-island-2', 'starter-island']) {
      const sl = (await load(`land/${land}`)).camp.slots.find((/** @type {any} */ q) => q.id === 'furnace');
      assert(sl && sl.v < 0 && sl.kinds.includes('furnace') && sl.blocks, `${land}: the furnace slot on the work side`);
    }
  });

  test(G, 'O1: the deeper clay fills its own pouch, the blue-grey clay a clay pouch', async () => {
    const D = await load('world/dig');
    eq(D.clay.kinds.deepclay, 'deep-clay', 'deeper clay is deep clay');
    eq(D.clay.kinds.clay, 'clay', 'the blue-grey is clay');
    assert(D.layers.bank.deep === 'deepclay' && D.layers.reach.blade === 3, 'it lies third under a damp bank, with the blade');
  });
}
