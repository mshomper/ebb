// @ts-check
// The action layer: gestures become typed actions, consumers subscribe (docs/15).
// Also holds the undo/redo command stack. Commands are plain data with a `kind`; the system
// that owns a kind registers an applier, so the stack survives a GPU rebuild unchanged.

import { emit } from '../core/events.js';

/**
 * @typedef {'mouse'|'pen'|'touch'|'key'} Source
 * @typedef {'sculpt'|'smooth'|'paint'|'water'} ToolId
 */

/**
 * @typedef {{ type: 'camera.orbit', dx: number, dy: number }
 *   | { type: 'camera.pan', dx: number, dy: number }
 *   | { type: 'camera.zoom', factor: number, x?: number, y?: number }
 *   | { type: 'camera.twist', angle: number }
 *   | { type: 'tool.select', toolId: ToolId | null, source?: Source }
 *   | { type: 'tool.begin', x: number, y: number, pressure: number, source: Source }
 *   | { type: 'tool.move', x: number, y: number, pressure: number, source: Source }
 *   | { type: 'tool.end', source: Source }
 *   | { type: 'tool.cancel', source: Source }
 *   | { type: 'tool.hover', x: number, y: number, inside: boolean, source: Source }
 *   | { type: 'brush.set', patch: { sculptMode?: 'raise'|'lower'|'flatten', paintLayer?: 'grass'|'sand'|'soil'|'rock', size?: number, strength?: number,
 *       waterMode?: 'pour'|'soak'|'spring', springRate?: 'trickle'|'brook'|'stream' } }
 *   | { type: 'water.springRemove', id: string }
 *   | { type: 'brush.resize', factor: number, source?: Source }
 *   | { type: 'history.undo', source?: Source }
 *   | { type: 'history.redo', source?: Source }
 *   | { type: 'time.flow', flow: 0|1|2|4 }
 *   | { type: 'look.palette', id: string }} Action
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

/** @typedef {{ kind: string, bytes: number }} Command */
/** @typedef {(cmd: any, direction: 'undo'|'redo') => boolean} Applier */

/**
 * Undo and redo stacks with a memory budget; the oldest steps drop off silently.
 * @param {{ budgetBytes: number }} opts
 */
export function createHistory(opts) {
  /** @type {Command[]} */ const undoStack = [];
  /** @type {Command[]} */ const redoStack = [];
  /** @type {Map<string, Applier>} */ const appliers = new Map();
  /** @type {(() => void)[]} */ const watchers = [];
  let budget = opts.budgetBytes;

  const total = () => [...undoStack, ...redoStack].reduce((s, c) => s + c.bytes, 0);
  const changed = () => { for (const fn of watchers) fn(); };

  function trim() {
    while (undoStack.length > 1 && total() > budget) undoStack.shift();
  }

  /**
   * @param {Command[]} from @param {Command[]} to @param {'undo'|'redo'} dir
   */
  function step(from, to, dir) {
    const cmd = from[from.length - 1];
    if (!cmd) return true;
    const apply = appliers.get(cmd.kind);
    if (!apply || !apply(cmd, dir)) return false;
    from.pop();
    to.push(cmd);
    if (dir === 'undo') emit('history:undone', { kind: cmd.kind });
    changed();
    return true;
  }

  return {
    /** @param {string} kind @param {Applier} fn */
    setApplier(kind, fn) { appliers.set(kind, fn); },
    /** @param {Command} cmd */
    push(cmd) {
      undoStack.push(cmd);
      redoStack.length = 0;
      trim();
      changed();
    },
    /** @returns {boolean} false if the owner was busy; try again shortly */
    undo: () => step(undoStack, redoStack, 'undo'),
    redo: () => step(redoStack, undoStack, 'redo'),
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    depth: () => ({ undo: undoStack.length, redo: redoStack.length, bytes: total() }),
    /** @param {number} bytes */
    setBudget(bytes) { budget = bytes; trim(); changed(); },
    /** @param {() => void} fn */
    onChange(fn) { watchers.push(fn); return () => watchers.splice(watchers.indexOf(fn), 1); },
  };
}

/** The app's history. */
export const history = createHistory({ budgetBytes: 48 * 1024 * 1024 });
