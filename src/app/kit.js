// @ts-check
// The walker's sketchbook and kit, and the tea's slow reveal.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import * as clock from '../core/clock.js';
import { get as getStore } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { weatherAt } from '../world/weather.js';
import { createTeaReveal } from '../world/creatures/tea-reveal.js';
import { setActRate } from '../world/figure/acts.js';
import { createSketchbook } from '../world/sketchbook/index.js';
import { createKit } from '../world/kit/index.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { pack, seasonsRecipe, sim, walk, world } = ctx;
  // The walker's sketchbook (P2i I5; src/world/sketchbook): Sketch on the here-bar with charcoal
  // sticks in the pack and a creature, plant or find near the middle of the view.
  const sketchRecipe = await loadRecipe('world/sketchbook');
  const sketchbook = createSketchbook({ recipe: sketchRecipe, walk, pack, worldT: () => clock.worldT(), season: () => world.state?.seasons?.index ?? 0,
    weather: () => { const w = weatherAt(world.state?.weather, clock.display(), seasonsRecipe); return { rain: w.rain ?? 0, mist: w.mist ?? 0 }; },
    subject: () => ctx.sketchSubject() });
  sim.addSystem(sketchbook);
  // The walker's kit (the Walker page, K1; src/world/kit): hat, lantern, in hand, coat and carrier.
  const kit = createKit({ recipe: await loadRecipe('world/kit'), pack, you: () => (walk.below ? walk.you() : null) });
  sim.addSystem(kit);
  Object.assign(ctx, { sketchRecipe, kit });
}

/** @param {import('./context.js').AppContext} ctx */
export function teaReveal(ctx) {
  const { camp, creatures, ripples, schools, sim, walk } = ctx;
  // A long, slow look (P2e, src/world/creatures/tea-reveal.js): an unfound creature gives itself away
  // once while that tea lasts. A strong back: the dig's swing keeps pace with its quicker beats.
  const teaReveal = createTeaReveal({ frogs: () => creatures.frogs(), schools, ripples, you: () => (walk.below ? walk.you() : null), spend: () => camp.boons.spendReveal() });
  sim.addSystem({ id: 'tea-reveal', tick: (/** @type {any} */ f) => teaReveal.update(f.realDt) });
  setActRate((name) => (name === 'dig' ? 1 / Math.max(0.25, getStore('boonLift')?.dig ?? 1) : 1));
}
