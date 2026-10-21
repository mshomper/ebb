// @ts-check
// Save format 6 to 7 (docs 18 and docs/future/12; October 21, 2026): the nets, in a new `nets`
// section, and the families of keepsakes ever kept (`unlocks.kept`, the beachcomber's trail: the
// general net comes at four). An older island has no nets yet; the families it has kept are taken
// from its shelf, so a shelf already holding four families earns the net when it loads. Pure and
// deterministic.

/**
 * The step itself: sections in, sections out (copies; the input is not changed).
 * @param {Record<string, any>} sections
 */
export function nets7(sections) {
  const s = structuredClone(sections);
  if (!s.nets || typeof s.nets !== 'object' || !Array.isArray(s.nets.nets)) {
    s.nets = { version: 1, nets: [], released: [], nextId: 1 };
  }
  const shelf = Array.isArray(s.keepsakes?.shelf) ? s.keepsakes.shelf : [];
  const u = s.unlocks && typeof s.unlocks === 'object' ? s.unlocks : {};
  const kept = new Set(Array.isArray(u.kept) ? u.kept : []);
  for (const e of shelf) if (typeof e?.n?.family === 'string') kept.add(e.n.family);
  s.unlocks = { ...u, kept: [...kept] };
  return s;
}
