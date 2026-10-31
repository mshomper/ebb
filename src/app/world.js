// @ts-check
// The terrain, the world state and env, the live sim and its hourly tick, the water world, growth and
// the species recipes.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import * as clock from '../core/clock.js';
import { emitDeferred, on } from '../core/events.js';
import { get as getStore, update as updateStore } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { subSeed } from '../core/rng.js';
import { createLiveSim } from '../sim/live-sim.js';
import { initialWorldState, makeEnv, runHour } from '../sim/tick.js';
import { createTerrain } from '../world/terrain/index.js';
import { stampOlderPad } from '../world/camp/stamp.js';
import { createWaterWorld } from '../world/water-world.js';
import { createGrowth } from '../world/growth/index.js';
import { SPECIES } from '../world/species.js';
import { testRecipe } from '../world/creatures/swarms.js';
import { history } from '../input/actions.js';
import { testTrust } from './test-links.js';

/** @param {import('./context.js').AppContext} ctx */
export async function land(ctx) {
  const { back, gpu, landName, landRecipe, seed, terrainRecipe } = ctx;
  const terrain = await createTerrain(gpu, { seed: subSeed(seed, 'terrain'), recipe: terrainRecipe, land: landRecipe, landId: `land/${landName}` });
  history.setApplier('terrain', (cmd, dir) => terrain.applyTiles(dir === 'undo' ? cmd.before : cmd.after));
  if (back) terrain.restoreChunks(back.chunks);   // before the water reads the ground
  Object.assign(ctx, { terrain });
}

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { gpu, landRecipe, params, seasonsRecipe, seed, skyRecipe, terrain, terrainRecipe, tier, waterRecipe } = ctx;
  const env = makeEnv(seed, { seasons: seasonsRecipe, sky: skyRecipe.orbit, water: waterRecipe });
  // `?trust=0.5` (src/app/test-links.js).
  /** @type {any} */ (env).testTrust = testTrust(params);
  // A tea's boon on trust (P2e): read as the hour's trust is applied, so it lifts only what live play
  // earned while the tea worked (away time earns no trust to lift). 1 without a tea.
  Object.defineProperty(env, 'trustBoost', { get: () => getStore('boonLift')?.trust ?? 1, enumerable: false });
  /** @type {import('../sim/live-sim.js').LiveWorld} */
  const world = { state: getStore('world') ?? runHour(initialWorldState(seed), clock.hourIndex(), env).state, env };
  updateStore('world', () => world.state);
  const sim = createLiveSim({ world });
  sim.addSystem(terrain);
  // The live water world (docs/07, 08): water, foam, wet ground, ripples and moss, in tick order.
  const ww = await createWaterWorld(gpu, {
    terrain, sim, seed, tier, history, recipes: { water: waterRecipe, terrain: terrainRecipe, land: landRecipe },
  });
  const { water, foam, ripples, wetness, moss } = ww;
  // An older island's camp pad, laid once on its first load after the keeper's camp update (CP-07, CP-08).
  stampOlderPad({ land: landRecipe, terrain, water, terrainRecipe, waterRecipe });
  // Growth (docs 10, 11): the habitat grid from the water summary, plants and grass cover grown in
  // the hourly tick; this keeps the habitat current and uploads what the drawing needs.
  // `?plants=all` (testing, unsaved): a new island starts with every plant, not only the starters
  // (growth.json starters; the rest otherwise come by themselves, volunteers.js).
  const growthRecipe = { ...(await loadRecipe('world/growth')) };
  if (params.get('plants') === 'all') growthRecipe.starters = [...growthRecipe.species, ...(growthRecipe.cover ?? [])];
  // `?plants=herbs` (testing, unsaved): the starters plus a set from growth.json testSets (the four tea herbs).
  const testSet = growthRecipe.testSets?.[params.get('plants') ?? ''];
  if (testSet) growthRecipe.starters = [...growthRecipe.starters, ...testSet];
  /** @type {Record<string, any>} */
  const flora = Object.fromEntries(await Promise.all(growthRecipe.species.map(async (/** @type {string} */ sp) => [sp, await loadRecipe(`flora/${sp}`)])));
  /** @type {Record<string, any>} the cover plants other than grass (rushes) */
  const covers = Object.fromEntries(await Promise.all((growthRecipe.cover ?? []).map(async (/** @type {string} */ sp) => [sp, await loadRecipe(`flora/${sp}`)])));
  const grassRecipe = await loadRecipe('flora/grass');
  const growth = createGrowth(gpu.device, { terrain, water, world, recipes: { growth: growthRecipe, flora, covers, land: landRecipe, grass: grassRecipe } });
  sim.addSystem(growth);
  // A burying stroke's plants come back with its undo and go under again with its redo (bury.js).
  history.setApplier('terrain', (cmd, dir) => {
    const r = terrain.applyTiles(dir === 'undo' ? cmd.before : cmd.after);
    // applyTiles is false while a stroke settles (undo tries again shortly): the plants wait with it.
    if (r && cmd.buried) { if (dir === 'undo') growth.unbury(cmd.buried); else growth.rebury(cmd.buried); }
    return r;
  });
  // Ecology and creatures (S6a, docs 11, 12): the midge field, frog habitat and the frogs' arrival
  // run in the hourly tick from these recipes.
  // Every species in the list (src/world/species.js): frogs and midges, then minnows and dragonflies.
  /** @type {Record<string, any>} */
  const speciesRecipes = Object.fromEntries(await Promise.all(SPECIES.map(async (id) => [id, await loadRecipe(`species/${id}`)])));
  const frogRecipe = speciesRecipes.frog, midgeRecipe = speciesRecipes.midge;
  // `?minnows=N` (testing, unsaved): a school comes at once, and the biggest still water will do
  // without its deep spot (src/world/creatures/swarms.js testRecipe), so a new island can be tested.
  if (params.has('minnows')) speciesRecipes.minnow = testRecipe(speciesRecipes.minnow);
  // `?dragonflies=N` likewise: any pond will do, not only a fish-free one you shaped.
  if (params.has('dragonflies')) speciesRecipes.dragonfly = testRecipe(speciesRecipes.dragonfly);
  // `?damselflies=N` likewise (any still pond suits them anyway).
  if (params.has('damselflies')) speciesRecipes.damselfly = testRecipe(speciesRecipes.damselfly);
  if (params.has('turtles')) speciesRecipes.turtle = testRecipe(speciesRecipes.turtle);
  // The hen (docs/future/15): not in the species list (she has no needs grid); her trust and Fond
  // run in the hourly tick from her recipe (src/world/hen/trust.js).
  speciesRecipes.hen = await loadRecipe('species/hen');
  world.env.recipes.species = speciesRecipes;
  updateStore('world', () => world.state);
  /** One game hour of the shared tick, live. @param {number} hour */
  function tickHour(hour) {
    const events = sim.hourlyTick(hour);
    for (const e of events) emitDeferred(e.name, e.payload);
    updateStore('world', () => world.state);
    // The hour as a whole, for watchers of the world such as the journal (src/world/journal).
    emitDeferred('world:ticked', { hour, events, state: world.state });
  }
  const unHour = on('clock:hour', (/** @type {{ hour: number }} */ p) => tickHour(p.hour));
  Object.assign(ctx, { world, sim, ww, water, foam, ripples, wetness, moss, growthRecipe, flora, covers, grassRecipe, growth, speciesRecipes, frogRecipe, midgeRecipe, tickHour, unHour });
}
