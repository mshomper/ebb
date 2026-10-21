// @ts-check
// Keepsakes on the shore (docs/future/12, piece K2): what the recent high tides left on their
// strandlines, worked out for the whole island once per tide (shore.js, pure), drawn near the view
// at the strandline shells' enlargement, and found by a tap. Each one's mesh is built from its
// numbers when it is first near the view and kept while it lies there. Nothing is saved: a tide's
// keepsakes are the same live or after time away, and one let go stays gone until its line is swept.

import { WATER_CELL, waterCellCenter } from '../water/grid.js';
import { strandLines } from '../water/strandline.js';
import { tideParams } from '../tide.js';
import { seasonOf } from '../../core/clock.js';
import { packMesh } from '../creatures/bodies.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { keepsakeMesh } from './families/index.js';
import { onShore, tideKeepsakes } from './shore.js';
import { coveField } from '../water/cove.js';

const SEASON_NAMES = ['spring', 'summer', 'autumn', 'winter'];

/**
 * @param {{ water: any, shore: any, terrain: any, camera: any, recipe: any, passRecipe: any, seed: number,
 *   tide?: any, on: () => boolean, test?: boolean, coveRecipe?: any }} opts
 *   recipe: keepsakes.json; passRecipe: the finds recipe, for the creature pass's look; on: whether
 *   the sea leaves keepsakes yet; test: ?keepsakes, a thick strandline; coveRecipe: recipes/world/
 *   cove.json, so sheltered coves are favoured (src/world/water/cove.js)
 */
