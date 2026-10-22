// @ts-check
// The water table and seasonal ponds for tools/unit-tests.html (docs/07, "The water table"): a
// modest dig on the rise stays damp, a dig near the shore with its floor under the table fills to
// it, a hole below sea level sealed from the sea fills to about sea level, and a rain-fed pond sits
// at most 15 cm below its lip in late summer (never below half its depth) and is full again by
// mid-autumn.

import { buildSummary, WATER_CLASS, BASIN_SOURCE } from '../src/world/water/summary.js';
import { seaDistance, waterTable, drawdownShare } from '../src/world/water/table.js';
import { quantize, WORLD_CELLS } from '../src/world/terrain/grid.js';

const G = 'water table';
const RECT = { x: 100, y: 100, w: 80, h: 80 };
/** Rain-fed ponds off, so a test sees the table alone. */
const NO_RAIN = { pondMinCatchmentM2: 1e6 };

/**
 * A 768 x 768 heightQ, 1 m under the sea except the rect, where `fn` gives the height (m) at each
 * terrain cell center in rect-local water-cell coordinates.
 * @param {(x: number, y: number) => number} fn
 */
function heights(fn) {
  const T = WORLD_CELLS, q = new Uint16Array(T * T).fill(quantize(-1));
  for (let ty = 2 * RECT.y; ty < 2 * (RECT.y + RECT.h); ty++) {
    for (let tx = 2 * RECT.x; tx < 2 * (RECT.x + RECT.w); tx++) q[ty * T + tx] = quantize(fn((tx + 0.5) / 2 - RECT.x, (ty + 0.5) / 2 - RECT.y));
  }
  return q;
}

/** A flat island `topM` high over cells 3..76, with an optional round bowl. */
const island = (/** @type {number} */ topM, /** @type {null | {x:number, y:number, r:number, floorM:number}} */ bowl) =>
  (/** @type {number} */ x, /** @type {number} */ y) => {
    if (x < 3 || y < 3 || x > 76 || y > 76) return -1;
    if (!bowl) return topM;
    const d2 = (x - bowl.x) ** 2 + (y - bowl.y) ** 2;
    return d2 < bowl.r * bowl.r ? bowl.floorM + (topM - bowl.floorM) * d2 / (bowl.r * bowl.r) : topM;
  };

