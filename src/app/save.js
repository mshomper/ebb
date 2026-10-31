// @ts-check
// Autosave from here on (src/save/autosave.js).
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import * as clock from '../core/clock.js';
import { get as getStore } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { SECTIONS9 } from '../save/migrate-format9.js';
import { packForSave } from '../world/kit/model.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { camera, hooks, island, save, seed, walk, world } = ctx;
  // Autosave from here on (src/save/autosave.js): what the island is now, whenever it asks.
  save.start({
    recipe: await loadRecipe('world/save'),
    parts: () => ({
      build: hooks.build ?? 'dev', seed, island: island.id, worldT: clock.worldT(), flow: clock.flow(),
      carryMinutes: getStore('meta')?.carryMinutes ?? 0, keepGrowing: getStore('meta')?.keepGrowing ?? true,
      world: world.state, journal: getStore('journal'), water: getStore('water'), unlocks: getStore('unlocks')?.earned ?? {},
      view: { ...camera.pose(), walker: walk.spot() }, looks: getStore('looks') ?? {}, music: getStore('music') ?? { hearted: [] }, pieces: getStore('pieces'), keepsakes: getStore('keepsakes'), nets: getStore('nets'), ...Object.fromEntries(SECTIONS9.map((id) => [id, getStore(id)])), pack: packForSave(getStore('pack')), chunks: getStore('chunks'), mirror: getStore('terrainLive')?.mirror ?? null,
    }),
  });
}
