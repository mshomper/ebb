// @ts-check
// Homes for gated arrivals (B3 wave 2, the eels; recipes/species/eel.json ecology.arrival.gate):
// at each look of the shaped-ground watch (src/app/shaped.js), whether the home a species' visit
// block asks for is made, and where, is written into the world state (`homes.<key>`: { met, x, z }),
// so the hourly tick (src/world/creatures/swarms.js gateOpen, atHome) can let them come on the next
// rainy autumn night, watched or away. The tick never measures the ground itself, so time away
// uses the home as it was when you left. Run after shaped.start in src/app/systems.js.

import { update as updateStore } from '../core/store.js';
import { homeOf } from '../world/ecology/shaped.js';
import { keyOf } from '../world/species.js';

/** @param {import('./context.js').AppContext} ctx */
export function start(ctx) {
  const { shapedAfterLook, speciesRecipes, world } = ctx;
  const gated = Object.values(speciesRecipes).filter((r) => r?.ecology?.arrival?.gate?.home && r.ecology.visit?.home);
  if (!gated.length) return;
  shapedAfterLook.push((/** @type {any} */ report) => {
    for (const rec of gated) {
      const key = keyOf(rec), h = homeOf(report, rec.ecology.visit.home);
      const now = h.met ? { met: true, x: h.best.x, z: h.best.z } : { met: false };
      const was = world.state?.homes?.[key];
      if (was && was.met === now.met && was.x === now.x && was.z === now.z) continue;
      if (!was && !now.met) continue;
      world.state = { ...world.state, homes: { ...(world.state.homes ?? {}), [key]: now } };
      updateStore('world', () => world.state);
    }
  });
}
