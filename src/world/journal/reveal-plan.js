// @ts-check
// What the reveal on return shows (docs 02, 13; S7c): the best few notes written while you were away,
// and the places on the island they are about, for its rings. Pure, and blind to species: notes rank
// by their kind (journal.json `reveal.rank`), and a place comes from any creature's news that says
// where it happened, or from the Show me spot of the note's page. So a new plant or animal joins
// the reveal through its recipes alone.

import { showMeSpot } from './describe.js';

/**
 * A note's rank: the index of the first class holding its kind; kinds not listed come last.
 * @param {{ kind?: string }} note @param {{ kinds: string[] }[]} rank
 */
export function rankOf(note, rank) {
  const i = note.kind ? rank.findIndex((r) => r.kinds.includes(/** @type {string} */ (note.kind))) : -1;
  return i < 0 ? rank.length : i;
}

/**
 * @typedef {Object} RevealPlace
 * @property {number} x @property {number} z
 * @property {string} sp       the page it is about
 */

/**
 * @param {{ notes: any[], events: any[], state: any, habitat: any, words: any, count: number, places: number,
 *   near?: number[] | null }} p
 *   notes: the notes written while away (oldest first); events: the notable tick events of those hours;
 *   count: notes to show; places: rings at most; near: the view's middle [x, z], for Show me spots
 * @returns {{ shown: { note: any, place: number }[], places: RevealPlace[] }}
 *   shown: best first, each with the index of its place in `places`, or -1 (a season has none)
 */
export function planReveal(p) {
  const R = p.words.reveal ?? { rank: [], placeApartM: 8 };
  const order = p.notes.map((note, i) => ({ note, i }));
  // Best class first; within a class, newer first.
  order.sort((a, b) => rankOf(a.note, R.rank) - rankOf(b.note, R.rank) || b.note.hour - a.note.hour || b.i - a.i);
  /** @type {RevealPlace[]} */ const places = [];
  const apart2 = (R.placeApartM ?? 8) ** 2;
  const shown = order.slice(0, Math.max(0, p.count)).map(({ note }) => {
    const at = placeFor(note, p);
    if (!at) return { note, place: -1 };
    const same = places.findIndex((q) => (q.x - at.x) ** 2 + (q.z - at.z) ** 2 < apart2);
    if (same >= 0) return { note, place: same };
    if (places.length >= p.places) return { note, place: -1 };
    places.push({ ...at, sp: note.sp });
    return { note, place: places.length - 1 };
  });
  return { shown, places };
}

/**
 * Where a note happened: an animal's news at that hour (or its latest), else its page's Show me spot.
 * @param {any} note @param {{ events: any[], state: any, habitat: any, words: any, near?: number[] | null }} p
 * @returns {{ x: number, z: number } | null}
 */
function placeFor(note, p) {
  if (!note.sp) return null;
  const said = p.events.filter((e) => e.payload?.species === note.sp && Number.isFinite(e.payload?.x) && Number.isFinite(e.payload?.z));
  const ev = said.find((e) => e.hour === note.hour) ?? said[said.length - 1];
  if (ev) return { x: ev.payload.x, z: ev.payload.z };
  const spot = showMeSpot(note.sp, p.state, p.habitat, p.words, p.near ?? null);
  return spot && Number.isFinite(spot.wx) ? { x: spot.wx, z: spot.wz } : null;
}
