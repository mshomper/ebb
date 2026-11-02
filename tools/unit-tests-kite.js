// @ts-check
// The kite (docs/future/20, 'The kite') for tools/unit-tests.html: the day it washes in (seeded,
// autumn, windy, onshore, after the islet rose), where it lies and the islet's top, whether it may
// fly from where you stand, its flight and the high view's pose, its meshes, the mend at the
// workbench, and the pieces round it (pack kind, icons, belt, thread, hint, sketchbook, test link).

import { washDay, onshore, strandSpot, isletTop, flyState, kiteAt, kitePose, linePoints, segmentBone, viewGoal, freePose, windVec } from '../src/world/kite/rules.js';
import { kiteMesh, lineMesh } from '../src/world/kite/mesh.js';
import { dayRecord } from '../src/world/weather.js';
import { seasonOf, SECONDS_PER_DAY } from '../src/core/clock.js';
import { cleanCook, layout } from '../src/world/camp/making.js';
import { ICON_NAMES } from '../src/ui/icons/icons.js';
import { itemIconFor } from '../src/ui/icons/item-registry.js';
import { hasItemIcon } from '../src/ui/icons/items.js';
import { TEST_PARAMS } from '../src/save/autosave.js';

const G = 'kite';
/** @param {string} p */
const load = async (p) => (await fetch(new URL(`../recipes/${p}.json`, import.meta.url))).json();

