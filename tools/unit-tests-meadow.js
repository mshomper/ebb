// @ts-check
// The marker stone and the rye (F20, Matt's calls of November 1, 2026) for tools/unit-tests.html:
// where the stone stands and how it leans, the midsummer spot the noon sun throws through its notch
// (about a meter north), when that light shows (only a midsummer after the islet rose, noon to the
// next morning), the stone's season by its shadow; the rye's wild stalks, the strip a handful sows,
// what a cut takes and the stooks it stands up; the save inside the islet's section; and the pieces
// round it (the flora recipe, the sickle's unique make, pack kinds, icons, journal, threads, hints).

import { stoneSpot, stoneBone, stoneToWorld, midsummerSpot, midsummerNoonH, lightShows, shadowLine } from '../src/world/meadow/stone.js';
import { wildSpots, cutTakes, stooksOf, stookLeftH, stripSpots } from '../src/world/meadow/rye.js';
import { cleanMeadow, emptyMeadow } from '../src/world/meadow/model.js';
import { markerStoneMesh, stookMesh } from '../src/world/meadow/meshes.js';
import { cleanIslet } from '../src/world/islet/model.js';
import { ICON_NAMES } from '../src/ui/icons/icons.js';
import { itemIconFor, makeIcon } from '../src/ui/icons/item-registry.js';
import { hasItemIcon } from '../src/ui/icons/items.js';

const G = 'meadow';
/** @param {string} p */
const load = async (p) => (await fetch(new URL(`../recipes/${p}.json`, import.meta.url))).json();

