// @ts-check
// The recipes many systems read, loaded together at start-up (src/app/boot.js), each under the name
// it takes in the start-up context (src/app/context.js). A recipe only one system reads loads in that
// system's own file; add one here only when several systems need it from the start.

/** Base recipes, context name -> recipe path, loaded at once in this order. @type {Record<string, string>} */
export const BASE_RECIPES = {
  camRecipe: 'world/camera',
  skyRecipe: 'world/sky',
  terrainRecipe: 'world/terrain',
  waterRecipe: 'world/water',
  seasonsRecipe: 'world/seasons',
  exposureRecipe: 'world/exposure',
  shadowRecipe: 'world/shadows',
  postRecipe: 'world/post',
};

/** Palettes available in the slice (docs/05): Moonlight and Clear sight join later. */
export const PALETTES = [{ id: 'dusk', name: 'Dusk' }, { id: 'meadow-morning', name: 'Meadow morning' }, { id: 'clear-sight', name: 'Clear sight' }];
