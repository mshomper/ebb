// @ts-check
// A whole island without the GPU (docs 07, 08, 10, 11): the opened chunks' landform, the water
// summary and the habitat grid, built from the recipes the same way the game builds them at the
// start of a new world (terrain/index.js, water/index.js, growth/index.js). For tools and tests that
// run the hourly tick on a real island: tools/ecology-lab.html and the ecology unit tests. Pure;
// about a second on a desktop.

import { subSeed } from '../core/rng.js';
import { CHUNK_CELLS, CHUNK_SIZE, WORLD_CELLS, chunkFirstCell, quantize } from './terrain/grid.js';
import { buildBase, landmarks } from './terrain/landform.js';
import { buildSummary } from './water/summary.js';
import { rectForBounds, waterCellOf } from './water/grid.js';
import { buildHabitat } from './growth/habitat.js';

/**
 * @param {{ seed: number, terrain: any, land: any, water: any, growth: any, edit?: (heightQ: Uint16Array, material: Uint8Array) => void }} r
 *   seed: the world seed (as ?seed=); terrain, water, growth: recipes/world/*.json; land: the island's land recipe;
 *   edit: shape the new island before its water and habitat are worked out, as a player would (tools/shaped-lab.html):
 *   it changes copies of the heights and paint in place, and the island as generated stays the habitat's baseQ
 * @returns {{ habitat: import('./growth/habitat.js').Habitat, summaryHash: number, summary: import('./water/summary.js').Summary,
 *   heightQ: Uint16Array, material: Uint8Array }}
 */
export function buildIslandModel(r) {
  const tSeed = subSeed(r.seed >>> 0, 'terrain');
  const S = { chunkMin: r.land.chunkMin ?? r.terrain.starter.chunkMin, chunkMax: r.land.chunkMax ?? r.terrain.starter.chunkMax };
  const N = WORLD_CELLS;
  const heightQ = new Uint16Array(N * N).fill(quantize(r.land.seabedDepth));
  const material = new Uint8Array(N * N * 4);
  for (let k = 0; k < N * N; k++) material[k * 4 + 1] = 255;   // open sea: sand
  for (let cz = S.chunkMin; cz <= S.chunkMax; cz++) {
    for (let cx = S.chunkMin; cx <= S.chunkMax; cx++) {
      const b = buildBase({ land: r.land, seed: tSeed, cx, cz });
      const x0 = chunkFirstCell(cx), z0 = chunkFirstCell(cz);
      for (let j = 0; j < CHUNK_CELLS; j++) {
        const k = (z0 + j) * N + x0;
        heightQ.set(b.heightQ.subarray(j * CHUNK_CELLS, (j + 1) * CHUNK_CELLS), k);
        material.set(b.material.subarray(j * CHUNK_CELLS * 4, (j + 1) * CHUNK_CELLS * 4), k * 4);
      }
    }
  }
  // A shaped island (the edit) keeps the island as generated for shapedCm.
  const baseQ = heightQ;
  if (r.edit) { const h = heightQ.slice(), m = material.slice(); r.edit(h, m); return finish(r, S, h, m, baseQ); }
  return finish(r, S, heightQ, material, baseQ);
}

/**
 * The water summary and habitat of an island's heights and paint.
 * @param {any} r @param {{ chunkMin: number, chunkMax: number }} S @param {Uint16Array} heightQ @param {Uint8Array} material @param {Uint16Array} baseQ
 */
function finish(r, S, heightQ, material, baseQ) {
  const N = WORLD_CELLS;
  const tSeed = subSeed(r.seed >>> 0, 'terrain');
  const half = CHUNK_SIZE / 2;
  const rect = rectForBounds({ openMin: [CHUNK_SIZE * S.chunkMin - half, CHUNK_SIZE * S.chunkMin - half], openMax: [CHUNK_SIZE * S.chunkMax + half, CHUNK_SIZE * S.chunkMax + half] });
  const springs = landmarks(r.land, tSeed).springs.map((s) => ({ cellX: waterCellOf(s.x), cellY: waterCellOf(s.z), rateLps: s.rateLps }));
  const summary = buildSummary({ heightQ, rect, springs, params: { ...r.water.summary, manningN: r.water.sim.manningN }, tide: r.water.tide });
  // A new island: nothing shaped yet (baseQ is the same heights), unless an edit shaped it.
  const habitat = buildHabitat({ eco: summary.eco, material, materialCells: N, params: r.growth.habitat,
    heightQ, baseQ });
  return { habitat, summaryHash: summary.hash, summary, heightQ, material };
}
