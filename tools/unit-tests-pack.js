// @ts-check
// The pack for tools/unit-tests.html (docs/future/13, sections 4.1 and 4.5): pouches top up before a
// new one opens, a full pack leaves the rest, pouches always sort the same way and keep one normal
// form, needs by group or kind, carriers, the save's cleaning (unknown kinds kept and last, an
// overfull save kept whole), K-21 heaps and their dawn, and the piles at camp: which slot a kind
// takes, the refusals, a full pile and Take up.

import { makeKinds } from '../src/world/pack/kinds.js';
import { emptyPack, cleanPack, sizeOf, add, take, has, handfulsOf, packHolds, normalize, addCarrier, removePouch,
  addHeap, takeFromHeap, expireHeaps } from '../src/world/pack/model.js';
import { pileWord, pileLook, slotFor, setDown, takeUp } from '../src/world/pack/piles.js';
import { createPiles } from '../src/world/pack/piles-live.js';
import { atCamp } from '../src/world/pack/camp.js';
import { padOf } from '../src/world/camp/layout.js';
import { offCampGround } from '../src/world/pieces/camp-clear.js';
import { emptyPieces } from '../src/world/pieces/model.js';
import { get as getStore, update as updateStore } from '../src/core/store.js';

const G = 'pack';

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addPackTests(test, assert, eq) {
  /** @type {Promise<any> | null} */
  let loaded = null;
  const load = () => {
    loaded ??= (async () => {
      const url = new URL('../recipes/world/pack.json', import.meta.url);
      if (url.protocol === 'file:') { const fs = await import('node:fs/promises'); return JSON.parse(await fs.readFile(url, 'utf8')); }
      return (await fetch(url)).json();
    })().then((recipe) => ({ recipe, kinds: makeKinds(recipe, ['mint.leaves', 'chamomile.seed']) }));
    return loaded;
  };
  const js = (/** @type {any} */ v) => JSON.stringify(v);
  /** Adds one handful at a time, as Gather does. @param {any} p @param {string} k @param {number} n @param {any} c */
  const gather = (p, k, n, c) => { for (let i = 0; i < n; i++) p = add(p, k, 1, c.kinds, c.recipe).pack; return p; };

  test(G, 'Set down at camp makes a pile on the pad, and the camp ground keeps it there', async () => {
    const c = await load();
    const land = await (async () => {
      const url = new URL('../recipes/land/starter-island-2.json', import.meta.url);
      if (url.protocol === 'file:') { const fs = await import('node:fs/promises'); return JSON.parse(await fs.readFile(url, 'utf8')); }
      return (await fetch(url)).json();
    })();
    const pad = padOf(land);
    assert(pad, 'the new island has a camp pad');
    updateStore('campPad', () => pad);
    updateStore('pieces', () => emptyPieces());
    const piles = createPiles({ recipe: c.recipe, kinds: c.kinds, seed: 7 });
    const r = piles.setDown('drift-twigs', 3);
    eq(r.moved, 3, 'all three handfuls go onto the pile');
    const list = getStore('pieces').list;
    const pile = list.find((/** @type {any} */ p) => p.kind === 'pile');
    assert(pile && pile.slot === 'sticks' && pile.holds === 'drift-twigs', 'drift twigs go to the stick pile slot');
    assert(atCamp(pile.x, pile.z), 'the pile lies on the camp ground');
    eq(offCampGround(pad, list).length, list.length, 'clearing the camp ground leaves the pile');
    eq(offCampGround(pad, [{ kind: 'stone', x: pad.x, z: pad.z, size: 0.3 }]).length, 0, 'a loose stone on the pad is still cleared');
    const t = piles.takeUp(pile.id, { add: (/** @type {string} */ k, /** @type {number} */ n) => ({ added: n }) });
    eq(t.taken, 3, 'Take up fills a pouch from it');
    eq(getStore('pieces').list.filter((/** @type {any} */ p) => p.kind === 'pile').length, 0, 'an empty pile is gone');
    updateStore('campPad', () => null);
  });

  test(G, 'a new pack is empty with six pouches', async () => {
    const { recipe } = await load();
    const p = emptyPack();
    eq(js(p), js({ version: 1, carriers: [], pouches: [], heaps: [], holding: null }));
    eq(sizeOf(p, recipe), 6);
    eq(has(p, 'sticks'), false);
  });

  test(G, 'a handful tops up the part-filled pouch before a new one opens', async () => {
    const c = await load();
    let p = gather(emptyPack(), 'sticks', 2, c);
    eq(js(p.pouches), js([['sticks', 2]]));
    p = gather(p, 'sticks', 2, c);
    eq(js(p.pouches), js([['sticks', 3], ['sticks', 1]]));
    eq(handfulsOf(p, 'sticks'), 4);
  });

  test(G, 'a full pack takes what fits and leaves the rest', async () => {
    const c = await load();
    let p = add(emptyPack(), 'pebbles', 16, c.kinds, c.recipe).pack;
    eq(p.pouches.length, 6);
    const r = add(p, 'pebbles', 5, c.kinds, c.recipe);
    eq(r.added, 2); eq(r.left, 3);
    const s = add(r.pack, 'sticks', 1, c.kinds, c.recipe);
    eq(s.added, 0); eq(s.left, 1);
    eq(js(s.pack), js(r.pack), 'a full pack is unchanged:');
  });

  test(G, 'pouches sort in a fixed order whatever order they came in', async () => {
    const c = await load();
    const a = gather(gather(gather(emptyPack(), 'pebbles', 2, c), 'mint.leaves', 1, c), 'sticks', 1, c);
    const b = gather(gather(gather(emptyPack(), 'sticks', 1, c), 'pebbles', 2, c), 'mint.leaves', 1, c);
    eq(js(a.pouches), js([['sticks', 1], ['pebbles', 2], ['mint.leaves', 1]]));
    eq(js(a), js(b));
  });

  test(G, 'normal form merges part-filled pouches of a kind', async () => {
    const c = await load();
    const p = normalize({ ...emptyPack(), pouches: [['sand', 1], ['sticks', 2], ['sand', 2], ['sticks', 2]] }, c.kinds, c.recipe);
    eq(js(p.pouches), js([['sticks', 3], ['sticks', 1], ['sand', 3]]));
  });

  test(G, 'take removes handfuls and keeps normal form', async () => {
    const c = await load();
    const p = gather(emptyPack(), 'sticks', 7, c);
    const r = take(p, 'sticks', 2, c.kinds);
    eq(r.taken, 2);
    eq(js(r.pack.pouches), js([['sticks', 3], ['sticks', 2]]));
    const all = take(r.pack, 'sticks', 9, c.kinds);
    eq(all.taken, 5); eq(all.pack.pouches.length, 0);
    eq(js(p.pouches), js([['sticks', 3], ['sticks', 3], ['sticks', 1]]), 'the input is untouched:');
  });

  test(G, 'a need counts by group or by kind', async () => {
    const c = await load();
    const p = gather(gather(gather(emptyPack(), 'drift-twigs', 1, c), 'pebbles', 1, c), 'flat-stones', 1, c);
    eq(packHolds(p, { fuel: 1, stones: 2 }, c.kinds), true);
    eq(packHolds(p, { fuel: 2 }, c.kinds), false);
    eq(packHolds(p, { pebbles: 2 }, c.kinds), false);
    eq(packHolds(p, { 'flat-stones': 1, 'drift-twigs': 1 }, c.kinds), true);
  });

  test(G, 'each carrier adds two pouches, once', async () => {
    const c = await load();
    let p = addCarrier(emptyPack(), 'satchel');
    p = addCarrier(addCarrier(p, 'satchel'), 'frame');
    eq(js(p.carriers), js(['satchel', 'frame']));
    eq(sizeOf(p, c.recipe), 10);
    eq(add(p, 'sand', 40, c.kinds, c.recipe).added, 30);
  });

  test(G, 'removing a pouch hands back its kind and handfuls', async () => {
    const c = await load();
    const p = gather(gather(emptyPack(), 'sticks', 4, c), 'clay', 2, c);
    const r = removePouch(p, 1);
    eq(r.kind, 'sticks'); eq(r.handfuls, 1);
    eq(js(r.pack.pouches), js([['sticks', 3], ['clay', 2]]));
    eq(removePouch(p, 9).kind, null);
  });

  test(G, 'a cleaned save round-trips, keeps unknown kinds last and an overfull save whole', async () => {
    const c = await load();
    const p = gather(gather(addCarrier(emptyPack(), 'basket'), 'wrack', 4, c), 'charcoal', 2, c);
    eq(js(cleanPack(JSON.parse(js(p)), c.kinds, c.recipe)), js(p));
    const odd = cleanPack({ version: 1, carriers: ['basket', 7], pouches: [['zz-new', 2], ['sticks', 9], ['aa-new', 1], ['sand', 0], ['clay', -1], 'x'],
      heaps: [], holding: 'pot' }, c.kinds, c.recipe);
    eq(js(odd.pouches), js([['sticks', 3], ['aa-new', 1], ['zz-new', 2]]));
    eq(js(odd.carriers), js(['basket'])); eq(odd.holding, 'pot');
    eq(c.kinds.sketchOf('zz-new'), 'plain');
    const over = cleanPack({ ...emptyPack(), pouches: Array.from({ length: 8 }, (_, i) => [['sticks', 'pebbles', 'clay', 'sand'][i % 4], 3]) }, c.kinds, c.recipe);
    eq(over.pouches.length, 8, 'none dropped:');
    const r = add(over, 'kelp', 1, c.kinds, c.recipe);
    eq(r.added, 0, 'no new pouch opens:');
    eq(js(cleanPack(null)), js(emptyPack())); eq(js(cleanPack({ pouches: 3 })), js(emptyPack()));
  });

  test(G, 'heaps cap at six, give back handfuls and go at the next dawn', async () => {
    const c = await load();
    let p = emptyPack();
    for (let i = 0; i < 7; i++) p = addHeap(p, 'sticks', i, 0, 4 + (i >> 2), 1, c.recipe.heaps.cap);
    eq(p.heaps.length, 6); eq(p.heaps[0][1], 1, 'the oldest went:');
    p = addHeap(p, 'sand', 9, 9, 5, 2);
    const t = takeFromHeap(p, 5, 1);
    eq(t.kind, 'sand'); eq(t.taken, 1); eq(t.pack.heaps[5][4], 1);
    eq(takeFromHeap(t.pack, 5, 3).pack.heaps.length, 5);
    eq(expireHeaps(p, 5).heaps.length, 4);
    eq(expireHeaps(p, 6).heaps.length, 0);
    const cl = cleanPack({ ...emptyPack(), heaps: [...p.heaps, ...p.heaps] }, c.kinds, c.recipe);
    eq(cl.heaps.length, 6);
  });

  test(G, 'a set-down pouch finds its slot, falls back to a heap slot, or says why not', async () => {
    const { kinds } = await load();
    const slots = ['sticks', 'stones', 'clay', 'heap1', 'heap2', 'heap3'].map((id, i) => ({ id, x: i, z: 0 }));
    const pile = (/** @type {string} */ holds, /** @type {string} */ slot) => ({ id: 1, kind: /** @type {'pile'} */ ('pile'), x: 0, z: 0, yaw: 0, seed: 1, size: 1, placedHour: 0, holds, handfuls: 4, slot });
    eq(js(slotFor('sticks', [], slots, kinds)), js({ slot: 'sticks' }));
    eq(js(slotFor('sticks', [pile('sticks', 'sticks')], slots, kinds)), js({ slot: 'sticks' }));
    eq(js(slotFor('drift-twigs', [pile('sticks', 'sticks')], slots, kinds)), js({ slot: 'heap1' }));
    eq(js(slotFor('flat-stones', [pile('pebbles', 'stones'), pile('sand', 'heap1')], slots, kinds)), js({ slot: 'heap2' }));
    eq(js(slotFor('reeds.down', [], slots, kinds)), js({ slot: 'heap1' }));
    eq(js(slotFor('kelp', [pile('a', 'heap1'), pile('b', 'heap2'), pile('c', 'heap3')], slots, kinds)), js({ refuse: 'noSlot' }));
    eq(js(slotFor('lichen-twigs', [], slots, kinds)), js({ refuse: 'noRack' }));
    eq(js(slotFor('mint.leaves', [], slots, kinds)), js({ refuse: 'noRack' }));
    eq(js(slotFor('acorns', [], slots, kinds)), js({ refuse: 'noBowl' }));
    eq(js(slotFor('worms', [], slots, kinds)), js({ refuse: 'worms' }));
    eq(js(slotFor('chamomile.seed', [], slots, kinds)), js({ refuse: 'pouch' }));
  });

  test(G, 'a pile takes what fits, gives a pouch back and names its size', async () => {
    const { recipe } = await load();
    const p = { id: 1, kind: /** @type {'pile'} */ ('pile'), x: 0, z: 0, yaw: 0, seed: 1, size: 1, placedHour: 0, holds: 'sticks', handfuls: 10, slot: 'sticks' };
    eq(js(setDown(p, 3, recipe.piles.handfuls)), js({ handfuls: 12, moved: 2, left: 1 }));
    eq(js(setDown({ ...p, handfuls: 0 }, 3)), js({ handfuls: 3, moved: 3, left: 0 }));
    eq(js(takeUp(p)), js({ handfuls: 7, taken: 3 }));
    eq(js(takeUp({ ...p, handfuls: 2 })), js({ handfuls: 0, taken: 2 }));
    eq(pileWord(3, recipe), 'A small heap.'); eq(pileWord(4, recipe), 'A good heap.');
    eq(pileWord(8, recipe), 'A good heap.'); eq(pileWord(12, recipe), 'A big heap.');
    eq(pileLook(9, recipe), 2);
    assert(p.handfuls === 10, 'the pile record is untouched');
  });
}
