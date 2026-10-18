// @ts-check
// Live simulation registry (doc 03): world systems in a fixed order, with per-frame CPU work,
// GPU compute encoding and an after-submit hook, plus the shared hourly tick (sim/tick.js).

import { runHour } from './tick.js';

/**
 * @typedef {Object} FrameInfo
 * @property {number} dt        the clock's clamped real step in seconds (not scaled by the time flow;
 *                              for game time use the change in worldT, which follows 1x to 4x and pause)
 * @property {number} realDt    real seconds since the last frame
 * @property {number} worldT
 * @property {number} animT
 * @property {number} displayT
 * @property {string} tier
 */

/**
 * @typedef {Object} LiveSystem
 * @property {string} id
 * @property {(f: FrameInfo) => void} [tick]
 * @property {(encoder: GPUCommandEncoder, f: FrameInfo) => void} [encode]
 * @property {() => void} [afterSubmit]
 * @property {() => void} [dispose]
 */

/** @typedef {{state: any, env: import('./tick.js').Env}} LiveWorld */

/**
 * @param {{world?: LiveWorld|null}} [opts] world: coarse state and env for the hourly tick.
 *   The object is kept and its `state` is replaced after each tick, so holders of it see the new state.
 */
export function createLiveSim(opts = {}) {
  /** @type {LiveSystem[]} */
  const systems = [];
  const world = opts.world ?? null;
  return {
    /** @param {LiveSystem} s */
    addSystem(s) { systems.push(s); },
    /** @param {FrameInfo} f */
    update(f) { for (const s of systems) s.tick?.(f); },
    /** @param {GPUCommandEncoder} encoder @param {FrameInfo} f */
    encode(encoder, f) { for (const s of systems) s.encode?.(encoder, f); },
    afterSubmit() { for (const s of systems) s.afterSubmit?.(); },
    dispose() { for (const s of systems) s.dispose?.(); systems.length = 0; },
    /**
     * Run the shared hourly tick for one game hour and keep the new state. Returns the
     * events for the app to emit. A no-op returning [] when created without a world.
     * @param {number} hourIndex
     * @returns {import('./tick.js').CoarseEvent[]}
     */
    hourlyTick(hourIndex) {
      if (!world) return [];
      const r = runHour(world.state, hourIndex, world.env);
      world.state = r.state;
      return r.events;
    },
    /** Current coarse world state (null without a world). */
    worldState() { return world ? world.state : null; },
  };
}
