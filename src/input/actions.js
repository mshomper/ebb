// @ts-check
// The action layer: gestures become typed actions, consumers subscribe (docs/15).
// M0 has camera actions only; tools, undo and redo join in M1.

/**
 * @typedef {{ type: 'camera.orbit', dx: number, dy: number }
 *   | { type: 'camera.pan', dx: number, dy: number }
 *   | { type: 'camera.zoom', factor: number, x?: number, y?: number }
 *   | { type: 'camera.twist', angle: number }} Action
 */

/** @type {((a: Action) => void)[]} */
const listeners = [];

/** @param {Action} action */
export function dispatch(action) {
  for (const fn of listeners) fn(action);
}

/**
 * @param {(a: Action) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onAction(fn) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}
