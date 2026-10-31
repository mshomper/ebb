// @ts-check
// Chunk bookkeeping (docs/08): which 32 m chunks are open, the open-land bounds used by
// brush edge fades, and building open chunks' base landform on the worker pool.

import { run } from '../../core/workers.js';
import { CHUNK_CELLS as C, WORLD_CELLS as N, CHUNK_SIZE, chunkFirstCell, chunkKey, quantize, dequantize } from './grid.js';

const LANDFORM_JOB = { module: './world/terrain/landform.js', fn: 'buildBase' };

/** @typedef {'sea'|'rising'|'open'|'raised'} ChunkState  raised: new land drawn there (the meadow islet), outside the open land the brushes reach */

export function createChunkTable() {
  /** @type {Map<string, { cx: number, cz: number, state: ChunkState, land: string }>} */
  const open = new Map();
  /** Chunks of new land risen outside the open land (src/world/islet): drawn, never brushed or saved. @type {Set<string>} */
  const raised = new Set();
  return {
    /** @param {number} cx @param {number} cz @param {string} land */
    open(cx, cz, land) { open.set(chunkKey(cx, cz), { cx, cz, state: 'open', land }); },
    /** Draw a sea chunk as land from now on (new land rising there). @param {number} cx @param {number} cz */
    raise(cx, cz) { if (!open.has(chunkKey(cx, cz))) raised.add(chunkKey(cx, cz)); },
    /** @param {number} cx @param {number} cz @returns {ChunkState} */
    state(cx, cz) { return open.get(chunkKey(cx, cz))?.state ?? (raised.has(chunkKey(cx, cz)) ? 'raised' : 'sea'); },
    list() { return [...open.values()]; },
    /**
     * Bounding box of the open chunks, in world meters and in cells.
     * (The open land is a square block, 3 x 3 or 4 x 4, so a box is exact; uneven shapes arrive with expansion.)
     */
    bounds() {
      const cs = [...open.values()];
      const cx0 = Math.min(...cs.map((c) => c.cx));
      const cx1 = Math.max(...cs.map((c) => c.cx));
      const cz0 = Math.min(...cs.map((c) => c.cz));
      const cz1 = Math.max(...cs.map((c) => c.cz));
      return {
        openMin: [CHUNK_SIZE * cx0 - CHUNK_SIZE / 2, CHUNK_SIZE * cz0 - CHUNK_SIZE / 2],
        openMax: [CHUNK_SIZE * cx1 + CHUNK_SIZE / 2, CHUNK_SIZE * cz1 + CHUNK_SIZE / 2],
        cells: { x: chunkFirstCell(cx0), y: chunkFirstCell(cz0), w: (cx1 - cx0 + 1) * C, h: (cz1 - cz0 + 1) * C },
      };
    },
  };
}

/**
 * Which land recipe an island grows from (docs/future/13 section 3.11). A new island uses the
 * island's current land (`land` in terrain.json's list, else its id); an island already made keeps
 * the land its saved chunks record ('land/<id>'), as long as that is one of this island's own.
 * @param {{ id: string, land?: string }} island
 * @param {{ land?: string }[]} saved  the saved (or live) chunk records, empty for a new island
 * @returns {string}  a land recipe id under recipes/land/
 */
export function islandLand(island, saved) {
  const now = island.land ?? island.id;
  const was = saved.find((c) => typeof c?.land === 'string')?.land?.replace(/^land\//, '');
  return was === island.id || was === now ? was : now;
}

/**
 * Fill the whole mirror with open sea (seabed height, sand), then build each open chunk's
 * base in parallel on the worker pool and paste it in.
 * @param {import('./heightfield.js').Mirror} mirror
 * @param {{ cx: number, cz: number }[]} chunks
 * @param {any} land  land recipe
 * @param {number} seed  terrain sub-seed
 */
export async function buildBases(mirror, chunks, land, seed) {
  const seabedQ = quantize(land.seabedDepth);
  mirror.heightQ.fill(seabedQ);
  mirror.heightF.fill(dequantize(seabedQ));
  for (let k = 0; k < N * N; k++) {
    mirror.material[k * 4] = 0;
    mirror.material[k * 4 + 1] = 255;
    mirror.material[k * 4 + 2] = 0;
    mirror.material[k * 4 + 3] = 0;
  }
  const results = await Promise.all(chunks.map((c) =>
    run(LANDFORM_JOB, { land, seed, cx: c.cx, cz: c.cz }, { lane: 'interactive' })));
  for (const r of results) pasteChunk(mirror, r.cx, r.cz, r.heightQ, r.material);
}

/**
 * @param {import('./heightfield.js').Mirror} mirror
 * @param {number} cx @param {number} cz
 * @param {Uint16Array} heightQ @param {Uint8Array} material
 */
export function pasteChunk(mirror, cx, cz, heightQ, material) {
  const x0 = chunkFirstCell(cx);
  const z0 = chunkFirstCell(cz);
  for (let j = 0; j < C; j++) {
    const k = (z0 + j) * N + x0;
    mirror.heightQ.set(heightQ.subarray(j * C, j * C + C), k);
    mirror.material.set(material.subarray(j * C * 4, (j * C + C) * 4), k * 4);
    for (let i = 0; i < C; i++) mirror.heightF[k + i] = dequantize(heightQ[j * C + i]);
  }
}
