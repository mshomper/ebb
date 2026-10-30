// @ts-check
// Threads in the live game (model.js has the rules): whenever the journal or the camp's makes change,
// any thread line whose test now holds is written with the game hour, into the store slice `threads`
// (saved as the save's threads section). Leaving Threads marks what is written as seen. `?threads`
// (testing, unsaved) sets the flags that take all four first threads part-way.

import { get, update, subscribe } from '../../core/store.js';
import { dispatch, onAction } from '../../input/actions.js';
import { writeLines, emptyThreads, markThreadsSeen } from './model.js';

/** Flags `?threads` sets: each first thread a line or two in, none finished. */
export const TEST_FLAGS = ['dig:marked-stone', 'setpiece:cairns:1', 'setpiece:cairns:2', 'setpiece:cairns:added',
  'setpiece:boat:seen', 'keeper:boat', 'keeper:first', 'keeper:tend',
  // Three morning hints already given (one of them done), for Things to try.
  'hint:gather@0', 'did:gathered', 'hint:finds@1', 'hint:cord@2'];

/**
 * @param {{ T: any, hour: () => number, journalWords?: any, test?: boolean }} o
 *   T: recipes/world/threads.json; hour: the game hour now; journalWords: recipes/world/journal.json (pages' kinds)
 * @returns {{ dispose: () => void }}
 */
export function createThreads(o) {
  const kindOf = (/** @type {string} */ sp) => o.journalWords?.species?.[sp]?.kind;
  if (!get('threads')) update('threads', () => emptyThreads());
  function write() {
    const journal = get('journal');
    if (!journal) return;
    const st = get('threads') ?? emptyThreads();
    const next = writeLines(o.T, { journal, cook: get('cook'), kindOf }, st, o.hour());
    if (next !== st) update('threads', () => next);
  }
  if (o.test) for (const f of TEST_FLAGS) if (!(get('journal')?.flags ?? []).includes(f)) dispatch(/** @type {any} */ ({ type: 'journal.flag', flag: f }));
  const offs = [subscribe('journal', write), subscribe('cook', write),
    // Threads shut again (src/ui/keeper-book.js): what is written counts as seen from now on.
    onAction((/** @type {any} */ a) => {
      if (a.type !== 'threads.seen') return;
      const st = get('threads'), n = st && markThreadsSeen(st);
      if (n && n !== st) update('threads', () => n);
    })];
  write();
  // On the test link the lines read as a story: each a game day after the one before.
  if (o.test) update('threads', (st) => ({ ...st, lines: st.lines.map((/** @type {any} */ l, /** @type {number} */ i, /** @type {any[]} */ all) => ({ ...l, h: l.h - (all.length - 1 - i) * 24 })) }));
  return { dispose() { for (const off of offs) off(); } };
}
