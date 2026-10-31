// @ts-check
// The water summary (src/world/water/): ponds, streams, the sea and shore zones, strandlines, and
// the same hash in a worker. Moved from the test page on October 31, 2026, so it runs in workers
// and in Node (tools/run-tests.mjs).

import { stream } from '../src/core/rng.js';
import { initWorkers, run } from '../src/core/workers.js';
import { WORLD_CELLS, quantize } from '../src/world/terrain/grid.js';
import { buildSummary, hashSummary, WATER_CLASS } from '../src/world/water/summary.js';
import { shoreZones, shoreHeightM } from '../src/world/water/shore.js';
import { strandLines } from '../src/world/water/strandline.js';
import * as tide from '../src/world/tide.js';
import { timeout } from './unit-tests-fixtures.js';

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addWaterSummaryTests(test, assert, eq) {
  const WSUM = 'water summary';
  /** @type {Promise<any> | null} */
  let waterPromise = null;
  /** recipes/world/water.json, fetched once. */
  function loadWater() {
    waterPromise ??= fetch('../recipes/world/water.json').then((r) => {
      if (!r.ok) throw new Error(`water.json: HTTP ${r.status}`);
      return r.json();
    });
    return waterPromise;
  }

  /**
   * A 768 x 768 heightQ that is 1 m under the sea everywhere except the rect, where `fn` gives the
   * height (m) at each terrain cell center in rect-local water-cell coordinates.
   * @param {{x:number,y:number,w:number,h:number}} rect @param {(x: number, y: number) => number} fn
   */
  function synthHeights(rect, fn) {
    const T = WORLD_CELLS, q = new Uint16Array(T * T).fill(quantize(-1));
    for (let ty = 2 * rect.y; ty < 2 * (rect.y + rect.h); ty++) {
      for (let tx = 2 * rect.x; tx < 2 * (rect.x + rect.w); tx++) q[ty * T + tx] = quantize(fn((tx + 0.5) / 2 - rect.x, (ty + 0.5) / 2 - rect.y));
    }
    return q;
  }

  const BOWL_RECT = { x: 100, y: 100, w: 40, h: 40 };
  /** A flat 1 m island with a round bowl of radius r cells, 0.5 m deep at its center. @param {number} r */
  const bowlLand = (r) => (/** @type {number} */ x, /** @type {number} */ y) => {
    if (x < 3 || y < 3 || x > 37 || y > 37) return -1;
    const d2 = (x - 20) ** 2 + (y - 20) ** 2;
    return d2 < r * r ? 1 - 0.5 * (1 - d2 / (r * r)) : 1;
  };
  const SLOPE_RECT = { x: 60, y: 200, w: 80, h: 24 };
  /** A valley down the x axis: steep (0.21) to x 30, gentle (0.009) to x 76, then the sea. */
  const slopeLand = (/** @type {number} */ x, /** @type {number} */ y) => {
    if (x < 2 || y < 2 || x > 76 || y > 21) return -1;
    const base = x < 30 ? 4 - (x - 2) * 3 / 28 : 1 - (x - 30) * 0.2 / 46;
    return base + Math.abs(y - 12.5) * 0.05;
  };
  const SLOPE_SPRING = [{ cellX: 70, cellY: 212, rateLps: 12 }];
  /** @param {number} h */
  const hex8 = (h) => (h >>> 0).toString(16).toUpperCase().padStart(8, '0');

  test(WSUM, 'a bowl fills to its lip, and is a pond only with enough catchment or a spring', async () => {
    const water = await loadWater();
    const at = 20 * BOWL_RECT.w + 20;
    const args = (/** @type {number} */ r, /** @type {any[]} */ springs) =>
      ({ heightQ: synthHeights(BOWL_RECT, bowlLand(r)), rect: BOWL_RECT, springs,
        // Thresholds pinned here, so the test checks the rule rather than the recipe's tuning.
        params: { ...water.summary, pondMinCatchmentM2: 30, pondMinDepthM: 0.15, rainCatchmentRatio: 0 }, tide: water.tide });
    const small = buildSummary(args(4, []));
    eq(small.cls[at], WATER_CLASS.damp, 'small dry bowl class');
    eq(small.targetMm[at], 0, 'small dry bowl depth');
    assert(small.basin[at] > 0, 'small bowl has a basin id');
    eq(small.stats.ponds, 0, 'ponds in the small dry bowl');
    const fed = buildSummary(args(4, [{ cellX: BOWL_RECT.x + 20, cellY: BOWL_RECT.y + 20, rateLps: 3 }]));
    eq(fed.cls[at], WATER_CLASS.still, 'spring-fed small bowl class');
    assert(Math.abs(fed.targetMm[at] - 500) <= 6, `spring-fed bowl center depth ${fed.targetMm[at]} mm, expected about 500 (to the lip)`);
    assert(fed.stats.streamCells > 0, 'the overflow runs on to the sea');
    const big = buildSummary(args(9, []));
    eq(big.cls[at], WATER_CLASS.still, 'large rain-fed bowl class');
    assert(Math.abs(big.targetMm[at] - 500) <= 6, `large bowl center depth ${big.targetMm[at]} mm`);
    eq(big.stats.ponds, 1, 'ponds in the large bowl');
    eq(big.cls[20 * BOWL_RECT.w + 32], WATER_CLASS.dry, 'flat ground beside the bowl');
    return `small: damp, fed: ${fed.targetMm[at]} mm still, large: ${big.targetMm[at]} mm still`;
  });

  test(WSUM, 'a spring on a slope runs to the sea: running on the steep part, slower on the gentle part', async () => {
    const water = await loadWater();
    const s = buildSummary({ heightQ: synthHeights(SLOPE_RECT, slopeLand), rect: SLOPE_RECT, springs: SLOPE_SPRING, params: water.summary, tide: water.tide });
    const row = (/** @type {number} */ i) => s.cls[12 * SLOPE_RECT.w + i];
    for (let i = 10; i <= 75; i++) assert(row(i) !== WATER_CLASS.dry, `cell ${i} on the route is dry`);
    for (let i = 12; i <= 26; i++) eq(row(i), WATER_CLASS.running, `steep cell ${i}`);
    for (let i = 36; i <= 70; i++) assert(row(i) === WATER_CLASS.slow || row(i) === WATER_CLASS.still, `gentle cell ${i} is class ${row(i)}`);
    eq(row(79), WATER_CLASS.sea, 'route ends in the sea');
    const steep = s.targetMm[12 * SLOPE_RECT.w + 20], gentle = s.targetMm[12 * SLOPE_RECT.w + 50];
    assert(gentle > steep, `gentle water (${gentle} mm) should be deeper than steep (${steep} mm)`);
    return `${s.stats.streamCells} stream cells, ${steep} mm on the steep part, ${gentle} mm on the gentle part`;
  });

  test(WSUM, 'the outer ring below sea level is sea, and the shore is in the tide band', async () => {
    const water = await loadWater();
    const s = buildSummary({ heightQ: synthHeights(SLOPE_RECT, slopeLand), rect: SLOPE_RECT, springs: [], params: water.summary, tide: water.tide });
    const { w, h } = SLOPE_RECT;
    for (let i = 0; i < w; i++) for (const j of [0, h - 1]) eq(s.cls[j * w + i], WATER_CLASS.sea, `ring cell ${i},${j}`);
    for (let j = 0; j < h; j++) for (const i of [0, w - 1]) eq(s.cls[j * w + i], WATER_CLASS.sea, `ring cell ${i},${j}`);
    // A beach rising 0.05 m per cell from -1 m: the band is the bed within 1.15 x 0.6 m of sea level.
    const beach = buildSummary({
      heightQ: synthHeights(SLOPE_RECT, (x, y) => (y < 2 || y > 21 || x > 76) ? -1 : -1 + x * 0.05),
      rect: SLOPE_RECT, springs: [], params: water.summary, tide: water.tide });
    const at = (/** @type {number} */ i) => 12 * w + i;
    eq(beach.cls[at(10)], WATER_CLASS.sea, 'beach cell at -0.5 m is sea');
    eq(beach.band[at(10)], 1, 'beach cell at -0.5 m is in the tide band');
    eq(beach.band[at(28)], 1, 'beach cell at +0.4 m is in the tide band');
    eq(beach.band[at(4)], 0, 'beach cell at -0.8 m is below the band');
    eq(beach.band[at(40)], 0, 'beach cell at +1 m is above the band');
    eq(beach.cls[at(40)], WATER_CLASS.dry, 'beach cell at +1 m is dry');
  });

  /** The beach above: bed of water cell i is -1 + 0.05 (i + 0.25) m (the lower of its terrain cells). */
  const beachLand = (/** @type {number} */ x, /** @type {number} */ y) => ((y < 2 || y > 21 || x > 76) ? -1 : -1 + x * 0.05);
  const beachBed = (/** @type {number} */ i) => -1 + 0.05 * (i + 0.25);

  test(WSUM, 'shore height grades the band and the splash ground above it, and reads back as the bed', async () => {
    const water = await loadWater();
    const s = buildSummary({ heightQ: synthHeights(SLOPE_RECT, beachLand), rect: SLOPE_RECT, springs: [], params: water.summary, tide: water.tide });
    const at = (/** @type {number} */ i) => 12 * SLOPE_RECT.w + i;
    const A0 = water.tide.amplitudeM;
    assert(Math.abs(s.shoreRange.loM + 1.15 * A0) < 1e-3 && Math.abs(s.shoreRange.hiM - 1.75 * A0) < 1e-3, `range ${s.shoreRange.loM} .. ${s.shoreRange.hiM}`);
    eq(s.shore[at(4)], 0, 'below the band (-0.79 m)');
    assert(s.shore[at(38)] > 0, 'splash ground (+0.91 m) is shore');
    eq(s.shore[at(45)], 0, 'above the splash top (+1.26 m)');
    let prev = 0;
    for (let i = 6; i <= 40; i++) {
      const v = s.shore[at(i)];
      assert(v > prev, `shore height should rise along the beach: ${prev} then ${v} at cell ${i}`);
      const m = shoreHeightM(v, s.shoreRange);
      assert(Math.abs(m - beachBed(i)) < 0.01, `cell ${i}: reads ${m.toFixed(3)} m, bed ${beachBed(i).toFixed(3)} m`);
      prev = v;
    }
    return `shore ${s.shore[at(6)]} at ${beachBed(6).toFixed(2)} m to ${s.shore[at(40)]} at ${beachBed(40).toFixed(2)} m`;
  });

  test(WSUM, 'strandlines: the newest high tide always lies, a higher later tide sweeps older lines up', async () => {
    const water = await loadWater();
    const R = (await (await fetch('../recipes/world/shore.json')).json()).look.strandline;
    const p = tide.tideParams(water.tide);
    // Day 0 is a spring tide (new moon): the first high water is the highest, nothing older shows.
    eq(strandLines(10, p, R).levels.length, 1, 'one line just after a spring high');
    // Falling toward the neap (day 1.75), every high is lower than the one before: they all lie.
    const falling = strandLines(39, p, R);
    assert(falling.levels.length >= 3, `lines while the tides fall: ${falling.levels.length}`);
    for (let i = 1; i < falling.levels.length; i++) {
      assert(falling.levels[i] > falling.levels[i - 1], `older lines lie higher: ${falling.levels.join(', ')}`);
      assert(falling.strengths[i] < falling.strengths[i - 1], 'older lines are fainter');
    }
    assert(falling.levels.length <= R.maxLines, 'at most maxLines');
    eq(JSON.stringify(strandLines(39, p, R)), JSON.stringify(falling), 'the same every time');
    return `hour 39: ${falling.levels.map((v) => v.toFixed(2)).join(', ')} m`;
  });

  test(WSUM, 'shore zones follow height and paint: kelp, wrack and wet sand where they belong, the same every time', async () => {
    const water = await loadWater();
    const recipe = await (await fetch('../recipes/world/shore.json')).json();
    const s = buildSummary({ heightQ: synthHeights(SLOPE_RECT, beachLand), rect: SLOPE_RECT, springs: [], params: water.summary, tide: water.tide });
    // Rock painted on the lower beach (cells below 25), sand above.
    const T = WORLD_CELLS, material = new Uint8Array(T * T * 4);
    for (let ty = 0; ty < T; ty++) for (let tx = 0; tx < T; tx++) {
      const i = Math.floor(tx / 2) - SLOPE_RECT.x;
      material[(ty * T + tx) * 4 + (i < 25 ? 2 : 1)] = 255;
    }
    const z = shoreZones({ summary: s, material, recipe, amplitudeM: water.tide.amplitudeM });
    const id = (/** @type {number} */ i) => { const v = z.zone[12 * SLOPE_RECT.w + i]; return v ? z.ids[v - 1] : 'none'; };
    eq(id(8), 'kelp', 'rock at -0.59 m');
    eq(id(16), 'wrack', 'rock at -0.19 m');
    eq(id(22), 'wrack', 'rock at +0.11 m');
    eq(id(28), 'wetSand', 'sand at +0.41 m');
    eq(id(36), 'none', 'sand at +0.81 m, above the wet sand');
    eq(id(45), 'none', 'above the shore');
    const again = shoreZones({ summary: s, material, recipe, amplitudeM: water.tide.amplitudeM });
    eq(again.zone.join(','), z.zone.join(','), 'second run');
    return z.ids.map((n, i) => `${n} ${z.cells[i]}`).join(', ');
  });

  test(WSUM, '1 m cells follow their four 0.5 m cells: fastest wet class, mean wet depth, any band', async () => {
    const water = await loadWater();
    const rect = { x: SLOPE_RECT.x + 1, y: SLOPE_RECT.y + 1, w: SLOPE_RECT.w - 1, h: SLOPE_RECT.h - 1 };
    const land = (/** @type {number} */ x, /** @type {number} */ y) => slopeLand(x + 1, y + 1);
    const s = buildSummary({ heightQ: synthHeights(rect, land), rect, springs: SLOPE_SPRING, params: water.summary, tide: water.tide });
    const e = s.eco;
    eq(e.x, Math.floor(rect.x / 2), 'eco.x'); eq(e.y, Math.floor(rect.y / 2), 'eco.y');
    eq(e.w, Math.ceil((rect.x + rect.w) / 2) - e.x, 'eco.w'); eq(e.h, Math.ceil((rect.y + rect.h) / 2) - e.y, 'eco.h');
    let wetCells = 0;
    for (let b = 0; b < e.h; b++) for (let a = 0; a < e.w; a++) {
      let fast = 0, damp = 0, band = 0, wet = 0;
      for (let sub = 0; sub < 4; sub++) {
        const i = 2 * (e.x + a) + (sub & 1) - rect.x, j = 2 * (e.y + b) + (sub >> 1) - rect.y;
        if (i < 0 || j < 0 || i >= rect.w || j >= rect.h) continue;
        const c = s.cls[j * rect.w + i];
        band |= s.band[j * rect.w + i];
        if (c === WATER_CLASS.damp) damp = 1;
        else if (c !== WATER_CLASS.dry) { wet++; fast = Math.max(fast, c); }
      }
      const k = b * e.w + a;
      eq(e.cls[k], wet ? fast : damp ? WATER_CLASS.damp : WATER_CLASS.dry, `eco class at ${a},${b}`);
      eq(e.band[k], band, `eco band at ${a},${b}`);
      if (wet && fast !== WATER_CLASS.sea) wetCells++;
      if (!wet) eq(e.depthCm[k], 0, `dry eco depth at ${a},${b}`);
    }
    assert(wetCells > 20, `only ${wetCells} stream eco cells`);
    return `${e.w} x ${e.h} eco cells, ${wetCells} with stream water`;
  });

  test(WSUM, 'buildSummary twice gives the same hash, and a different spring changes it', async () => {
    const water = await loadWater();
    const heightQ = synthHeights(SLOPE_RECT, slopeLand);
    const args = { heightQ, rect: SLOPE_RECT, springs: SLOPE_SPRING, params: water.summary, tide: water.tide };
    const a = buildSummary(args), b = buildSummary(args);
    eq(b.hash, a.hash, 'second build');
    eq(hashSummary(a), a.hash, 'hashSummary of the result');
    const c = buildSummary({ ...args, springs: [{ ...SLOPE_SPRING[0], rateLps: 30 }] });
    assert(c.hash !== a.hash, 'a stronger spring gave the same hash');
    return `hash ${hex8(a.hash)}, ${a.stats.ms?.toFixed(1)} ms`;
  });

  test(WSUM, 'buildSummary in a worker gives the same hash as on the main thread', async () => {
    const water = await loadWater();
    initWorkers({ size: 1 });
    try {
      const heightQ = synthHeights(BOWL_RECT, bowlLand(4));
      const args = { heightQ, rect: BOWL_RECT, springs: [{ cellX: 120, cellY: 120, rateLps: 3 }], params: water.summary, tide: water.tide };
      const m = buildSummary(args);
      const wr = await timeout(run({ module: './world/water/summary.js', fn: 'buildSummary' }, args));
      assert(wr.targetMm instanceof Uint16Array && wr.eco.cls instanceof Uint8Array, 'worker result types');
      assert(!('__transfer' in wr), '__transfer should be stripped');
      eq(wr.hash, m.hash, 'worker hash');
      eq(hashSummary(wr), m.hash, 'hash of the arrays that came back');
      return `hash ${hex8(m.hash)}`;
    } finally {
      initWorkers({ size: 1 });
    }
  });
}
