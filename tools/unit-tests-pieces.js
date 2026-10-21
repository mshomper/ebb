// @ts-check
// Placed pieces for tools/unit-tests.html (doc 09, docs/future/10): loose stones as save records,
// the save upgrade that brought them in (src/save/migrate-pieces.js), the handful that comes with the
// naturalist's reward, the cap, a lifted stone's tip, and the Sculpt card's chip rows. Driftwood: its
// reward, logs on the strandline, a carried log kept and saved, a carried stone moved, the log cap,
// and the log shapes and roll.

import { cleanPieces, emptyPieces, makeStone, makeLog, addPiece, removePiece, movePiece, countKind, pieceAt, arrivingStones, tipAngle, tipDone, stoneBone, leanBone, logBone, mul4 } from '../src/world/pieces/model.js';
import { stoneShapes, logShapes } from '../src/world/pieces/meshes.js';
import { strandLogs, cellHeights, strandMask } from '../src/world/pieces/driftwood.js';
import { strandLines } from '../src/world/water/strandline.js';
import { tideParams } from '../src/world/tide.js';
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
    // Format 6 (the shelf of keepsakes, src/save/migrate-keepsakes.js) and 7 (the nets) came after the pieces.
    assert(FORMAT >= 6, 'this build writes format 6 or later');
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

  test(G, 'the reward has a give: driftwood at ten finds, after stones', async () => {
    const [N, words] = await Promise.all([fetch('../recipes/world/naturalist.json').then((r) => r.json()), fetch('../recipes/world/journal.json').then((r) => r.json())]);
    const dw = N.rewards.find((/** @type {any} */ r) => r.id === 'driftwood');
    eq(JSON.stringify(dw.give), JSON.stringify({ driftwood: true }), 'give');
    assert(dw.at === 10 && dw.title && dw.line && dw.icon === 'driftwood', 'at ten, with card words and icon');
    const p = { flags: [], rewards: N.rewards, gifts: {}, words, giftWords: N.gifts };
    const earned = { shells: true, stones: true, naturalist: ['shells', 'stones'] };
    eq(due({ ...p, found: 9, earned }).length, 0, 'nine finds: not yet');
    const d = due({ ...p, found: 10, earned });
    eq(d.map((g) => g.id).join(), 'driftwood', 'ten finds: driftwood');
    const e2 = grant(earned, d[0]);
    assert(e2.driftwood === true && e2.stones && !e2.carry, 'driftwood earned; carrying waits for the turtles');
    const L = words.pieces?.log, C = words.pieces?.carry;
    assert(L?.cardLine && L.lifted && L.icon === 'driftwood', 'a log\'s tap card and first-roll note have words');
    assert(C?.button && C.hint && C.cancel && C.water && C.full, 'Carry has its words');
  });

  /**
   * A beach for the strand: a 60 x 30 cell rect whose ground rises 0.12 m a meter inland (x) from
   * below the low tide to above the highest, with a gentle wobble along the shore.
   */
  const beach = () => {
    const rect = { x: 170, y: 170, w: 60, h: 30 };
    const x0 = waterCellCenter(rect.x) + 15;
    const height = (/** @type {number} */ x, /** @type {number} */ z) => (x - x0) * 0.12 + 0.05 * Math.sin(z * 0.4);
    return { rect, height, heights: cellHeights(rect, height) };
  };
  const STRAND = { lookbackTides: 14, maxLines: 8, fadeHours: 96, runupM: 0.05 };

  test(G, 'driftwood washes up the same for the same seed and tide, only on the strandline, and moves with later tides', async () => {
    const R = await recipe, D = R.driftwood;
    const B = beach(), tide = tideParams(null);
    const run = (/** @type {number} */ seed, /** @type {number} */ nowH) => strandLogs({ seed, nowH, tide, strand: STRAND, rect: B.rect, heights: B.heights, height: B.height, recipe: D });
    let total = 0, sets = new Set();
    for (let h = 1; h < 24 * 12; h += 12) {
      const a = run(55, h), b = run(55, h);
      eq(JSON.stringify(a), JSON.stringify(b), `hour ${h}: the same twice`);
      assert(a.length <= D.most, `hour ${h}: at most ${D.most}`);
      const lines = strandLines(h, tide, STRAND);
      for (const s of a) {
        const y = B.height(s.x, s.z);
        assert(lines.levels.slice(0, D.lines).some((l) => Math.abs(y - l - STRAND.runupM) <= D.lineToleranceM + 1e-9), `${s.key} lies on a strandline`);
        const ax = Math.sin(s.yaw) * s.length / 2, az = Math.cos(s.yaw) * s.length / 2;
        assert([1, -1].every((k) => lines.levels.slice(0, D.lines).some((l) => Math.abs(B.height(s.x + k * ax, s.z + k * az) - l - STRAND.runupM) <= D.endToleranceM + 1e-9)), `${s.key} lies along it`);
        assert(s.length >= D.lengthM[0] && s.length <= D.lengthM[1] && s.size >= D.thickM[0] && s.size <= D.thickM[1], 'sized within the recipe');
      }
      total += a.length;
      sets.add(JSON.stringify(a.map((s) => s.key)));
    }
    assert(total > 0, 'some tides leave logs');
    // The sea's strand only: near the tide band, never by a pond.
    const ps = pondSummary(), m = strandMask(ps, D.bandReachM), W = ps.rect.w;
    assert(m[20 * W + 5] === 1 && m[20 * W + 3 + Math.round(D.bandReachM * 2) + 1] === 0, 'a few meters from the sea, no further');
    assert(m[20 * W + 20] === 0 && m[20 * W + 26] === 0, 'not in the pond, nor on its bank');
    const none = strandLogs({ seed: 55, nowH: 49, tide, strand: STRAND, rect: B.rect, heights: B.heights, height: B.height, recipe: D, mask: new Uint8Array(B.rect.w * B.rect.h) });
    eq(none.length, 0, 'nowhere the mask allows: none');
    assert(sets.size > 2, 'later tides take them and leave others');
    const kept = run(55, 49);
    if (kept.length) {
      const without = strandLogs({ seed: 55, nowH: 49, tide, strand: STRAND, rect: B.rect, heights: B.heights, height: B.height, recipe: D, kept: new Set([kept[0].seed]) });
      assert(!without.some((s) => s.seed === kept[0].seed) && without.length === kept.length - 1, 'a log carried off is not on the strand again');
    }
    return `${total} logs over 24 tides`;
  });

  test(G, 'a carried log is kept as a log record and comes back from a save the same', async () => {
    const R = await recipe;
    const log = { key: 'drift:4:100', kind: /** @type {'log'} */ ('log'), x: 3, z: 4, yaw: 0.7, seed: 123456789, size: 0.14, length: 1.3, tideId: 4 };
    let s = emptyPieces();
    s = /** @type {any} */ (addPiece(s, makeStone(9, 1, 0, 0, 1, R), R.cap));
    const piece = makeLog(s.nextId, { ...log, x: 8.5, z: -2.25 }, 77);
    eq(`${piece.id} ${piece.kind} ${piece.x} ${piece.z} ${piece.length} ${piece.size} ${piece.seed}`, 'p2 log 8.5 -2.25 1.3 0.14 123456789', 'its record');
    s = /** @type {any} */ (addPiece(s, piece, R.driftwood.cap));
    const { header, sections } = snapshot(parts(s));
    const back = restore((await decode(await encode(header, sections))).sections);
    eq(JSON.stringify(back.pieces), JSON.stringify(s), 'the log and the stone come back exactly');
    eq(header.format, FORMAT, 'written at the build\'s format (carrying a log needed no new one)');
    eq(cleanPieces({ list: [{ ...piece, length: undefined }] }).list.length, 0, 'a log without a length is left out');
    eq(pieceAt(back.pieces.list, 8.5 + Math.sin(0.7) * 0.6, -2.25 + Math.cos(0.7) * 0.6, 0.05)?.id, 'p2', 'a tap near its end picks the log');
  });

  test(G, 'carrying a stone moves its record, and only that', async () => {
    const R = await recipe;
    let s = emptyPieces();
    for (let n = 1; n <= 3; n++) s = /** @type {any} */ (addPiece(s, makeStone(11, n, n, n, 5, R), R.cap));
    const moved = movePiece(s, 'p2', -4, 6.5);
    const p2 = moved.list.find((p) => p.id === 'p2');
    eq(`${p2?.x} ${p2?.z} ${p2?.yaw === s.list[1].yaw} ${p2?.seed === s.list[1].seed}`, '-4 6.5 true true', 'moved, the same stone');
    eq(JSON.stringify([moved.list[0], moved.list[2]]), JSON.stringify([s.list[0], s.list[2]]), 'the others untouched');
    eq(moved.nextId, s.nextId, 'no new id');
    eq(JSON.stringify(movePiece(moved, 'p2', 2, 2).list), JSON.stringify(s.list), 'moving it back is the same as before (undo)');
  });

  test(G, 'the log cap holds, apart from the stones\'', async () => {
    const R = await recipe, cap = R.driftwood.cap;
    let s = emptyPieces();
    for (let n = 1; n <= cap; n++) s = /** @type {any} */ (addPiece(s, makeLog(n, { x: n, z: 0, yaw: 0, seed: n, size: 0.1, length: 1 }, 0), cap));
    eq(countKind(s.list, 'log'), cap, 'full of logs');
    eq(addPiece(s, makeLog(99, { x: 0, z: 0, yaw: 0, seed: 99, size: 0.1, length: 1 }, 0), cap), null, 'one more log is refused');
    assert(addPiece(s, makeStone(3, 100, 0, 0, 0, R), R.cap), 'a stone still fits');
    eq(arrivingStones({ seed: 1, summary: pondSummary(), material: null, recipe: R, hour: 1, nextId: 50, existing: s.list }).length, R.arrive.count, 'logs do not take the stones\' room');
  });

  test(G, 'log shapes bake the same every load, 1 long and 1 thick, weathered silver-grey; a roll shows the ground', async () => {
    const R = await recipe;
    const a = logShapes(R), b = logShapes(R);
    eq(a.length, R.driftwood.shape.count, 'shapes');
    const means = [];
    for (let i = 0; i < a.length; i++) {
      assert(a[i].mesh.vertices.every((v, k) => v === b[i].mesh.vertices[k]), `shape ${i} the same`);
      const V = a[i].mesh.vertices;
      let ylo = Infinity, zlo = Infinity, zhi = -Infinity, sum = 0, n = 0, bad = 0;
      for (let v = 0; v < a[i].mesh.count; v++) {
        ylo = Math.min(ylo, V[v * 9 + 1]); zlo = Math.min(zlo, V[v * 9 + 2]); zhi = Math.max(zhi, V[v * 9 + 2]);
        for (let c = 6; c < 9; c++) if (!(V[v * 9 + c] > 0 && V[v * 9 + c] < 0.5)) bad++;
        if (V[v * 9 + 4] > 0.3) { sum += V[v * 9 + 7]; n++; }
      }
      assert(Math.abs(ylo) < 1e-6 && Math.abs(zhi - zlo - 1) < 1e-6, `shape ${i} on y = 0 and 1 long`);
      assert(a[i].hy > 0.8 && a[i].hy < 2.2, `shape ${i} about 1 thick (${a[i].hy.toFixed(2)}, with its bow)`);
      eq(bad, 0, `shape ${i} albedos outside physical wood`);
      means.push(sum / n);
    }
    assert(means.every((m) => m > 0.22 && m < 0.36), `the tops are silver-grey (${means.map((m) => m.toFixed(2)).join(', ')})`);
    // Flat: squeezed across and set into the ground. Rolled: its middle moves over to the side.
    const A = 0.1, flat = logBone(0, 1, A, 0.2);
    eq([...flat].map((v) => Math.round(v * 1e6) / 1e6).join(), '0.1,0,0,0,0,0.1,0,0,0,0,1,0,0,-0.02,0,1', 'flat');
    const roll = logBone(Math.PI / 2, 1, A, 0);
    const mid = [0, 1, 2].map((r) => roll[4 + r] * 0.5 + roll[12 + r]);
    assert(Math.abs(mid[0] - (Math.PI / 2) * A / 2) < 1e-6 && Math.abs(mid[1] - A / 2) < 1e-6, 'rolled a quarter turn: over by a quarter of its round, its middle the same height');
    return means.map((m) => m.toFixed(2)).join(', ');
  });

  test(G, 'Sculpt chips always fill their rows: 4, 5, 6 and 7 chips', () => {
    eq(chipRows(4).join(), '4', 'four in a row');
    eq(chipRows(5).join(), '3,2', 'five: three and two');
    eq(chipRows(6).join(), '3,3', 'six: three and three');
    eq(chipRows(7).join(), '4,3', 'seven: four and three');
    for (const n of [4, 5, 6, 7]) assert(chipRows(n).every((per) => 12 % per === 0), `${n}: each row divides 12 columns`);
  });
}
