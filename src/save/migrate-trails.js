// @ts-check
// Save format 7 to 8 (doc 13 "Trails", doc 18; October 21, 2026): the trails' firsts, in the saved
// unlocks (`firsts`). An older island has kept keepsakes but wrote no firsts, so they are rebuilt from
// what it has: each family it kept (`kept`; undated if it is no longer on the shelf), and the
// families, rarities and marks of what is on its shelf, dated from when each was found. What was let
// go before cannot be known, so the trail starts from the shelf. Places are noticed on the island's
// first look after loading. Pure and deterministic.

import { addFirst, keptFirsts } from '../world/trails.js';

/**
 * The step itself: sections in, sections out (copies; the input is not changed).
 * @param {Record<string, any>} sections
 */
export function trails8(sections) {
  const s = structuredClone(sections);
  /** @type {Record<string, any>} */ let u = s.unlocks && typeof s.unlocks === 'object' ? s.unlocks : {};
  const shelf = (Array.isArray(s.keepsakes?.shelf) ? s.keepsakes.shelf : [])
    .filter((/** @type {any} */ e) => typeof e?.n?.family === 'string')
    .sort((/** @type {any} */ a, /** @type {any} */ b) => (a.hour ?? 0) - (b.hour ?? 0));
  const onShelf = new Set(shelf.map((/** @type {any} */ e) => e.n.family));
  // Families kept and let go since: undated, so they lead the trail.
  for (const f of Array.isArray(u.kept) ? u.kept : []) {
    if (typeof f === 'string' && !onShelf.has(f)) u = addFirst(u, { trail: 'beach', kind: 'family', id: f, hour: -1 });
  }
  for (const e of shelf) for (const f of keptFirsts(e.n, Number.isFinite(e.hour) ? Math.floor(e.hour) : -1)) u = addFirst(u, f);
  if (!Array.isArray(u.firsts)) u = { ...u, firsts: [] };
  s.unlocks = u;
  return s;
}
