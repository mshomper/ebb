// @ts-check
// The island's live water world (docs/07, 08): the shallow-water simulation and what rides on it,
// registered with the live sim in tick order (water, foam, wet ground, ripples, moss), plus the
// spring bookkeeping the water tool and undo need. app.js owns drawing and input and calls in here
// with ground points and tool settings; this module never reads the camera or the pointer.

import { get as getStore, update as updateStore } from '../core/store.js';
import { on } from '../core/events.js';
import * as clock from '../core/clock.js';
import { subSeed } from '../core/rng.js';
import { createWater } from './water/index.js';
import { createFoam } from './water/foam.js';
import { createRipples } from './water/ripples.js';
import { createWetness } from './terrain/wetness.js';
import { createMossLive } from './growth/moss-live.js';
import { createShoreLive } from './water/shore-live.js';
import { loadRecipe } from '../core/recipes.js';

/**
 * @param {import('../core/gpu.js').Gpu} gpu
 * @param {{ terrain: import('./terrain/index.js').Terrain, sim: ReturnType<typeof import('../sim/live-sim.js').createLiveSim>,
 *   seed: number, tier: string, history: any,
 *   recipes: { water: any, terrain: any, land: any } }} opts
 *   history: input/actions.js `history` (spring edits are undoable); recipes: water.json, terrain.json
 *   and the land recipe
 */
