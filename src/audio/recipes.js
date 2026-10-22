// @ts-check
// Audio recipe loader. The audio recipes are listed in recipes/index.json with every other recipe
// (they had their own recipes/audio-index.json while the audio work lived on separate branches), so
// this is the shared loader (src/core/recipes.js) under the name the audio code already uses.

import { loadRecipe } from '../core/recipes.js';

/**
 * Load an audio recipe by id, e.g. 'audio/mixer' or 'music/instruments/piano-steinway-b'.
 * @param {string} id
 * @returns {Promise<any>}
 */
export function loadAudioRecipe(id) {
  return loadRecipe(id);
}

/**
 * Settings for one instrument: the sampler defaults with that instrument's overrides on top.
 * @param {any} samplerRecipe recipes/music/sampler.json
 * @param {string} instrumentId
 */
export function samplerSettingsFor(samplerRecipe, instrumentId) {
  const over = samplerRecipe.byInstrument?.[instrumentId] ?? {};
  return { ...structuredClone(samplerRecipe.defaults), ...structuredClone(over) };
}

/** The repo root, for asset paths in recipes (e.g. "assets/audio/instruments/..."). */
export const REPO_ROOT = new URL('../../', import.meta.url);
