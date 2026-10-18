// @ts-check
// The shared store (doc 03): one plain object in slices that mirror the .ebb
// sections (doc 18), plus a per-device `settings` slice. Subscribers are told
// synchronously after each update of their slice.

/**
 * @typedef {Object} MetaSlice
 * @property {number} seed    world seed (uint32)
 * @property {number} worldT  game seconds
 * @property {0|1|2|4} flow   time flow
 */

/**
 * @typedef {Object} AudioSettings
 * @property {number} master @property {number} ambience @property {number} creatures
 * @property {number} tools @property {number} ui  volumes 0..1
 * @property {boolean} muteInBackground
 */

/**
 * @typedef {Object} SettingsSlice
 * @property {string} palette            palette id, e.g. 'dusk' (doc 05)
 * @property {100|115|130|160} textSize  percent (doc 16)
 * @property {'full'|'reduced'} motion
 * @property {'auto'|'ultra'|'high'|'medium'|'low'} quality  'auto' lets render/quality.js pick (doc 19)
 * @property {AudioSettings} audio
 */

/** @typedef {(value: any, slice: string) => void} Subscriber */

/**
 * @typedef {Object} Store
 * @property {(slice: string) => any} get  current slice object (live reference)
 * @property {(slice: string, fn: (value: any) => any) => void} update
 *   fn may mutate the slice or return a new one; subscribers run afterwards
 * @property {(slice: string, fn: Subscriber) => () => void} subscribe  returns an unsubscribe fn
 */

/**
 * Fresh default slices.
 * @returns {{meta: MetaSlice, settings: SettingsSlice}}
 */
export function initialSlices() {
  return {
    meta: { seed: 0, worldT: 0, flow: 1 },
    settings: {
      palette: 'dusk',
      textSize: 100,
      motion: 'full',
      quality: 'auto',
      audio: { master: 1, ambience: 1, creatures: 1, tools: 1, ui: 1, muteInBackground: true },
    },
  };
}

/**
 * Make an independent store. Slices not in `initial` start undefined and are
 * created by the first update that returns a value.
 * @param {Record<string, any>} [initial]
 * @returns {Store}
 */
export function createStore(initial = initialSlices()) {
  /** @type {Record<string, any>} */
  const slices = { ...initial };
  /** @type {Map<string, Subscriber[]>} */
  const subs = new Map();

  /** @param {string} slice */
  function get(slice) {
    return slices[slice];
  }

  /** @param {string} slice @param {(value: any) => any} fn */
  function update(slice, fn) {
    const result = fn(slices[slice]);
    if (result !== undefined) slices[slice] = result;
    const list = subs.get(slice);
    if (!list) return;
    for (const s of list.slice()) {
      try {
        s(slices[slice], slice);
      } catch (err) {
        console.error(`[store] subscriber for "${slice}" failed`, err);
      }
    }
  }

  /** @param {string} slice @param {Subscriber} fn */
  function subscribe(slice, fn) {
    let list = subs.get(slice);
    if (!list) subs.set(slice, (list = []));
    list.push(fn);
    return () => {
      const l = subs.get(slice);
      const i = l ? l.indexOf(fn) : -1;
      if (l && i >= 0) l.splice(i, 1);
    };
  }

  return { get, update, subscribe };
}

const store = createStore();

/** The app store. */
export const defaultStore = store;
export const get = store.get;
export const update = store.update;
export const subscribe = store.subscribe;