export async function createWaterWorld(gpu, opts) {
  const { terrain, sim, tier, history } = opts;
  const { water: waterRecipe, terrain: terrainRecipe, land: landRecipe } = opts.recipes;

  // Live water (docs/07): the sea at the display tide, the springs, flowing over the terrain and
  // topped up toward the deterministic water summary.
  const water = await createWater(gpu, {
    terrain, recipe: waterRecipe, land: landRecipe, terrainSeed: subSeed(opts.seed, 'terrain'), tier,
    displayHours: clock.display() / clock.SECONDS_PER_HOUR,
    getHeightQ: () => getStore('terrainLive')?.mirror?.heightQ ?? null,
    springs: getStore('water')?.springs ?? [],
  });
  sim.addSystem(water);
  // Foam where the water churns, carried by the current (docs/07); right after the water steps.
  const foam = await createFoam(gpu.device, { water, terrain, recipe: waterRecipe.foam });
  sim.addSystem(foam);
  // Wet ground for the look (docs/08, 22): soaked by water, tide and rain, drying over game hours;
  // its puddle level rises with rain.
  const sky = { rain: 0, sunY: 0, wind: 0 };
  const wetness = await createWetness(gpu.device, {
    terrain, water, recipe: terrainRecipe.wetness, dampWet: waterRecipe.look.dampHollowWet,
    getRain: () => sky.rain, getSun: () => sky.sunY, getWind: () => sky.wind,
    puddles: terrainRecipe.wetGround.puddles,
  });
  sim.addSystem(wetness);
  // Ripples: a fine wave field around the view, rung by the pour brush and (later) creatures.
  const ripples = await createRipples(gpu.device, {
    water, recipe: waterRecipe.ripples, size: waterRecipe.ripples.size[tier] ?? waterRecipe.ripples.size.high,
  });
  sim.addSystem(ripples);
  // Moss creeps over ground that stays damp (interim live form; doc 10's growth takes over later).
  const moss = createMossLive(gpu.device, { water, recipe: terrainRecipe.moss });
  sim.addSystem(moss);
  // The shore zones itself by the tide (docs/future/10): wrack, ripples, lichen and mud.
  const shore = createShoreLive(gpu.device, { water, recipe: await loadRecipe('world/shore'), amplitudeM: waterRecipe.tide.amplitudeM });
  sim.addSystem(shore);

  const tools = waterRecipe.tools;
  /** Flow (L/s) for a spring rate step. @param {string | undefined} rate */
  const rateLps = (rate) => tools.springRates[rate ?? 'brook'] ?? tools.springRates.brook;

  /** Mirror the placed springs into the saved `water` slice and the tool bar's `waterUi` slice. */
  function syncSprings(selectedId = getStore('waterUi')?.selectedId ?? null) {
    const placed = water.placedSprings();
    updateStore('water', (w) => ({ ...(w ?? {}), springs: placed, version: 1 }));
    const sel = placed.some((s) => s.id === selectedId) ? selectedId : null;
    updateStore('waterUi', () => ({ springCount: placed.length, maxSprings: tools.maxSprings, selectedId: sel }));
  }
  syncSprings(null);
  // Spring edits are undoable commands (docs/07): add, remove, or a change of rate.
  history.setApplier('water-spring', (/** @type {any} */ cmd, /** @type {'undo'|'redo'} */ dir) => {
    const undo = dir === 'undo';
    if (cmd.op === 'add') { if (undo) water.removeSpring(cmd.spring.id); else water.addSpring(cmd.spring); }
    else if (cmd.op === 'remove') { if (undo) water.addSpring(cmd.spring); else water.removeSpring(cmd.spring.id); }
    else if (cmd.op === 'rate') water.setSpringRate(cmd.spring.id, undo ? cmd.before : cmd.after);
    syncSprings();
    return true;
  });
  // The summary follows the ground: rebuild after every settled stroke, undo and redo.
  const unStroke = on('terrain:stroke-ended', () => water.requestSummary());

  return {
    water, foam, ripples, wetness, moss, shore,
    syncSprings,

    /**
     * Each frame: the pour or drain brush held at a ground point (null when nothing is held).
     * Pouring also drops into the ripple field, so rings spread from it.
     * @param {ArrayLike<number> | null} p  ground point [x, y, z]
     * @param {{ waterMode: string, strength: number, size: number }} t  the tool bar's settings
     */
    holdBrush(p, t) {
      if (!p || (t.waterMode !== 'pour' && t.waterMode !== 'drain')) { water.setBrush(null); ripples.setPour(0, 0, 0); return; }
      const lps = (t.waterMode === 'pour' ? tools.pourLps : -tools.drainLps) * Math.max(0.05, t.strength);
      water.setBrush({ x: p[0], z: p[2], radiusM: t.size, rateLps: lps });
      if (t.waterMode === 'pour') ripples.setPour(p[0], p[2], t.strength, t.size); else ripples.setPour(0, 0, 0);
    },

    /**
     * A tap with the spring mode at a ground point: select the spring there, or place a new one
     * under the cap (undoable).
     * @param {ArrayLike<number>} p @param {string | undefined} rate
     */
    tapSpring(p, rate) {
      const hit = water.springAt(p[0], p[2], 1.0);
      if (hit) { syncSprings(hit); return; }
      if (water.placedSprings().length >= tools.maxSprings) { syncSprings(null); return; }
      const s = water.addSpring({ x: p[0], z: p[2], rateLps: rateLps(rate) });
      history.push({ kind: 'water-spring', bytes: 64, op: 'add', spring: s });
      syncSprings(s.id);
    },

    /** A new flow step on the tool bar applies to the selected spring too (undoable). @param {string} rate */
    rateSelected(rate) {
      const sel = getStore('waterUi')?.selectedId;
      if (!sel) return;
      const s = water.springs().find((x) => x.id === sel);
      const after = rateLps(rate);
      if (s && s.rateLps !== after && water.setSpringRate(sel, after)) {
        history.push({ kind: 'water-spring', bytes: 64, op: 'rate', spring: s, before: s.rateLps, after });
        syncSprings(sel);
      }
    },

    /** Remove a placed spring (undoable). @param {string} id */
    removeSpring(id) {
      const s = water.removeSpring(id);
      if (s) history.push({ kind: 'water-spring', bytes: 64, op: 'remove', spring: s });
      syncSprings(null);
    },

    /**
     * Each frame: the weather the wet ground follows, and where the view is (the ripple window).
     * @param {{ rain: number, sunY: number, wind: number }} w @param {ArrayLike<number>} target
     */
    update(w, target) {
      sky.rain = w.rain; sky.sunY = w.sunY; sky.wind = w.wind;
      ripples.setCenter(target[0], target[2]);
    },

    dispose() { unStroke(); shore.dispose(); },
  };
}

/** @typedef {Awaited<ReturnType<typeof createWaterWorld>>} WaterWorld */
