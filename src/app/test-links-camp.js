// @ts-check
// Test links (unsaved) that set up the camp: `?camp=...`, `?teas` and `?spring` (ore at the bench).
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import * as clock from '../core/clock.js';
import { emit } from '../core/events.js';
import { get as getStore, update as updateStore } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { testShelf, shelfPoint } from '../world/camp/shelf-fit.js';
import { setWater } from '../world/camp/pots.js';

/** @param {import('./context.js').AppContext} ctx */
export function camp(ctx) {
  const { afterGrow, back, camera, camp, campRecipe, keepsakesRecipe, kit, pack, params, terrain, walk } = ctx;
  // `?camp` (a test link, unsaved; S1): the evening skipped, the camp ready, the pack holding what
  // the workbench and the shovel take, and you standing at the workbench's ground; `?camp=bench`
  // has the workbench built already; `?camp=apothecary` (S2, P2j) the workbench and the apothecary
  // bench built, the rack, mortar and hamper made, and the pack holding herbs and shells, standing
  // at the apothecary bench.
  // The camp and tea links stamp the hour they set things up: with `?day=N` they wait for the growing.
  if (params.has('camp') && !back) afterGrow(() => {
    emit('intro:camp-ready', { tent: true, ring: true });
    // `?camp=dawn&hour=7` (P2i): the morning after a fire-night, the ring banked to embers with its
    // charcoal and ash, a handful of withies and a pouch of ash in the pack, standing at the ring.
    if (params.get('camp') === 'dawn') {
      const h = clock.worldT() / 3600;
      updateStore('camp', (c) => ({ ...c, fire: { ...c.fire, state: 'embers', sinceHour: h - 8, flameUntilHour: h - 8, litDays: 3, lastLitDay: Math.floor(h / 24) - 1, nights: [Math.floor(h / 24)], carry: null } }));
      for (const [k, n] of [['willow.withies', 1], ['ash', 2], ['sticks', 2]]) pack.add(/** @type {string} */ (k), /** @type {number} */ (n));
    }
    const apo = params.get('camp') === 'apothecary';
    // `?camp=benches` (the season check's benches set-up, October 29, 2026): both benches built and
    // nothing made on them yet, the pack holding the rack's, mortar's and hamper's parts.
    const benchesLink = params.get('camp') === 'benches';
    // `?camp=hearth` (S4, S5): the workbench built, the hearth stones set, the cooking pot and the
    // cup fired in their places, clay, sand and crushed shell in the pack, standing at the ring;
    // `&fire=lit|embers|cold` sets the fire.
    const hearthLink = params.get('camp') === 'hearth';
    // `?camp=carriers` (P2f): the workbench built and the pack holding a satchel's and a basket's parts.
    const carriersLink = params.get('camp') === 'carriers';
    // `?camp=gift` (B1 C1): the workbench built and the pack holding the gift stone's parts.
    const giftLink = params.get('camp') === 'gift';
    // `?camp=nest` (the hen's slice 4): the workbench built and the pack holding the nest box's parts.
    const nestLink = params.get('camp') === 'nest';
    // `?camp=shelf` (B2): the workbench built, the keepsake shelf made beside the tent with sixteen
    // keepsakes on it (`&keep=N` that many, 0 to 16), and you standing in front of it; `&make` leaves
    // the shelf unmade with its parts (a stick, woven twigs, rush cord) in the pack, at the workbench.
    const shelfLink = params.get('camp') === 'shelf', shelfMake = shelfLink && params.has('make');
    // `?camp=canvas` (B1 C2, C-35; tools/canvas-check.html): your tent as pitched `&age=` seasons ago
    // (0 by default), with the same tent new, after one season and after a year in a row behind it,
    // and the view stood back to see them all; `&row=0,2,8` other ages; `&sort` those tents drawn as
    // the shader sorts their paint (wood red, lining blue, canvas green, patches yellow).
    if (params.get('camp') === 'canvas') {
      const row = params.has('row') ? (params.get('row') ?? '').split(',').filter((v) => v !== '').map(Number).filter(Number.isFinite) : [0, 1, 4];
      const t = camp.debug.canvasAge(Number(params.get('age')) || 0, row, params.has('sort'));
      // From the tents' side, a little up, the row's middle in view.
      if (t) {
        const mid = (row.length * campRecipe.canvas.checkGapM) / 2, cx = t.x - Math.sin(t.yaw) * mid, cz = t.z - Math.cos(t.yaw) * mid;
        camera.setPose({ ...camera.pose(), target: [cx, terrain.sampleHeight(cx, cz) + 0.7, cz], yaw: t.yaw + 1.2,
          distance: 4 + row.length * 1.8, pitch: (14 * Math.PI) / 180 });
      }
    }
    const kit = carriersLink ? [['rushes.stems', 1], ['willow.withies', 1], ['rush-cord', 4]]
      : giftLink ? [['flat-stones', 1], ['shells', 2]]
      : nestLink ? [['sticks', 1], ['rushes.stems', 2]]
      : shelfLink ? (shelfMake ? [['sticks', 1], ['woven-twigs', 1], ['rush-cord', 1]] : [])
      : benchesLink ? [['willow.withies', 1], ['sticks', 1], ['rush-cord', 2], ['flat-stones', 1], ['pebbles', 1], ['rushes.stems', 2], ['clay', 1], ['watermint.leaves', 1]] : apo ? (params.has('eggs') ? [['sticks', 1]] : [['shells', 3], ['watermint.leaves', 2], ['chamomile.flowers', 2], ['sticks', 3], ['pebbles', 2], ['rushes.stems', 3]])
      : hearthLink ? (params.has('eggs') ? [['sticks', 1]] : [['clay', 3], ['sand', 2], ['crushed-shell', 1], ['sticks', 3]])
      : [['flat-stones', 3], ['sticks', 2], ['rush-cord', 1], ['pebbles', 2]];
    for (const [k, n] of kit) pack.add(/** @type {string} */ (k), /** @type {number} */ (n));
    if (params.get('camp') === 'bench' || apo || benchesLink || hearthLink || carriersLink || giftLink || nestLink || shelfLink) camp.stations.debug.buildNow('workbench');
    if (shelfLink && !shelfMake) {
      camp.stations.debug.placeNow('keepsake-shelf');
      const n = params.has('keep') ? Math.max(0, Math.min(16, Number(params.get('keep')) || 0)) : 16;
      updateStore('keepsakes', () => testShelf(keepsakesRecipe, n, clock.worldT() / 3600));
    }
    // `&eggs` (the hen's slice 4): two eggs, a pinch of sea salt, eggshells and grit in the pack; at
    // the hearth, the cooking pot full of spring water, so `?camp=hearth&fire=lit&eggs` cooks at once.
    if (params.has('eggs')) {
      for (const [k, n] of [['egg', 2], ['sea-salt', 1], ['eggshells', 1], ['grit', 1]]) pack.add(/** @type {string} */ (k), /** @type {number} */ (n));
    }
    if (benchesLink) camp.stations.debug.buildNow('apothecary');
    if (apo) { camp.stations.debug.buildNow('apothecary'); for (const m of ['rack', 'mortar', 'hamper']) camp.stations.debug.placeNow(m); }
    if (hearthLink) {
      // `&shaped` is the look of it all at once (tools/hearth-check.html): every piece fired, a pale
      // bowl, cup and tea pot on the bench and a bowl firing. Without it, the tea pot and bowls are
      // still to shape and fire. `&shaped=pot` (the season check's set-up): a tea pot shaped and waiting
      // pale on the workbench, ready to lay at the fire.
      camp.hearth.debug.setUp(params.get('shaped') === 'pot' ? { shaped: ['tea-pot'] }
        : params.has('shaped') ? { fired: ['cooking-pot', 'tea-pot', 'cup'], shaped: ['bowl', 'cup', 'tea-pot'], firing: ['bowl'] } : {});
      const f = params.get('fire');
      if (f === 'lit' || f === 'embers' || f === 'cold') camp.debug.fireAs(f);
      if (params.has('eggs')) updateStore('camp', (c) => setWater(c, 'cooking-pot', 'fresh'));
    }
    const rp = hearthLink ? camp.ringPlace() : null, pad = getStore('campPad');
    // At the ring, on the pad's side of it, a little round so the workbench shows too.
    const ringAt = rp && pad ? (() => { const a = Math.atan2(pad.z - rp.z, pad.x - rp.x) - 0.5;
      return { x: rp.x, z: rp.z, stand: { x: rp.x + Math.cos(a) * 1.2, z: rp.z + Math.sin(a) * 1.2 } }; })() : null;
    // At the shelf: beside it, so the low view takes in you and the whole shelf from its front.
    const shelfAt = shelfLink && !shelfMake ? camp.shelf.at() : null;
    const shelfSide = shelfAt ? shelfPoint(shelfAt, campRecipe.keepsakeShelf.testStandM) : null;
    const at = hearthLink ? ringAt : shelfAt && shelfSide ? { x: shelfAt.x, z: shelfAt.z, stand: { x: shelfSide[0], z: shelfSide[2] } } : camp.stations.benchAt(apo ? 'apothecary' : 'workbench');
    if (params.get('camp') !== 'canvas' && at && walk.placeAt(at.stand.x, at.stand.z, Math.atan2(at.x - at.stand.x, at.z - at.stand.z), 'stand')) {
      const p = camera.pose();
      camera.setPose({ ...p, target: [at.stand.x, terrain.sampleHeight(at.stand.x, at.stand.z), at.stand.z],
        yaw: shelfAt ? shelfAt.yaw + campRecipe.keepsakeShelf.testViewRad : Math.atan2(at.x - at.stand.x, at.z - at.stand.z) + Math.PI + 0.9,
        distance: campRecipe.rest.viewDistanceM, pitch: (campRecipe.rest.viewPitchDeg * Math.PI) / 180 });
      walk.downHere();
    }
  });
}