const at = (/** @type {number} */ i, /** @type {number} */ j) => j * RECT.w + i;
/** Surface height (m) of a still cell: its bed plus the target depth. */
const surfaceM = (/** @type {any} */ s, /** @type {number} */ k, /** @type {number} */ bedM) => bedM + s.targetMm[k] / 1000;

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addWaterTableTests(test, assert, eq) {
  /** @type {Promise<any>} */ let waterP;
  const water = () => (waterP ??= fetch('../recipes/world/water.json').then((r) => r.json()));
  /** @param {any} land @param {any} [params] @param {number} [yearDay] */
  const summary = async (land, params = {}, yearDay = 0) => {
    const w = await water();
    return buildSummary({ heightQ: heights(land), rect: RECT, springs: [], params: { ...w.summary, ...params }, tide: w.tide, yearDay });
  };

  test(G, 'the lens: sea level at the shore, highest in the middle, flat near the top', async () => {
    const w = 9, h = 1, sea = new Uint8Array(w * h);
    sea[0] = 1; sea[8] = 1;
    const d = seaDistance(sea, w, h);
    eq([...d].join(','), '0,3,6,9,12,9,6,3,0', 'chamfer distance along a line');
    const t = waterTable(sea, w, h, 1000, new Int32Array(w * h));
    eq(t[0], 0, 'sea'); eq(t[4], 1000, 'middle');
    assert(t[1] > 600 && t[1] < 700, `one cell in: ${t[1]} (sqrt(0.25 x 1.75) = 0.66)`);
    assert(t[3] - t[2] < t[2] - t[1], 'rises more slowly toward the middle');
    eq(drawdownShare(5, [14, 25, 35]), 0, 'spring'); eq(drawdownShare(25, [14, 25, 35]), 1000, 'late summer');
    eq(drawdownShare(40, [14, 25, 35]), 0, 'autumn'); eq(drawdownShare(50, [14, 25, 35]), 0, 'winter');
    const mid = drawdownShare(19, [14, 25, 35]);
    assert(mid > 0 && mid < 1000, `early summer share ${mid}`);
  });

  test(G, 'a modest dig on the central rise stays a damp hollow', async () => {
    const land = (/** @type {number} */ x, /** @type {number} */ y) => {
      const r = Math.hypot(x - 40, y - 40);
      if (r > 36) return -1;
      const h = 3 * (1 - (r / 36) ** 2);
      const d2 = (x - 40) ** 2 + (y - 40) ** 2;
      return d2 < 25 ? h - 0.5 * (1 - d2 / 25) : h;
    };
    const s = await summary(land);
    const k = at(40, 40);
    eq(s.cls[k], WATER_CLASS.damp, 'dig on the rise');
    eq(s.targetMm[k], 0, 'no standing water');
    eq(s.basinSource[s.basin[k]], BASIN_SOURCE.none, 'source');
    return `table at the dig ${s.tableMm[k]} mm above the sea`;
  });

  test(G, 'a dig near the shore with its floor under the table fills to the table', async () => {
    const s = await summary(island(0.6, { x: 10, y: 40, r: 4, floorM: 0 }), NO_RAIN);
    const k = at(10, 40);
    eq(s.cls[k], WATER_CLASS.still, 'near-shore dig');
    eq(s.basinSource[s.basin[k]], BASIN_SOURCE.table, 'source');
    const surf = surfaceM(s, k, 0);
    // Level with the table at the basin's floor (the first deepest cell, a cell or two off center).
    assert(Math.abs(surf - s.tableMm[k] / 1000) < 0.025, `surface ${surf.toFixed(3)} m, table ${s.tableMm[k]} mm`);
    assert(surf > 0.08 && surf < 0.3, `surface ${surf.toFixed(3)} m above the sea`);
    // The same dig in the middle, its floor above the table, stays damp.
    const mid = await summary(island(0.6, { x: 40, y: 40, r: 4, floorM: 0.45 }), NO_RAIN);
    eq(mid.cls[at(40, 40)], WATER_CLASS.damp, 'shallow dig in the middle');
    return `fills to ${(surf * 100).toFixed(1)} cm above the sea; table in the middle ${mid.tableMm[at(40, 40)]} mm`;
  });

  test(G, 'a hole below sea level, sealed from the sea, fills to about sea level', async () => {
    const s = await summary(island(0.6, { x: 6, y: 40, r: 2.5, floorM: -0.5 }), NO_RAIN);
    const k = at(6, 40);
    eq(s.cls[k], WATER_CLASS.still, 'sealed hole');
    eq(s.basinSource[s.basin[k]], BASIN_SOURCE.table, 'source');
    const surf = surfaceM(s, k, -0.5);
    assert(surf > -0.02 && surf < 0.2, `surface ${surf.toFixed(3)} m`);
    return `surface ${(surf * 100).toFixed(1)} cm above mean sea level`;
  });

  test(G, 'a rain-fed pond lowers at most 15 cm in late summer, never below half its depth, and refills by mid-autumn', async () => {
    // Rain-fed by the rule alone: the catchment ratio is pinned off so the island's size does not matter.
    const rain = { pondMinCatchmentM2: 30, pondMinDepthM: 0.15, rainCatchmentRatio: 0 };
    const deep = island(1, { x: 40, y: 40, r: 9, floorM: 0.5 });
    const k = at(40, 40);
    const spring = await summary(deep, rain, 5), late = await summary(deep, rain, 25), early = await summary(deep, rain, 19), autumn = await summary(deep, rain, 36);
    eq(spring.basinSource[spring.basin[k]], BASIN_SOURCE.rain, 'source');
    assert(Math.abs(spring.targetMm[k] - 500) <= 6, `spring depth ${spring.targetMm[k]} mm`);
    assert(Math.abs(late.targetMm[k] - 350) <= 6, `late summer depth ${late.targetMm[k]} mm`);
    assert(Math.abs(late.basinDrawMm[late.basin[k]] - 150) <= 2, `late summer drawdown ${late.basinDrawMm[late.basin[k]]} mm`);
    assert(early.targetMm[k] < spring.targetMm[k] && early.targetMm[k] > late.targetMm[k], `early summer ${early.targetMm[k]} mm`);
    eq(autumn.targetMm[k], spring.targetMm[k], 'full again by mid-autumn');
    // The margin the lowering leaves bare reads as damp.
    const edge = at(40 + 8, 40);
    eq(spring.cls[edge], WATER_CLASS.still, 'margin in spring');
    eq(late.cls[edge], WATER_CLASS.damp, 'margin in late summer');
    // A shallow pond loses at most half its depth.
    const shallow = island(1, { x: 40, y: 40, r: 9, floorM: 0.8 });
    const sl = await summary(shallow, rain, 25);
    assert(Math.abs(sl.targetMm[k] - 100) <= 6, `shallow pond in late summer ${sl.targetMm[k]} mm (half of 200)`);
    return `500 mm in spring, ${early.targetMm[k]} early summer, ${late.targetMm[k]} late summer, ${autumn.targetMm[k]} mid-autumn`;
  });

  test(G, 'the catchment ratio: a dig that gathers little more than its own footprint stays damp', async () => {
    const s = await summary(island(1, { x: 40, y: 40, r: 9, floorM: 0.5 }));
    const k = at(40, 40);
    // On a flat island little more than the bowl itself drains into it: far under the ratio of 8.
    eq(s.cls[k], WATER_CLASS.damp, 'bowl class');
    const loose = await summary(island(1, { x: 40, y: 40, r: 9, floorM: 0.5 }), { rainCatchmentRatio: 1, pondMinCatchmentM2: 30 });
    eq(loose.cls[k], WATER_CLASS.still, 'with a ratio of 1');
  });

  test(G, 'the same day gives the same hash; another season changes it', async () => {
    const land = island(1, { x: 40, y: 40, r: 9, floorM: 0.5 });
    const a = await summary(land, {}, 25), b = await summary(land, {}, 25), c = await summary(land, {}, 5);
    eq(b.hash, a.hash, 'same day');
    assert(c.hash !== a.hash, 'spring and late summer gave the same hash');
  });
}
