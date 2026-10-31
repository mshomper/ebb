// @ts-check
// The keepsake shelf at camp (B2, Matt, October 30, 2026): its make is a stick, woven twigs and rush
// cord into the shelf slot, with parts no other make or build takes; its sixteen spots run top left
// to bottom right on the model's planks; every keepsake family sits inside its spot on the plank (a
// bottle stood up, flat things leant back), the same every time; a click's ray finds the shelf and
// the letter tin; the eased view looks at its front; the camp page names it; and an older camp
// section (no shelf) reads as before.

import { layout, partKinds, cleanCook, recordMade } from '../src/world/camp/making.js';
import { cleanCamp, inSlot } from '../src/world/camp/model.js';
import { shelfFit, shelfPoint, rayShelfBox, shelfLook, meshBounds, testShelf } from '../src/world/camp/shelf-fit.js';
import { keepsakeMesh } from '../src/world/keepsakes/families/index.js';
import { cleanShelf, SHELF_CAP } from '../src/world/keepsakes/shelf.js';
import { campView, campFirsts } from '../src/ui/journal-camp.js';
import { padOf } from '../src/world/camp/layout.js';
import { makeIcon } from '../src/ui/icons/item-registry.js';

const G = 'camp: keepsake shelf';
/** @param {string} p */
const load = async (p) => (await fetch(new URL(`../recipes/${p}.json`, import.meta.url))).json();

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addKeepsakeShelfTests(test, assert, eq) {
  test(G, 'made at the workbench from a stick, woven twigs and rush cord, into the shelf slot; no other make or build takes the same parts', async () => {
    const C = await load('world/cook'), s = cleanCook(null), m = C.makes['keepsake-shelf'];
    eq(JSON.stringify(m.parts), JSON.stringify(['sticks', 'woven-twigs', 'rush-cord']), 'its parts (Matt, October 30, 2026)');
    eq(m.at, 'workbench', 'at the workbench');
    eq(m.out, 'slot', 'it stands in a camp slot');
    eq(m.slot, 'shelf', 'the shelf slot');
    eq(m.max, 1, 'only one');
    const L = layout(C, 'workbench', ['rush-cord', 'sticks', 'woven-twigs'], s, { filled: () => true });
    assert(L.complete && L.make === 'keepsake-shelf', `laid in any order, it is the shelf (${L.make})`);
    assert(layout(C, 'workbench', ['rush-cord', 'sticks', 'woven-twigs'], recordMade(s, 'keepsake-shelf', 4), { filled: () => true }).make !== 'keepsake-shelf', 'once made it is not offered again');
    eq(layout(C, 'workbench', ['woven-twigs', 'flat-stones', 'rush-cord'], s, { filled: () => true }).make, 'shovel', 'the shovel keeps its own (a flat stone)');
    const key = (/** @type {any[]} */ parts) => parts.map((p) => partKinds(p).slice().sort().join('|')).sort().join(' + ');
    const mine = key(m.parts);
    for (const [id, o] of Object.entries(C.makes)) if (id !== 'keepsake-shelf') assert(key(/** @type {any} */ (o).parts) !== mine, `${id} takes other parts`);
    for (const [id, b] of Object.entries(C.builds)) {
      const parts = /** @type {any} */ (b).parts.flatMap((/** @type {[string, number]} */ [k, n]) => Array(n).fill(k));
      assert(key(parts) !== mine, `the ${id} build takes other parts`);
    }
    for (const k of ['pageNames', 'pageParts', 'made']) assert(C.words[k]['keepsake-shelf'], `the camp page's ${k} has the shelf`);
    assert(C.words.page.sketchNames.shelf, 'the camp sketch names it');
    eq(makeIcon('keepsake-shelf'), 'keepsake-shelf', 'a drawn item icon');
  });

  test(G, 'the slot takes the shelf and blocks the walk; the model, its sixteen spots and the card words are in the camp recipe', async () => {
    const R = await load('world/camp'), S = R.keepsakeShelf;
    for (const id of ['land/starter-island-2', 'land/starter-island']) {
      const sl = (await load(id)).camp.slots.find((/** @type {any} */ q) => q.id === 'shelf');
      assert(sl.kinds.includes('keepsake-shelf') && sl.blocks, `${id}: the shelf slot`);
    }
    const file = R.props.models[S.model]?.file;
    assert(file, 'the model is one of the camp props');
    const r = await fetch(new URL(`../${file}`, import.meta.url));
    assert(r.ok, `${file} is there`);
    eq(S.slotsM.length, SHELF_CAP, 'sixteen spots');
    for (let i = 1; i < 16; i++) {
      const a = S.slotsM[i - 1], b = S.slotsM[i];
      assert(i % 4 === 0 ? b[1] < a[1] - 0.2 : b[0] > a[0] + 0.2 && b[1] === a[1], `spot ${i + 1} follows spot ${i}: left to right, then the plank below`);
    }
    assert(S.slotsM.every((/** @type {number[]} */ p) => Math.abs(p[0]) < S.boxM[1][0] && p[1] < S.boxM[1][1] && p[2] < S.boxM[1][2]), 'every spot inside the shelf');
    for (const k of ['name', 'line', 'empty', 'open', 'letters', 'tinName', 'tinLine', 'tinNone']) assert(R.words.keepsakeShelf[k], `card words: ${k}`);
  });

  test(G, 'every family sits in its spot on the plank, under the plank above, the same every time; a bottle stands', async () => {
    const R = await load('world/camp'), K = await load('world/keepsakes'), S = R.keepsakeShelf, F = S.fit;
    const s = testShelf(K, 16, 500);
    eq(s.shelf.length, 16, 'a full test shelf');
    eq(cleanShelf(s).shelf.length, 16, 'it is a shelf the save keeps');
    const gap = S.slotsM[1][0] - S.slotsM[0][0], under = S.slotsM[0][1] - S.slotsM[4][1];
    for (const e of s.shelf) {
      const raw = keepsakeMesh(e.n, K), f = shelfFit(raw, e.n, S, e.id), b = meshBounds(f.mesh.vertices, f.mesh.count);
      const [w, h, d] = f.size;
      assert(Math.abs(b.lo[1]) < 1e-5, `${e.n.family}: its base on the plank (${b.lo[1]})`);
      assert(w <= F.maxWideM + 1e-6 && w < gap, `${e.n.family}: no wider than its spot (${w.toFixed(3)})`);
      assert(h <= F.maxHighM + 1e-6 && h < under, `${e.n.family}: under the plank above (${h.toFixed(3)})`);
      assert(d <= F.maxDeepM + 1e-6, `${e.n.family}: no deeper than the plank holds (${d.toFixed(3)})`);
      assert(Math.max(w, h, d) >= Math.min(F.minM, F.maxWideM, F.maxHighM) - 1e-6, `${e.n.family}: big enough to see (${Math.max(w, h, d).toFixed(3)})`);
      assert(f.mesh.vertices.every(Number.isFinite), `${e.n.family}: finite`);
      eq(raw.vertices[0], keepsakeMesh(e.n, K).vertices[0], `${e.n.family}: the mesh as built is left alone`);
      const again = shelfFit(keepsakeMesh(e.n, K), e.n, S, e.id);
      assert(again.mesh.vertices.every((v, i) => v === f.mesh.vertices[i]), `${e.n.family}: the same every time`);
      if (e.n.family === 'bottle') assert(f.pose === 'stand' && h > w, `the bottle stands (${h.toFixed(3)} tall, ${w.toFixed(3)} wide)`);
      if (S.families[e.n.family]?.leanDeg) assert(f.pose === 'lean' && h > d * 0.5, `${e.n.family} leans back against the boards`);
    }
  });

  test(G, "a click's ray finds the shelf and the tin on top; the eased view looks at its front", async () => {
    const S = (await load('world/camp')).keepsakeShelf;
    const at = { x: 3, y: 1, z: -2, yaw: 0.7 };
    // From in front, level with the second plank, looking straight at it.
    const front = shelfPoint(at, [0, 0.8, 2]), into = [-Math.sin(at.yaw), 0, -Math.cos(at.yaw)];
    assert(Number.isFinite(rayShelfBox(front, into, at, S.boxM[0], S.boxM[1])), 'a ray at its front meets it');
    const beside = shelfPoint(at, [1.5, 0.8, 2]);
    assert(!Number.isFinite(rayShelfBox(beside, into, at, S.boxM[0], S.boxM[1])), 'a ray beside it misses');
    const T = S.letterTinM, h = S.tinHalfM, above = shelfPoint(at, [T[0], T[1] + 2, T[2]]);
    assert(Number.isFinite(rayShelfBox(above, [0, -1, 0], at, T.map((v, i) => v - h[i]), T.map((v, i) => v + h[i]))), 'straight down onto the tin meets it');
    const L = shelfLook(at, { ...S, look: { ...S.look, minDistanceM: 0 } }), c = Math.cos(L.pitchDeg * Math.PI / 180);
    const eye = [L.target[0] + Math.sin(L.yaw) * L.distance * c, L.target[1] + Math.sin(L.pitchDeg * Math.PI / 180) * L.distance, L.target[2] + Math.cos(L.yaw) * L.distance * c];
    const from = shelfPoint(at, S.look.fromM);
    assert(Math.hypot(eye[0] - from[0], eye[1] - from[1], eye[2] - from[2]) < 1e-6, "the eased eye is at the model's look_from");
    const facing = [Math.sin(at.yaw), Math.cos(at.yaw)];
    assert(shelfLook(at, S).distance >= S.look.minDistanceM, 'never nearer than minDistanceM');
    assert((eye[0] - at.x) * facing[0] + (eye[2] - at.z) * facing[1] > 1, 'in front of the shelf');
  });

  test(G, 'the camp page names the shelf once made; an older camp with no shelf reads as before', async () => {
    const C = await load('world/cook'), words = await load('world/journal'), land = await load('land/starter-island-2');
    const pad = padOf(land);
    const old = cleanCamp({ slots: [{ slot: 'ring', kind: 'ring', seed: 1, placedHour: 3 }] });
    eq(inSlot(old, 'shelf'), null, 'no shelf on an older camp');
    const camp = cleanCamp({ ...old, slots: [...old.slots, { slot: 'shelf', kind: 'keepsake-shelf', seed: 9, placedHour: 40 }] });
    eq(inSlot(camp, 'shelf')?.kind, 'keepsake-shelf', 'the slot record is kept');
    const cook = { made: { 'keepsake-shelf': 40 } };
    const first = campFirsts(C, camp, cook).find((f) => f.id === 'keepsake-shelf');
    eq(first?.parts.join(), 'sticks,woven-twigs,rush-cord', 'its first, with its parts');
    const html = campView(C, camp, cook, pad, words);
    assert(html.includes(C.words.page.sketchNames.shelf), 'the sketch names it');
    assert(html.includes(C.words.pageNames['keepsake-shelf']), 'the firsts name it');
    assert(!campView(C, old, {}, pad, words).includes(C.words.page.sketchNames.shelf), 'not before it is made');
  });
}
