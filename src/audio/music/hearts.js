// @ts-check
// Hearted pieces (doc 24, "Naming"; Matt, October 19 and 20, 2026): a piece you heart is kept with
// the island (the save's `music` section, store slice `music`) and plays more often. A tide is
// kept by its id. A grown piece is kept by what grows it again exactly, its slot, weather and seed
// (the composer is deterministic), with its name for showing. Pure.

/**
 * @typedef {Object} Heart
 * @property {string} key      'tide:<id>' or 'grown:<slot>:<weather>:<seed>'
 * @property {'tide'|'grown'} kind
 * @property {string} title
 * @property {string} [id]     a tide's piece id
 * @property {string} [slot]   a grown piece's slot
 * @property {string} [weather]
 * @property {number} [seed]
 */

/**
 * The heart for a piece now playing (music:started's payload).
 * @param {{ id: string, title: string, grown?: boolean, slot?: string, weather?: string, seed: number, grownSlot?: string }} p
 * @returns {Heart}
 */
export function heartOf(p) {
  if (p.grown) {
    const slot = p.grownSlot ?? p.slot ?? 'morning', weather = p.weather ?? 'clear';
    return { key: `grown:${slot}:${weather}:${p.seed >>> 0}`, kind: 'grown', title: p.title, slot, weather, seed: p.seed >>> 0 };
  }
  return { key: `tide:${p.id}`, kind: 'tide', title: p.title, id: p.id };
}

/** @param {Heart[] | undefined} list @param {string} key */
export const isHearted = (list, key) => !!list?.some((h) => h.key === key);

/**
 * Heart or unheart a piece, returning a new list (newest last), at most `max` long.
 * @param {Heart[] | undefined} list @param {Heart} h @param {number} [max]
 */
export function toggleHeart(list, h, max = 200) {
  const l = (list ?? []).filter((x) => x && typeof x.key === 'string');
  if (l.some((x) => x.key === h.key)) return l.filter((x) => x.key !== h.key);
  return [...l, h].slice(-max);
}
