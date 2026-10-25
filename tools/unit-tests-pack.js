// @ts-check
// The pack for tools/unit-tests.html (docs/future/13, sections 4.1 and 4.5): pouches top up before a
// new one opens, a full pack leaves the rest, pouches always sort the same way and keep one normal
// form, needs by group or kind, carriers, the save's cleaning (unknown kinds kept and last, an
// overfull save kept whole), K-21 heaps and their dawn, and the piles at camp: which slot a kind
// takes, the refusals, a full pile and Take up.

import { makeKinds } from '../src/world/pack/kinds.js';
import { emptyPack, cleanPack, sizeOf, add, take, has, handfulsOf, packHolds, normalize, addCarrier, removePouch,
  addHeap, takeFromHeap, expireHeaps } from '../src/world/pack/model.js';
import { pileWord, pileLook, slotFor, setDown, takeUp, hang, dryShare, rackWord, takeBunch, cleanBunches } from '../src/world/pack/piles.js';
import { slotsOf, capOf, put as storePut, room as storeRoom, take as storeTake, takeSlot, holdsOf, cleanHolds } from '../src/world/pack/store.js';
import { routeOf, setDownAtCamp } from '../src/world/pack/route.js';
import { cleanCamp } from '../src/world/camp/model.js';
import { createPiles } from '../src/world/pack/piles-live.js';
import { splitPieces, firstPieces, buildsUp } from '../src/world/pack/pile-pieces.js';
import { logStack, stoneHeap, logsShown } from '../src/world/pack/log-stack.js';
import { atCamp } from '../src/world/pack/camp.js';
import { createStores, storeSlots, heldKind } from '../src/world/pack/stores.js';
import { woodStoreMesh, scrapeMesh } from '../src/world/pack/pickup-meshes.js';
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

  test(G, 'the stores are places from the first frame: a card empty or holding, and a glow while the pack holds their kind', async () => {
    const c = await load();
    const land = await (async () => {
      const url = new URL('../recipes/land/starter-island-2.json', import.meta.url);
      if (url.protocol === 'file:') { const fs = await import('node:fs/promises'); return JSON.parse(await fs.readFile(url, 'utf8')); }
      return (await fetch(url)).json();
    })();
    const pad = padOf(land);
    updateStore('campPad', () => pad);
    updateStore('pieces', () => emptyPieces());
    const packWas = getStore('pack');
    updateStore('pack', () => emptyPack());
    const piles = createPiles({ recipe: c.recipe, kinds: c.kinds, seed: 7 });
    const you = [pad.x, 0, pad.z];
    let laid = false;
    const stores = createStores({ recipe: c.recipe, piles, walk: { below: true, you: () => you }, glow: { nearM: 2, opacity: 0.35, breathS: 3 }, ringLaid: () => laid });
    eq(storeSlots().map((s) => s.id).join(), 'sticks,stones,clay', 'three stores in their slots');
    const wood = storeSlots()[0];
    const empty = stores.cardAt(wood.x, wood.z);
    assert(empty && empty.name === 'Wood store' && empty.text === 'Empty.' && !empty.pile, 'an empty wood store has its card');
    eq(empty.storeKinds.join(), 'sticks,drift-twigs', 'it keeps sticks and drift twigs');
    eq(heldKind(empty.storeKinds, [['pebbles', 3], ['drift-twigs', 1], ['sticks', 2]]), 'sticks', 'Set down takes the fullest pouch of its kinds');
    eq(heldKind(empty.storeKinds, [['pebbles', 3]]), null, 'nothing to set down without its kind');
    piles.setDown('sticks', 3);
    const held = stores.cardAt(wood.x, wood.z);
    assert(held.pile && held.pile.holds === 'sticks' && held.sub === 'Sticks' && held.piece, 'with a pile, the card is the pile\'s too');
    // The glow: only once the ring is laid, near camp, while the pack holds a store's kind.
    updateStore('pack', (p) => ({ ...p, pouches: [['pebbles', 2]] }));
    eq(stores.rings(0).length, 0, 'no glow before the ring is laid');
    laid = true;
    const g = stores.rings(0);
    eq(g.length, 1, 'one store glows');
    assert(Math.hypot(g[0][0] - storeSlots()[1].x, g[0][1] - storeSlots()[1].z) < 1e-6, 'the stone pile glows for pebbles');
    you[0] = pad.x + pad.r + 5;
    eq(stores.rings(0).length, 0, 'no glow away from camp');
    // The empty stores' meshes: indices in range, the wood store's stakes standing up to their forks.
    const L = c.recipe.stores.sticks.look;
    for (const m of [woodStoreMesh(1, L), scrapeMesh(c.recipe.stores.stones.look)]) {
      assert(m.count > 0 && m.indices.length % 3 === 0 && Math.max(...m.indices) < m.count, 'a well-formed mesh');
    }
    const w = woodStoreMesh(1, L);
    let top = 0;
    for (let i = 0; i < w.count; i++) top = Math.max(top, w.vertices[i * 9 + 1]);
    assert(top > L.forkM && top < L.forkM + L.tineM + 0.05, `the forks stand at ${top.toFixed(2)} m`);
    updateStore('pack', () => packWas);
    updateStore('pieces', () => emptyPieces());
    updateStore('campPad', () => null);
  });

  test(G, 'a pile builds up piece by piece from the bottom; a fused model does not come apart', () => {
    // Three separate triangles stacked at heights 0.4, 0, 0.2 (out of order), each its own piece,
    // and a seam: the bottom one is split into two triangles that share a place, not a vertex.
    /** @param {number[][]} tris */
    const mesh = (tris) => {
      const vertices = new Float32Array(tris.length * 3 * 9);
      tris.forEach((t, i) => t.forEach((y, j) => vertices.set([j === 1 ? 1 : 0, y, j === 2 ? 1 : 0], (i * 3 + j) * 9)));
      return { vertices, count: tris.length * 3, indices: Uint32Array.from({ length: tris.length * 3 }, (_, i) => i) };
    };
    const m = mesh([[0.4, 0.4, 0.4], [0, 0, 0], [0.2, 0.2, 0.2], [0, 0, 0]]);
    const split = splitPieces(m);
    eq(split.ends.length, 3, 'the two bottom triangles sharing a place are one piece');
    eq(m.vertices[split.indices[0] * 9 + 1], 0, 'the bottom piece comes first');
    eq(Math.round(m.vertices[split.indices[split.ends[1] - 1] * 9 + 1] * 10) / 10, 0.2, 'then the middle one');
    eq(firstPieces(m, split, 0.3).indices.length, 6, 'a small heap shows the bottom piece');
    eq(firstPieces(m, split, 1).indices.length, 12, 'the full pile shows them all');
    assert(buildsUp(split), 'separate pieces build up');
    eq(buildsUp(splitPieces(mesh([[0, 0, 0]]))), false, 'one piece does not');
  });

  test(G, 'a stick pile of seeded logs: each rests on the ground or on two below, none floats or overlaps', async () => {
    const { recipe } = await load();
    const S = recipe.piles.look.stack, r = 0.16;
    const a = logStack(42, r, S), b = logStack(42, r, S);
    eq(JSON.stringify(a), JSON.stringify(b), 'the same seed gives the same pile');
    assert(JSON.stringify(logStack(43, r, S)) !== JSON.stringify(a), 'another seed another pile');
    eq(a.length, S.rows.reduce((t, n) => t + n, 0), 'every row is there');
    const C = a.map((g) => ({ z: g.z, cy: g.y + r * g.size, r: r * g.size }));
    for (let i = 0; i < C.length; i++) {
      const touching = C.slice(0, i).filter((q) => Math.abs(Math.hypot(q.z - C[i].z, q.cy - C[i].cy) - (q.r + C[i].r)) < 1e-6).length;
      assert(Math.abs(C[i].cy - C[i].r) < 1e-9 || touching >= 2, `log ${i} rests on the ground or on two logs`);
      for (let j = 0; j < i; j++) assert(Math.hypot(C[j].z - C[i].z, C[j].cy - C[i].cy) >= C[j].r + C[i].r - 1e-6, `logs ${j} and ${i} do not overlap`);
      if (i > 0) assert(C[i].cy - C[i].r >= C[i - 1].cy - C[i - 1].r - 1e-9, 'bottom up');
    }
    eq(logsShown(a.length, 0.3), 3); eq(logsShown(a.length, 1), a.length); eq(logsShown(a.length, 0), 1);
  });

  test(G, 'a stone pile of seeded stones: each rests on the ground or on stones set before it, none sinks into another', async () => {
    const { recipe } = await load();
    const S = recipe.piles.look.stones, w = 0.15, h = 0.12, k = w / h;
    const a = stoneHeap(7, w, h, S);
    eq(JSON.stringify(a), JSON.stringify(stoneHeap(7, w, h, S)), 'the same seed gives the same pile');
    eq(a.length, S.count);
    // In heights stretched by w / h each stone is a ball of radius w * size.
    const B = a.map((g) => ({ x: g.x, z: g.z, cy: (g.y + h * g.size) * k, r: w * g.size }));
    B.forEach((b, i) => {
      assert(Math.hypot(b.x, b.z) + b.r <= S.radiusM + 1e-9, `stone ${i} within the footprint`);
      const onGround = Math.abs(b.cy - b.r) < 1e-9;
      const resting = B.slice(0, i).some((q) => Math.abs(Math.hypot(q.x - b.x, q.z - b.z, q.cy - b.cy) - (q.r + b.r)) < 1e-6);
      assert(onGround || resting, `stone ${i} rests on the ground or on a stone set before it`);
      for (let j = 0; j < i; j++) assert(Math.hypot(B[j].x - b.x, B[j].z - b.z, B[j].cy - b.cy) >= B[j].r + b.r - 1e-6, `stones ${j} and ${i} do not overlap`);
    });
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

  test(G, 'P2j: the hamper keeps one kind a slot up to 12, has 6 slots then 12, takes from a slot and cleans its save', async () => {
    const { recipe } = await load();
    eq(slotsOf(1, recipe), 6, 'one hamper: 6 slots'); eq(slotsOf(2, recipe), 12, 'stacked: 12'); eq(capOf(recipe), 12, '12 handfuls a slot');
    let h = storePut([], 'kelp', 14, 12, 6);
    eq(js(h), js({ holds: [['kelp', 12], ['kelp', 2]], moved: 14 }), 'a kind fills a slot, then opens another');
    h = storePut(h.holds, 'kelp', 3, 12, 6);
    eq(js(h.holds), js([['kelp', 12], ['kelp', 5]]), 'more of a kind tops up its own slot first');
    let full = { holds: /** @type {[string, number][]} */ ([]), moved: 0 };
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) full = storePut(full.holds, k, 12, 12, 6);
    eq(storePut(full.holds, 'g', 1, 12, 6).moved, 0, 'six full slots take nothing more');
    assert(!storeRoom(full.holds, 'g', 12, 6) && storeRoom(full.holds, 'g', 12, 12), 'a second hamper makes room');
    eq(js(storeTake(h.holds, 'kelp', 6)), js({ holds: [['kelp', 11]], taken: 6 }), 'a make takes from the last slot back; an emptied slot goes');
    eq(js(takeSlot([['shells', 2], ['sand', 9]], 1, 3)), js({ holds: [['shells', 2], ['sand', 6]], kind: 'sand', taken: 3 }), 'Take up fills one pouch from a slot');
    eq(js(holdsOf([['kelp', 12], ['sand', 1], ['kelp', 2]])), js({ kelp: 14, sand: 1 }), 'what it holds, by kind');
    eq(js(cleanHolds([['kelp', 3], ['x', 0], ['y', 2.5], 'z', ['sand', 4]])), js([['kelp', 3], ['sand', 4]]), 'a saved hamper comes back clean');
    const c = cleanCamp({ slots: [{ slot: 'store', kind: 'hamper', seed: 1, placedHour: 2, stack: 2, holds: [['kelp', 3]] }, { slot: 'rack', kind: 'rack', seed: 2, placedHour: 3, bunches: [['mint.leaves', 2, 30], ['bad', -1, 2]] }] });
    eq(js(c.slots.map((s) => [s.stack, s.holds, s.bunches])), js([[2, [['kelp', 3]], undefined], [undefined, undefined, [['mint.leaves', 2, 30]]]]), 'the camp section keeps the hamper and the rack');
  });

  test(G, 'S2: herbs hang in bunches by kind and day, dry over three game days, and come down a pouch at a time', async () => {
    const { recipe } = await load();
    let b = hang([], 'mint.leaves', 2, 10, 6, 12);
    b = hang(b.bunches, 'mint.leaves', 5, 12, 6, 12);
    eq(js(b.bunches), js([['mint.leaves', 6, 10], ['mint.leaves', 1, 12]]), 'the same day tops up a bunch to six, then starts another');
    eq(js(hang(b.bunches, 'mint.leaves', 1, 40, 6, 12).bunches[2]), js(['mint.leaves', 1, 40]), 'a new day hangs a new bunch');
    eq(hang(b.bunches, 'nettle.tops', 3, 12, 6, 2).moved, 0, 'a full rack takes nothing');
    eq(dryShare(10, 10, 3), 0, 'just hung'); eq(dryShare(10, 46, 3), 0.5, 'half dry after a day and a half'); eq(dryShare(10, 200, 3), 1, 'dry');
    const W = recipe.words.rack;
    eq(rackWord(0, W), W.fresh); eq(rackWord(0.5, W), W.drying); eq(rackWord(1, W), W.dry);
    eq(js(takeBunch(b.bunches, 0, 3)), js({ bunches: [['mint.leaves', 3, 10], ['mint.leaves', 1, 12]], kind: 'mint.leaves', taken: 3 }), 'Take up a bunch fills one pouch');
    eq(js(cleanBunches([['mint.leaves', 2, 5], ['x', 1, 'no']])), js([['mint.leaves', 2, 5]]), 'a saved rack comes back clean');
  });

  test(G, 'P2j: set down goes to a kind\'s own place first, then the hamper; heaps only before a hamper; full says so', async () => {
    const { kinds } = await load();
    eq(routeOf('rack', { rack: true, hamper: true }).join(), 'rack,hamper', 'a herb: the rack, then the hamper');
    eq(routeOf('rack', { rack: false, hamper: false }).join(), 'piles', 'a herb with neither: the piles say there is no rack');
    eq(routeOf('sticks', { rack: false, hamper: true }).join(), 'piles,hamper', 'sticks: the wood store, then the hamper');
    eq(routeOf('heap', { rack: false, hamper: true }).join(), 'hamper', 'a heap kind goes straight in the hamper');
    eq(routeOf('heap', { rack: false, hamper: false }).join(), 'piles', 'before a hamper, the heaps');
    eq(routeOf('none', { rack: true, hamper: true }).join(), 'piles', 'worms still dig in');
    // A live run with fakes: the stick pile takes 2, the hamper 3 of the rest; then the hamper is full.
    let inHamper = 0;
    const k = { campOf: kinds.campOf, piles: { setDown: (/** @type {string} */ _k, /** @type {number} */ n) => ({ moved: Math.min(n, 2), pile: 'p1' }) },
      rack: { here: () => false, hang: () => 0, at: () => null },
      hamper: { here: () => true, put: (/** @type {string} */ _k, /** @type {number} */ n) => { const m = Math.min(n, 3 - inHamper); inHamper += m; return m; }, at: () => ({ x: 1, z: 2 }) } };
    eq(js(setDownAtCamp('sticks', 6, k)), js({ moved: 5, pile: 'p1', at: { x: 1, z: 2 }, full: 'hamperFull' }), 'what fits moves; the hamper filled');
    eq(js(setDownAtCamp('kelp', 2, k)), js({ moved: 0, refuse: 'hamperFull', pile: null, at: null }), 'The hamper is full.');
    assert(/hamper is full/i.test((await load()).recipe.words.hamperFull), 'its line');
  });

  test(G, 'P2j: once a hamper stands the heap slots retire: a heap kind is refused a heap slot', async () => {
    const { kinds } = await load();
    const slots = ['sticks', 'stones', 'clay', 'heap1', 'heap2', 'heap3'].map((id, i) => ({ id, x: i, z: 0 }));
    eq(js(slotFor('kelp', [], slots, kinds, true)), js({ refuse: 'noSlot' }), 'no heap slot once retired');
    eq(js(slotFor('sticks', [], slots, kinds, true)), js({ slot: 'sticks' }), 'a store still takes its own kind');
  });
}
