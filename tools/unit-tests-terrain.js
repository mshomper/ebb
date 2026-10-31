// @ts-check
// The terrain grid and the starter landform (src/world/terrain/), on the main thread and in
// workers. Moved from the test page on October 31, 2026, so it runs in workers and in Node
// (tools/run-tests.mjs).

import { subSeed } from '../src/core/rng.js';
import { initWorkers, run } from '../src/core/workers.js';
import { CHUNK_CELLS, CHUNK_SIZE, CELL, H_MIN, H_MAX, quantize, dequantize } from '../src/world/terrain/grid.js';
import { buildBase, hashBase } from '../src/world/terrain/landform.js';
import { timeout } from './unit-tests-fixtures.js';

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addTerrainTests(test, assert, eq) {
  /** @type {Promise<any> | null} */
  let landPromise = null;
  /** The starter island recipe, fetched once. */
  function loadLand() {
    landPromise ??= fetch('../recipes/land/starter-island.json').then((r) => {
      if (!r.ok) throw new Error(`starter-island.json: HTTP ${r.status}`);
      return r.json();
    });
    return landPromise;
  }
  const TERRAIN_SEED = subSeed(1, 'terrain');

  test('terrain', 'quantize and dequantize round trip within 0.25 mm and clamp at -4 and +12', () => {
    let worst = 0;
    for (let k = 0; k <= 16000; k++) {
      const h = H_MIN + k * 0.001;
      worst = Math.max(worst, Math.abs(dequantize(quantize(h)) - h));
    }
    assert(worst <= 0.00025, `worst error ${worst} m`);
    eq(quantize(-4), 0, 'quantize(-4)');
    eq(quantize(-9), 0, 'quantize(-9)');
    eq(quantize(12), 65535, 'quantize(12)');
    eq(quantize(30), 65535, 'quantize(30)');
    eq(dequantize(0), H_MIN, 'dequantize(0)');
    eq(dequantize(65535), H_MAX, 'dequantize(65535)');
    return `worst error ${(worst * 1000).toFixed(3)} mm`;
  });

  test('terrain', 'edit delta wraps around and restores every height', () => {
    const pairs = [[0, 0], [100, 40], [40, 100], [0, 65535], [65535, 0], [65535, 65535], [1, 65534], [32768, 12]];
    for (let k = 0; k < 2000; k++) pairs.push([(k * 7919) % 65536, (k * 104729) % 65536]);
    for (const [q, baseQ] of pairs) {
      const delta = (q - baseQ) & 0xFFFF;
      assert(delta >= 0 && delta <= 65535, `delta ${delta} out of range`);
      eq((baseQ + delta) & 0xFFFF, q, `restore q=${q} base=${baseQ}`);
    }
    eq((0 - 65535) & 0xFFFF, 1, 'wrap delta for q=0, base=65535');
  });

  test('terrain', 'buildBase is identical twice for one seed and differs for another', async () => {
    const land = await loadLand();
    const a = buildBase({ land, seed: TERRAIN_SEED, cx: 0, cz: 0 });
    const b = buildBase({ land, seed: TERRAIN_SEED, cx: 0, cz: 0 });
    const c = buildBase({ land, seed: subSeed(2, 'terrain'), cx: 0, cz: 0 });
    eq(a.heightQ.length, CHUNK_CELLS * CHUNK_CELLS, 'heightQ length');
    eq(a.material.length, CHUNK_CELLS * CHUNK_CELLS * 4, 'material length');
    for (let k = 0; k < a.heightQ.length; k++) eq(a.heightQ[k], b.heightQ[k], `height ${k}`);
    for (let k = 0; k < a.material.length; k++) eq(a.material[k], b.material[k], `material ${k}`);
    const ha = hashBase(a.heightQ, a.material), hc = hashBase(c.heightQ, c.material);
    eq(hashBase(b.heightQ, b.material), ha, 'hash of second build');
    assert(ha !== hc, 'a different seed gave the same hash');
    return `hash ${ha.toString(16).toUpperCase().padStart(8, '0')}`;
  });

  test('terrain', 'material weights sum to 255 in every cell of the 9 starter chunks', async () => {
    const land = await loadLand();
    for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) {
      const { material } = buildBase({ land, seed: TERRAIN_SEED, cx, cz });
      for (let k = 0; k < material.length; k += 4) {
        const sum = material[k] + material[k + 1] + material[k + 2] + material[k + 3];
        if (sum !== 255) throw new Error(`chunk ${cx},${cz} cell ${k / 4} sums to ${sum}`);
      }
    }
  });

  test('terrain', 'heights are continuous across the seam between chunks (0,0) and (1,0)', async () => {
    const land = await loadLand();
    const a = buildBase({ land, seed: TERRAIN_SEED, cx: 0, cz: 0 });
    const b = buildBase({ land, seed: TERRAIN_SEED, cx: 1, cz: 0 });
    const N = CHUNK_CELLS;
    let worst = 0;
    for (let j = 0; j < N; j++) {
      const h = (/** @type {Uint16Array} */ q, /** @type {number} */ i) => dequantize(q[j * N + i]);
      const left = h(a.heightQ, N - 1) - h(a.heightQ, N - 2);   // step just inside chunk (0,0)
      const seam = h(b.heightQ, 0) - h(a.heightQ, N - 1);       // step across the seam
      const right = h(b.heightQ, 1) - h(b.heightQ, 0);          // step just inside chunk (1,0)
      assert(Math.abs(seam) < 0.15, `row ${j}: seam step ${seam.toFixed(3)} m`);
      worst = Math.max(worst, Math.abs(seam - (left + right) / 2));
    }
    assert(worst < 0.01, `seam step differs from its neighbors by ${worst.toFixed(4)} m`);
    return `largest seam kink ${(worst * 1000).toFixed(2)} mm`;
  });

  test('terrain', 'cells beyond falloffEnd are exactly the seabed', async () => {
    const land = await loadLand();
    const sea = quantize(land.seabedDepth);
    let counted = 0;
    for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [1, 0], [0, -1]]) {
      const { heightQ } = buildBase({ land, seed: TERRAIN_SEED, cx, cz });
      for (let j = 0; j < CHUNK_CELLS; j++) for (let i = 0; i < CHUNK_CELLS; i++) {
        const x = CHUNK_SIZE * cx - CHUNK_SIZE / 2 + (i + 0.5) * CELL;
        const z = CHUNK_SIZE * cz - CHUNK_SIZE / 2 + (j + 0.5) * CELL;
        if (Math.sqrt(x * x + z * z) < land.falloffEnd) continue;
        counted++;
        if (heightQ[j * CHUNK_CELLS + i] !== sea) throw new Error(`chunk ${cx},${cz} cell ${i},${j} is ${heightQ[j * CHUNK_CELLS + i]}, not ${sea}`);
      }
    }
    assert(counted > 1000, `only ${counted} cells checked`);
    return `${counted} cells checked`;
  });

  test('terrain', 'buildBase in a worker gives the same hash as on the main thread', async () => {
    const land = await loadLand();
    initWorkers({ size: 2 });
    const job = { module: './world/terrain/landform.js', fn: 'buildBase' };
    const chunks = [[0, 0], [-1, 1]];
    const results = await timeout(Promise.all(chunks.map(([cx, cz]) => run(job, { land, seed: TERRAIN_SEED, cx, cz }))));
    for (let k = 0; k < chunks.length; k++) {
      const [cx, cz] = chunks[k];
      const w = results[k];
      assert(w.heightQ instanceof Uint16Array && w.material instanceof Uint8Array, 'worker result types');
      assert(!('__transfer' in w), '__transfer should be stripped');
      const m = buildBase({ land, seed: TERRAIN_SEED, cx, cz });
      eq(hashBase(w.heightQ, w.material), hashBase(m.heightQ, m.material), `chunk ${cx},${cz} hash`);
    }
    initWorkers({ size: 1 });
  });
}
