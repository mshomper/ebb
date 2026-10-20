// @ts-check
// Save format 4 to 5 (docs 09, 13, 18; October 20, 2026): placed pieces. Loose stones, the
// naturalist's reward at six finds, are the first: records the save keeps in a new `pieces`
// section. An older island has none yet, so it gets an empty list, with its stones still to come
// (the reward was not built before this format, so no island has been given it). Pure and
// deterministic.

/**
 * The step itself: sections in, sections out (copies; the input is not changed).
 * @param {Record<string, any>} sections
 */
export function pieces5(sections) {
  const s = structuredClone(sections);
  if (!s.pieces || typeof s.pieces !== 'object' || !Array.isArray(s.pieces.list)) {
    s.pieces = { version: 1, list: [], nextId: 1, arrived: false };
  }
  return s;
}
