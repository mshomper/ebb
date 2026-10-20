// @ts-check
// Shore zones (docs/future/10, "Shore zonation"): the shore banded by how long each height spends
// under the sea. Reads the water summary's shore height (summary.js, 1..255 from the band bottom to
// the splash top) and the painted ground, and gives each 0.5 m water cell a zone from
// recipes/world/shore.json: kelp, wrack, channelled wrack and lichen on rock; rippled and firm wet
// sand on sand; mud on soil. Nothing is saved: the zones follow the land, so shaping the coast
// rezones it. Pure, integer-indexed and worker-safe, like the summary it reads.

import { WORLD_CELLS } from '../terrain/grid.js';

/** Painted ground channels, as terrain/brushes.js LAYER_INDEX. */
const GROUNDS = ['grass', 'sand', 'rock', 'soil'];

/**
 * @typedef {Object} ShoreZones
 * @property {{x:number,y:number,w:number,h:number}} rect  water cells, as the summary's
 * @property {Uint8Array} zone   0 for none, else 1 + the zone's index in the recipe list
 * @property {string[]} ids      zone ids by index (zone value - 1)
 * @property {number[]} cells    cells per zone, by index
 */

/**
 * The painted ground of a 0.5 m water cell: the channel with the most weight over its 2 x 2
 * terrain texels (ties to the lower channel). @param {Uint8Array} material 768 x 768 x 4
 * @param {number} cx water cell x (world) @param {number} cy water cell y (world)
 */
export function groundOfCell(material, cx, cy) {
  const T = WORLD_CELLS;
  const sum = [0, 0, 0, 0];
  for (let s = 0; s < 4; s++) {
    const i = 2 * cx + (s & 1), j = 2 * cy + (s >> 1);
    if (i < 0 || j < 0 || i >= T || j >= T) continue;
    const k = (j * T + i) * 4;
    for (let c = 0; c < 4; c++) sum[c] += material[k + c];
  }
  let best = 0;
  for (let c = 1; c < 4; c++) if (sum[c] > sum[best]) best = c;
  return best;
}

/**
 * Shore zones for a summary.
 * @param {{ summary: { rect: {x:number,y:number,w:number,h:number}, shore: Uint8Array, shoreRange: {loM:number, hiM:number} },
 *   material: Uint8Array, recipe: any, amplitudeM: number }} a
 *   recipe: recipes/world/shore.json; amplitudeM: water.json tide.amplitudeM (A0)
 * @returns {ShoreZones}
 */
export function shoreZones(a) {
  const { summary, material, recipe } = a;
  const { rect, shore, shoreRange } = summary;
  const A0 = a.amplitudeM;
  const list = /** @type {any[]} */ (recipe.zones ?? []);
  // Each zone's height range as shore-height bytes, so the per-cell test is integers only.
  const lo = shoreRange.loM, span = shoreRange.hiM - shoreRange.loM;
  /** @param {number} m */
  const toByte = (m) => 1 + Math.floor(((m - lo) * 254) / span);
  // Ranges are [from, to); a zone reaching the splash top keeps the top byte too.
  const rules = list.map((z) => ({ ground: GROUNDS.indexOf(z.ground), from: toByte(z.fromA0 * A0),
    to: z.toA0 * A0 >= shoreRange.hiM - 1e-9 ? 256 : toByte(z.toA0 * A0) }));
  const n = rect.w * rect.h;
  const zone = new Uint8Array(n);
  const cells = list.map(() => 0);
  for (let j = 0; j < rect.h; j++) {
    for (let i = 0; i < rect.w; i++) {
      const k = j * rect.w + i, s = shore[k];
      if (!s) continue;
      const g = groundOfCell(material, rect.x + i, rect.y + j);
      for (let r = 0; r < rules.length; r++) {
        const R = rules[r];
        if (R.ground === g && s >= R.from && s < R.to) { zone[k] = r + 1; cells[r]++; break; }
      }
    }
  }
  return { rect, zone, ids: list.map((z) => z.id), cells };
}

/**
 * Bed height in meters about mean sea level that a shore-height byte stands for (its lower edge).
 * @param {number} s 1..255 @param {{loM:number, hiM:number}} range
 */
export function shoreHeightM(s, range) {
  return range.loM + ((s - 1) * (range.hiM - range.loM)) / 254;
}
