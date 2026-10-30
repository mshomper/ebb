// @ts-check
// The gift stone's gifts (docs/future/13 C-14, C-37; B1 C1), pure. Once the gift stone stands in its
// camp slot, what a named creature gives is laid on it as a small thing you walk to and take up,
// instead of arriving on the walker's gift spot at once. Each laid gift is a record in the camp
// section's `gifts` (kind, from, hour, seed, taken), kept after it is taken up so the camp page can
// write each gift with the creature that left it. A gift that goes to the gift spot (a sowing.json
// gift: the minnows' pondweed seeds, the turtles' reed raft) stays off the spot while it lies on the
// stone (giftItems' `waiting`). Other systems leave their own (the hen's tail feather) through
// `camp:gift-leave`; taking one up says `camp:gift-taken` for its owner to act on.

/**
 * @typedef {{ kind: string, from: string | null, hour: number, seed: number, taken: number | null, name?: string }} Gift
 *   kind: a sowing.json gift id ('pondweed', 'raft') or another system's own kind; from: the creature
 *   (a journal species id) or null; hour: when it was laid; taken: when it was taken up, or null while
 *   it lies on the stone; name: its words when the camp's words have none for its kind
 */

/** Is the gift stone made and standing in its slot? @param {any} camp the camp section */
export const hasGiftStone = (camp) => (camp?.slots ?? []).some((/** @type {any} */ s) => s.slot === 'gift');

/** A saved (or missing) gifts list made safe. @param {any} v @returns {Gift[]} */
export function cleanGifts(v) {
  /** @type {Gift[]} */ const out = [];
  for (const g of Array.isArray(v) ? v : []) {
    if (!g || typeof g.kind !== 'string' || !g.kind) continue;
    /** @type {Gift} */ const r = { kind: g.kind, from: typeof g.from === 'string' ? g.from : null, hour: Number.isFinite(g.hour) ? g.hour : 0,
      seed: (Number(g.seed) >>> 0), taken: Number.isFinite(g.taken) ? g.taken : null };
    if (typeof g.name === 'string' && g.name) r.name = g.name;
    out.push(r);
  }
  return out;
}

/** The gifts lying on the stone now, with their index in the list. @param {Gift[]} gifts */
export const lying = (gifts) => gifts.map((g, i) => ({ ...g, i })).filter((g) => g.taken === null);

/**
 * A gift laid on the stone. Each kind from each creature is laid once, ever.
 * @param {Gift[]} gifts @param {{ kind: string, from?: string | null, hour: number, seed: number, name?: string }} g
 * @returns {Gift[] | null} the new list, or null when it was laid before
 */
export function leaveGift(gifts, g) {
  const from = g.from ?? null;
  if (gifts.some((q) => q.kind === g.kind && q.from === from)) return null;
  return [...gifts, { kind: g.kind, from, hour: g.hour, seed: g.seed >>> 0, taken: null, ...(g.name ? { name: g.name } : {}) }];
}

/** A gift taken up off the stone. @param {Gift[]} gifts @param {number} i @param {number} hour @returns {Gift[] | null} null when it was not lying there */
export function takeGift(gifts, i, hour) {
  if (!gifts[i] || gifts[i].taken !== null) return null;
  return gifts.map((g, j) => (j === i ? { ...g, taken: hour } : g));
}

/** The sowing.json gift ids still lying on the stone (kept off the gift spot). @param {Gift[]} gifts @param {any} sowing recipes/world/sowing.json */
export function waitingIds(gifts, sowing) {
  const ids = new Set((sowing?.gifts ?? []).map((/** @type {any} */ g) => g.id));
  return lying(gifts).map((g) => g.kind).filter((k) => ids.has(k));
}

/** The same, from the camp section as saved (the store slice `camp`). @param {any} camp @param {any} sowing */
export const stoneWaiting = (camp, sowing) => waitingIds(cleanGifts(camp?.gifts), sowing);

/**
 * Which gift-spot gift a species' grant gives (src/world/expansion.js `due`), by its unlock path:
 * { seeds: { pondweed: true } } is 'seeds.pondweed', the pondweed gift; { raft: true } the raft. A
 * tool gift (the Cliff tool, springs) gives nothing to carry, so null: it comes as it does today.
 * @param {{ kind: string, give: Record<string, any> }} grant @param {any} sowing recipes/world/sowing.json
 * @returns {string | null}
 */
export function stoneGiftFor(grant, sowing) {
  if (grant?.kind !== 'gift') return null;
  /** @type {string[]} */ const paths = [];
  for (const [k, v] of Object.entries(grant.give ?? {})) {
    if (v && typeof v === 'object') for (const [k2, v2] of Object.entries(v)) { if (v2) paths.push(`${k}.${k2}`); } else if (v) paths.push(k);
  }
  return (sowing?.gifts ?? []).find((/** @type {any} */ g) => paths.includes(g.unlock))?.id ?? null;
}
