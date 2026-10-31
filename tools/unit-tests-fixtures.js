// @ts-check
// Small helpers more than one test file shares. Not a test file itself (it has no add...Tests),
// so tools/index-tests.mjs leaves it out of the list.

/** @template T @param {Promise<T>} p @param {number} ms @returns {Promise<T>} */
export function timeout(p, ms = 10000) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms} ms`)), ms))]);
}

/** @type {Promise<any> | null} */
let seasonsPromise = null;
/** recipes/world/seasons.json, fetched once. */
export function loadSeasons() {
  seasonsPromise ??= fetch(new URL('../recipes/world/seasons.json', import.meta.url)).then((r) => {
    if (!r.ok) throw new Error(`seasons.json: HTTP ${r.status}`);
    return r.json();
  });
  return seasonsPromise;
}
