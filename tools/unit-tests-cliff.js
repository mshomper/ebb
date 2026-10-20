// @ts-check
// Cliff tests for tools/unit-tests.html (docs/08, M2): Sculpt's Terrace and Cut modes. The shelf
// level snaps, a stroke builds a level shelf whose rim drops within one cell, Terrace never lowers
// and Cut never raises, a stroke is the same at any frame rate, faces are found for rock paint,
// cliff chunks are flagged for full mesh detail, and undo puts the ground back exactly.

import { cliffLevel, cliffMask, cliffHeight, onFace, chunkHasCliff, createCliffChunks } from '../src/world/terrain/cliff.js';
import { applyStampCpu, circleRect, CLIFF_MODE } from '../src/world/terrain/brushes.js';
import { createMirror, syncFloat } from '../src/world/terrain/heightfield.js';
import { tilesOf, copyTiles, pasteTiles } from '../src/world/terrain/undo.js';
import { WORLD_CELLS as N, CELL, WORLD_ORIGIN, quantize, dequantize } from '../src/world/terrain/grid.js';

const CLIFF = 'cliff';
const ALL = { x: 0, y: 0, w: N, h: N };
const EDGE = { openMin: [-48, -48], openMax: [48, 48], edgeFade: 2 };

async function recipe() {
  return (await (await fetch('../recipes/world/terrain.json')).json());
}

/** A mirror at height h(x, z), quantized like the saved truth. @param {(x: number, z: number) => number} h */
function mirrorOf(h) {
  const m = createMirror();
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    m.heightQ[k] = quantize(h(WORLD_ORIGIN + (i + 0.5) * CELL, WORLD_ORIGIN + (j + 0.5) * CELL));
    m.heightF[k] = dequantize(m.heightQ[k]);
  }
  return m;
}

/** @param {number} x */
const cellOf = (x) => Math.floor((x - WORLD_ORIGIN) / CELL);
/** @param {Float32Array} hf @param {number} x @param {number} z */
const at = (hf, x, z) => hf[cellOf(z) * N + cellOf(x)];

/**
 * Stamps along a straight drag, as makeStamps spaces them (a quarter radius apart).
 * @param {number} sign the Height, positive for Terrace, negative for Cut @param {number} level @param {number[]} a @param {number[]} b
 * @param {number} radius @param {number} edgeM @param {number} [every] stamp spacing as a share of the radius
 */
function drag(sign, level, a, b, radius, edgeM, every = 0.25) {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (radius * every)));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const x = a[0] + ((b[0] - a[0]) * i) / n, z = a[1] + ((b[1] - a[1]) * i) / n;
    out.push({ x, z, radius, hardness: edgeM, amount: sign, target: level, mode: CLIFF_MODE, layer: 0, span: 1.3, rect: circleRect(x, z, radius, ALL) });
  }
  return out;
}

