// @ts-check
// Autumn's season markers, live (doc 13; autumn.js): fungi on the kept logs and dewy orb webs in the
// tall grass on misty mornings, worked out a few times a second near the view's middle and drawn by
// two small passes of their own: the fungi by a creature pass (their meshes, autumn-meshes.js), the
// webs by the webs pass (spun in the shader, render/passes/webs.js). Nothing is saved: the logs come
// from src/world/pieces (keptLogs), the weather and grass from the world state and the growth. The
// finds module asks shown() what a tap may land on, so tapping either is a find for the journal.

import { subSeed } from '../../core/rng.js';
import { seasonOf, SECONDS_PER_HOUR, HOURS_PER_DAY } from '../../core/clock.js';
import { weatherAt } from '../weather.js';
import { waterCellOf } from '../water/grid.js';
import { packMesh } from '../creatures/bodies.js';
import { HABITAT_CELLS, HABITAT_ORIGIN } from '../growth/habitat.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { createWebsPass } from '../../render/passes/webs.js';
import { moodsOf, fungiBloom, fungusSize, fungiLayout, websNear, webDew } from './autumn.js';
import { fungusMeshes } from './autumn-meshes.js';

/**
 * @param {{ world: { state: any, env: any }, terrain: any, water: any, camera: any, pieces: any, growth: any,
 *   recipe: any, seasons: any, seed: number }} opts
 *   pieces: src/world/pieces (its kept logs); growth: src/world/growth (the lush field); recipe:
 *   recipes/species/autumn-finds.json; seasons: recipes/world/seasons.json; seed: the world seed
 */
