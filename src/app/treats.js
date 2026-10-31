// @ts-check
// Treats (P2h): setting a handful out for a creature that likes it.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import * as clock from '../core/clock.js';
import { emitDeferred, on } from '../core/events.js';
import { update as updateStore } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { keyOf, swarmSpecies } from '../world/species.js';
import { createTreats } from '../world/creatures/treats.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { creatures, frogRecipe, hen, pack, schools, speciesRecipes, walk, water } = ctx;
  // Treats (P2h; src/world/creatures/treats.js): Set out on a pouch's card puts a handful down in front
  // of you and the nearest creature that likes it comes and eats it at once; one nobody wants fades
  // back into the ground. `?treats` (a test link, unsaved): a pouch of wrack, a pouch of leaf packs and
  // a handful of fallen leaves (with `&camp=bench`, enough to make another leaf pack), and a pouch of
  // pondweed strands for the minnows (B1 P1).
  const treats = createTreats({ recipe: await loadRecipe('world/treats'), pack, walk, hour: () => clock.worldT() / 3600,
    depth: (x, z) => water.sampleLive(x, z)?.depth ?? 0,
    species: [{ key: 'frogs', rec: frogRecipe, live: creatures },
      ...swarmSpecies(speciesRecipes).filter((rec) => rec.treat).map((rec) => ({ key: keyOf(rec), rec, live: schools.find((s) => s.id === keyOf(rec)) ?? null })),
      // The hen (docs/future/15): worms and seedheads, on land; she pecks them up where they lie.
      { key: 'hens', rec: speciesRecipes.hen, live: { treat: (x, z, t) => hen.treat(x, z, t, (tid) => emitDeferred('treat:taken', { tid })) } }] });
  on('treat:taken', (/** @type {{ tid?: number }} */ p) => { if (p?.tid !== undefined) hen.treatGone(p.tid); });
  updateStore('treatKinds', () => pack.recipe.kinds.map((/** @type {any} */ k) => k.id).filter((/** @type {string} */ k) => treats.isTreat(k)));
  Object.assign(ctx, { treats });
}
