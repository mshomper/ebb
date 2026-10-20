// @ts-check
// Save format 3 to 4 (docs 12, 13; October 20, 2026): the frogs' gift became the Cliff tool
// (Sculpt's Terrace and Cut), where it had been a water lily seed, and the tool is no longer there
// from the start. An island whose frogs already gave their gift gets the Cliff tool too, quietly
// (no card on load), so nothing it could do before is taken away. Its lily seed stays, harmless:
// lilies are a starter plant. Cliffs already in the ground are part of the land and stay as they
// are. Pure and deterministic.

/**
 * The step itself: sections in, sections out (copies; the input is not changed).
 * @param {Record<string, any>} sections
 */
export function cliffs4(sections) {
  const s = structuredClone(sections);
  const u = s.unlocks && typeof s.unlocks === 'object' ? s.unlocks : {};
  if (u.gifts?.frogs) u.cliffs = true;
  s.unlocks = u;
  return s;
}
