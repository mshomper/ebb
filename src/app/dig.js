// @ts-check
// Digging (docs/future/13 section 10): made before the zones, added to the live sim after them.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import * as clock from '../core/clock.js';
import { loadRecipe } from '../core/recipes.js';
import { subSeed } from '../core/rng.js';
import { keepsakeWords } from '../world/keepsakes/families/index.js';
import { createDig } from '../world/dig/index.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { back, campRecipe, gather, keepsakesRecipe, landRecipe, pack, params, pieces, presence, seed, shadowPass, terrain, walk, water, world } = ctx;
  // Digging (docs/future/13 section 10, P2c; src/world/dig): Dig and Scoop sand on the here-bar once
  // the shovel is made at the workbench; `?shovel` (testing, unsaved) puts it in the walker's kit.
  const digRecipe = await loadRecipe('world/dig');
  const dig = createDig({ recipe: digRecipe, keepsakes: keepsakesRecipe, seed, world, walk, terrain, water, pieces, pack, gather, presence,
    worldT: () => clock.worldT(), test: params.has('shovel'), propsRecipe: campRecipe.props, shadowBias: shadowPass.bias, noteKept: (n) => ctx.noteKept(n),
    // Digging deeper (B1 D1): the land's story block (the old hearths, the marked stone) and `?dig=cache|hearth|sherd|sleeper|blade`.
    land: landRecipe, terrainSeed: subSeed(seed, 'terrain'), piecesRecipe: await loadRecipe('world/pieces'), testDig: back ? null : params.get('dig') });
  dig.setKeepsakeWords((n) => keepsakeWords(n, keepsakesRecipe));
  Object.assign(ctx, { digRecipe, dig });
}

/** @param {import('./context.js').AppContext} ctx */
export function run(ctx) {
  const { dig, sim } = ctx;
  sim.addSystem(dig);
}
