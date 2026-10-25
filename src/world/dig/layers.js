// @ts-check
// Where the shovel can dig, and what lies under it (docs/future/13 10.4). The dig point is classed
// from the habitat grid (1 m cells: standing water, moisture, salt, the tide band and the painted
// shares), the live water over it, the camp pad and the placed pieces: soil, a damp bank, dry sand,
// or nothing (rock, water, the camp ground, the wet flats, a piece in the way). Each class has its
// layer stack, top first, and a word for what lies below the last (recipes/world/dig.json layers).
// Pure: the live module fills a DigGround from the world and asks.

import { HABITAT_CELLS, HABITAT_ORIGIN } from '../growth/habitat.js';

/** The ground classes a shovel can dig. */
export const CLASSES = /** @type {const} */ (['soil', 'bank', 'sand']);
/** @typedef {'soil' | 'bank' | 'sand'} GroundClass */
/**
 * Why a point cannot be dug (never said: Dig is simply not offered there).
 * @typedef {'outside' | 'camp' | 'water' | 'rock' | 'flats' | 'piece'} NoDig
 */

/**
 * What classing a point reads. depthAt and pieces may be left out (no live water, no pieces).
 * @typedef {Object} DigGround
 * @property {import('../growth/habitat.js').Habitat} hab
 * @property {(x: number, z: number) => number} [depthAt]  live water over the ground (m)
 * @property {{ x: number, z: number, r: number } | null} [pad]  the camp pad
 * @property {{ x: number, z: number, r: number }[]} [pieces]  placed pieces as footprint circles (m)
 */

/** The 1 m habitat cell under a point, or -1 off the grid. @param {number} x @param {number} z */
export function cellOf(x, z) {
  const i = Math.floor(x - HABITAT_ORIGIN), j = Math.floor(z - HABITAT_ORIGIN);
  return i < 0 || j < 0 || i >= HABITAT_CELLS || j >= HABITAT_CELLS ? -1 : j * HABITAT_CELLS + i;
}

/** A cell's middle [x, z]. @param {number} k */
export const cellCenter = (k) => [HABITAT_ORIGIN + (k % HABITAT_CELLS) + 0.5, HABITAT_ORIGIN + Math.floor(k / HABITAT_CELLS) + 0.5];

/**
 * The painted ground strongest in a cell: grass, sand, rock or soil (ties go in that order).
 * @param {import('../growth/habitat.js').Habitat} hab @param {number} k
 */
export function strongestPaint(hab, k) {
  const s = [['grass', hab.grass?.[k] ?? 255], ['sand', hab.sand?.[k] ?? 0], ['rock', hab.rock?.[k] ?? 0], ['soil', hab.soil?.[k] ?? 0]];
  let best = s[0];
  for (const e of s) if (e[1] > best[1]) best = e;
  return /** @type {'grass' | 'sand' | 'rock' | 'soil'} */ (best[0]);
}

/**
 * The ground class at a point (docs/future/13 10.4.1), or why it cannot be dug.
 * @param {number} x @param {number} z @param {DigGround} g @param {any} R recipes/world/dig.json
 * @returns {{ cls: GroundClass, k: number } | { cls: null, k: number, why: NoDig }}
 */
export function groundClass(x, z, g, R) {
  const k = cellOf(x, z), hab = g.hab;
  if (k < 0 || !hab.open[k]) return { cls: null, k, why: 'outside' };
  const pad = g.pad;
  if (pad && (x - pad.x) * (x - pad.x) + (z - pad.z) * (z - pad.z) < pad.r * pad.r) return { cls: null, k, why: 'camp' };
  if (hab.clear?.[k]) return { cls: null, k, why: 'camp' };
  const ankle = R.ground.ankleM;
  if (hab.depthCm[k] > ankle * 100 || hab.sea[k] || (g.depthAt && g.depthAt(x, z) > ankle)) return { cls: null, k, why: 'water' };
  const paint = strongestPaint(hab, k);
  if (paint === 'rock') return { cls: null, k, why: 'rock' };
  // The tide band is the clam rake's (resolution 4): the shovel never digs there.
  if (hab.band?.[k]) return { cls: null, k, why: 'flats' };
  const clear = R.hole.pieceClearM + R.hole.sizeM / 2;
  for (const p of g.pieces ?? []) {
    const d = clear + p.r;
    if ((x - p.x) * (x - p.x) + (z - p.z) * (z - p.z) < d * d) return { cls: null, k, why: 'piece' };
  }
  if (paint === 'sand') return { cls: 'sand', k };
  const B = R.ground.dampBank;
  if (hab.moisture[k] >= B.moistureMin * 255 && hab.salt[k] <= B.saltMax * 255) return { cls: 'bank', k };
  return { cls: 'soil', k };
}

/** The layers under a ground class, top first. @param {GroundClass} cls @param {any} R @returns {string[]} */
export const stackOf = (cls, R) => R.layers[cls].stack;

/** The word said under a class's last layer: stones, harder or sand. @param {GroundClass} cls @param {any} R @returns {string} */
export const bottomOf = (cls, R) => R.layers[cls].bottom;

/**
 * What a press on a hole dug to `depth` layers reaches next: the layer (1-based depth), or the
 * bottom word when there is none. @param {GroundClass} cls @param {number} depth layers dug so far @param {any} R
 * @returns {{ layer: string, depth: number } | { bottom: string }}
 */
export function nextLayer(cls, depth, R) {
  const s = stackOf(cls, R);
  return depth < s.length ? { layer: s[depth], depth: depth + 1 } : { bottom: bottomOf(cls, R) };
}
