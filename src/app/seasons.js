// @ts-check
// The season markers: autumn's fungi and webs, and spring at the pond.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import { createAutumn } from '../world/finds/autumn-live.js';
import { createSpring } from '../world/creatures/spring-live.js';

/** @param {import('./context.js').AppContext} ctx */
export function start(ctx) {
  const { autumnRecipe, camera, finds, frogRecipe, growth, params, pieces, presence, seasonsRecipe, seed, sim, speciesRecipes, terrain, water, world } = ctx;
  // Autumn's season markers (doc 13; src/world/finds/autumn-live.js): fungi on the kept logs, and
  // dewy webs in the tall grass on misty mornings. Tapping either is a find.
  const autumn = createAutumn({ world, terrain, water, camera, pieces, growth, recipe: autumnRecipe, seasons: seasonsRecipe, seed });
  sim.addSystem(autumn);
  finds.addSource(autumn.shown);
  // Spring at the pond (doc 13; src/world/creatures/spring-live.js): frogspawn, tadpoles and
  // froglets, the toad's night walk, and the basking spots (stones, logs, the raft) turtles and the
  // toad read. `?spring=spawn|tadpoles|froglets|toad` (testing, unsaved) sets one near the view.
  const spring = createSpring({ world, terrain, water, camera, pieces, presence, test: ['spawn', 'tadpoles', 'froglets', 'toad'].includes(params.get('spring') ?? '') ? params.get('spring') : null,
    recipes: { frogspawn: speciesRecipes.frogspawn, toad: speciesRecipes.toad, frog: frogRecipe, slowworm: speciesRecipes.slowworm, lizard: speciesRecipes.lizard } });
  sim.addSystem(spring);
  finds.addSource(spring.shown);
  Object.assign(ctx, { autumn, spring });
}
