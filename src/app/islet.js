// @ts-check
// The meadow islet (B3a, src/world/islet): made with the land, so a risen islet is in the ground
// before the water and the walk grid are laid over it; given the view, the plants and the walker
// once they exist. `?islet` (testing, unsaved) raises it at once; `?islet=rising` starts its shoal
// now, to watch the whole rise (12 game hours: 12 minutes at 1x, 3 at 4x); `?islet=0.5` starts it
// that far through; `?islet=earned` earns the milestone now, so it rises at the next big low tide
// (`?day=27&hour=16&islet=earned` watches it come at 18:00 on day 27).
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import * as clock from '../core/clock.js';
import { update as updateStore } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { subSeed } from '../core/rng.js';
import { baseSampler } from '../world/terrain/landform.js';
import { tideParams } from '../world/tide.js';
import { createIslet } from '../world/islet/index.js';

/** @param {import('./context.js').AppContext} ctx */
export async function land(ctx) {
  const { landRecipe, params, seed, terrain, waterRecipe } = ctx;
  const R = await loadRecipe('land/meadow-islet');
  const terrainSeed = subSeed(seed, 'terrain');
  const base = baseSampler(landRecipe, terrainSeed);
  const islet = createIslet({ R, land: landRecipe, terrain, seed: subSeed(seed, 'islet'), terrainSeed, tide: tideParams(waterRecipe.tide),
    hours: () => clock.worldT() / clock.SECONDS_PER_HOUR, base: (x, z) => base(x, z)[0], test: params.has('islet') ? params.get('islet') ?? '' : null });
  Object.assign(ctx, { islet });
}

/** @param {import('./context.js').AppContext} ctx */
export function start(ctx) {
  const { back, camera, covers, flora, growth, islet, params, sim, world } = ctx;
  if (!islet) return;
  islet.attach({ camera, growth, hasPlant: (sp) => !!flora[sp] || !!covers[sp], record: () => updateStore('world', () => world.state),
    walkerAt: () => { const w = ctx.walk?.walker; return w?.placed ? [w.x, w.z] : null; } });
  // A view left over the islet: put back now that the view may roam there.
  if (back?.view) camera.setPose(back.view);
  sim.addSystem(islet);
  // `?islet` and `?islet=rising`: the view glides out to look at it.
  if (params.has('islet') && params.get('islet') !== 'earned') {
    const L = islet.layout, c = ctx.landRecipe.center ?? { x: 0, z: 0 };
    camera.focus(c.x + (L.x - c.x) * 0.8, c.z + (L.z - c.z) * 0.8, 70, 42);
  }
}
