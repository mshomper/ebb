// @ts-check
// Hearted and passed pieces (doc 24, "Naming"; Matt, October 19 and 20, 2026): a piece you heart is
// kept with the island (the save's `music` section, store slice `music`) and plays more often; a
// piece you turn down (thumbs-down) fades out, never comes back, and the composer leans a little
// away from its form and sound. A tide is kept by its id. A grown piece is kept by what grows it
// again exactly, its season, slot, weather and seed (the composer is deterministic), with its name
// for showing. Pure.

/**
 * @typedef {Object} Heart
 * @property {string} key      'tide:<id>' or 'grown:<slot>:<weather>:<seed>'
 * @property {'tide'|'grown'} kind
 * @property {string} title
 * @property {string} [id]     a tide's piece id
 * @property {string} [slot]   a grown piece's slot
 * @property {string} [weather]
 * @property {number} [seed]
 * @property {string} [season] a grown piece's season (its material); spring when absent
 * @property {string} [template] a grown piece's form (song, sway, long-dusk...), for the leaning
 * @property {string} [sound]    its sound (soundOf), for the leaning
 */

/**
 * The heart for a piece now playing (music:started's payload).
 * @param {{ id: string, title: string, grown?: boolean, slot?: string, weather?: string, seed: number, grownSlot?: string, season?: string, template?: string, sound?: string }} p
 * @returns {Heart}
 */
export function heartOf(p) {
  if (p.grown) {
    const slot = p.grownSlot ?? p.slot ?? 'morning', weather = p.weather ?? 'clear', season = p.season ?? 'spring';
    // Spring's keys stay as they were first written; other seasons name theirs.
    const key = season === 'spring' ? `grown:${slot}:${weather}:${p.seed >>> 0}` : `grown:${season}:${slot}:${weather}:${p.seed >>> 0}`;
    /** @type {Heart} */
    const h = { key, kind: 'grown', title: p.title, slot, weather, seed: p.seed >>> 0, season };
    if (p.template) h.template = p.template;
    if (p.sound) h.sound = p.sound;
    return h;
  }
  return { key: `tide:${p.id}`, kind: 'tide', title: p.title, id: p.id };
}

/** @param {Heart[] | undefined} list @param {string} key */
export const isHearted = (list, key) => !!list?.some((h) => h.key === key);

/**
 * The sound of a piece, for the composer's leaning away from what a player turns down: the guitar
 * strumming, the electric piano, or the piano.
 * @param {any} palette
 */
export function soundOf(palette) {
  if (palette?.strum?.length) return 'strum';
  return palette?.accomp?.[0] ?? 'piano';
}

/**
 * A heart or a thumbs-down on a piece, returning the new `music` slice. The two exclude each other;
 * the same verdict again takes it back. Lists keep the newest last, at most `max` each.
 * @param {{hearted?: Heart[], passed?: Heart[]} | undefined} m @param {Heart} h @param {'heart'|'pass'} verdict
 * @param {number} [max]
 */
export function setVerdict(m, h, verdict, max = 200) {
  const clean = (/** @type {Heart[] | undefined} */ l) => (l ?? []).filter((x) => x && typeof x.key === 'string');
  let hearted = clean(m?.hearted), passed = clean(m?.passed);
  if (verdict === 'heart') {
    hearted = toggleHeart(hearted, h, max);
    passed = passed.filter((x) => x.key !== h.key);
  } else {
    passed = toggleHeart(passed, h, max);
    hearted = hearted.filter((x) => x.key !== h.key);
  }
  return { ...(m ?? {}), hearted, passed };
}

/**
 * Heart or unheart a piece, returning a new list (newest last), at most `max` long.
 * @param {Heart[] | undefined} list @param {Heart} h @param {number} [max]
 */
export function toggleHeart(list, h, max = 200) {
  const l = (list ?? []).filter((x) => x && typeof x.key === 'string');
  if (l.some((x) => x.key === h.key)) return l.filter((x) => x.key !== h.key);
  return [...l, h].slice(-max);
}
