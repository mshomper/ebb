// @ts-check
// Light and look: the sky, shadows, the shared lighting group and its small lights, exposure, daylight,
// the palette, ground detail, bloom, the tonemap and photo mode's depth of field.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import { get as getStore, update as updateStore, subscribe as subscribeStore } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { createShadowPass } from '../render/passes/shadow.js';
import { createExposurePass } from '../render/passes/post/exposure.js';
import { createTonemapPass } from '../render/passes/post/tonemap.js';
import { createBloomPass } from '../render/passes/post/bloom.js';
import { createPaletteBaker } from '../render/passes/post/lut-bake.js';
import { createDofPass } from '../render/passes/post/dof.js';
import { createGroundDetail } from '../render/ground-detail.js';
import { createAtmosphere } from '../render/sky/atmosphere.js';
import { createLighting } from '../render/lighting.js';
import { createDaylight } from '../render/daylight.js';
import { PALETTES } from './recipes.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { camRecipe, camera, exposureRecipe, gpu, palettes, postRecipe, prefs, seasonsRecipe, shadowRecipe, skyRecipe, terrain, terrainRecipe, tierSettings } = ctx;
  // Light: the physical sky, sun or moon shadows, the shared lighting group, slow eye adaptation.
  const atmosphere = await createAtmosphere(gpu.device, skyRecipe, tierSettings);
  const shadowPass = createShadowPass({ terrain, recipe: shadowRecipe, terrainRecipe, tierShadows: tierSettings.shadows, worldRadius: camRecipe.worldRadius,
    getEye: () => camera.eye, cliffDetailM: tierSettings.cliffDetailM });
  // The small lights (doc 06): up to eight, the most important to the view, fading in and out (recipes/world/small-lights.json).
  const smallLights = await loadRecipe('world/small-lights');
  const lighting = createLighting(gpu.device, atmosphere, shadowPass.resources(gpu.device), undefined, smallLights);
  const exposure = createExposurePass(exposureRecipe);
  const daylight = createDaylight({ sky: skyRecipe, seasons: seasonsRecipe, shadows: shadowRecipe });

  // Look: bloom, then the palette LUT in the tonemap (physical light, painted last; docs/05).
  const baker = await createPaletteBaker(gpu.device);
  // The palette is a device setting (doc 18, src/save/prefs.js).
  const wanted = prefs.palette ?? getStore('settings')?.palette;
  const startPalette = palettes[wanted] ? wanted : PALETTES[0].id;
  updateStore('settings', (s) => { s.palette = startPalette; });
  baker.setPalette(palettes[startPalette], { fadeS: 0 });
  // Scanned ground detail (docs/22): placeholders now, the real maps load after the first calm frames.
  const groundDetail = createGroundDetail(gpu.device, { tier: tierSettings.ground, recipe: terrainRecipe.detail });
  const bloom = createBloomPass({ levels: tierSettings.bloomLevels, mix: postRecipe.bloom.mix, radius: postRecipe.bloom.radius, karis: postRecipe.bloom.karis });
  const tonemap = createTonemapPass({ bloom, luts: baker.views, recipe: postRecipe });
  // Photo mode's depth of field (B2 P1): on the HDR image before exposure and bloom, only while it is open.
  const photoRecipe = await loadRecipe('world/photo');
  const dof = createDofPass({ recipe: photoRecipe, fovYDeg: camRecipe.fovYDeg });
  // The journal's show-where wash (store slice `wash`, src/world/journal/wash.js), painted last.
  tonemap.setWash(getStore('wash') ?? null);
  const unWash = subscribeStore('wash', (/** @type {any} */ w) => tonemap.setWash(w));
  Object.assign(ctx, { atmosphere, shadowPass, smallLights, lighting, exposure, daylight, baker, groundDetail, bloom, tonemap, photoRecipe, dof, unWash });
}