/** A plain islet: middle at (100, 0), out along +x, the bar across z; a dome 1.4 m high. */
const L = { x: 100, z: 0, ux: 1, uz: 0, tx: 0, tz: 1, A: 30, B: 17 };
const dome = (/** @type {number} */ x, /** @type {number} */ z) => 1.4 - 2.6 * (((x - 100) / 17) ** 2 + (z / 30) ** 2);

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addKiteTests(test, assert, eq) {
  test(G, 'it washes in on the first windy onshore autumn day after the islet rose, the same day every time', async () => {
    const [S, R] = await Promise.all([load('world/seasons'), load('world/kite')]);
    const o = { weatherSeed: 12345, lean: 0, weather: S.weather, riseDay: 27, L, W: R.wash };
    const d = washDay(o);
    assert(d !== null, 'a day is found within two years');
    const day = /** @type {number} */ (d);
    eq(washDay(o), day, 'the same day again');
    assert(day > 27, 'after the islet rose');
    eq(seasonOf(day * SECONDS_PER_DAY).index, 2, 'in autumn');
    const rec = dayRecord(12345, day, 0, S.weather);
    assert(rec.windStrength >= R.wash.windMin && onshore(rec.windDir, L, R.wash.onshoreDeg), 'windy, onto the bar');
    for (let e = 28; e < day; e++) {
      const r = dayRecord(12345, e, 0, S.weather);
      if (seasonOf(e * SECONDS_PER_DAY).index === 2) assert(!(r.windStrength >= R.wash.windMin && onshore(r.windDir, L, R.wash.onshoreDeg)), `no earlier day (${e})`);
    }
    eq(washDay({ ...o, riseDay: null }), null, 'never before the islet rises');
  });

  test(G, 'onshore means across the bar from either side, never along it', () => {
    // t runs along z: a wind toward -z (pi/2) or +z (-pi/2) is across the bar; along x is not.
    assert(onshore(Math.PI / 2, L, 55) && onshore(-Math.PI / 2, L, 55), 'straight across, both ways');
    assert(!onshore(0, L, 55) && !onshore(Math.PI, L, 55), 'along the bar');
    eq(windVec(0).map((v) => Math.round(v * 1e6) / 1e6).join(), '1,0', 'weather.js: 0 blows toward +x');
  });

  test(G, 'it lies on the strand above the highest tide, near the bar, and the top is the highest ground', async () => {
    const R = await load('world/kite');
    const s = strandSpot(L, dome, 0.69, R.wash);
    assert(s !== null, 'a spot');
    const p = /** @type {{ x: number, z: number }} */ (s), h = dome(p.x, p.z);
    assert(h >= 0.69 + R.wash.aboveTideM && h <= 0.69 + R.wash.aboveTideM + R.wash.bandM, 'between the tide and the band');
    assert(p.x < 100, 'on the near side, where the bar comes in');
    assert(Math.abs(p.z - R.wash.sideM) < 1e-6, 'a step off the walking line');
    const t = isletTop(L, dome);
    assert(Math.hypot(t.x - 100, t.z) < 1.01 && Math.abs(t.y - 1.4) < 0.05, 'the top of the dome');
  });

  test(G, 'it flies only from the islet top in wind: ok, calm, or where', async () => {
    const F = (await load('world/kite')).fly, top = { x: 100, z: 0, y: 1.4 };
    eq(flyState([100, 1.4, 1], top, dome, 0.6, F), 'ok', 'on the top, windy');
    eq(flyState([100, 1.4, 1], top, dome, 0.1, F), 'calm', 'on the top, calm');
    eq(flyState([0, 1, 0], top, () => 1, 0.9, F), 'where', 'on the pond island');
    eq(flyState([100, 0.2, 25], top, dome, 0.9, F), 'where', 'on the islet, low down');
    eq(flyState(null, top, dome, 0.9, F), 'where', 'from above');
  });

  test(G, 'in the air it climbs out downwind to its line, its face to the wind, the line sagging', async () => {
    const F = (await load('world/kite')).fly, hand = [0, 1, 0];
    const k0 = kiteAt(hand, 0, 0, F), k = kiteAt(hand, 0, F.climbS * 2, F);
    assert(k0.len < 1e-6, 'starts in the hand');
    assert(Math.abs(Math.hypot(k.x, k.y - 1, k.z) - F.lineM) < 1e-6, 'at the full line');
    assert(k.x > 0 && k.y > 1 + F.lineM * 0.5, 'downwind (+x) and high');
    const m = kitePose([k.x, k.y, k.z], hand, 3, F);
    assert(m[8] < 0, "its face (+z) turned back toward the wind's source");
    const pts = linePoints(hand, [k.x, k.y, k.z], 1, 6);
    eq(pts.length, 7, 'seven points');
    assert(pts[3][1] < (hand[1] + k.y) / 2, 'sags at its middle');
    const b = segmentBone(pts[0], pts[1]);
    assert(Math.abs(b[8] - (pts[1][0] - pts[0][0])) < 1e-6, "the bone's z column is the segment");
  });

  test(G, 'the high view frames the island, the islet and the stack from behind the kite, looking at their middle', async () => {
    const V = (await load('world/kite')).view;
    const things = [{ x: 0, z: 0, r: 40 }, { x: 100, z: 0, r: 30 }, { x: -20, z: 60, r: 10 }];
    const g = viewGoal(things, [80, 20, 0], (40 * Math.PI) / 180, 0, V);
    assert(g.eye[1] > 20, 'above the kite');
    assert(Math.hypot(g.eye[0] - g.look[0], g.eye[2] - g.look[2]) > Math.hypot(80 - g.look[0], 0 - g.look[2]), 'farther out than the kite');
    const f = freePose(g.eye, g.look);
    const d = [-Math.sin(f.yaw) * Math.cos(f.pitch), Math.sin(f.pitch), -Math.cos(f.yaw) * Math.cos(f.pitch)];
    const to = [g.look[0] - g.eye[0], g.look[1] - g.eye[1], g.look[2] - g.eye[2]], n = Math.hypot(...to);
    assert(Math.abs(d[0] - to[0] / n) + Math.abs(d[1] - to[1] / n) + Math.abs(d[2] - to[2] / n) < 1e-6, 'the free pose looks at the middle');
  });

  test(G, 'its meshes: whole and torn kites and the line, well formed', async () => {
    const K = (await load('world/kite')).look;
    for (const m of [kiteMesh(K, false), kiteMesh(K, true), lineMesh(K)]) {
      eq(m.vertices.length, m.count * 9, 'nine floats a vertex');
      assert(m.indices.length % 3 === 0 && Math.max(...m.indices) < m.count, 'indices in range');
      assert([...m.vertices].every(Number.isFinite), 'finite');
    }
    assert(kiteMesh(K, true).count !== kiteMesh(K, false).count, 'the torn one differs');
  });

  test(G, 'mended at the workbench from the torn kite, rush cord and sticks, a set no other make uses', async () => {
    const C = await load('world/cook');
    const Lk = layout(C, 'workbench', ['torn-kite', 'rush-cord', 'sticks'], cleanCook(null));
    assert(Lk.make === 'kite' && Lk.complete, 'the kite');
    eq(C.makes.kite.out, 'tool', 'a tool (the belt)');
    const key = (/** @type {any[]} */ parts) => parts.map((p) => JSON.stringify(p)).sort().join('|');
    const mine = key(C.makes.kite.parts);
    for (const [id, m] of Object.entries(C.makes)) if (id !== 'kite') assert(key(/** @type {any} */ (m).parts) !== mine, `not ${id}'s set`);
    assert(Object.entries(C.makes).every(([id, m]) => id === 'kite' || !JSON.stringify(/** @type {any} */ (m).parts).includes('torn-kite')), 'only the mend takes the torn kite');
    assert(C.words.made.kite && C.words.pageNames.kite && C.words.pageParts.kite, 'its made line and camp page words');
  });

  test(G, 'the pieces round it: pack kind, icons, belt, thread, hint, sketchbook, test link', async () => {
    const [P, Kt, Th, H, Sb, R, I] = await Promise.all([load('world/pack'), load('world/kit'), load('world/threads'), load('world/morning-hints'), load('world/sketchbook'), load('world/kite'), load('index')]);
    assert(P.kinds.some((/** @type {any} */ k) => k.id === 'torn-kite'), 'the torn kite is a pack kind');
    for (const n of ['kite', 'fly', 'kiteview', 'reel']) assert(ICON_NAMES.includes(n), `the ${n} icon`);
    assert(hasItemIcon('kite') && hasItemIcon('torn-kite'), 'item glyphs');
    assert(itemIconFor('torn-kite') === 'torn-kite', 'the torn kite in the item registry');
    assert(Kt.belt.some((/** @type {any} */ t) => t.id === 'kite' && t.icon === 'kite'), 'on the belt');
    const th = Th.threads.find((/** @type {any} */ t) => t.id === 'kite');
    assert(th && th.icon === 'kite' && th.end.includes('kiteFlown'), 'its thread, finished once flown');
    for (const l of th.lines) assert(Th.tests[l.test], `thread test ${l.test}`);
    const h = H.hints.find((/** @type {any} */ x) => x.id === 'kite');
    assert(h && H.tests[h.when] && H.tests[h.done], 'its morning hint and tests');
    assert(Sb.subjects.includes('kite'), 'a sketchbook page');
    assert(I.recipes['world/kite'], 'listed in the recipe index');
    assert(TEST_PARAMS.includes('kite'), '?kite is a test link (unsaved)');
    for (const w of Object.values(R.words)) assert(!/genuine/i.test(/** @type {string} */ (w)), 'plain words');
  });
}