/** @param {import('./context.js').AppContext} ctx */
export async function teas(ctx) {
  const { afterGrow, back, camera, camp, campRecipe, pack, params, terrain, walk } = ctx;
  // `?teas` (a test link, unsaved; P2e): the camp ready, the tea pot fired, full of spring water and on
  // the hearth over a lit fire, the cup fired, the apothecary bench, rack and hamper made with a
  // dried bunch of chamomile on the rack (for Deep rest), a handful of each tea herb in the pack, and
  // you standing at the ring.
  const cookRecipe = await loadRecipe('world/cook');
  if (params.has('teas') && !back && !params.has('camp')) afterGrow(() => {
    emit('intro:camp-ready', { tent: true, ring: true });
    for (const id of ['workbench', 'apothecary']) camp.stations.debug.buildNow(id);
    for (const m of ['rack', 'mortar', 'hamper']) camp.stations.debug.placeNow(m);
    camp.hearth.debug.setUp({ fired: ['tea-pot', 'cup', 'cooking-pot'] });
    camp.debug.fireAs('lit');
    const h = clock.worldT() / 3600;
    camp.stations.keeps.rack.hang('chamomile.flowers', 2);
    updateStore('camp', (c) => ({ ...c, slots: c.slots.map((/** @type {any} */ s) => (s.slot === 'pot-tea' || s.kind === 'tea-pot' ? { ...s, water: 'fresh' }
      : s.kind === 'rack' ? { ...s, bunches: (s.bunches ?? []).map((/** @type {[string, number, number]} */ b) => [b[0], b[1], h - 24 * 4]) } : s)) }));
    for (const herb of Object.values(cookRecipe.teas.herbs)) pack.add(/** @type {string} */ (herb), 1);
    const rp = camp.ringPlace(), pad = getStore('campPad');
    if (rp && pad) {
      const a = Math.atan2(pad.z - rp.z, pad.x - rp.x) - 0.5, sx = rp.x + Math.cos(a) * 1.2, sz = rp.z + Math.sin(a) * 1.2, yaw = Math.atan2(rp.x - sx, rp.z - sz);
      if (walk.placeAt(sx, sz, yaw, 'stand')) {
        camera.setPose({ ...camera.pose(), target: [sx, terrain.sampleHeight(sx, sz), sz], yaw: yaw + Math.PI + 0.9, distance: campRecipe.rest.viewDistanceM, pitch: (campRecipe.rest.viewPitchDeg * Math.PI) / 180 });
        walk.downHere();
      }
    }
  });
}

