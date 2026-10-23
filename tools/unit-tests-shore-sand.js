// @ts-check
// Sand under the tide (Matt's click-test, October 22, 2026) for tools/unit-tests.html: the larger
// island's shore is sand below its sand floor (sandFloorM), with its heights unchanged; and grass
// cover never takes the tide band, on any island, so high water never stands over grass.

import { buildBase, landmarks } from '../src/world/terrain/landform.js';
import { dequantize, CHUNK_SIZE, CELL, CHUNK_CELLS } from '../src/world/terrain/grid.js';
import { HABITAT_CELLS } from '../src/world/growth/habitat.js';
import { settleGrowth } from '../src/world/growth/coarse.js';
import { initialWorldState, makeEnv } from '../src/sim/tick.js';
import { shoreline, loadRecipes } from './unit-tests-growth.js';

const G = 'shore sand';
const get = (/** @type {string} */ p) => fetch(`../recipes/${p}.json`).then((r) => r.json());

/**
 * The share of shore cells between sea level and `top` (m) painted mostly grass, away from ponds.
 * @param {any} land @param {number} seed @param {number} top
 */
function grassyShore(land, seed, top) {
  const basins = landmarks(land, seed).basins.map((b, i) => ({ ...b, r: (land.basins?.[i] ?? land.basin).outerRadius + 1 }));
  let n = 0, grassy = 0;
  for (let cz = land.chunkMin; cz <= land.chunkMax; cz++) for (let cx = land.chunkMin; cx <= land.chunkMax; cx++) {
    const b = buildBase({ land, seed, cx, cz });
    for (let k = 0; k < CHUNK_CELLS * CHUNK_CELLS; k++) {
      const h = dequantize(b.heightQ[k]);
      if (h < 0 || h > top) continue;
      const x = CHUNK_SIZE * cx - CHUNK_SIZE / 2 + ((k % CHUNK_CELLS) + 0.5) * CELL, z = CHUNK_SIZE * cz - CHUNK_SIZE / 2 + (Math.floor(k / CHUNK_CELLS) + 0.5) * CELL;
      if (basins.some((p) => (x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r)) continue;
      n++;
      if (b.material[k * 4] > 128) grassy++;
    }
  }
  return { n, share: grassy / Math.max(1, n) };
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addShoreSandTests(test, assert, eq) {
  test(G, 'the larger island: sand, not grass, below its sand floor; its heights unchanged', async () => {
    const land = await get('land/starter-island-2');
    const top = land.materials.sandFloorM - land.materials.sandFloorSoftM;
    const lines = [];
    for (const seed of [1, 7, 42]) {
      const s = grassyShore(land, seed, top);
      assert(s.n > 1000, `seed ${seed}: shore cells found (${s.n})`);
      eq(s.share, 0, `seed ${seed}: no mostly-grass cell on the shore below ${top} m`);
      lines.push(`seed ${seed}: ${s.n} shore cells, all sand`);
    }
    const without = { ...land, materials: { ...land.materials } };
    delete without.materials.sandFloorM;
    const a = buildBase({ land, seed: 7, cx: 0, cz: -2 }), b = buildBase({ land: without, seed: 7, cx: 0, cz: -2 });
    assert(a.heightQ.every((v, k) => v === b.heightQ[k]), 'the sand floor changes the paint only, never a height');
    const old = await get('land/starter-island');
    eq(old.materials.sandFloorM, undefined, 'an older island keeps its own base');
    return lines.join(', ');
  });

  test(G, 'grass cover never takes the tide band, so high water never stands over grass', async () => {
    const recipes = await loadRecipes();
    const N = HABITAT_CELLS;
    const hab = /** @type {any} */ (shoreline());
    // The tide band: shoreline()'s band zone, columns 20 to 22 (as the water summary marks it).
    hab.band = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 20; i <= 22; i++) hab.band[j * N + i] = 1;
    const grass = settleGrowth(initialWorldState(9), { ...makeEnv(9, recipes), habitat: () => hab }).growth.grass;
    const row = 20 * N;
    for (let i = 20; i <= 22; i++) eq(grass[row + i], 0, `no grass in the tide band (column ${i})`);
    assert(grass[row + 30] >= 250, `full grass on the dry ground above (${grass[row + 30]})`);
  });
}
