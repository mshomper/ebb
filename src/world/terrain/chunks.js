// @ts-check
// Chunk bookkeeping (docs/08): which 32 m chunks are open, the open-land bounds used by
// brush edge fades, and building open chunks' base landform on the worker pool.

import { run } from '../../core/workers.js';
import { CHUNK_CELLS as C, WORLD_CELLS as N, CHUNK_SIZE, chunkFirstCell, chunkKey, quantize, dequantize } from './grid.js';

const LANDFORM_JOB = { module: './world/terrain/landform.js', fn: 'buildBase' };

/** @typedef {'sea'|'rising'|'open'} ChunkState */

export function createChunkTable() {
  /** @type {Map<string, { cx: number, cz: number, state: ChunkState, land: string }>} */
  const open = new Map();
  return {
    /** @param {number} cx @param {number} cz @param {string} land */
    open(cx, cz, land) { open.set(chunkKey(cx, cz), { cx, cz, state: 'open', land }); },
    /** @param {number} cx @param {number} cz @returns {ChunkState} */
    state(cx, cz) { return open.get(chunkKey(cx, cz))?.state ?? 'sea'; },
    list() { return [...open.values()]; },
    /**
     * Bounding box of the open chunks, in world meters and in cells.
     * (S1 opens a 3 x 3 block, so a box is exact; uneven shapes arrive with expansion in M2.)
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
