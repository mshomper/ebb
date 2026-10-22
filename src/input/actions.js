// @ts-check
// The action layer: gestures become typed actions, consumers subscribe (docs/15).
// Also holds the undo/redo command stack. Commands are plain data with a `kind`; the system
// that owns a kind registers an applier, so the stack survives a GPU rebuild unchanged.

import { emit } from '../core/events.js';

/**
 * @typedef {'mouse'|'pen'|'touch'|'key'} Source
 * @typedef {'sculpt'|'smooth'|'paint'|'water'|'plant'|'feed'} ToolId
 * @typedef {'reeds'|'lilies'|'iris'|'marigold'|'rushes'|'thrift'|'campion'|'willow'|'gorse'|'pondweed'} PlantSpecies
 */

/**
 * @typedef {{ type: 'camera.orbit', dx: number, dy: number }
 *   | { type: 'camera.pan', dx: number, dy: number }
 *   | { type: 'camera.zoom', factor: number, x?: number, y?: number }
 *   | { type: 'camera.twist', angle: number }
 *   | { type: 'camera.focus', x: number, z: number, distance: number, pitchDeg: number, y?: number }
 *   | { type: 'journal.showMe', sp: string }
 *   | { type: 'tool.select', toolId: ToolId | null, source?: Source }
 *   | { type: 'tool.begin', x: number, y: number, pressure: number, source: Source, shift?: boolean }
 *   | { type: 'tool.move', x: number, y: number, pressure: number, source: Source }
 *   | { type: 'tool.end', source: Source }
 *   | { type: 'tool.cancel', source: Source }
 *   | { type: 'tool.hover', x: number, y: number, inside: boolean, source: Source }
 *   | { type: 'brush.set', patch: { sculptMode?: 'raise'|'lower'|'flatten'|'stone'|'loosestone'|'pondstones'|'terrace'|'cut'|'steps', paintLayer?: 'grass'|'sand'|'soil'|'rock', size?: number, strength?: number, cliffHeight?: number,
 *       waterMode?: 'pour'|'drain'|'spring'|'net', springRate?: 'trickle'|'brook'|'stream', plantSpecies?: PlantSpecies } }
 *   | { type: 'water.springRemove', id: string }
 *   | { type: 'pieces.remove', id: string }
 *   | { type: 'pieces.removeRun', run: string }
 *   | { type: 'pieces.carry', id: string }
 *   | { type: 'pieces.carryCancel' }
 *   | { type: 'keepsakes.leave', id: string }
 *   | { type: 'keepsakes.keep', id: string }
 *   | { type: 'keepsakes.swap', out: number }
 *   | { type: 'keepsakes.letGo', id: number }
 *   | { type: 'keepsakes.cancelKeep' }
 *   | { type: 'keepsakes.read', shoreId?: string, entryId?: number }
 *   | { type: 'nets.lift', id: number }
 *   | { type: 'nets.bringIn', id?: number }
 *   | { type: 'nets.release', id: string }
 *   | { type: 'nets.keep' }
 *   | { type: 'nets.leave' }
 *   | { type: 'nets.close' }
 *   | { type: 'brush.resize', factor: number, source?: Source }
 *   | { type: 'history.undo', source?: Source }
 *   | { type: 'history.redo', source?: Source }
 *   | { type: 'time.flow', flow: 0|1|2|4 }
 *   | { type: 'time.keepGrowing', on: boolean }
 *   | { type: 'settings.set', patch: Record<string, any> }
 *   | { type: 'music.heart', heart: import('../audio/music/hearts.js').Heart }
 *   | { type: 'music.pass', heart: import('../audio/music/hearts.js').Heart }
 *   | { type: 'look.palette', id: string }
 *   | { type: 'look.tap', x: number, y: number, source: Source }
 *   | { type: 'ui.identify' }
 *   | { type: 'creature.name', id: number, name: string }
 *   | { type: 'ui.hideHud', hidden?: boolean, source?: Source }
 *   | { type: 'ui.journal', open?: boolean, toggle?: boolean, view?: 'trails'|'living'|'ground'|'web'|'almanac'|'notes'|'shelf', page?: string|null, size?: 'half'|'full', trail?: 'naturalist'|'beach'|'shape' }} Action
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
