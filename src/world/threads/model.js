// @ts-check
// Threads (Matt, October 30, 2026; the Keeper book's Threads tab): the long stories the island tells,
// written by the keeper as they happen. A line is written, with the game hour, the first time its
// test holds once the line before it is written; written lines are kept in the save's `threads`
// section and never change. The tests are the morning hints' own (src/world/hints/morning.js), read
// from recipes/world/threads.json. Pure; the live part is live.js, the page src/ui/keeper-threads.js.

import { testHolds } from '../hints/morning.js';

/**
 * The save's threads section: the lines written, in the order written, each `<thread>.<line>` with
 * the game hour it was written; seen: how many of them were written when Threads was last opened
 * (the rest show as new).
 * @typedef {{ version: 1, lines: { id: string, h: number }[], seen: number }} ThreadsState
 */

/** A new island's threads: nothing written yet. @returns {ThreadsState} */
export const emptyThreads = () => ({ version: 1, lines: [], seen: 0 });

/**
 * The section as saved, or empty: an older save has none and reads as nothing written yet.
 * @param {any} v @returns {ThreadsState}
 */
export function cleanThreads(v) {
  if (!v || typeof v !== 'object' || !Array.isArray(v.lines)) return emptyThreads();
  const lines = v.lines.filter((/** @type {any} */ l) => l && typeof l.id === 'string' && Number.isFinite(l.h)).map((/** @type {any} */ l) => ({ id: l.id, h: Number(l.h) }));
  const seen = Number.isFinite(v.seen) ? Math.max(0, Math.min(lines.length, Math.floor(v.seen))) : lines.length;
  return { version: 1, lines, seen };
}

/**
 * Write every line whose test now holds and whose line before it is written. The same state comes
 * back when nothing is new, so a caller can skip the store.
 * @param {any} T recipes/world/threads.json @param {import('../hints/morning.js').HintState} s
 * @param {ThreadsState} st @param {number} hour the game hour now
 * @returns {ThreadsState}
 */
export function writeLines(T, s, st, hour) {
  const had = new Set(st.lines.map((l) => l.id));
  /** @type {{ id: string, h: number }[]} */ const add = [];
  for (const th of T?.threads ?? []) {
    for (const ln of th.lines ?? []) {
      const id = `${th.id}.${ln.id}`;
      if (had.has(id)) continue;
      if (!testHolds(T, ln.test, s)) break;
      add.push({ id, h: Math.floor(hour) });
      had.add(id);
    }
  }
  return add.length ? { ...st, lines: [...st.lines, ...add] } : st;
}

/**
 * Each thread as the page shows it: its lines written so far (in its own order, with their hours and
 * whether they are new), whether it has begun, and whether it is finished (every one of its `end`
 * tests holds and its lines are all written, or all of its end tests hold).
 * @param {any} T @param {import('../hints/morning.js').HintState} s @param {ThreadsState} st
 * @returns {{ id: string, title: string, icon: string, pages: boolean, pencil: string, begun: number, last: number, done: boolean, fresh: boolean,
 *   lines: { id: string, text: string, h: number, fresh: boolean }[] }[]}
 */
export function threadsOf(T, s, st) {
  const at = new Map(st.lines.map((l, i) => [l.id, { h: l.h, fresh: i >= st.seen }]));
  return (T?.threads ?? []).map((/** @type {any} */ th) => {
    const lines = (th.lines ?? []).flatMap((/** @type {any} */ ln) => {
      const w = at.get(`${th.id}.${ln.id}`);
      return w ? [{ id: ln.id, text: String(ln.text ?? ''), h: w.h, fresh: w.fresh }] : [];
    });
    const end = /** @type {string[]} */ (th.end ?? []);
    const done = lines.length > 0 && end.length > 0 && end.every((name) => testHolds(T, name, s));
    return { id: th.id, title: String(th.title ?? th.id), icon: String(th.icon ?? 'notes'), pages: !!th.pages, pencil: String(th.pencil ?? ''),
      begun: lines.length ? lines[0].h : -1, last: lines.length ? Math.max(...lines.map((l) => l.h)) : -1, done, fresh: lines.some((l) => l.fresh), lines };
  }).filter((/** @type {any} */ t) => t.lines.length > 0);
}

/** Threads opened now: every line written counts as seen from here on. @param {ThreadsState} st @returns {ThreadsState} */
export const markThreadsSeen = (st) => (st.seen === st.lines.length ? st : { ...st, seen: st.lines.length });

/** Is any written line not yet seen? @param {ThreadsState | null | undefined} st */
export const threadsUnread = (st) => !!st && st.lines.length > st.seen;