/** @param {import('./context.js').AppContext} ctx */
export function spring(ctx) {
  const { afterGrow, back, camera, camp, campRecipe, pack, params, terrain, walk } = ctx;
  // `?spring` (a test link, unsaved; the spring-ore plan): ore at the bench. The camp ready, the
  // workbench and the clay furnace built and dry, ore, charcoal, sticks, a lump of iron and deep clay
  // in the pack, and you standing at the furnace. `&furnace=burning` lays a load of copper ore in an
  // hour ago (with `&hour=21` it glows); `&furnace=done` has iron waiting behind the arch.
  // (`?spring=spawn` and the rest are the spring creatures'; `?spring=cave` goes straight to the cave.)
  if (params.get('spring') === '' && !back && !params.has('camp')) afterGrow(() => {
    emit('intro:camp-ready', { tent: true, ring: true });
    for (const id of ['workbench', 'furnace']) camp.stations.debug.buildNow(id);
    const h = clock.worldT() / 3600, f = params.get('furnace');
    const load = f === 'burning' ? { id: 'smelt-copper', gives: 'copper', count: 1, laidHour: h - 1 } : f === 'done' ? { id: 'smelt-iron', gives: 'iron', count: 1, laidHour: h - 30 } : null;
    updateStore('camp', (c) => ({ ...c, slots: c.slots.map((/** @type {any} */ q) => (q.slot === 'furnace' ? { ...q, placedHour: h - 48, ...(load ? { load } : {}) } : q)) }));
    for (const [k, n] of [['iron-ore', 2], ['copper-ore', 1], ['charcoal-sticks', 2], ['sticks', 2], ['iron', 1], ['deep-clay', 2]]) pack.add(/** @type {string} */ (k), /** @type {number} */ (n));
    const at = camp.stations.benchAt('furnace');
    if (at && walk.placeAt(at.stand.x, at.stand.z, Math.atan2(at.x - at.stand.x, at.z - at.stand.z), 'stand')) {
      camera.setPose({ ...camera.pose(), target: [at.stand.x, terrain.sampleHeight(at.stand.x, at.stand.z), at.stand.z], yaw: Math.atan2(at.x - at.stand.x, at.z - at.stand.z) + Math.PI + 0.9,
        distance: campRecipe.rest.viewDistanceM, pitch: (campRecipe.rest.viewPitchDeg * Math.PI) / 180 });
      walk.downHere();
    }
  });
}
