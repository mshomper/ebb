// @ts-check
// Placed pieces for tools/unit-tests.html (doc 09, docs/future/10): loose stones as save records,
// the save upgrade that brought them in (src/save/migrate-pieces.js), the handful that comes with the
// naturalist's reward, the cap, a lifted stone's tip, and the Sculpt card's chip rows.

import { cleanPieces, emptyPieces, makeStone, addPiece, removePiece, pieceAt, arrivingStones, tipAngle, tipDone, stoneBone, leanBone, mul4 } from '../src/world/pieces/model.js';
import { stoneShapes } from '../src/world/pieces/meshes.js';
import { pieces5 } from '../src/save/migrate-pieces.js';
import { migrate, FORMAT } from '../src/save/migrate.js';
import { snapshot, restore } from '../src/save/sections.js';
import { encode, decode } from '../src/save/world-file.js';
import { due, grant } from '../src/world/expansion.js';
import { WATER_CLASS } from '../src/world/water/summary.js';
import { waterCellCenter } from '../src/world/water/grid.js';
import { chipRows } from '../src/ui/tools.js';

const G = 'pieces';

/** A small island's parts with these pieces, as app.js hands them to the autosave. @param {any} pieces */
function parts(pieces) {
  return {
    build: 'test', seed: 7, island: 'starter-island', worldT: 3600, flow: /** @type {1} */ (1), world: { tide: { level: 0 } },
    journal: null, water: { springs: [], version: 1 }, unlocks: { stones: true, naturalist: ['shells', 'stones'] }, view: null, looks: {},
    pieces, chunks: {}, mirror: null, savedAt: 1760000000000, wallHighWater: 1760000000000,
  };
}

/**
 * A water summary over a 40 x 40 cell rect: dry ground, a round pond of still fresh water in the
 * middle, and the sea along one edge (its band too), so stones must come by the pond and never the sea.
 */
