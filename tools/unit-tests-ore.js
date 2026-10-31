// @ts-check
// The underground spring (the spring-ore plan, Matt, October 30, 2026). O1: the new pack kinds and
// their drawn icons; twisted sticks and planks at the workbench; the clay furnace built from deep
// clay, sand and marram, dry after a night, ore and charcoal in at dusk and metal by morning, nails
// at once; every make's parts unique and no workbench make over its three spots; the deeper clay
// fills its own pouch. O2: the way down lies just above the spring's head; the cairn trail ends
// just short of it; the first spadeful there gives way once, into a hole that never fills. O3:
// the zone's fade swaps once while dark; the cave is the same from the same seed, walkable round a
// pool; panning is seeded, a few a day, the first always black sand.

import { cleanCook, layout, partKinds } from '../src/world/camp/making.js';
import { cleanCamp } from '../src/world/camp/model.js';
import { morningAfter, furnaceState, furnaceDry, layLoad, cleanLoad } from '../src/world/camp/furnace.js';
import { itemIconFor, makeIcon } from '../src/ui/icons/item-registry.js';
import { ITEM_ICON_NAMES } from '../src/ui/icons/items.js';
import { ICON_NAMES } from '../src/ui/icons/icons.js';
import { springSpot, trailEndFor, caveInDue } from '../src/world/dig/story.js';
import { holeNow, closeHole, capHoles, holeAt, cleanHoleFields } from '../src/world/dig/holes.js';
import { cleanDig } from '../src/world/dig/rest.js';
import { mouthStones } from '../src/world/dig/story-draw.js';
import { planTrail } from '../src/world/setpieces/cairn-rules.js';
import { landmarks, baseSampler } from '../src/world/terrain/landform.js';
import { subSeed } from '../src/core/rng.js';
import { idleFade, stepFade, darkness, startFade } from '../src/world/zones/zone.js';
import { createZones } from '../src/world/zones/live.js';
import { cleanPans, pansLeft, panFind, panned } from '../src/world/spring/pan.js';
import { caveShape, caveMesh, meshHash } from '../src/world/spring/cave-field.js';

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

  test(G, "O2: the way down lies on soil just uphill of the spring's head, the same every time; the trail ends just short of it", async () => {
    const land = await load('land/starter-island-2'), D = (await load('world/dig')).story, C = await load('setpieces/cairns');
    const tSeed = subSeed(12345, 'terrain');
    const a = springSpot(land, tSeed, D), b = springSpot(land, tSeed, D);
    assert(!!a, 'the starter island has one');
    eq(JSON.stringify(a), JSON.stringify(b), 'the same spot from the same seed');
    const lm = landmarks(land, tSeed), base = baseSampler(land, tSeed), sp = /** @type {any} */ (lm.spring), s0 = /** @type {any} */ (a);
    const d = Math.hypot(s0.x - sp.x, s0.z - sp.z);
    assert(d <= D.spring.aboveM + D.spring.searchM + 0.01 && d >= 0.5, `near the spring's head (${d.toFixed(2)} m)`);
    assert(base(s0.x, s0.z)[0] >= base(sp.x, sp.z)[0], 'on the rise, not below the spring');
    assert(base(s0.x, s0.z)[3] <= D.rockMax, "not on the spring's rock");
    const camp = { x: land.camp.x, z: land.camp.z }, end = trailEndFor(s0, camp, D.spring.trailBackM);
    eq(Math.round(Math.hypot(end.x - s0.x, end.z - s0.z) * 10) / 10, D.spring.trailBackM, 'the trail ends trailBackM short');
    const ground = (/** @type {number} */ x, /** @type {number} */ z) => base(x, z)[0];
    const t = planTrail(camp, ground, C.trail, 7, end);
    assert(!!t && t.length === C.trail.count, 'a full trail toward it');
    const last = /** @type {any} */ (t)[C.trail.count - 1];
    assert(Math.hypot(last[0] - end.x, last[1] - end.z) < 0.6, 'the last cairn stands at the end, just below the mark');
    return `${d.toFixed(1)} m from the spring`;
  });

  test(G, 'O2: the first spadeful by the mark gives way once, only after the letter; that hole never fills, closes or is capped', async () => {
    const R = await load('world/dig'), SP = R.story.spring, spot = { x: 3, z: 4 };
    assert(caveInDue(1, 3.2, 4.1, spot, true, null, SP), 'a first-layer dig beside it, once sent');
    assert(!caveInDue(1, 3.2, 4.1, spot, false, null, SP), 'not before the letter');
    assert(!caveInDue(2, 3.2, 4.1, spot, true, null, SP), 'only the first layer');
    assert(!caveInDue(1, 5, 4, spot, true, null, SP), 'not away from it');
    assert(!caveInDue(1, 3, 4, spot, true, { hour: 1, x: 3, z: 4 }, SP), 'once per island');
    const stay = { id: 'p1', kind: 'hole', x: 3, z: 4, size: SP.hole.sizeM, depth: 1, layer: 'topsoil', cls: 'soil', dugHour: 0, closedHour: -1, wetH: 0, stays: true };
    const n = holeNow(stay, 24 * 400, 500, R);
    assert(n.stage === 0 && !n.gone, 'open a year later, after any rain');
    eq(closeHole(stay, 10), stay, 'a stroke or water never closes it');
    const others = Array.from({ length: R.fill.listCap + 3 }, (_, i) => ({ ...stay, id: `q${i}`, stays: false, x: i, dugHour: 10 }));
    const isOpen = (/** @type {any} */ h) => holeNow(h, 11, 0, R).stage < 3;
    const capped = capHoles([stay, ...others], isOpen, 11, R);
    assert(capped.holes.some((h) => h.id === 'p1') && !capped.capped.includes('p1'), 'never capped or dropped');
    eq(holeAt([stay], 3, 4, () => true, R), null, 'a press beside it never digs it deeper');
    eq(/** @type {any} */ (cleanHoleFields(stay))?.stays, true, 'it stays through the save');
    eq(JSON.stringify(cleanDig({ spring: { hour: 30, x: 3, z: 4 } }).spring), JSON.stringify({ hour: 30, x: 3, z: 4 }), 'the dig section keeps where it fell');
    eq('spring' in cleanDig({}), false, 'and an older save reads as before');
    // Boulders and broken stones round the mouth (Matt, October 31, 2026), the same for the same hole, a gap left to step up.
    const M = SP.mouth, ring = mouthStones(stay, M);
    eq(JSON.stringify(ring), JSON.stringify(mouthStones({ x: 3, z: 4 }, M)), 'the same stones every time');
    eq(ring.filter((q) => q.big).length, M.boulders, 'its boulders');
    eq(ring.filter((q) => !q.big).length, M.lip, 'and its lip stones');
    const angles = ring.filter((q) => q.big).map((q) => Math.atan2(q.z - 4, q.x - 3)).sort((a, b) => a - b);
    const gaps = angles.map((a, i) => (i ? a - angles[i - 1] : a + Math.PI * 2 - angles[angles.length - 1]));
    assert(Math.max(...gaps) > Math.PI / 3, 'a gap between the boulders to step up to the edge');
    assert(ring.every((q) => Math.hypot(q.x - 3, q.z - 4) > SP.hole.sizeM / 2), 'none in the hole');
  });

  test(G, 'O3: a zone fades out, swaps once while the screen is dark, fades back in; going back reverses it', async () => {
    const R = await load('world/zones');
    let f = startFade(idleFade(), 'spring-cave', null), swaps = 0, t = 0, peak = 0;
    while (f.phase !== 'idle' && t < 10) { const s = stepFade(f, 1 / 60, R); if (s.swap) { swaps++; eq(darkness(s.fade, R), 1, 'black at the swap'); } f = s.fade; peak = Math.max(peak, darkness(f, R)); t += 1 / 60; }
    eq(swaps, 1, 'one swap');
    assert(Math.abs(t - (2 * R.fadeS + R.holdS)) < 0.05, `the whole fade takes fadeS twice and holdS (${t.toFixed(2)} s)`);
    eq(startFade(startFade(idleFade(), 'a', null), 'b', null).to, 'a', 'a fade going is not restarted');
    eq(startFade(idleFade(), 'a', 'a').phase, 'idle', 'already there: no fade');
    // The live module, without a page: enter on the swap, leave on the way back.
    const log = [];
    const Z = createZones({ R, host: null });
    Z.register({ id: 'test', enter: () => { log.push('in'); return true; }, leave: () => log.push('out') });
    Z.go('test');
    for (let i = 0; i < 200; i++) Z.tick(1 / 60);
    eq(Z.active(), 'test', 'in the zone');
    Z.back();
    for (let i = 0; i < 200; i++) Z.tick(1 / 60);
    eq(Z.active(), null, 'back on the island');
    eq(log.join(','), 'in,out', 'entered once, left once');
  });

  test(G, 'O3: the cave is the same from the same seed, with a pool, a floor to stand on and a shaft up to the hole', async () => {
    const C = await load('world/spring-cave'), S = C.shape;
    const a = caveMesh(S, C.seed, C.depthM), b = caveMesh(S, C.seed, C.depthM);
    eq(meshHash(a), meshHash(b), 'the same mesh, bit for bit');
    assert(a.count > 2000 && a.idx.length > 3000, `a full mesh (${a.count} vertices)`);
    const shape = caveShape(S, C.seed);
    assert(shape.poolDepth(S.pool.at[0], S.pool.at[1]) > 0.3, 'the pool is deep in the middle');
    eq(shape.poolDepth(R0(C).x, R0(C).z), 0, 'dry where you come down the rope');
    assert(shape.inside(R0(C).x, R0(C).z) > C.walk.wallM, 'the rope comes down inside the walls');
    assert(shape.air(0, C.depthM - 0.1, 0) > 0, 'the shaft is open up to the hole');
    assert(shape.air(0, shape.floorAt(0, 0) + 1, 0) > 0, 'air over the floor under the hole');
    assert(shape.air(S.centre[0] + S.radiusM[0] + 1.5, 1, S.centre[1]) < 0, 'rock beyond the walls');
    assert(shape.drips.length > 0, 'dripstone');
    return `${a.count} vertices, ${shape.drips.length} dripstones`;
  });

  test(G, 'O3: panning: a few a day, the first always black sand, copper only after the first few, the same every time', async () => {
    const P = (await load('world/spring-cave')).pan;
    let c = cleanPans(null);
    eq(pansLeft(c, 3, 3 * 24 + 10, P), P.perDay, 'a full day to start');
    eq(panFind(77, 3, 0, 0, P), P.firstFind, 'the first pan ever is black sand');
    for (let i = 0; i < P.perDay; i++) c = panned(c, 3, 3 * 24 + 10 + i);
    eq(pansLeft(c, 3, 3 * 24 + 14, P), 0, 'then the pool is cloudy');
    eq(pansLeft(c, 4, 3 * 24 + 12 + P.settleH - 0.1, P), 0, 'still settling just after midnight');
    eq(pansLeft(c, 4, 4 * 24 + 10, P), P.perDay, 'settled by the next morning');
    eq(c.total, P.perDay, 'the count goes on');
    // Seeded: the same day and pan, the same find; over many, iron most, copper less, some gravel.
    const n = { 'iron-ore': 0, 'copper-ore': 0, gravel: 0 };
    for (let d = 0; d < 400; d++) for (let i = 0; i < 3; i++) n[/** @type {'iron-ore'} */ (panFind(77, d, i, 10, P))]++;
    eq(panFind(77, 9, 1, 10, P), panFind(77, 9, 1, 10, P), 'the same pan, the same find');
    assert(n['iron-ore'] > n['copper-ore'] && n['copper-ore'] > n.gravel * 0.5 && n.gravel > 0, `iron ${n['iron-ore']}, copper ${n['copper-ore']}, gravel ${n.gravel}`);
    for (let d = 0; d < 50; d++) assert(panFind(77, d, 0, 1, P) !== 'copper-ore' || P.copperAfter <= 2, 'no copper before copperAfter');
    eq(JSON.stringify(cleanDig({ spring: { hour: 1, x: 0, z: 0, pans: c } }).spring?.pans), JSON.stringify(c), 'the pans keep in the save');
    return `iron ${n['iron-ore']}, copper ${n['copper-ore']}, gravel ${n.gravel} of 1200`;
  });
}

/** Where the rope comes down (the cave's frame). @param {any} C */
function R0(C) { return { x: C.rope.at[0], z: C.rope.at[1] }; }
