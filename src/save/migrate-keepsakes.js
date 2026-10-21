// @ts-check
// Save format 5 to 6 (docs 18 and docs/future/12; October 21, 2026): the shelf of keepsakes, in a
// new `keepsakes` section. An older island has kept nothing yet, so it gets an empty shelf. Pure
// and deterministic.

/**
 * The step itself: sections in, sections out (copies; the input is not changed).
 * @param {Record<string, any>} sections
 */
export function keepsakes6(sections) {
  const s = structuredClone(sections);
  if (!s.keepsakes || typeof s.keepsakes !== 'object' || !Array.isArray(s.keepsakes.shelf)) {
    s.keepsakes = { version: 1, shelf: [], nextId: 1 };
  }
  return s;
}
