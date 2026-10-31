// @ts-check
// Lift on foot (L3a) and what lives under a lifted log.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import { loadRecipe } from '../core/recipes.js';
import { createLift } from '../world/pieces/lift.js';
import { createUnderLogLive } from '../world/finds/under-log-live.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { finds, pieces, seed, sim, terrain, walk, world } = ctx;
  // Lift, on foot (docs/future/11 L3a; src/world/pieces/lift.js): a kept log's or a loose stone's card
  // offers Lift within reach, and what lives underneath is rolled for the day.
  const underLogRecipe = await loadRecipe('species/under-log');
  const lift = createLift({ pieces, walk, world, recipe: underLogRecipe, seed, ageRecipe: (await loadRecipe('world/pieces')).driftwood?.age ?? null });
  // While it is up, woodlice and the violet ground beetle scuttle for the dark (under-log-live.js).
  const underLog = createUnderLogLive({ lift, terrain, recipe: underLogRecipe });
  sim.addSystem(underLog);
  finds.addSource(underLog.shown);
  Object.assign(ctx, { lift, underLog });
}