function pondSummary() {
  const R = { x: 170, y: 170, w: 40, h: 40 }, n = R.w * R.h;
  const cls = new Uint8Array(n), band = new Uint8Array(n), basin = new Uint16Array(n), shore = new Uint8Array(n);
  for (let j = 0; j < R.h; j++) for (let i = 0; i < R.w; i++) {
    const k = j * R.w + i;
    if (Math.hypot(i - 20, j - 20) < 5) { cls[k] = WATER_CLASS.still; basin[k] = 1; }
    if (i < 3) { cls[k] = WATER_CLASS.sea; band[k] = 1; shore[k] = 10; }
  }
  return { rect: R, cls, band, basin, shore };
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addPiecesTests(test, assert, eq) {
  const recipe = fetch('../recipes/world/pieces.json').then((r) => r.json());

  test(G, 'loose stones come back from a save exactly; a missing or broken section comes back empty', async () => {
    const R = await recipe;
    let s = emptyPieces();
    for (let n = 1; n <= 3; n++) s = /** @type {any} */ (addPiece(s, makeStone(99, n, n * 1.5, -2 + n, 40 + n, R), R.cap));
    s = { ...s, arrived: true };
    const { header, sections } = snapshot(parts(s));
    const back = restore((await decode(await encode(header, sections))).sections);
    eq(JSON.stringify(back.pieces), JSON.stringify(s), 'records, next id and arrived');
    eq(JSON.stringify(restore({ meta: {} }).pieces), JSON.stringify(emptyPieces()), 'no section: none');
    eq(restore({ pieces: { list: 'x' } }).pieces.list.length, 0, 'unreadable: none');
    const mixed = cleanPieces({ list: [s.list[0], { ...s.list[1], x: NaN }, { ...s.list[2], kind: 'bridge' }, s.list[0]], nextId: 1 });
    eq(mixed.list.length, 1, 'a bad record, an unknown kind and a repeated id are left out');
    eq(mixed.nextId, 2, 'the next id never reuses one already there');
    return `${header.format === FORMAT ? 'format' : 'FORMAT?'} ${header.format}`;
  });

  test(G, `save format ${FORMAT}: an older island gets an empty pieces list, from 4 and from 2`, () => {
    const up = pieces5({ meta: { worldT: 10 }, unlocks: { cliffs: true } });
    eq(JSON.stringify(up.pieces), JSON.stringify(emptyPieces()), 'an empty list, its stones still to come');
    assert(up.unlocks.cliffs, 'the rest kept');
    const kept = pieces5({ pieces: { version: 1, list: [], nextId: 4, arrived: true } });
    eq(kept.pieces.nextId, 4, 'a pieces section already there is kept');
    const s = { meta: {} };
    pieces5(s);
    assert(!(/** @type {any} */ (s)).pieces, 'the input is not changed');
    const from2 = migrate({ meta: { worldT: 10 }, world: null, journal: { species: {}, flags: ['frogs:happy'], notes: [] }, unlocks: {} }, 2);
    assert(from2.pieces && Array.isArray(from2.pieces.list) && from2.pieces.list.length === 0, 'format 2 ends with an empty pieces list');
    assert(from2.unlocks.cliffs, 'and the steps before ran too');
    eq(FORMAT, 5, 'this build writes format 5');
  });

  test(G, 'the reward has a give: stones at six finds, once', async () => {
    const [N, words] = await Promise.all([fetch('../recipes/world/naturalist.json').then((r) => r.json()), fetch('../recipes/world/journal.json').then((r) => r.json())]);
    const st = N.rewards.find((/** @type {any} */ r) => r.id === 'stones');
    eq(JSON.stringify(st.give), JSON.stringify({ stones: true }), 'give');
    assert(st.title && st.line && st.icon === 'loosestone', 'card words and icon');
    const p = { flags: [], rewards: N.rewards, gifts: {}, words, giftWords: N.gifts };
    const earned = grant({}, due({ ...p, found: 3, earned: {} })[0]);
    eq(due({ ...p, found: 5, earned }).length, 0, 'five finds: not yet');
    const d = due({ ...p, found: 6, earned });
    eq(d.map((g) => g.id).join(), 'stones', 'six finds: stones');
    const e2 = grant(earned, d[0]);
    assert(e2.stones === true && e2.shells && e2.naturalist.includes('stones'), 'stones earned, shells kept');
    eq(due({ ...p, found: 6, earned: e2 }).length, 0, 'given once');
    assert(words.pieces?.stone?.cardLine && words.pieces.stone.lifted, 'the tap card and first-lift note have words');
  });

  test(G, 'the handful comes the same for the same seed and land: by fresh water, never in it, never by the sea', async () => {
    const R = await recipe;
    const summary = pondSummary();
    const run = (/** @type {number} */ seed) => arrivingStones({ seed, summary, material: null, recipe: R, hour: 100, nextId: 1 });
    const a = run(1234), b = run(1234), c = run(4321);
    eq(JSON.stringify(a), JSON.stringify(b), 'the same twice');
    eq(a.length, R.arrive.count, 'a handful');
    assert(JSON.stringify(a) !== JSON.stringify(c), 'another seed, other stones');
    const pond = [waterCellCenter(190), waterCellCenter(190)], radius = 5 * 0.5;
    for (const s of a) {
      const d = Math.hypot(s.x - pond[0], s.z - pond[1]) - radius;
      assert(d > R.arrive.nearM[0] - 0.6 && d < R.arrive.nearM[1] + 0.6, `${s.id} ${d.toFixed(2)} m from the pond`);
      assert(s.size >= R.sizeM[0] && s.size <= R.sizeM[1], 'size within the recipe');
    }
    for (let i = 0; i < a.length; i++) for (let k = i + 1; k < a.length; k++) {
      assert(Math.hypot(a[i].x - a[k].x, a[i].z - a[k].z) >= R.arrive.spacingM - 1e-9, 'apart');
    }
    eq(a.map((s) => s.id).join(), 'p1,p2,p3,p4,p5', 'ids from the next id');
    // No fresh water: none come (they wait for a pond).
    const dry = { ...summary, cls: summary.cls.map((v) => (v === WATER_CLASS.still ? WATER_CLASS.dry : v)) };
    eq(arrivingStones({ seed: 1234, summary: dry, material: null, recipe: R, hour: 1, nextId: 1 }).length, 0, 'only the sea: none');
    // Steep ground: none come there.
    eq(arrivingStones({ seed: 1234, summary, material: null, ground: (x) => x * 2, recipe: R, hour: 1, nextId: 1 }).length, 0, 'too steep: none');
    return a.map((s) => `${s.x.toFixed(1)},${s.z.toFixed(1)}`).join('  ');
  });

  test(G, 'the cap: no more than cap stones, set or come', async () => {
    const R = await recipe;
    let s = emptyPieces();
    for (let n = 1; n <= R.cap; n++) s = /** @type {any} */ (addPiece(s, makeStone(5, n, n, 0, 0, R), R.cap));
    eq(s.list.length, R.cap, 'full');
    eq(addPiece(s, makeStone(5, 99, 0, 0, 0, R), R.cap), null, 'one more is refused');
    const r = removePiece(s, 'p3');
    eq(`${r.removed?.id} ${r.state.list.length}`, `p3 ${R.cap - 1}`, 'one removed');
    assert(addPiece(r.state, makeStone(5, 99, 0, 0, 0, R), R.cap), 'room again');
    const almost = { ...r.state, list: r.state.list.slice(0, R.cap - 2) };
    eq(arrivingStones({ seed: 1, summary: pondSummary(), material: null, recipe: R, hour: 1, nextId: 50, existing: almost.list }).length, 2, 'the handful stops at the cap');
    eq(pieceAt(s.list, 3.05, 0.02, 0.1)?.id, 'p3', 'a tap picks the nearest stone');
  });

  test(G, 'a lifted stone tips about its far edge, holds, and settles back', async () => {
    const R = await recipe;
    const T = R.tip;
    eq(tipAngle(0, T), 0, 'starts flat');
    assert(Math.abs(tipAngle(T.tipS + 0.1, T) - (T.tipDeg * Math.PI) / 180) < 1e-9, 'tipped right up while held');
    eq(tipAngle(T.tipS + T.holdS + T.settleS + 0.01, T), 0, 'back down');
    assert(tipDone(T.tipS + T.holdS + T.settleS, T) && !tipDone(T.tipS, T), 'done after settling');
    const sink = 0.1, dir = [0.6, 0.8], reach = 0.45;
    const M = stoneBone(0.9, sink, dir, reach);
    const apply = (/** @type {number[]} */ p) => [0, 1, 2].map((r) => M[r] * p[0] + M[4 + r] * p[1] + M[8 + r] * p[2] + M[12 + r]);
    const pivot = apply([-dir[0] * reach, sink, -dir[1] * reach]);
    assert(Math.abs(pivot[0] + dir[0] * reach) < 1e-6 && Math.abs(pivot[1]) < 1e-6 && Math.abs(pivot[2] + dir[1] * reach) < 1e-6, 'the far edge stays on the ground line');
    assert(apply([dir[0] * reach, sink, dir[1] * reach])[1] > 0.5, 'the near edge rises toward you');
    // Leaning with the ground: up turns all the way to the slope's normal at share 1.
    const Lb = leanBone(0.5, 0, 1);
    const n = [-0.5, 1, 0].map((v) => v / Math.hypot(0.5, 1));
    assert(Math.abs(Lb[4] - n[0]) < 1e-6 && Math.abs(Lb[5] - n[1]) < 1e-6 && Math.abs(Lb[6]) < 1e-6, 'fully leaned, up is the ground normal');
    eq([...mul4(leanBone(0, 0, 1), M)].join(), [...M].join(), 'level ground: no lean');
    const flat = stoneBone(0, sink, dir, reach);
    eq([...flat].map((v) => Math.round(v * 1e6) / 1e6).join(), `1,0,0,0,0,1,0,0,0,0,1,0,0,${-sink},0,1`, 'flat: only set into the ground');
  });

  test(G, 'stone shapes bake the same every load, 1 long, on the ground, with a damp patch', async () => {
    const R = await recipe;
    const a = stoneShapes(R), b = stoneShapes(R);
    eq(a.length, R.shape.count, 'shapes');
    for (let i = 0; i < a.length; i++) {
      eq(a[i].mesh.count, b[i].mesh.count, `shape ${i} vertex count`);
      assert(a[i].mesh.vertices.every((v, k) => v === b[i].mesh.vertices[k]), `shape ${i} the same`);
      let lo = Infinity, zlo = Infinity, zhi = -Infinity, bad = 0;
      const V = a[i].mesh.vertices;
      for (let v = 0; v < a[i].mesh.count; v++) {
        lo = Math.min(lo, V[v * 9 + 1]); zlo = Math.min(zlo, V[v * 9 + 2]); zhi = Math.max(zhi, V[v * 9 + 2]);
        for (let c = 6; c < 9; c++) if (!(V[v * 9 + c] > 0 && V[v * 9 + c] < 0.6)) bad++;
      }
      assert(Math.abs(lo) < 1e-6 && Math.abs(zhi - zlo - 1) < 1e-6, `shape ${i} on y = 0 and 1 long`);
      eq(bad, 0, `shape ${i} albedos outside physical rock (0..0.6)`);
      assert(a[i].hy > 0.12 && a[i].hy < 0.7 && a[i].damp.count > 20, `shape ${i} height ${a[i].hy.toFixed(2)}, damp patch`);
      // The top is cut flat: a good number of vertices lie close under the highest.
      let top = 0;
      for (let v = 0; v < a[i].mesh.count; v++) if (V[v * 9 + 1] > a[i].hy - 0.01) top++;
      assert(top > 10, `shape ${i} has a flat top (${top} vertices near it)`);
    }
    return a.map((s) => `${(s.mesh.indices.length / 3).toFixed(0)} tris`).join(', ');
  });

  test(G, 'Sculpt chips always fill their rows: 4, 5, 6 and 7 chips', () => {
    eq(chipRows(4).join(), '4', 'four in a row');
    eq(chipRows(5).join(), '3,2', 'five: three and two');
    eq(chipRows(6).join(), '3,3', 'six: three and three');
    eq(chipRows(7).join(), '4,3', 'seven: four and three');
    for (const n of [4, 5, 6, 7]) assert(chipRows(n).every((per) => 12 % per === 0), `${n}: each row divides 12 columns`);
  });
}