/** @param {Float32Array} hf @param {ReturnType<typeof drag>} stamps */
function apply(hf, stamps) { for (const s of stamps) applyStampCpu(hf, s, EDGE); }

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addCliffTests(test, assert, eq) {
  test(CLIFF, 'the shelf level is the start plus or minus Height, snapped; Shift is sea level', async () => {
    const rc = (await recipe()).cliff;
    eq(cliffLevel(1.1, 'terrace', 1, rc), 2, 'terrace from 1.1 m by 1 m');
    eq(cliffLevel(1.1, 'cut', 1, rc), 0, 'cut from 1.1 m by 1 m');
    eq(cliffLevel(2.37, 'terrace', 0.5, rc), 2.75, 'snaps to the nearest quarter meter');
    eq(cliffLevel(3, 'cut', 2, rc, true), 0, 'Shift levels to sea level');
    eq(cliffLevel(11.5, 'terrace', 3, rc), 12, 'never past the top of the height range');
    eq(cliffLevel(-3.5, 'cut', 3, rc), -4, 'never under the bottom');
  });

  test(CLIFF, 'a Terrace drag builds a level shelf whose rim drops within two cells', async () => {
    const rc = (await recipe()).cliff;
    const m = mirrorOf(() => 1);
    apply(m.heightF, drag(1, 2, [-4, 0], [4, 0], 2, rc.edgeM));
    const inside = [at(m.heightF, -3, 0), at(m.heightF, 0, 0), at(m.heightF, 3, 0.5)];
    for (const h of inside) assert(Math.abs(h - 2) < 1e-4, `inside the shelf is ${h.toFixed(3)} m, not 2 m`);
    // Walk out across the rim at x = 0: from shelf (2 m) to ground (1 m), at most one cell partway.
    let partway = 0;
    for (let z = 0; z < 3; z += CELL) {
      const h = at(m.heightF, 0, z);
      if (h > 1.1 && h < 1.9) partway++;
    }
    // The rim falls over edgeM (under two cells), so a wall running across the grid stays smooth.
    assert(partway <= 2, `${partway} cells partway down the rim`);
    eq(at(m.heightF, 0, 2.6), Math.fround(dequantize(quantize(1))), 'ground past the rim is untouched');
    return `rim cells partway: ${partway}`;
  });

  test(CLIFF, 'Terrace never lowers ground above its level, Cut never raises ground below it', async () => {
    const rc = (await recipe()).cliff;
    // A slope rising along x: the left half is under 2 m, the right half over it.
    const slope = (/** @type {number} */ x) => 2 + x * 0.3;
    const t = mirrorOf((x) => slope(x));
    const before = t.heightF.slice();
    apply(t.heightF, drag(1, 2, [-3, 0], [3, 0], 2.5, rc.edgeM));
    const c = mirrorOf((x) => slope(x));
    apply(c.heightF, drag(-1, 2, [-3, 0], [3, 0], 2.5, rc.edgeM));
    let tLowered = 0, cRaised = 0;
    for (let k = 0; k < before.length; k++) {
      if (t.heightF[k] < before[k] - 1e-6) tLowered++;
      if (c.heightF[k] > before[k] + 1e-6) cRaised++;
    }
    eq(tLowered, 0, 'cells Terrace lowered');
    eq(cRaised, 0, 'cells Cut raised');
    assert(Math.abs(at(t.heightF, -2, 0) - 2) < 1e-4, 'Terrace filled the low side up to the level');
    assert(Math.abs(at(c.heightF, 2, 0) - 2) < 1e-4, 'Cut carved the high side down to the level');
    assert(at(t.heightF, 2, 0) > 2.5, 'Terrace left the hill above the level alone');
  });

  test(CLIFF, 'a stroke is the same at any frame rate and repeating it changes nothing', async () => {
    const rc = (await recipe()).cliff;
    const a = mirrorOf((x, z) => 0.5 + 0.2 * Math.sin(x) * Math.cos(z));
    const b = mirrorOf((x, z) => 0.5 + 0.2 * Math.sin(x) * Math.cos(z));
    // The same drag, as few big frames (one stamp set) and as many small frames applied twice over.
    apply(a.heightF, drag(-1, 0, [-5, -1], [5, 2], 1.5, rc.edgeM, 0.25));
    const fine = drag(-1, 0, [-5, -1], [5, 2], 1.5, rc.edgeM, 0.05);
    apply(b.heightF, fine);
    const once = b.heightF.slice();
    apply(b.heightF, fine);
    let moved = 0, worst = 0;
    for (let k = 0; k < once.length; k++) {
      if (b.heightF[k] !== once[k]) moved++;
      // Spacing changes only where the stamps' rims overlap the shelf's edge: inside, both are level.
      if (Math.abs(a.heightF[k]) < 1e-6 !== Math.abs(b.heightF[k]) < 1e-6) worst++;
    }
    eq(moved, 0, 'cells a second pass moved');
    const floorA = at(a.heightF, 0, 0.5), floorB = at(b.heightF, 0, 0.5);
    assert(Math.abs(floorA - floorB) < 1e-6 && Math.abs(floorA) < 1e-6, `the floor is ${floorA} and ${floorB}, not 0`);
    return `${worst} rim cells differ between stamp spacings`;
  });

  test(CLIFF, 'the rim and the foot of a face are found for rock paint; the shelf is not', async () => {
    const rc = (await recipe()).cliff;
    const m = mirrorOf(() => 1);
    apply(m.heightF, drag(2, 3, [-3, 0], [3, 0], 2, rc.edgeM));
    const i = cellOf(0);
    // March out from the shelf along z: the shelf, then the face cells, then flat ground.
    const marks = [];
    for (let z = 0; z < 3.5; z += CELL) marks.push(onFace(m.heightF, i, cellOf(z), rc.faceDeg) ? 1 : 0);
    eq(marks[0], 0, 'the middle of the shelf is not a face');
    eq(marks[marks.length - 1], 0, 'flat ground past it is not a face');
    const faces = marks.reduce((s, v) => s + v, 0);
    assert(faces >= 2 && faces <= 4, `${faces} face cells across the rim, expected 2 to 4`);
    // A soft Raise-like slope is never a face.
    const soft = mirrorOf((x) => 1 + x * 0.2);
    eq(onFace(soft.heightF, cellOf(1), cellOf(0), rc.faceDeg), false, 'an 11 degree slope');
    return `face marks ${marks.join('')}`;
  });

  test(CLIFF, 'cliff chunks are flagged, and unflagged when the cliff goes', async () => {
    const rc = (await recipe()).cliff;
    const m = mirrorOf(() => 1);
    const cliffs = createCliffChunks(rc.chunkStepM);
    cliffs.refresh(m.heightF, ALL);
    eq(cliffs.has(0, 0), false, 'a flat island has no cliff chunks');
    const v0 = cliffs.version;
    const before = copyTiles(m, tilesOf({ x: cellOf(-3), y: cellOf(-3), w: 6 / CELL, h: 6 / CELL }));
    apply(m.heightF, drag(2, 3, [-1, 0], [1, 0], 1.5, rc.edgeM));
    const r = { x: cellOf(-3), y: cellOf(-3), w: 6 / CELL, h: 6 / CELL };
    assert(cliffs.refresh(m.heightF, r), 'the refresh saw a change');
    eq(cliffs.has(0, 0), true, 'the chunk with the new terrace');
    eq(cliffs.has(1, 0), false, 'its neighbor');
    assert(cliffs.version > v0, 'the version moved');
    assert(chunkHasCliff(m.heightF, 0, 0, rc.chunkStepM), 'chunkHasCliff agrees');
    pasteTiles(m, before);
    syncFloat(m, ALL);
    cliffs.refresh(m.heightF, r);
    eq(cliffs.has(0, 0), false, 'after undo the chunk is plain again');
  });

  test(CLIFF, 'a step right on the edge between two chunks flags both', async () => {
    const rc = (await recipe()).cliff;
    // Chunk 0 starts at x = -16 m: higher ground on the left, a 2 m step exactly at the edge.
    const m = mirrorOf((x) => (x < -16 ? 3 : 1));
    eq(chunkHasCliff(m.heightF, -1, 0, rc.chunkStepM), true, 'the chunk left of the step');
    eq(chunkHasCliff(m.heightF, 0, 0, rc.chunkStepM), true, 'the chunk right of the step');
    eq(chunkHasCliff(m.heightF, 1, 0, rc.chunkStepM), false, 'a chunk further on');
  });

  test(CLIFF, 'undo puts the ground back exactly, and redo the shelf', async () => {
    const rc = (await recipe()).cliff;
    const m = mirrorOf((x, z) => 1 + 0.3 * Math.sin(x * 0.7 + z));
    const area = { x: cellOf(-6), y: cellOf(-6), w: 12 / CELL, h: 12 / CELL };
    const ids = tilesOf(area);
    const origQ = m.heightQ.slice();
    const before = copyTiles(m, ids);
    apply(m.heightF, drag(-1, 0.25, [-3, -2], [3, 2], 2, rc.edgeM));
    // Stroke end: the mirror is quantized, as finalize() does with the read-back result.
    for (let k = 0; k < m.heightQ.length; k++) m.heightQ[k] = quantize(m.heightF[k]);
    const afterQ = m.heightQ.slice();
    const after = copyTiles(m, ids);
    pasteTiles(m, before);
    let diff = 0;
    for (let k = 0; k < origQ.length; k++) if (m.heightQ[k] !== origQ[k]) diff++;
    eq(diff, 0, 'cells differing after undo');
    pasteTiles(m, after);
    diff = 0;
    for (let k = 0; k < afterQ.length; k++) if (m.heightQ[k] !== afterQ[k]) diff++;
    eq(diff, 0, 'cells differing after redo');
  });

  test(CLIFF, 'the mask and the per-cell shelf maths', async () => {
    eq(cliffMask(0, 2, 0.125), 1, 'center');
    eq(cliffMask(1.8, 2, 0.125), 1, 'inside the rim');
    eq(cliffMask(2, 2, 0.125), 0, 'at the radius');
    assert(cliffMask(2 - CELL * 0.25, 2, 0.01) > 0 && cliffMask(2 - CELL * 0.25, 2, 0.01) < 1, 'the rim is never thinner than half a cell');
    eq(cliffHeight(1, 2, 1, 1), 2, 'Terrace lifts to the level');
    eq(cliffHeight(3, 2, 1, 1), 3, 'Terrace leaves higher ground');
    eq(cliffHeight(3, 2, 1, -1), 2, 'Cut lowers to the level');
    eq(cliffHeight(1, 2, 1, -1), 1, 'Cut leaves lower ground');
    eq(cliffHeight(1, 2, 0.5, 1), 1.5, 'half way across the rim the goal has fallen by half the Height');
    eq(cliffHeight(1, 2, 0.5, 3), 1, 'with a taller Height it falls further, here below the ground');
    assert(Math.abs(cliffHeight(1, 2, 0.97, 1) - 1.97) < 1e-9, 'right at the inner rim it is just under the level');
    eq(cliffHeight(0, 2, 1, 1, 0.5, 1.3), 2 - 0.65, 'half way across the world-edge fade it has fallen by half the edge drop');
    const r = await recipe();
    assert(r.erosion.talusRockDeg >= 80, `painted rock talus is ${r.erosion.talusRockDeg} degrees; cliffs need about 82 to stay sheer`);
    assert(r.cliff.faceDeg < r.erosion.talusRockDeg, 'faces turn to rock at a gentler angle than rock slumps');
  });
}
