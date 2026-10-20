// @ts-check
// Stone tests for tools/unit-tests.html (docs/future/10): Sculpt's Stone mode sets a seeded boulder
// into the heightfield, the same every time, only ever raising the ground, painted rock, its
// paint still summing to 255, and leaving ground outside the open land alone.

import { makeBoulder, applyBoulder } from '../src/world/terrain/boulder.js';
import { createMirror } from '../src/world/terrain/heightfield.js';
import { WORLD_CELLS, CELL, WORLD_ORIGIN, quantize, dequantize } from '../src/world/terrain/grid.js';

const STONE = 'stone';

/** A flat grass mirror at 1 m. */
function flatMirror() {
  const m = createMirror();
  const q = quantize(1);
  m.heightQ.fill(q);
  m.heightF.fill(dequantize(q));
  for (let k = 0; k < m.material.length; k += 4) { m.material[k] = 255; m.material[k + 1] = 0; m.material[k + 2] = 0; m.material[k + 3] = 0; }
  return m;
}

/** @param {number} x */
const cellOf = (x) => Math.floor((x - WORLD_ORIGIN) / CELL);

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addStoneTests(test, assert, eq) {
  test(STONE, 'a boulder is the same for the same spot, raises the ground and paints it rock', async () => {
    const r = (await (await fetch('../recipes/world/terrain.json')).json()).stone;
    const all = { x: 0, y: 0, w: WORLD_CELLS, h: WORLD_CELLS };
    const a = flatMirror(), b = flatMirror();
    const ra = applyBoulder(a, makeBoulder(77, 3, -2, 1.0, r), 3, -2, all);
    applyBoulder(b, makeBoulder(77, 3, -2, 1.0, r), 3, -2, all);
    let same = true;
    for (let k = 0; k < a.heightQ.length; k++) if (a.heightQ[k] !== b.heightQ[k]) { same = false; break; }
    assert(same, 'two boulders at the same spot differ');
    const c = cellOf(3), d = cellOf(-2), k = d * WORLD_CELLS + c;
    const top = a.heightF[k];
    assert(top > 1 + 0.4, `the middle stands ${top.toFixed(2)} m, under 1.4 m`);
    eq(a.material[k * 4 + 2], 255, 'the middle is all rock');
    let lowered = 0, badSum = 0;
    for (let j = ra.y; j < ra.y + ra.h; j++) for (let i = ra.x; i < ra.x + ra.w; i++) {
      const q = j * WORLD_CELLS + i;
      if (a.heightF[q] < 1 - 1e-6) lowered++;
      const s = a.material[q * 4] + a.material[q * 4 + 1] + a.material[q * 4 + 2] + a.material[q * 4 + 3];
      if (s !== 255) badSum++;
    }
    eq(lowered, 0, 'cells lowered');
    eq(badSum, 0, 'cells whose paint does not sum to 255');
    // Another spot gives another boulder.
    const e = flatMirror();
    applyBoulder(e, makeBoulder(77, 3.7, -2, 1.0, r), 3.7, -2, all);
    assert(e.heightF[k] !== a.heightF[k], 'a different spot gave the same height here');
    return `${ra.w} x ${ra.h} cells, middle ${top.toFixed(2)} m`;
  });

  test(STONE, 'a boulder at the edge of the open land fades out, and stays inside the bounds', async () => {
    const r = (await (await fetch('../recipes/world/terrain.json')).json()).stone;
    const m = flatMirror();
    const bounds = { x: cellOf(0), y: 0, w: WORLD_CELLS - cellOf(0), h: WORLD_CELLS };
    applyBoulder(m, makeBoulder(5, 0.2, 0, 1.0, r), 0.2, 0, bounds, (i) => Math.min(1, Math.max(0, (i - cellOf(0)) / 8)));
    let outside = 0;
    for (let j = 0; j < WORLD_CELLS; j++) for (let i = 0; i < cellOf(0); i++) if (m.heightF[j * WORLD_CELLS + i] !== m.heightF[0]) outside++;
    eq(outside, 0, 'cells changed outside the bounds');
    const at = (/** @type {number} */ x) => m.heightF[cellOf(0) * WORLD_CELLS + cellOf(x)];
    assert(at(0.05) < at(0.6), 'the boulder should rise as it leaves the edge');
  });
}
