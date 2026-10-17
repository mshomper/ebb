// @ts-check
// Event bus (doc 03). emit is synchronous; emitDeferred queues until flushDeferred,
// which the frame loop calls once at the end of each frame.

/** @typedef {(payload: any, name: string) => void} Listener */

/**
 * @typedef {Object} Bus
 * @property {(name: string, fn: Listener) => () => void} on  subscribe; returns an unsubscribe fn
 * @property {(name: string, fn: Listener) => void} off
 * @property {(name: string, payload?: any) => void} emit  deliver now
 * @property {(name: string, payload?: any) => void} emitDeferred  queue for the next flush
 * @property {() => number} flushDeferred  deliver queued events in order; returns how many
 */

/**
 * Make an independent bus (the module exports a default one).
 * @returns {Bus}
 */
export function createBus() {
  /** @type {Map<string, Listener[]>} */
  const listeners = new Map();
  /** @type {{name: string, payload: any}[]} */
  let queue = [];

  /** @param {string} name @param {Listener} fn */
  function off(name, fn) {
    const list = listeners.get(name);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) listeners.delete(name);
  }

  /** @param {string} name @param {Listener} fn */
  function on(name, fn) {
    let list = listeners.get(name);
    if (!list) listeners.set(name, (list = []));
    list.push(fn);
    return () => off(name, fn);
  }

  /** @param {string} name @param {any} [payload] */
  function emit(name, payload) {
    const list = listeners.get(name);
    if (!list) return;
    for (const fn of list.slice()) {
      try {
        fn(payload, name);
      } catch (err) {
        console.error(`[events] listener for "${name}" failed`, err);
      }
    }
  }

  /** @param {string} name @param {any} [payload] */
  function emitDeferred(name, payload) {
    queue.push({ name, payload });
  }

  function flushDeferred() {
    const batch = queue;
    queue = []; // events raised during this flush wait for the next one
    for (const e of batch) emit(e.name, e.payload);
    return batch.length;
  }

  return { on, off, emit, emitDeferred, flushDeferred };
}

const bus = createBus();

/** The shared app bus. */
export const defaultBus = bus;
export const on = bus.on;
export const off = bus.off;
export const emit = bus.emit;
export const emitDeferred = bus.emitDeferred;
export const flushDeferred = bus.flushDeferred;
