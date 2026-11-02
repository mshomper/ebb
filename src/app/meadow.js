// @ts-check
// The meadow islet's stories without creatures (F20, src/world/meadow): the marker stone and its
// midsummer pot, the wild rye and the rye's year. Made once the islet, the plants, the pieces and the
// dig exist; added to the live sim. Run in order from src/app/systems.js; reads and adds to the
// start-up context (src/app/context.js). Its test links are in test-links-meadow.js.

import * as clock from '../core/clock.js';
import { subSeed } from '../core/rng.js';
import { update as updateStore } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { sunOptsOf } from '../world/seasons.js';
import { createMeadow } from '../world/meadow/index.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { dig, growth, islet, pack, pieces, seed, sim, terrain, walk, world } = ctx;
  if (!islet) return;
  const meadow = createMeadow({ R: await loadRecipe('land/meadow-islet'), islet, seed: subSeed(seed, 'islet'), terrain, pieces, growth, world, walk, pack, dig,
    sunOpts: sunOptsOf(world.env), hours: () => clock.worldT() / clock.SECONDS_PER_HOUR, record: () => updateStore('world', () => world.state) });
  sim.addSystem(meadow);
  Object.assign(ctx, { meadow });
}
