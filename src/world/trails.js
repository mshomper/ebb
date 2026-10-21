// @ts-check
// The beachcomber's and shaper's trails (doc 13 "Trails", docs/future/12). Pure. Both are read from
// one short, ordered list of firsts kept in the saved unlocks (`firsts`): the first keepsake of each
// family kept, the first kept at each rarity, the first of each mark seen (even one left to the sea),
// and the first time the island has each kind of place you made. A stop is reached when its need is
// met (recipes/world/beachcomber.json, shaper.json); never a total, never taken back.

/**
 * @typedef {{ trail: 'beach' | 'shape', kind: 'family' | 'rarity' | 'mark' | 'place', id: string, hour: number }} First
 * @typedef {{ families?: number, rarity?: string, marks?: number, place?: string }} Need
 * @typedef {{ id: string, need: Need, icon: string, hint: string, give?: Record<string, any>, built?: boolean, title?: string, line?: string }} Stop
 *   built: nothing to give, but it exists already (the shelf), so it inks when reached
 * @typedef {{ type: 'first', first: First } | { type: 'station', stop: Stop, inked: boolean } | { type: 'next', stop: Stop }} TrailEntry
 *   station: a stop reached (inked once given, else pencil, "one day"); next: the next stop ahead, in pencil
 */

/** The rarities a first can be, in order (common is not a first). */
export const RARITY_FIRSTS = ['uncommon', 'rare', 'veryRare', 'lifetime'];

/**
 * The saved unlocks with a first written down, once, for good. The same object if it was there.
 * @param {Record<string, any>} earned @param {First} f
 */
export function addFirst(earned, f) {
  const firsts = earned?.firsts ?? [];
  if (firsts.some((/** @type {First} */ e) => e.trail === f.trail && e.kind === f.kind && e.id === f.id)) return earned ?? {};
  return { ...(earned ?? {}), firsts: [...firsts, { trail: f.trail, kind: f.kind, id: f.id, hour: f.hour }] };
}

/**
 * The firsts a kept keepsake brings: its family, and its rarity if uncommon or rarer; a mark too,
 * since a kept one has been seen. @param {any} n its numbers @param {number} hour @returns {First[]}
 */
export function keptFirsts(n, hour) {
  /** @type {First[]} */ const out = [];
  if (typeof n?.family !== 'string') return out;
  out.push({ trail: 'beach', kind: 'family', id: n.family, hour });
  if (RARITY_FIRSTS.includes(n.rarity)) out.push({ trail: 'beach', kind: 'rarity', id: n.rarity, hour });
  const m = seenMark(n, hour);
  if (m) out.push(m);
  return out;
}

/** The first a keepsake with a mark brings when it is seen. @param {any} n @param {number} hour @returns {First | null} */
export function seenMark(n, hour) {
  return typeof n?.family === 'string' && typeof n?.mark === 'string' ? { trail: 'beach', kind: 'mark', id: `${n.family}:${n.mark}`, hour } : null;
}

/**
 * What the firsts add up to, as kinds (never totals of things).
 * @param {First[]} firsts @param {string[]} [kept] families kept before firsts were written (save format 7)
 */
export function counts(firsts, kept = []) {
  const families = new Set(kept), rarities = new Set(), marks = new Set(), places = new Set();
  for (const f of firsts) {
    if (f.kind === 'family') families.add(f.id);
    else if (f.kind === 'rarity') rarities.add(f.id);
    else if (f.kind === 'mark') marks.add(f.id);
    else if (f.kind === 'place') places.add(f.id);
  }
  return { families: families.size, rarities, marks: marks.size, places };
}

/** Is a stop's need met? @param {Need} need @param {ReturnType<typeof counts>} c */
export function reached(need, c) {
  if (need.families !== undefined && c.families < need.families) return false;
  if (need.rarity !== undefined && !c.rarities.has(need.rarity)) return false;
  if (need.marks !== undefined && c.marks < need.marks) return false;
  if (need.place !== undefined && !c.places.has(need.place)) return false;
  return true;
}

/**
 * A trail as the journal draws it: each first in the order it happened, each stop right after the
 * first that reached it (inked once given, else in pencil), then the next stop ahead in pencil, and
 * nothing past it. @param {First[]} firsts this trail's @param {Stop[]} stops in their order
 * @param {string[]} given stops given (the saved unlocks' beachcomber list); a stop with no give is
 *   never given and stays in pencil @param {string[]} [kept] families kept before firsts were written
 * @returns {TrailEntry[]}
 */
export function trailLine(firsts, stops, given, kept = []) {
  /** @type {TrailEntry[]} */ const out = [];
  const placed = new Set();
  const place = (/** @type {First[]} */ upTo) => {
    const c = counts(upTo, upTo.length === firsts.length ? kept : []);
    for (const s of stops) {
      if (placed.has(s.id) || !reached(s.need, c)) continue;
      placed.add(s.id);
      out.push({ type: 'station', stop: s, inked: s.give ? given.includes(s.id) : !!s.built });
    }
  };
  firsts.forEach((f, i) => { out.push({ type: 'first', first: f }); place(firsts.slice(0, i + 1)); });
  // Families kept before the firsts were written may reach a stop the firsts alone do not.
  place(firsts);
  const next = stops.find((s) => !placed.has(s.id));
  if (next) out.push({ type: 'next', stop: next });
  return out;
}

/**
 * The ?trails test link's unlocks: five families kept (the net reached), a rare one kept, a mark
 * seen, and two places made, spread over the first days. Pure. @param {Record<string, any>} earned
 */
export function sampleTrails(earned) {
  let e = earned;
  const at = (/** @type {number} */ d, /** @type {number} */ h) => d * 24 + h;
  /** @type {First[]} */ const fs = [
    { trail: 'shape', kind: 'place', id: 'deepPool', hour: at(1, 11) },
    { trail: 'beach', kind: 'family', id: 'shell', hour: at(2, 9) },
    { trail: 'beach', kind: 'family', id: 'stone', hour: at(3, 15) },
    { trail: 'beach', kind: 'mark', id: 'stone:holed', hour: at(3, 15) },
    { trail: 'beach', kind: 'rarity', id: 'uncommon', hour: at(4, 8) },
    { trail: 'beach', kind: 'family', id: 'feather', hour: at(5, 10) },
    { trail: 'shape', kind: 'place', id: 'cove', hour: at(5, 14) },
    { trail: 'beach', kind: 'family', id: 'urchin', hour: at(6, 7) },
    { trail: 'beach', kind: 'family', id: 'bivalve', hour: at(7, 18) },
    { trail: 'beach', kind: 'rarity', id: 'rare', hour: at(7, 18) },
  ];
  for (const f of fs) e = addFirst(e, f);
  for (const f of ['shell', 'stone', 'feather', 'urchin', 'bivalve']) if (!(e.kept ?? []).includes(f)) e = { ...e, kept: [...(e.kept ?? []), f] };
  return e;
}

/** The firsts of one trail, in the order they happened. @param {Record<string, any>} earned @param {'beach' | 'shape'} trail @returns {First[]} */
export const firstsOf = (earned, trail) => (earned?.firsts ?? []).filter((/** @type {First} */ f) => f.trail === trail);