export function createKeepsakes(opts) {
  const { water, shore, terrain, camera, recipe: K } = opts;
  const S = K.shore;
  const pass = createCreaturePass({ recipe: opts.passRecipe, maxBones: 1 });
  const tideP = tideParams(opts.tide);
  /** Each tide's keepsakes, by tide id, for the shore as it was when worked out. @type {Map<number, import('./shore.js').ShoreKeepsake[]>} */
  const byTide = new Map();
  /** Let go (or, later, kept): gone until their tide's line is swept. @type {Set<string>} */
  const gone = new Set();
  /** Meshes by keepsake id, built when first near the view. @type {Set<string>} */
  const meshes = new Set();
  /** @type {any} */ let zonesSeen = null;
  /** @type {import('./shore.js').ShoreKeepsake[]} */ let now = [];
  /** @type {{ id: string, x: number, z: number, n: any }[]} */ let shown = [];
  let clock = 0;
  /** How sheltered each shore cell is (src/world/water/cove.js), for the shore as it is now. @type {Uint8Array | null} */
  let shelter = null;
  /** What the last look saw (tools). */
  let stats = { lines: 0, cells: 0, rolled: 0, ready: false, on: false };

  /** The keepsakes one strandline holds: its cells across the whole island, then the roll. */
  function workOut(/** @type {number} */ tideId, /** @type {number} */ level, /** @type {number} */ spring, /** @type {any} */ rect) {
    const L = shore.recipe?.look?.strandline;
    /** @type {import('./shore.js').StrandCell[]} */ const cells = [];
    for (let j = 0; j < rect.h; j++) for (let i = 0; i < rect.w; i++) {
      const x = waterCellCenter(rect.x + i), z = waterCellCenter(rect.y + j);
      if (Math.abs(terrain.sampleHeight(x, z) - level - L.runupM) > S.lineToleranceM) continue;
      const k = j * rect.w + i;
      // Sheltered cells (the cove field, 0 open to 255 deep in a cove) are chosen far more often.
      cells.push({ k, x, z, weight: shelter ? S.coveFloor + (1 - S.coveFloor) * S.coveGain * (shelter[k] / 255) : 1 });
    }
    stats.cells += cells.length;
    const hour = tideId * tideP.periodH + tideP.phaseH;
    const season = SEASON_NAMES[seasonOf(hour * 3600).index];
    return tideKeepsakes(opts.seed, tideId, cells, { spring, season }, K, opts.test ? { budget: S.testBudget } : {});
  }

  /** @param {import('../../sim/live-sim.js').FrameInfo} f */
  function scan(f) {
    const L = shore.recipe?.look?.strandline;
    const z = shore.zones?.();
    stats = { lines: 0, cells: 0, rolled: 0, ready: !!(L && z), on: opts.on() };
    if (!L || !z || !opts.on()) { now = []; shown = []; return; }
    // A reshaped shore moves the lines and its coves: work them out again.
    if (z !== zonesSeen) {
      zonesSeen = z;
      byTide.clear();
      const s = water.getSummary?.();
      shelter = opts.coveRecipe && s && s.rect.w === z.rect.w && s.rect.h === z.rect.h ? coveField(s, opts.coveRecipe) : null;
    }
    const nowH = f.displayT / 3600;
    const lines = strandLines(nowH, tideP, L);
    /** @type {import('./shore.js').ShoreKeepsake[][]} */ const lists = [];
    const live = new Set();
    for (let n = 0; n < lines.levels.length; n++) {
      const tideId = Math.round((nowH - lines.ages[n] - tideP.phaseH) / tideP.periodH);
      live.add(tideId);
      if (!byTide.has(tideId)) {
        const spring = (lines.levels[n] / tideP.amplitudeM - 1) / tideP.springNeap;
        byTide.set(tideId, workOut(tideId, lines.levels[n], spring, z.rect));
      }
      lists.push(/** @type {any} */ (byTide.get(tideId)));
      stats.rolled += /** @type {any} */ (byTide.get(tideId)).length;
    }
    stats.lines = lines.levels.length;
    // Swept lines are forgotten, and with them anything let go from them.
    for (const id of [...byTide.keys()]) if (!live.has(id)) byTide.delete(id);
    for (const g of [...gone]) if (!live.has(Number(g.split(':')[0]))) gone.delete(g);
    now = onShore(lists, opts.test ? S.testMax : S.maxOnIsland, gone)
      // Under water there is nothing to see of them.
      .filter((s) => (water.sampleLive(s.x, s.z)?.depth ?? 0) <= 0.005);
    const t = camera.target, near2 = S.nearM * S.nearM;
    shown = now.filter((s) => (s.x - t[0]) ** 2 + (s.z - t[2]) ** 2 < near2).map((s) => ({ id: s.id, x: s.x, z: s.z, n: s.n }));
    for (const s of shown) {
      if (meshes.has(s.id)) continue;
      const m = keepsakeMesh(s.n, K);
      pass.setMesh(s.id, { data: packMesh(m), indices: m.indices });
      meshes.add(s.id);
    }
  }

  const api = {
    id: 'keepsakes',
    pass,
    /** @param {import('../../sim/live-sim.js').FrameInfo} f */
    tick(f) {
      clock += f.realDt;
      if (clock < 0.25) return;
      clock = 0;
      scan(f);
      pass.setBeings(now.filter((s) => shown.some((h) => h.id === s.id)).map((s) => ({
        x: s.x, y: terrain.sampleHeight(s.x, s.z) - 0.001, z: s.z, yaw: s.yaw, size: S.scale, mesh: s.id,
      })));
    },
    /**
     * The keepsake nearest a tapped ground point, if one is close enough.
     * @param {number} x @param {number} z @returns {{ id: string, x: number, z: number, n: any } | null}
     */
    keepsakeAt(x, z) {
      const r = 0.3 + 0.02 * (camera.distance ?? 10);
      let best = null, bestD = r * r;
      for (const s of shown) {
        const d = (s.x - x) ** 2 + (s.z - z) ** 2;
        if (d < bestD) { bestD = d; best = s; }
      }
      return best;
    },
    /** Leave one where it lies: it goes back to the sea and does not come again. @param {string} id */
    leave(id) { gone.add(id); now = now.filter((s) => s.id !== id); shown = shown.filter((s) => s.id !== id); },
    /**
     * What the shelf keeps of one on the shore: its numbers, the hour of the tide that left it, and
     * whether that was a spring tide. @param {string} id
     * @returns {{ n: any, hour: number, spring: boolean } | null}
     */
    toKeep(id) {
      const s = now.find((e) => e.id === id);
      if (!s) return null;
      return { n: structuredClone(s.n), hour: s.tideId * tideP.periodH + tideP.phaseH, spring: !!s.spring };
    },
    /** On the shore now, and drawn now (tools and tests). */
    onShore: () => now,
    shown: () => shown,
    /** Strandlines, their cells and keepsakes rolled at the last look (tools). */
    stats: () => stats,
    cellSize: WATER_CELL,
  };
  // On the ?keepsakes test link only, a handle for the console and tools: where they lie.
  if (opts.test) {
    /** @type {any} */ (globalThis).ebbKeepsakes = {
      ...api,
      /** Look at the i-th keepsake on the shore from close by. @param {number} i */
      look(i = 0) { const s = now[i]; if (s) camera.focus(s.x, s.z, 1.2, 35, terrain.sampleHeight(s.x, s.z)); return s?.id ?? null; },
    };
  }
  return api;
}
