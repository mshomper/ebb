// @ts-check
// A starter island with B3's test grounds shaped into it, with no GPU, for tools/shaped-lab.html and
// the shaped unit tests: the same layout the game's `?shape=` strokes use (src/world/ecology/
// shaped-demo.js), raised into the island's heights before its water and habitat are worked out
// (src/world/island-model.js edit), so the habitat knows which ground was shaped. A sheer face the
// shapes make is painted rock, as the Cliff tool's faces are.

import { buildIslandModel } from '../src/world/island-model.js';
import { WORLD_CELLS, WORLD_ORIGIN, CELL, quantize, dequantize } from '../src/world/terrain/grid.js';
import { shapedLayout, shapedHeight } from '../src/world/ecology/shaped-demo.js';

/** @param {string} path */
async function get(path) {
  const r = await fetch(new URL(`../recipes/${path}.json`, import.meta.url));
  if (!r.ok) throw new Error(`recipes/${path}.json: HTTP ${r.status}`);
  return r.json();
}

/** @type {Promise<any> | null} */ let shared = null;
/** The recipes an island model and the checks read, loaded once. */
export function loadShapedRecipes() {
  shared ??= (async () => {
    const [terrain, water, growth, shaped] = await Promise.all(['world/terrain', 'world/water', 'world/growth', 'world/shaped'].map(get));
    const starter = terrain.islands.list.find((/** @type {any} */ i) => i.id === 'starter-island') ?? terrain.islands.list[0];
    const land = await get(`land/${starter.land ?? starter.id}`);
    return { terrain, water, growth, shaped, land };
  })();
  return shared;
}

/** A sheer step between two neighbouring cells (m): a face the Cliff tool would paint rock. */
const FACE_STEP_M = 0.35;

/**
 * The island with these test grounds shaped into it. Each call builds the island afresh (about a
 * second). kinds: any of bar, wall, pond. Returns the model, the layout and the ground sampler.
 * @param {any} R loadShapedRecipes() @param {string[]} kinds @param {number} [seed]
 */
export function shapedIsland(R, kinds, seed = 1) {
  const T = R.shaped.test, N = WORLD_CELLS;
  const base = buildIslandModel({ seed, terrain: R.terrain, land: R.land, water: R.water, growth: R.growth });
  const groundOf = (/** @type {Uint16Array} */ hq) => (/** @type {number} */ x, /** @type {number} */ z) => {
    const i = Math.max(0, Math.min(N - 1, Math.floor((x - WORLD_ORIGIN) / CELL))), j = Math.max(0, Math.min(N - 1, Math.floor((z - WORLD_ORIGIN) / CELL)));
    return dequantize(hq[j * N + i]);
  };
  const L = shapedLayout(groundOf(base.heightQ), T);
  if (!kinds.length) return { model: base, L, ground: groundOf(base.heightQ) };
  const floor = L.pond ? groundOf(base.heightQ)(L.pond.x, L.pond.z) - T.pond.depthM : undefined;
  const model = buildIslandModel({ seed, terrain: R.terrain, land: R.land, water: R.water, growth: R.growth, edit: (hq, mat) => {
    /** @type {Set<number>} */ const touched = new Set();
    for (const kind of kinds) {
      if (!(/** @type {any} */ (L))[kind]) continue;
      for (let j = 0; j < N; j++) {
        const z = WORLD_ORIGIN + (j + 0.5) * CELL;
        for (let i = 0; i < N; i++) {
          const k = j * N + i, x = WORLD_ORIGIN + (i + 0.5) * CELL;
          const h0 = dequantize(hq[k]), h1 = shapedHeight(h0, x, z, /** @type {any} */ (kind), L, T, floor);
          if (h1 !== h0) { hq[k] = quantize(h1); touched.add(k); }
        }
      }
    }
    // The faces: a shaped cell beside a neighbour more than FACE_STEP_M lower or higher, painted rock.
    for (const k of touched) {
      const i = k % N, h = dequantize(hq[k]);
      for (const q of [i > 0 ? k - 1 : -1, i < N - 1 ? k + 1 : -1, k - N, k + N]) {
        if (q < 0 || q >= N * N) continue;
        if (Math.abs(dequantize(hq[q]) - h) <= FACE_STEP_M) continue;
        // The face and a cell either side of it (the Cliff tool paints the whole sheer band).
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const c = k + dj * N + di;
          if (c >= 0 && c < N * N) { mat[c * 4] = 0; mat[c * 4 + 1] = 0; mat[c * 4 + 2] = 255; mat[c * 4 + 3] = 0; }
        }
      }
    }
  } });
  return { model, L, ground: groundOf(model.heightQ) };
}
