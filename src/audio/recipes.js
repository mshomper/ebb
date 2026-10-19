// @ts-check
// Audio recipe loader. Same idea as src/core/recipes.js, but reads recipes/audio-index.json, so
// the audio branches never edit the shared recipes/index.json (docs/audio-future-work.md).

const ROOT = new URL('../../recipes/', import.meta.url);

/** @type {Promise<{recipes: Record<string, string>}> | null} */
let manifest = null;
/** @type {Map<string, Promise<any>>} */
const cache = new Map();

/**
 * Load an audio recipe by id, e.g. 'audio/mixer' or 'music/instruments/piano-steinway-b'.
 * @param {string} id
 * @returns {Promise<any>}
 */
export function loadAudioRecipe(id) {
  let p = cache.get(id);
  if (!p) {
    p = (async () => {
      manifest ??= fetchJson(new URL('audio-index.json', ROOT));
      const path = (await manifest).recipes[id];
      if (!path) throw new Error(`Audio recipe "${id}" is not listed in recipes/audio-index.json`);
      return fetchJson(new URL(path, ROOT));
    })();
    cache.set(id, p);
  }
  return p;
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

/** @param {URL} url */
async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Could not load ${url.pathname} (${r.status})`);
  return r.json();
}
