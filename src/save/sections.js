// @ts-check
// What an island save holds (doc 18), and back again. Pure: the live parts are handed in.
//
// Saved: meta (seed, island, time, time flow), world (the hourly tick's state exactly as the tick
// and the Plant tool left it), journal (with its read marks), water (placed springs), unlocks
// (earned ones only), view (where the camera was), looks (empty until the creature studio), and
// one record per open 32 m chunk; only edited chunks carry heights and paint, stored as they are
// (not as a difference from the regrown land) so retuning a land recipe never scrambles them.
// Not saved, rebuilt on load: untouched land, the water summary, habitat, moving water, moss,
// plant and grass drawing, live frogs and midges, undo history.

import { CHUNK_CELLS as C, WORLD_CELLS as N, chunkFirstCell, chunkKey } from '../world/terrain/grid.js';
import { FORMAT } from './migrate.js';

/** Section ids this build writes; others found in a save are kept and written back unchanged. */
const KNOWN = ['meta', 'world', 'journal', 'water', 'unlocks', 'view', 'looks'];

/**
 * @typedef {Object} SavedChunk
 * @property {number} cx @property {number} cz @property {string} land @property {boolean} edited
 * @property {Uint16Array} [heightQ]  128 x 128, only if edited
 * @property {Uint8Array} [material]  128 x 128 x 4, only if edited
 */

/**
 * @typedef {Object} IslandParts
 * @property {string} build
 * @property {number} seed @property {string} island @property {number} worldT @property {0|1|2|4} flow
 * @property {any} world @property {any} journal @property {any} water @property {any} unlocks
 * @property {any} view   camera pose, or null
 * @property {any} looks
 * @property {Record<string, { state: string, land: string, edited: boolean }>} chunks  the store's `chunks` slice
 * @property {import('../world/terrain/heightfield.js').Mirror | null} mirror
 * @property {number} savedAt  UTC ms
 * @property {number} wallHighWater UTC ms
 * @property {[string, any][]} [extra]  sections from a newer build, kept as they were
 */

/**
 * One chunk's heights and paint, copied out of the mirror.
 * @param {import('../world/terrain/heightfield.js').Mirror} mirror @param {number} cx @param {number} cz
 */
export function copyChunk(mirror, cx, cz) {
  const x0 = chunkFirstCell(cx), z0 = chunkFirstCell(cz);
  const heightQ = new Uint16Array(C * C), material = new Uint8Array(C * C * 4);
  for (let j = 0; j < C; j++) {
    const k = (z0 + j) * N + x0;
    heightQ.set(mirror.heightQ.subarray(k, k + C), j * C);
    material.set(mirror.material.subarray(k * 4, (k + C) * 4), j * C * 4);
  }
  return { heightQ, material };
}

/**
 * The header and sections of a save. Values are copied, so the live island may change while the
 * save is packed.
 * @param {IslandParts} p
 * @returns {{ header: Record<string, any>, sections: [string, any][] }}
 */
export function snapshot(p) {
  /** @type {[string, any][]} */
  const sections = [
    ['meta', { seed: p.seed, island: p.island, worldT: p.worldT, flow: p.flow, carryMinutes: 0, keepGrowing: true }],
    ['world', structuredClone(p.world)],
    ['journal', structuredClone(p.journal ?? null)],
    ['water', structuredClone(p.water ?? { springs: [], version: 1 })],
    ['unlocks', structuredClone(p.unlocks ?? {})],
    ['view', p.view ? structuredClone(p.view) : null],
    ['looks', structuredClone(p.looks ?? {})],
  ];
  for (const [key, c] of Object.entries(p.chunks ?? {})) {
    if (c.state !== 'open') continue;
    const [cx, cz] = key.split(',').map(Number);
    /** @type {SavedChunk} */ const rec = { cx, cz, land: c.land, edited: !!c.edited };
    if (c.edited && p.mirror) Object.assign(rec, copyChunk(p.mirror, cx, cz));
    sections.push([`chunk:${key}`, rec]);
  }
  for (const s of p.extra ?? []) sections.push(s);
  const header = {
    format: FORMAT, build: p.build, seed: p.seed, island: p.island,
    savedAt: p.savedAt, wallHighWater: p.wallHighWater, worldT: p.worldT,
  };
  return { header, sections };
}

/**
 * Sort decoded sections back into island parts. A chunk whose arrays are the wrong size is left
 * out (it regrows from the seed) and named in `bad`.
 * @param {Record<string, any>} sections
 * @returns {{ meta: any, world: any, journal: any, water: any, unlocks: any, view: any, looks: any,
 *   chunks: SavedChunk[], extra: [string, any][], bad: string[] }}
 */
export function restore(sections) {
  /** @type {SavedChunk[]} */ const chunks = [];
  /** @type {[string, any][]} */ const extra = [];
  /** @type {string[]} */ const bad = [];
  for (const [id, v] of Object.entries(sections)) {
    if (KNOWN.includes(id)) continue;
    if (!id.startsWith('chunk:')) { extra.push([id, v]); continue; }
    const ok = v && Number.isInteger(v.cx) && Number.isInteger(v.cz) && id === `chunk:${chunkKey(v.cx, v.cz)}`
      && (!v.edited || (v.heightQ instanceof Uint16Array && v.heightQ.length === C * C
        && v.material instanceof Uint8Array && v.material.length === C * C * 4));
    if (ok) chunks.push(v); else bad.push(id);
  }
  return {
    meta: sections.meta ?? null, world: sections.world ?? null, journal: sections.journal ?? null,
    water: sections.water ?? null, unlocks: sections.unlocks ?? {}, view: sections.view ?? null,
    looks: sections.looks ?? {}, chunks, extra, bad,
  };
}
