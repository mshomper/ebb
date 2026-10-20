// @ts-check
// Finds tests for tools/unit-tests.html (docs/future/11): which cells each kind may live in (a rock
// pool is a hollow that reaches the tide band), and groups that are the same for the same seed,
// with lugworm casts laid fresh each tide and periwinkles only drifting; shells the same for the same
// tide, rare ones only near spring, and a shells page that keeps each kind found.

import { findCells, groupAt, shellAt } from '../src/world/finds/index.js';
import { barnacleMesh, barnacleLayout, pondSkaterMesh, proceduralMeshes } from '../src/world/finds/procedural.js';
import { WATER_CLASS } from '../src/world/water/summary.js';
import { initialJournal, foundFind } from '../src/world/journal/observe.js';
import { describe } from '../src/world/journal/describe.js';
import { triggered } from '../src/world/journal/web.js';
import { drawSketch, hasSketch } from '../src/ui/sketches/index.js';
import { ICON_NAMES } from '../src/ui/icons/icons.js';

const FINDS = 'finds';

async function findsRecipe() {
  const r = await fetch('../recipes/species/finds.json');
  if (!r.ok) throw new Error(`recipes/species/finds.json: HTTP ${r.status}`);
  return r.json();
}

/**
 * A row of six cells: 0 wrack, 1 wetSand, 2 and 3 one basin whose rim (2) is in the tide band and
 * whose floor (3) is below it, 4 and 5 a second basin wholly above the band.
 */
