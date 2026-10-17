// @ts-check
// Recipe loader (docs/14). M0 keeps it minimal: manifest lookup, fetch, cache.
// Validation and the generator registry arrive with the tuning panel in M2.

const ROOT = new URL('../../recipes/', import.meta.url);

/** @type {Promise<{recipes: Record<string, string>}> | null} */
let manifest = null;
/** @type {Map<string, Promise<any>>} */
const cache = new Map();

/**
 * Load a recipe by id, e.g. 'world/camera'.
 * @param {string} id
 * @returns {Promise<any>}
 */
export function loadRecipe(id) {
  let p = cache.get(id);
  if (!p) {
    p = (async () => {
      manifest ??= fetchJson(new URL('index.json', ROOT));
      const path = (await manifest).recipes[id];
      if (!path) throw new Error(`Recipe "${id}" is not listed in recipes/index.json`);
      return fetchJson(new URL(path, ROOT));
    })();
    cache.set(id, p);
  }
  return p;
}

/** @param {URL} url */
async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Could not load ${url.pathname} (${r.status})`);
  return r.json();
}
