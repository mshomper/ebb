// @ts-check
// The island's ground and water passes: terrain, grass, rushes and plants; then the water and waterfalls.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import * as clock from '../core/clock.js';
import { get as getStore, subscribe as subscribeStore } from '../core/store.js';
import { subSeed } from '../core/rng.js';
import { createTerrainPass } from '../render/passes/terrain.js';
import { createWaterPass } from '../render/passes/water.js';
import { createFallsPass } from '../render/passes/falls.js';
import { createGrassPass } from '../render/passes/grass.js';
import { createFloraPass } from '../render/passes/flora.js';

/** @param {import('./context.js').AppContext} ctx */
export function start(ctx) {
  const { atmosphere, camera, covers, flora, grassRecipe, groundDetail, growth, growthRecipe, moss, seed, terrain, terrainRecipe, tier, tierSettings, water, waterRecipe, wetness, ww } = ctx;
  const terrainPass = createTerrainPass({
    terrain, recipe: terrainRecipe, seed: subSeed(seed, 'terrain-look'), getEye: () => camera.eye, tier,
    ground: groundDetail, groundTier: tierSettings.ground, getTide: () => water.tide, lodDistances: tierSettings.lodDistances, cliffDetailM: tierSettings.cliffDetailM,
    getHours: () => clock.display() / clock.SECONDS_PER_HOUR,
    water: { depthTextures: water.sim.depthTextures, current: () => water.sim.current, damp: water.sim.damp, dampWet: waterRecipe.look.dampHollowWet,
      vel: water.sim.vel, caustics: waterRecipe.caustics, tide: waterRecipe.tide },
    moss: moss.texture, causticLayers: tierSettings.causticLayers, wetness, cover: growth.coverTex,
    probe: { view: atmosphere.probeView, sampler: atmosphere.probeSampler }, rings: waterRecipe.ripples.rings,
    shore: { texture: ww.shore.texture, look: ww.shore.recipe.look },
  });
  // The camp pad's trodden look and dashed edge pattern follow the live pad (CP-01, CP-02).
  terrainPass.setCampPad(getStore('campPad') ?? null);
  subscribeStore('campPad', (/** @type {any} */ p) => terrainPass.setCampPad(p ?? null));
  // The meadow (docs 10): GPU grass blades where grass is painted, after the terrain.
  const grassPass = createGrassPass({
    terrain, recipe: grassRecipe, terrainRecipe, seed: subSeed(seed, 'grass'), tier: tierSettings,
    water: { depthTextures: water.sim.depthTextures, current: () => water.sim.current }, cover: growth.coverTex,
  });
  // The marsh's rushes (docs 10): the same blades in tussocks, where the rush cover is, standing in
  // shallow still water.
  const rushPass = createGrassPass({
    terrain, recipe: covers.rushes, terrainRecipe, seed: subSeed(seed, 'rushes'), tier: tierSettings, kind: 'rushes',
    water: { depthTextures: water.sim.depthTextures, current: () => water.sim.current }, cover: growth.coverTex,
  });
  // Plants (docs 10): every species from the growth step's instances, after the grass.
  const floraPass = createFloraPass({ growth, terrain, water: { depthTextures: water.sim.depthTextures, current: () => water.sim.current }, recipes: flora, looks: growthRecipe.looks });
  Object.assign(ctx, { terrainPass, grassPass, rushPass, floraPass });
}

/** @param {import('./context.js').AppContext} ctx */
export function waterPasses(ctx) {
  const { atmosphere, camera, foam, landRecipe, ripples, terrain, terrainRecipe, tierSettings, water, waterRecipe } = ctx;
  const waterPass = createWaterPass({
    water, terrain, atmosphere, recipe: waterRecipe, seaExtent: terrainRecipe.sea.extent, getTime: () => clock.animT(),
    seabed: { y: landRecipe.seabedDepth, albedo: terrainRecipe.materials.albedoSand.map((/** @type {number} */ a) => a * terrainRecipe.materials.wetDarkening),
      wetDarkening: terrainRecipe.materials.wetDarkening },
    detailFadeM: tierSettings.waterDetailFadeM, ssr: tierSettings.waterSSR ?? null, foam, ripples,
  });
  // Waterfalls (M2 Cliff tool): curtains where live water runs over a drop, visual only.
  // Near the eye they are droplet water with real volume (screen-space fluid, falls-fluid.js).
  const fallsPass = createFallsPass({ water, terrain, recipe: waterRecipe.falls, getTime: () => clock.animT(), tier: tierSettings,
    absorption: waterRecipe.look.absorptionPond, atmosphere, getEye: () => camera.eye, getProjY: () => camera.proj[5],
    getOpaqueDepth: () => waterPass.opaqueDepth });
  Object.assign(ctx, { waterPass, fallsPass });
}