/** A flat islet 60 by 34 m round the origin, a dome toward +x, grass on its +z half. */
const L = { x: 0, z: 0, A: 30, B: 17, tx: 1, tz: 0, ux: 0, uz: 1 };
const shape = {
  heightAt: (/** @type {number} */ x, /** @type {number} */ z) => 1.2 + 0.3 * Math.exp(-((x - 4) ** 2 + z ** 2) / 50),
  paintAt: (/** @type {number} */ x, /** @type {number} */ z) => (z > 0 ? [0.6, 0.3, 0, 0.1] : [0.05, 0.9, 0, 0.05]),
};

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addMeadowTests(test, assert, eq) {
  test(G, 'the stone stands on the dome, on turf, the same for the same seed, leaning as the recipe says', async () => {
    const R = await load('land/meadow-islet');
    const a = stoneSpot(L, shape, R.stone, 1234), b = stoneSpot(L, shape, R.stone, 1234);
    eq(JSON.stringify(a), JSON.stringify(b), 'seeded: the same spot every load');
    assert(Math.abs(a.x) <= R.stone.spotShare * L.A + 1e-6 && Math.abs(a.z) <= R.stone.spotShare * L.B + 1e-6, 'within the middle of the islet');
    assert(a.z > 0, 'on the grassy side');
    // Its lean carries the top toward leanTowardDeg from north (north is -z).
    const top = stoneToWorld(a, 0, 0, [0, R.stone.heightM, 0]);
    const th = (R.stone.leanTowardDeg * Math.PI) / 180;
    const dx = top[0] - a.x, dz = top[2] - a.z, l = Math.hypot(dx, dz);
    assert(l > 0.1, 'it leans');
    assert(Math.abs(dx / l - Math.sin(th)) < 1e-6 && Math.abs(dz / l + Math.cos(th)) < 1e-6, 'toward the recipe bearing');
    const bone = stoneBone(a.lean, R.stone.sinkM);
    eq(bone.length, 16, 'a mat4 for the pieces pass');
    eq(bone[13], -R.stone.sinkM, 'set into the ground');
  });

  test(G, 'the noon sun through the notch on summer day 0 lands about a meter north of the stone', async () => {
    const R = await load('land/meadow-islet'), M = R.stone.midsummer;
    const st = stoneSpot(L, shape, R.stone, 99);
    const notch = stoneToWorld(st, shape.heightAt(st.x, st.z), R.stone.sinkM, [0, R.stone.heightM - R.stone.notch.depthM, 0]);
    const spot = midsummerSpot(notch, (x, z) => shape.heightAt(x, z), M, { latitudeDeg: 40, tiltDeg: 18 });
    const north = notch[2] - spot.z, d = Math.hypot(spot.x - st.x, spot.z - st.z);
    assert(north > 0, 'north of the notch (the noon sun stands in the south)');
    assert(d > 0.3 && d < 2.2, `about a meter from the stone's foot (${d.toFixed(2)} m)`);
    eq(midsummerNoonH(0, M), 14 * 24 + 12, 'summer day 0 at noon is hour 348 of the first year');
    eq(midsummerNoonH(56 * 24 + 5, M), 56 * 24 + 348, 'and of the second');
  });

  test(G, 'the light shows from midsummer noon to the next morning, and only after the islet rose', async () => {
    const M = (await load('land/meadow-islet')).stone.midsummer;
    const noon2 = 56 * 24 + 348;
    eq(lightShows(noon2 - 1, 27 * 24, M), false, 'not before noon');
    eq(lightShows(noon2, 27 * 24, M), true, 'at noon');
    eq(lightShows(noon2 + 17.5, 27 * 24, M), true, 'still at half past five the next morning');
    eq(lightShows(noon2 + 18, 27 * 24, M), false, 'gone by six');
    eq(lightShows(348, 27 * 24, M), false, "year 1's midsummer came before the islet rose on day 27");
    eq(lightShows(noon2, null, M), false, 'never without the islet');
  });

  test(G, "the stone's season by its noon shadow: shortest at high summer, longest at midwinter", async () => {
    const W = (await load('land/meadow-islet')).meadowWords;
    eq(W.shadow.length, 12, 'twelve thirds of the year');
    assert(shadowLine(348 + 2, W.shadow).includes('shortest'), 'just after midsummer');
    assert(shadowLine(45 * 24, W.shadow).includes('longest'), 'in midwinter');
    for (const l of W.shadow) assert(!/genuine/i.test(l), 'words');
  });

  test(G, 'wild stalks stand at the foot on the side away from the spot; a handful sows a 2 by 6 m strip along your line', async () => {
    const R = await load('land/meadow-islet'), S = await load('world/sowing');
    const st = { x: 3, z: 4, yaw: 0.4, lean: 0.1 };
    const w = wildSpots(st, R.rye.wild);
    eq(w.length, R.rye.wild.count, 'the recipe count');
    const lx = Math.sin(st.yaw), lz = Math.cos(st.yaw);
    for (const p of w) {
      const d = Math.hypot(p.x - st.x, p.z - st.z);
      assert(d >= R.rye.wild.ringM[0] - 1e-6 && d <= R.rye.wild.ringM[1] + 1e-6, 'within the ring');
      assert((p.x - st.x) * lx + (p.z - st.z) * lz > 0, 'on the side it leans toward');
    }
    const T = S.strips.rye, spots = stripSpots([0, 0], [0, 10], T, 7);
    eq(spots.length, T.rows * T.perRow, 'rows times seeds');
    const zs = spots.map((p) => p[1]), xs = spots.map((p) => p[0]);
    assert(Math.max(...zs) - Math.min(...zs) > T.lengthM * 0.8 && Math.max(...zs) - Math.min(...zs) < T.lengthM + 0.3, 'its length along your line');
    assert(Math.max(...xs) - Math.min(...xs) < T.widthM + 0.3, 'its width across');
  });

  test(G, 'a cut takes the grown rye in reach (never the wild stalks) and stands it in stooks with straw and seed shared out', async () => {
    const R = await load('land/meadow-islet'), C = R.rye.cut, K = R.rye.stooks;
    const stone = { x: 0, z: 0 };
    const plants = [];
    for (let i = 0; i < 24; i++) plants.push({ id: i + 1, sp: 'rye', x: 4 + (i % 12) * 0.45, z: (i < 12 ? 0 : 0.5), stage: 4 });
    plants.push({ id: 90, sp: 'rye', x: 0.8, z: 0, stage: 4 }, { id: 91, sp: 'rye', x: 5, z: 0.2, stage: 1 }, { id: 92, sp: 'flax', x: 5, z: 0.1, stage: 4 });
    const took = cutTakes(plants, { x: 4, z: 0 }, stone, C, (p) => p.stage === 3 || p.stage === 4);
    assert(!took.some((p) => p.id === 90), 'the wild stalk by the stone stays');
    assert(!took.some((p) => p.id === 91 || p.id === 92), 'not a shoot, not flax');
    assert(took.length > 8 && took.length < 24, 'a few swings take a strip: one cut takes what is in reach');
    const st = stooksOf(took, C, 100);
    eq(st.length, Math.ceil(took.length / C.perStook), 'up to perStook a stook');
    eq(st.reduce((s, q) => s + q.straw, 0), Math.max(1, Math.round(took.length / C.strawPer)), 'the straw');
    eq(st.reduce((s, q) => s + q.seed, 0), Math.max(1, Math.round(took.length / C.seedPer)), 'the seed');
    eq(stookLeftH(st[0], 100 + K.dryH, K), 0, 'dry after three days');
    assert(stookLeftH({ ...st[0], wetH: 10 }, 100 + K.dryH, K) > 0, 'longer after rain');
  });

  test(G, "it keeps inside the islet's save section, and an older save reads without it", () => {
    eq(JSON.stringify(cleanMeadow(undefined)), JSON.stringify(emptyMeadow()), 'nothing yet');
    const m = cleanMeadow({ version: 1, potH: 1400, lightH: 1392, stooks: [{ x: 1, z: 2, yaw: 0.5, cutH: 1500, straw: 2, seed: 1, wetH: 3 }, { x: 'bad' }] });
    eq(m.potH, 1400, 'the pot');
    eq(m.stooks.length, 1, 'a broken stook is dropped');
    const i = cleanIslet({ version: 1, earnedH: 10, lowH: 600, applied: 1, planted: ['0:harebell', 'meadow:wild'], meadow: m });
    eq(i.meadow.potH, 1400, 'kept by the islet');
    eq(cleanIslet({ version: 1, earnedH: 10, lowH: 600, applied: 1, planted: [] }).meadow, undefined, 'an islet saved before F20 comes back exactly');
  });

  test(G, 'the meshes: a stone with its notch, and stooks', async () => {
    const R = await load('land/meadow-islet');
    const s = markerStoneMesh(R.stone, 5);
    assert(s.mesh.count > 100 && s.mesh.indices.length % 3 === 0, 'a mesh');
    let topMid = -1, topEdge = -1;
    for (let v = 0; v < s.mesh.count; v++) {
      const x = s.mesh.vertices[v * 9], y = s.mesh.vertices[v * 9 + 1];
      if (Math.abs(x) < 0.02) topMid = Math.max(topMid, y);
      if (Math.abs(x) > R.stone.notch.halfWidthM * 1.2) topEdge = Math.max(topEdge, y);
    }
    assert(topEdge - topMid > R.stone.notch.depthM * 0.8, 'the notch cuts down into its top');
    for (let k = 0; k < s.mesh.vertices.length; k++) assert(Number.isFinite(s.mesh.vertices[k]), 'finite');
    const k = stookMesh(R.rye.stooks.look, 3);
    assert(k.count > 0 && k.indices.length % 3 === 0, 'a stook');
  });

  test(G, 'the pieces: rye in the growth lists waiting for autumn, the sickle unique, its kinds, icons, journal, threads and hints', async () => {
    const [F, Gr, Ga, cook, pack, J, web, th, mh, idx] = await Promise.all(['flora/rye', 'world/growth', 'world/gather', 'world/cook', 'world/pack', 'world/journal',
      'world/journal-web', 'world/threads', 'world/morning-hints'].map(load).concat([fetch(new URL('../recipes/index.json', import.meta.url)).then((r) => r.json())]));
    assert(Gr.species.includes('rye') && !Gr.volunteers.order.includes('rye'), 'grown, never a volunteer');
    assert(Object.values(idx.recipes ?? idx).includes('flora/rye.json'), 'registered');
    eq(JSON.stringify(F.growth.sproutWindow), JSON.stringify([2.3, 3]), 'sown seed waits for autumn');
    assert(Ga.plants.parts['rye.seed'], 'its seed gathers');
    const sk = cook.makes.sickle;
    assert(sk && sk.out === 'tool' && sk.unlock === 'sickle', 'the sickle, a tool, opened by the blade');
    const key = (/** @type {any[]} */ parts) => parts.map((p) => (Array.isArray(p) ? p.join('|') : typeof p === 'object' ? JSON.stringify(p) : p)).sort().join('+');
    const same = Object.entries(cook.makes).filter(([id, m]) => id !== 'sickle' && key(/** @type {any} */ (m).parts) === key(sk.parts));
    eq(same.length, 0, 'no other make takes the same parts');
    for (const kind of ['rye-straw', 'sickle-blade']) {
      assert(pack.kinds.some((/** @type {any} */ k) => k.id === kind), `${kind} is a pack kind`);
      assert(hasItemIcon(/** @type {string} */ (itemIconFor(kind))), `${kind} has a drawn glyph`);
    }
    assert(hasItemIcon(/** @type {string} */ (makeIcon('sickle'))), 'the sickle has a drawn glyph');
    assert(hasItemIcon(/** @type {string} */ (itemIconFor('rye.seed'))), 'rye seed has a drawn glyph');
    for (const i of ['rye', 'sheaf', 'stook', 'marker-stone', 'sickle']) assert(ICON_NAMES.includes(i), `icon ${i}`);
    assert(J.order.includes('rye') && J.species.rye, 'the rye page');
    assert(J.findOrder.includes('markerstone') && J.species.markerstone?.kind === 'find', "the stone's page");
    assert(web.nodes.rye && web.nodes.markerstone, 'on the web');
    for (const id of ['rye', 'marker-stone']) {
      const t = th.threads.find((/** @type {any} */ q) => q.id === id);
      assert(t && ICON_NAMES.includes(t.icon), `the ${id} thread`);
      for (const l of t.lines) assert(th.tests[l.test], `its test ${l.test}`);
    }
    for (const id of ['rye-sow', 'stone-notch']) {
      const h = mh.hints.find((/** @type {any} */ q) => q.id === id);
      assert(h && mh.tests[h.when] && mh.tests[h.done], `the ${id} hint`);
    }
  });
}
