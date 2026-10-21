// @ts-check
// The shelf (docs/future/12, piece K3): the keepsakes the player chose to keep, 16 at most. It is
// the only record of keepsakes: nothing counts what was found or left. Each saves its numbers (with
// its family and gen), so it rebuilds the same for good, and where and when it was found. Pure: the
// store slice `keepsakes` holds a ShelfState, saved as the `keepsakes` section (format 6).

/**
 * @typedef {{ id: number, n: any, hour: number, spring: boolean }} ShelfEntry
 *   hour: the game hour of the high tide that left it; spring: whether that was a spring tide
 * @typedef {{ version: 1, shelf: ShelfEntry[], nextId: number }} ShelfState
 */

/** The shelf holds this many. */
export const SHELF_CAP = 16;

/** An empty shelf. @returns {ShelfState} */
export const emptyShelf = () => ({ version: 1, shelf: [], nextId: 1 });

/**
 * A shelf read from a save (or anything else): what is readable stays, the rest goes.
 * @param {any} s @returns {ShelfState}
 */
export function cleanShelf(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.shelf)) return emptyShelf();
  const shelf = s.shelf
    .filter((/** @type {any} */ e) => e && Number.isInteger(e.id) && e.n && typeof e.n.family === 'string' && Number.isFinite(e.hour))
    .slice(0, SHELF_CAP)
    .map((/** @type {any} */ e) => ({ id: e.id, n: structuredClone(e.n), hour: e.hour, spring: !!e.spring }));
  const top = shelf.reduce((m, e) => Math.max(m, e.id), 0);
  return { version: 1, shelf, nextId: Math.max(Number.isInteger(s.nextId) ? s.nextId : 1, top + 1) };
}

/**
 * Keep one: onto the shelf if there is room, else the shelf asks which to let go.
 * @param {ShelfState} s @param {{ n: any, hour: number, spring: boolean }} k
 * @returns {{ state: ShelfState, kept: boolean, full: boolean }}
 */
export function keep(s, k) {
  if (s.shelf.length >= SHELF_CAP) return { state: s, kept: false, full: true };
  const e = { id: s.nextId, n: structuredClone(k.n), hour: k.hour, spring: !!k.spring };
  return { state: { ...s, shelf: [...s.shelf, e], nextId: s.nextId + 1 }, kept: true, full: false };
}

/** Let one go, back to the sea. @param {ShelfState} s @param {number} id @returns {ShelfState} */
export function letGo(s, id) {
  return { ...s, shelf: s.shelf.filter((e) => e.id !== id) };
}

/**
 * Let one go to make room for another, which takes its place on the shelf.
 * @param {ShelfState} s @param {number} outId @param {{ n: any, hour: number, spring: boolean }} k
 * @returns {ShelfState}
 */
export function swap(s, outId, k) {
  const at = s.shelf.findIndex((e) => e.id === outId);
  if (at < 0) return s;
  const shelf = s.shelf.slice();
  shelf[at] = { id: s.nextId, n: structuredClone(k.n), hour: k.hour, spring: !!k.spring };
  return { ...s, shelf, nextId: s.nextId + 1 };
}
