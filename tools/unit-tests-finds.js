// @ts-check
// Finds tests for tools/unit-tests.html (docs/future/11): which cells each kind may live in (a rock
// pool is a hollow that reaches the tide band), and groups that are the same for the same seed,
// with lugworm casts laid fresh each tide and periwinkles only drifting.

import { findCells, groupAt } from '../src/world/finds/index.js';
import { WATER_CLASS } from '../src/world/water/summary.js';

const FINDS = 'finds';

async function findsRecipe() {
  const r = await fetch('../recipes/species/finds.json');
  if (!r.ok) throw new Error(`recipes/species/finds.json: HTTP ${r.status}`);
  return r.json();
}

/**
 * A row of six cells: 0 wrack, 1 wetSand, 2 and 3 one basin whose rim (2) is in the tide band and
 * whose floor (3) is below it, 4 and 5 a second basin wholly above the band.
 */
function row() {
  const ids = ['wrack', 'wetSand'];
  const zone = new Uint8Array([1, 2, 0, 0, 0, 0]);
  const basin = new Uint16Array([0, 0, 7, 7, 9, 9]);
  const band = new Uint8Array([1, 1, 1, 0, 0, 0]);
  const cls = new Uint8Array([0, 0, WATER_CLASS.still, WATER_CLASS.still, WATER_CLASS.still, WATER_CLASS.still]);
  return { s: { rect: { x: 0, y: 0, w: 6, h: 1 }, cls, basin, band }, z: { zone, ids } };
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addFindsTests(test, assert, eq) {
  test(FINDS, 'finds live in their zones, anemones only in rock pools that reach the tide', async () => {
    const K = (await findsRecipe()).kinds;
    const { s, z } = row();
    const c = findCells(s, z, K, () => true);
    eq(c.periwinkle.join(','), '0', 'periwinkles on the wrack');
    eq(c.lugworm.join(','), '1', 'casts on the wet sand');
    eq(c.anemone.join(','), '2,3', 'anemones in the tidal pool, its deep floor too, not in the high hollow');
    const bare = findCells(s, z, K, () => false);
    eq(bare.anemone.length, 0, 'a hollow dug in sand holds no anemones');
  });

  test(FINDS, 'the same seed gives the same groups; casts move with the tide, periwinkles only drift', async () => {
    const K = (await findsRecipe()).kinds;
    const dense = (/** @type {any} */ k) => ({ ...k, density: 1 });
    const a = groupAt(11, 'lugworm', 40, dense(K.lugworm), 1, 2, 3);
    const b = groupAt(11, 'lugworm', 40, dense(K.lugworm), 1, 2, 3);
    eq(JSON.stringify(a), JSON.stringify(b), 'same seed, cell and tide, same casts');
    const later = groupAt(11, 'lugworm', 40, dense(K.lugworm), 1, 2, 4);
    assert(JSON.stringify(a) !== JSON.stringify(later), 'the next tide lays fresh casts');
    const p0 = groupAt(11, 'periwinkle', 40, dense(K.periwinkle), 1, 2, 3);
    const p1 = groupAt(11, 'periwinkle', 40, dense(K.periwinkle), 1, 2, 4);
    eq(p0.length, p1.length, 'the same periwinkles next tide');
    for (let i = 0; i < p0.length; i++) {
      eq(p0[i].key, p1[i].key, 'each keeps its name');
      assert(Math.hypot(p0[i].x - p1[i].x, p0[i].z - p1[i].z) <= K.periwinkle.driftM * 2 * 1.2 + 1e-9, 'and creeps only a little');
    }
    let n = 0;
    for (let k = 0; k < 2000; k++) n += groupAt(5, 'anemone', k, K.anemone, 0, 0, 0).length > 0 ? 1 : 0;
    assert(Math.abs(n / 2000 - K.anemone.density) < 0.05, `about density of cells hold anemones (${(n / 2000).toFixed(2)})`);
  });
}
