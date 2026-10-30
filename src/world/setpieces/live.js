// @ts-check
// The set pieces, live (docs/future/14): the bridge between play and the runner (runner.js), which
// runs in the hourly tick. It hands the recipes to the tick (world.env.recipes.setpieces), records
// choices and conditions as notes for the next hour (note, cond), keeps the journal's flags in step
// with what the set pieces have reached (keeper:<page> when a page is due, setpiece:<id>:<what> for
// the lines a page shows), and answers the test link `?setpiece=<id>&beat=N` (unsaved): that set
// piece started now at step N. Each set piece's own live module (cairns-live.js, boat-live.js)
// registers with `use` for its flags, its beat notices and its test-link data.

import { get, subscribe } from '../../core/store.js';
import { on, emitDeferred } from '../../core/events.js';
import { dispatch } from '../../input/actions.js';
import { addNote, setpiecesOf, startAt, stepsOf } from './runner.js';

/**
 * A set piece's live module, as the core needs it.
 * @typedef {{ id: string, flags?: (run: any, sp: any) => string[], beat?: (p: { id: string, beat: string, rep: number }) => void,
 *   testData?: () => Record<string, any> | null }} SetpieceLive
 */

/**
 * @param {{ world: { state: any, env: any }, recipes: { world: any, list: Record<string, any> }, hourIndex: () => number,
 *   record: () => void, test?: { id: string, beat: number } | null }} o
 *   record: publish world.state to the store after a note (as the hen's does)
 */
export function createSetpiecesLive(o) {
  const { world } = o;
  world.env.recipes.setpieces = { list: o.recipes.list, order: o.recipes.world.order, world: o.recipes.world };
  /** @type {Map<string, SetpieceLive>} */ const mods = new Map();

  /** The set pieces' state now. */
  const sp = () => setpiecesOf(world.state);
  /** A set piece's run now (the last, done or not). @param {string} id */
  const runOf = (id) => sp().runs?.[id] ?? null;

  /** Record a choice for the next hour's tick. @param {string} id @param {string} kind @param {Record<string, any>} [extra] */
  function note(id, kind, extra = {}) {
    world.state = addNote(world.state, { ...extra, id, kind, hour: o.hourIndex() });
    o.record();
  }
  /** Report a condition the tick cannot see, when it changes. @param {string} name @param {any} value */
  function cond(name, value) {
    const now = sp().conds?.[name], waiting = (sp().pending ?? []).filter((/** @type {any} */ n) => n.kind === 'cond' && n.name === name).pop();
    if ((waiting ? waiting.value : now) === value) return;
    world.state = addNote(world.state, { id: '', kind: 'cond', name, value, hour: o.hourIndex() });
    o.record();
  }

  /** Set a journal flag once. @param {string} f */
  const setFlag = (f) => { const j = get('journal'); if (j && !(j.flags ?? []).includes(f)) dispatch(/** @type {any} */ ({ type: 'journal.flag', flag: f })); };

  /** The flags the set pieces have reached, set in the journal. */
  function syncFlags() {
    if (!get('journal')) return;
    const s = sp();
    for (const [id, run] of Object.entries(s.runs ?? {})) {
      const R = o.recipes.list[id];
      if (!R) continue;
      // The set piece's own page once it has ended the first time.
      if ((s.count?.[id] ?? 0) > 0 && R.page !== false) setFlag(`keeper:${R.page ?? id}`);
      for (const f of mods.get(id)?.flags?.(run, s) ?? []) setFlag(f);
    }
  }

  const offs = [
    subscribe('world', syncFlags),
    subscribe('journal', syncFlags),
    on('setpiece:beat', (/** @type {any} */ p) => mods.get(p?.id)?.beat?.(p)),
  ];

  // `?setpiece=<id>&beat=N`: started once the island, its journal and the set piece's module are up.
  let testDone = !o.test;
  function runTest() {
    if (testDone || !o.test || !get('journal') || get('testGrow')?.done === false) return;
    const T = o.test, R = o.recipes.list[T.id], mod = mods.get(T.id);
    if (!R || !mod) { testDone = true; console.warn(`?setpiece=${T.id}: no such set piece`); return; }
    const data = mod.testData?.();
    if (data === null) return;   // not ready yet (the ground, the camp)
    testDone = true;
    const at = Math.max(0, Math.min(stepsOf(R).length, T.beat));
    world.state = startAt(world.state, T.id, at, o.hourIndex(), world.env, data ?? {});
    o.record();
    emitDeferred('setpiece:test', { id: T.id, step: at });
  }

  return {
    id: 'setpieces',
    note, cond, runOf, sp,
    /** Register a set piece's live module. @param {SetpieceLive} m */
    use(m) { mods.set(m.id, m); },
    /** Each frame: the test link waits for what it needs. */
    tick() { runTest(); },
    /** Steps of a set piece (tests). @param {string} id */
    steps: (id) => stepsOf(o.recipes.list[id]),
    dispose() { for (const off of offs) off(); },
  };
}

