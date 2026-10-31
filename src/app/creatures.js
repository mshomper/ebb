// @ts-check
// Presence and the creatures: frogs, the schools, then the midges, and the store slice `creatureSound`.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import * as clock from '../core/clock.js';
import { get as getStore, update as updateStore } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { weatherAt } from '../world/weather.js';
import { setLiftLook } from '../render/lift.js';
import { createCreatures } from '../world/creatures/index.js';
import { createPresence } from '../world/creatures/presence.js';
import { createMidges } from '../world/ecology/midges-live.js';
import { swarmSpecies } from '../world/species.js';
import { createSchools } from '../world/creatures/schools.js';
import { wearsBand } from '../world/kit/model.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { camRecipe, camera, flora, frogRecipe, hooks, params, ripples, sim, speciesRecipes, terrain, tierSettings, water, world } = ctx;
  // The frogs (src/world/creatures): posed bodies at their homes until S6b, the plop, finding one.
  // `?frogs=N` (testing): N frogs come at once instead of over days (1: a scout, the sign).
  const testFrogs = params.has('frogs') ? Math.max(1, Math.min(12, Number.parseInt(params.get('frogs') ?? '1', 10) || 1)) : 0;
  // floraFrame: the time and wind the plants were drawn with this frame (frogs on lily pads ride them; the frame sets it).
  /** @type {{ time: number, wind: number, windDir: number } | null} */ ctx.floraFrame = null;
  // Presence (doc 23): what creatures react to. Two views (W3): the camera above counts only for
  // its edits (reported below); you on foot are felt with your pace, posture and gaze.
  const walkerRecipe = await loadRecipe('world/walker');
  // Planting on foot (D1a): the seed tin, the gift spot and the net in hand (src/world/sowing).
  const sowingRecipe = await loadRecipe('world/sowing');
  // The lift (F5): a hovered or chosen thing is tinted warm with a thin rim in its own shader, never ringed.
  setLiftLook(await loadRecipe('world/highlight'));
  // The keeper's camp's words (recipes/world/camp.json): `clear`, the line when a tap lands on the pad.
  const campRecipe = await loadRecipe('world/camp');
  // The walker (ctx.walk) is made below (src/app/walker.js); these read it when they are called.
  // `hooks.labCamera` (tools/frog-lab.html): the old close camera, whose own eye startles frogs.
  if (hooks.labCamera) camera.setClose(camRecipe.labClose);
  const presence = createPresence({ camera, cameraBody: !!hooks.labCamera, walker: () => ctx.walk?.presenceNow() ?? null, heightM: walkerRecipe.presence.heightM,
    ringK: () => (getStore('boonLift')?.comfort ?? 1) * (wearsBand(getStore('kit'), 'hen-feather') ? speciesRecipes.hen.fond?.calmK ?? 1 : 1),
    known: () => getStore('campKnown') ?? null });
  /** Where you are felt on foot (finds, food, finding by watching); null while you are above. */
  const you = () => ctx.walk?.you() ?? null;
  const creatures = createCreatures({ world, recipe: frogRecipe, terrain, water, ripples, camera, testFrogs, flora, floraFrame: () => ctx.floraFrame, presence, you });
  sim.addSystem(creatures);
  // Schools you can see (src/world/creatures/schools.js): minnows under the live water surface, one
  // system and one pass per species that has a body and a school's motion.
  const schools = swarmSpecies(speciesRecipes).filter((rec) => rec.body && rec.motion)
    .map((rec) => createSchools({ world, recipe: rec, water, ripples, camera, presence, budget: tierSettings.liveCreatures ?? 120,
      ground: (x, z) => terrain.sampleHeight(x, z), you }));
  for (const s of schools) sim.addSystem(s);
  Object.assign(ctx, { walkerRecipe, sowingRecipe, campRecipe, presence, you, creatures, schools });
}

/** @param {import('./context.js').AppContext} ctx */
export function midges(ctx) {
  const { creatures, midgeRecipe, ripples, schools, seasonsRecipe, sim, terrain, tierSettings, water, world } = ctx;
  // Midges you can see (src/world/ecology/midges-live.js): swarms from the midge field, after the water.
  const midges = createMidges({ world, recipe: midgeRecipe, budget: tierSettings.boids ?? 4096, ripples,
    ground: (x, z) => terrain.sampleHeight(x, z), water: (x, z) => water.sampleLive(x, z),
    wind: () => ({ strength: weatherAt(world.state?.weather, clock.display(), seasonsRecipe).wind, dir: world.state?.weather?.today?.windDir ?? 0 }),
    rain: (hoursAgo) => weatherAt(world.state?.weather, clock.display() - hoursAgo * clock.SECONDS_PER_HOUR, seasonsRecipe).rain });
  sim.addSystem(midges);
  // What the animals do that can be heard (src/audio reads it): frog calls and plops, midge swarms,
  // and the schools: each minnow and dragonfly with its speed, and the minnows' rises to the surface.
  updateStore('creatureSound', () => ({ frogs: (/** @type {number} */ since) => creatures.sounds(since), swarms: () => midges.heard(),
    schools: () => schools.flatMap((s) => s.heard()) }));
  Object.assign(ctx, { midges });
}