function row() {
  const ids = ['wrack', 'wetSand'];
  const zone = new Uint8Array([1, 2, 0, 0, 0, 0]);
  const basin = new Uint16Array([0, 0, 7, 7, 9, 9]);
  const band = new Uint8Array([1, 1, 1, 0, 0, 0]);
  const cls = new Uint8Array([0, 0, WATER_CLASS.still, WATER_CLASS.still, WATER_CLASS.still, WATER_CLASS.still]);
  return { s: { rect: { x: 0, y: 0, w: 6, h: 1 }, cls, basin, band }, z: { zone, ids } };
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addFindsTests(test, assert, eq) {
  test(FINDS, 'finds live in their zones, anemones only in rock pools that reach the tide', async () => {
    const K = (await findsRecipe()).kinds;
    const { s, z } = row();
    const c = findCells(s, z, K, () => true);
    eq(c.periwinkle.join(','), '0', 'periwinkles on the wrack');
    eq(c.lugworm.join(','), '1', 'casts on the wet sand');
    eq(c.anemone.join(','), '2,3', 'anemones in the tidal pool, its deep floor too, not in the high hollow');
    eq(c.hermitcrab.join(','), '2,3', 'hermit crabs in the tidal pool only');
    eq(c.ediblecrab.join(','), '0,2,3', 'edible crabs in the wrack and the tidal pool');
    const bare = findCells(s, z, K, () => false);
    eq(bare.anemone.length, 0, 'a hollow dug in sand holds no anemones');
    eq(c.barnacles.join(','), '0', 'barnacles on the rock of the wrack');
    eq(c.pondskaters.join(','), '4,5', 'pond skaters on the high hollow, never in the tidal pool');
  });

  test(FINDS, 'pond skaters only on still fresh water: not the sea, the tide band, a rock pool or moving water', async () => {
    const K = (await findsRecipe()).kinds;
    const C = WATER_CLASS;
    // 0 sea; 1 still in the band; 2 still pond off the band; 3 slow stream; 4 a rock pool's deep
    // floor (its basin reaches the band at 5); 6 damp ground; 7 still in a channelled zone, off the band.
    const cls = new Uint8Array([C.sea, C.still, C.still, C.slow, C.still, C.still, C.damp, C.still]);
    const band = new Uint8Array([1, 1, 0, 0, 0, 1, 0, 0]);
    const basin = new Uint16Array([0, 0, 4, 0, 6, 6, 0, 8]);
    const zone = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]);
    const s = { rect: { x: 0, y: 0, w: 8, h: 1 }, cls, basin, band };
    const c = findCells(s, { zone, ids: ['channelled'] }, K, () => true);
    eq(c.pondskaters.join(','), '2,7', 'only the still water off the band and out of any tidal hollow');
    eq(c.barnacles.join(','), '7', 'barnacles on channelled rock too');
  });

  test(FINDS, 'built meshes: barnacles and pond skaters are the same every load, stand on y = 0, and index truly', async () => {
    const R = await findsRecipe();
    const a = proceduralMeshes(R), b = proceduralMeshes(R);
    eq(Object.keys(a).sort().join(','), 'barnacles-open,barnacles-shut,pondskaters', 'three meshes');
    for (const key of Object.keys(a)) {
      const m = a[key];
      eq(m.vertices.length, m.count * 9, `${key}: 9 floats a vertex`);
      assert(m.indices.length > 0 && m.indices.length % 3 === 0, `${key}: whole triangles`);
      assert(m.indices.every((i) => i < m.count), `${key}: every index names a vertex`);
      assert(m.vertices.every((v) => Number.isFinite(v)), `${key}: no NaN`);
      let lo = Infinity, hi = -Infinity, n = 0;
      for (let i = 0; i < m.count; i++) {
        lo = Math.min(lo, m.vertices[i * 9 + 1]); hi = Math.max(hi, m.vertices[i * 9 + 1]);
        n = Math.max(n, Math.abs(Math.hypot(m.vertices[i * 9 + 3], m.vertices[i * 9 + 4], m.vertices[i * 9 + 5]) - 1));
      }
      eq(lo, 0, `${key}: base on y = 0`);
      assert(hi > 0.001 && hi < 0.02, `${key}: a few millimeters tall at real size (${(hi * 1000).toFixed(1)} mm)`);
      assert(n < 1e-4, `${key}: unit normals`);
      assert(m.vertices.every((v, i) => v === b[key].vertices[i]) && m.indices.every((v, i) => v === b[key].indices[i]), `${key}: the same on every load`);
    }
    const S = R.kinds.barnacles.shape;
    const cones = barnacleLayout(S);
    assert(cones.length >= S.count[0] && cones.length <= S.count[1], `${cones.length} cones in a patch`);
    for (const c of cones) assert(Math.hypot(c.x, c.z) + c.r <= S.patchRadiusM * (1 + S.roughness) + 1e-9, 'every cone inside the patch');
    assert(barnacleMesh(S, true).count > barnacleMesh(S, false).count, 'open, the cirri add to the shut patch');
    const P = R.kinds.pondskaters.shape, sk = pondSkaterMesh(P);
    let x0 = Infinity, x1 = -Infinity, pale = 0;
    for (let i = 0; i < sk.count; i++) {
      x0 = Math.min(x0, sk.vertices[i * 9]); x1 = Math.max(x1, sk.vertices[i * 9]);
      if (sk.vertices[i * 9 + 6] === Math.fround(P.dimpleAlbedo[0]) && sk.vertices[i * 9 + 1] === 0) pale++;
    }
    assert(x1 - x0 > P.bodyLengthM, 'its legs splay wider than its body is long');
    assert(Math.abs(x1 + x0) < 1e-6, 'and it is the same both sides');
    assert(pale > 0, 'pale dimple rings lie flat on the water');
    return `${cones.length} barnacles; ${a['barnacles-open'].indices.length / 3} and ${sk.indices.length / 3} triangles`;
  });

  test(FINDS, 'barnacles and pond skaters have pages, icons, sketches with their labels, and a joined trigger for the frogs', async () => {
    const words = await (await fetch('../recipes/world/journal.json')).json();
    for (const id of ['barnacles', 'pondskaters']) {
      const rec = words.species[id];
      assert(rec && rec.kind === 'find' && words.findOrder.includes(id), `${id} is a find in findOrder`);
      assert(ICON_NAMES.includes(rec.icon), `${id}'s icon is drawn`);
      assert(hasSketch(id), `${id} has a sketch`);
      const labels = Object.fromEntries(Object.entries(rec.sketch.labels).map(([k, v]) => [k, /** @type {any} */ (v).text]));
      for (const stage of /** @type {(0|1|2)[]} */ ([0, 1, 2])) {
        const svg = drawSketch(id, { stage, labels, scale: rec.sketch.scale });
        assert(svg.startsWith('<svg') && !/NaN|undefined/.test(svg), `${id} stage ${stage} draws cleanly`);
        if (stage === 0) assert(!svg.includes('<text'), `${id} pencil has no labels`);
        else for (const k of Object.keys(labels)) assert(svg.includes(labels[k][0]), `${id} labels ${k}`);
      }
    }
    const j = (/** @type {string[]} */ flags, /** @type {boolean} */ seen) => /** @type {any} */ ({ species: seen ? { pondskaters: { ever: true } } : {}, flags });
    const ink = 'seen:pondskaters&flag:frogs:seen';
    assert(!triggered(ink, j([], true), null), 'pond skaters seen, but no frogs yet: pencil');
    assert(!triggered(ink, j(['frogs:seen'], false), null), 'frogs, but no pond skaters seen: pencil');
    assert(triggered(ink, j(['frogs:seen'], true), null), 'both: inked');
  });

  test(FINDS, 'the same seed gives the same groups; casts move with the tide, periwinkles only drift', async () => {
    const K = (await findsRecipe()).kinds;
    const dense = (/** @type {any} */ k) => ({ ...k, density: 1 });
    const a = groupAt(11, 'lugworm', 40, dense(K.lugworm), 1, 2, 3);
    const b = groupAt(11, 'lugworm', 40, dense(K.lugworm), 1, 2, 3);
    eq(JSON.stringify(a), JSON.stringify(b), 'same seed, cell and tide, same casts');
    const later = groupAt(11, 'lugworm', 40, dense(K.lugworm), 1, 2, 4);
    assert(JSON.stringify(a) !== JSON.stringify(later), 'the next tide lays fresh casts');
    const p0 = groupAt(11, 'periwinkle', 40, dense(K.periwinkle), 1, 2, 3);
    const p1 = groupAt(11, 'periwinkle', 40, dense(K.periwinkle), 1, 2, 4);
    eq(p0.length, p1.length, 'the same periwinkles next tide');
    for (let i = 0; i < p0.length; i++) {
      eq(p0[i].key, p1[i].key, 'each keeps its name');
      assert(Math.hypot(p0[i].x - p1[i].x, p0[i].z - p1[i].z) <= K.periwinkle.driftM * 2 * 1.2 + 1e-9, 'and creeps only a little');
    }
    let n = 0;
    for (let k = 0; k < 2000; k++) n += groupAt(5, 'anemone', k, K.anemone, 0, 0, 0).length > 0 ? 1 : 0;
    assert(Math.abs(n / 2000 - K.anemone.density) < 0.05, `about density of cells hold anemones (${(n / 2000).toFixed(2)})`);
  });

  test(FINDS, 'shells: the same tide leaves the same shell; rare ones only come near spring tides', async () => {
    const S = (await findsRecipe()).kinds.shells;
    eq(JSON.stringify(shellAt(7, 123, 40, 0.2, S)), JSON.stringify(shellAt(7, 123, 40, 0.2, S)), 'same seed, cell and tide, same shell');
    const rare = S.items.filter((/** @type {any} */ i) => i.springMin !== undefined).map((/** @type {any} */ i) => i.id);
    /** @type {Record<string, number>} */ const neap = {}, spring = {};
    for (let k = 0; k < 20000; k++) {
      const a = shellAt(7, k, 40, -0.5, S), b = shellAt(7, k, 40, 1, S);
      if (a) neap[a.item] = (neap[a.item] ?? 0) + 1;
      if (b) spring[b.item] = (spring[b.item] ?? 0) + 1;
    }
    for (const id of rare) assert(!neap[id], `no ${id} on a neap tide's line`);
    for (const id of rare) assert((spring[id] ?? 0) > 0, `a ${id} now and then on the highest tide's line`);
    assert((spring.periwinkle ?? 0) > (spring.murex ?? 0) * 5, 'common shells far outnumber rare ones');
    let moved = 0;
    for (let k = 0; k < 400; k++) if (JSON.stringify(shellAt(7, k, 40, 0.2, S)) !== JSON.stringify(shellAt(7, k, 41, 0.2, S))) moved++;
    assert(moved > 0, 'the next tide leaves different shells');
  });

  test(FINDS, 'shells share one page that keeps each kind found, and hints at the rest', async () => {
    const words = await (await fetch('../recipes/world/journal.json')).json();
    const ctx = { state: null, hour: 10, words };
    let j = initialJournal(0);
    j = foundFind(j, 'shells', ctx, 'turret').journal;
    eq(j.species.shells.ever, true, 'the page inks with the first shell');
    const again = foundFind(j, 'shells', ctx, 'turret');
    eq(again.notes.length, 0, 'the same shell again writes nothing');
    const next = foundFind(j, 'shells', ctx, 'cockle');
    eq(next.notes.length, 1, 'a new kind of shell gets its own note');
    j = next.journal;
    const d = /** @type {any} */ (describe(j, 'shells', null, null, words, 10));
    const found = d.collection.filter((/** @type {any} */ c) => c.found).map((/** @type {any} */ c) => c.id).join(',');
    eq(found, 'turret,cockle', 'the page lists the two found');
    assert(d.collection.filter((/** @type {any} */ c) => !c.found).every((/** @type {any} */ c) => c.name === null && c.text), 'the rest are hints, unnamed');
  });
}