export function createAutumn(opts) {
  const { world, terrain, water, camera, pieces, growth, recipe } = opts;
  const F = recipe.fungi, W = recipe.webs;
  const websSeed = subSeed(opts.seed, 'webs');
  const fungiPass = createCreaturePass({ recipe: { body: { wetSpecular: F.look, contactShadow: 0, scaleReal: [0.03, 0.03] } }, name: 'fungi' });
  for (const [key, mesh] of Object.entries(fungusMeshes(F))) fungiPass.setMesh(key, { data: packMesh(mesh), indices: mesh.indices });
  const websPass = createWebsPass({ recipe: W });

  /** The weather's moods by day, worked out again while the leaning stays the same. */
  let moods = { lean: NaN, of: /** @type {(d: number) => string} */ (() => 'clear') };
  const moodOf = () => {
    const lean = world.state?.weather?.lean ?? 0;
    if (lean !== moods.lean) moods = { lean, of: moodsOf(world.env.weatherSeed, lean, opts.seasons.weather) };
    return moods.of;
  };
  /** Each log's layout (by seed, never changes) and bloom (by day and where it was set). */
  /** @type {Map<number, ReturnType<typeof fungiLayout>>} */ const layouts = new Map();
  /** @type {Map<string, any>} */ const blooms = new Map();

  /** @type {{ sp: string, x: number, z: number, item: string | null, reach: number }[]} */ let shown = [];
  /** @type {any[]} */ let fungi = [];
  /** @type {{ x: number, y: number, z: number, yaw: number, r: number, dew: number, seed: number }[]} */ let webs = [];
  let clock = 1;
  let last = { fungi: 0, webs: 0, dew: 0 };

  /** Is a ground point in the tide band (water summary), where no log rests out of the tide? @param {number} x @param {number} z */
  function inTide(x, z) {
    const s = water.getSummary?.();
    if (!s) return false;
    const i = waterCellOf(x) - s.rect.x, j = waterCellOf(z) - s.rect.y;
    return i >= 0 && j >= 0 && i < s.rect.w && j < s.rect.h && !!s.band[j * s.rect.w + i];
  }

  /** The fungi on the kept logs near the view. @param {number} hourNow */
  function scanFungi(hourNow) {
    const dayNow = Math.floor(hourNow / HOURS_PER_DAY);
    const t = camera.target, out = [], taps = [], mo = moodOf();
    for (const log of pieces?.keptLogs?.() ?? []) {
      if (!log.still) continue;
      const far = recipe.nearM + log.length;
      if ((log.x - t[0]) ** 2 + (log.z - t[2]) ** 2 > far * far || inTide(log.x, log.z)) continue;
      const key = `${log.id}:${log.placedHour}:${dayNow}:${moods.lean}`;
      let bloom = blooms.get(key);
      if (bloom === undefined) {
        bloom = fungiBloom({ dayNow, placedHour: log.placedHour, moodOf: mo, F });
        if (blooms.size > 256) blooms.clear();
        blooms.set(key, bloom);
      }
      if (!bloom) continue;
      let lay = layouts.get(log.seed);
      if (!lay) { lay = fungiLayout(log, F); layouts.set(log.seed, lay); }
      for (const c of lay.clusters) {
        const mid = log.surface(c.t, c.a);
        let most = 0;
        for (const m of c.members) {
          const grown = fungusSize(hourNow, bloom, m.grow, m.fade, F);
          if (grown < 0.02) continue;
          most = Math.max(most, grown);
          const s = log.surface(Math.max(0.02, Math.min(0.98, m.t)), m.a);
          const size = grown * m.size * F.scale;
          if (m.mesh.startsWith('bracket')) {
            // Out from the wood, level: square to the log, give or take, its root set into the wood.
            const l = Math.hypot(s.n[0], s.n[2]) || 1, nx = s.n[0] / l, nz = s.n[2] / l;
            const e = F.turkeytail.embedM;
            out.push({ x: s.p[0] - nx * e, y: s.p[1], z: s.p[2] - nz * e, yaw: Math.atan2(nx, nz) + m.yaw, size, mesh: m.mesh });
          } else {
            // Upright, leaning out from the tuft's middle, its foot set into the wood.
            const dx = s.p[0] - mid.p[0], dz = s.p[2] - mid.p[2];
            const yaw = (dx * dx + dz * dz > 1e-8 ? Math.atan2(dx, dz) : m.yaw * 10) + m.yaw;
            const k = F.sulphurtuft.sinkM;
            out.push({ x: s.p[0] - s.n[0] * k, y: s.p[1] - s.n[1] * k, z: s.p[2] - s.n[2] * k, yaw, size, mesh: m.mesh });
          }
        }
        if (most > 0.3) taps.push({ sp: 'fungi', x: mid.p[0], z: mid.p[2], item: lay.species, reach: 0.12 });
      }
    }
    out.sort((a, b) => ((a.x - t[0]) ** 2 + (a.z - t[2]) ** 2) - ((b.x - t[0]) ** 2 + (b.z - t[2]) ** 2));
    fungi = out.slice(0, F.max);
    return taps;
  }

  /** The dewy webs near the view now. @param {number} display game seconds */
  function scanWebs(display) {
    const hour = display / SECONDS_PER_HOUR, day = Math.floor(hour / HOURS_PER_DAY);
    const ws = world.state?.weather;
    const mood = ws?.today?.day === day ? ws.today.mood : moodOf()(day);
    const dew = webDew({ season: seasonOf(display).index, mood, mist: weatherAt(ws, display, opts.seasons).mist }, W);
    last.dew = dew;
    if (!(dew > 0)) { webs = []; return []; }
    const t = camera.target;
    const found = websNear({ seed: websSeed, day, x: t[0], z: t[2], nearM: recipe.nearM, grass: world.state?.growth?.grass ?? null,
      lush: growth?.lush?.() ?? null, cells: HABITAT_CELLS, origin: HABITAT_ORIGIN, W });
    webs = [];
    const taps = [];
    for (const w of found) {
      if ((water.sampleLive?.(w.x, w.z)?.depth ?? 0) > 0.005) continue;
      const y = terrain.sampleHeight(w.x, w.z) + w.hub;
      webs.push({ x: w.x, y, z: w.z, yaw: w.yaw, r: w.r, dew, seed: w.seed });
      taps.push({ sp: 'webs', x: w.x, z: w.z, item: null, reach: w.r * 1.3 });
    }
    return taps;
  }

  return {
    id: 'autumn',
    /** The fungi's creature pass and the webs pass, for the frame graph. */
    passes: [fungiPass, websPass],

    /** @param {import('../../sim/live-sim.js').FrameInfo} f */
    tick(f) {
      clock += f.realDt;
      if (clock >= 0.25) {
        clock = 0;
        shown = [...scanFungi(f.displayT / SECONDS_PER_HOUR), ...scanWebs(f.displayT)];
        last = { ...last, fungi: fungi.length, webs: webs.length };
        fungiPass.setBeings(fungi);
      }
      websPass.set(webs, f.animT);
    },

    /** What a tap may land on now (the finds module's findAt asks): each fungus tuft and each web. */
    shown: () => shown,
    /** How many fungi and webs are drawn, and the webs' dew (tools, tests, ?debug). */
    counts: () => ({ ...last }),
    /** What is drawn now: the fungi as the pass has them, and the webs (tools, tests, ?debug). */
    drawn: () => ({ fungi, webs }),
    dispose() {},
  };
}
