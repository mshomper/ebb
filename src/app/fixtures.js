// @ts-check
// Pieces that stand on their own: perch sticks (B1 P1) and lanterns (B2 L1), and the furnace's glow.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import * as clock from '../core/clock.js';
import { loadRecipe } from '../core/recipes.js';
import { createPerchSticks } from '../world/creatures/perch-sticks.js';
import { createLanterns } from '../world/pieces/lantern-live.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { camera, camp, pack, pieces, seed, sim, terrain, walk, water } = ctx;
  // The perch stick (B1 P1; src/world/creatures/perch-sticks.js): once the dragonflies are found, the
  // sticks pouch's card stands a handful upright in a pond's shallows, a piece they rest on. `?perch`
  // with `&dragonflies=N` (a test link, unsaved): two handfuls of sticks, and you kneel at the edge
  // of their pond, facing the shallows.
  const perchSticks = createPerchSticks({ recipe: await loadRecipe('world/treats'), seed, pieces, pack, walk, terrain, water });
  sim.addSystem(perchSticks);
  // The lantern (B2 L1; src/world/pieces/lantern-live.js): the shaper's trail's gift, made at the
  // workbench and set down from its pouch; it lights itself every dusk. `?lantern` (a test link,
  // unsaved): the gift given, the parts for a second make's steps in the pack, and one lantern
  // already standing a few metres off the camp with you beside it (add `&hour=20` for dusk).
  const piecesRecipe = await loadRecipe('world/pieces');
  const lanterns = createLanterns({ recipe: piecesRecipe.lantern, seed, pieces, pack, walk, terrain, water, camp, camera, liftM: piecesRecipe.driftwood.carry.liftM });
  sim.addSystem(lanterns);
  // The lanterns' lights and the furnace's glow join the camp's (src/app/lights.js).
  ctx.lanterns = lanterns;
  ctx.furnaceLights = () => camp.stations.lights(clock.animT());
  Object.assign(ctx, { perchSticks, piecesRecipe });
}
