// @ts-check
// The walker's pack (docs/future/13, sections 4.1 and 4.5): what the save keeps of it and the rules
// of its pouches. Pure. One kind per pouch, three handfuls to a full pouch. The pack keeps one normal
// form: for each kind every pouch is full except at most one, and pouches sort by group, then by the
// order of recipes/world/pack.json `kinds` (kinds.js), so the same pouches always save the same way.
// Empty pouches are not saved; the size says how many lie flat at the end of the row. The walker
// wears one carrier at a time (P2f, Matt, October 26, 2026: they replace, never stack): the starting
// pack, or a made one (the rush satchel, the willow basket), each two pouches more than the one
// before; the one taken off hangs at camp. When it is full, a handful may be laid as a small heap at
// the walker's feet, which the island takes back at the next dawn.
//
// The store slice `pack` holds a Pack, saved as the `pack` section (format 9).

/**
 * @typedef {import('./kinds.js').Kinds} Kinds
 * @typedef {[string, number]} Pouch kind id, handfuls 1..3
 * @typedef {[string, number, number, number, number]} Heap kind id, x, z, game day, handfuls
 * @typedef {{ version: 1, carriers: string[], worn?: string, pouches: Pouch[], heaps: Heap[], holding: null | 'pot' }} Pack
 *   carriers: the carriers made; worn: the one on your back (left out: the starting pack, so a save from before P2f reads the same)
 */

const FULL = 3;
const HEAP_CAP = 6;

/** The handfuls a full pouch holds. @param {any} [recipe] */
const fullOf = (recipe) => (Number.isInteger(recipe?.handfulsPerPouch) && recipe.handfulsPerPouch > 0 ? recipe.handfulsPerPouch : FULL);

/** A new walker's pack: six flat pouches, no carriers, no heaps. @returns {Pack} */
export const emptyPack = () => ({ version: 1, carriers: [], pouches: [], heaps: [], holding: null });

/**
 * How many pouches a carrier has: the starting pack (null) startPouches, each carrier in the
 * recipe's order two more than the one before (the satchel 8, the basket 10, the frame 12).
 * @param {string | null} id @param {any} recipe
 */
export function pouchesOf(id, recipe) {
  const start = Number.isInteger(recipe?.startPouches) ? recipe.startPouches : 6;
  const per = Number.isInteger(recipe?.perCarrier) ? recipe.perCarrier : 2;
  const order = Array.isArray(recipe?.carriers) ? recipe.carriers : [];
  return start + per * (id === null ? 0 : order.indexOf(id) + 1);
}

/**
 * How many pouches the pack has: the carrier worn's.
 * @param {Pack} pack @param {any} recipe
 */
export const sizeOf = (pack, recipe) => pouchesOf(pack.worn ?? null, recipe);

/** Every handful of one kind in the pack. @param {Pack} pack @param {string} kind */
export function handfulsOf(pack, kind) {
  let n = 0;
  for (const [k, h] of pack.pouches) if (k === kind) n += h;
  return n;
}

/** True when the pack holds at least n handfuls of a kind. @param {Pack} pack @param {string} kind @param {number} [n] */
export const has = (pack, kind, n = 1) => handfulsOf(pack, kind) >= n;

/**
 * Pouches in normal form: each kind's handfuls in full pouches and at most one part-filled one,
 * sorted by group then kind order.
 * @param {Pouch[]} pouches @param {Kinds | null} kinds @param {number} [full]
 * @returns {Pouch[]}
 */
function formPouches(pouches, kinds, full = FULL) {
  /** @type {Map<string, number>} */
  const totals = new Map();
  for (const [k, h] of pouches) if (h > 0) totals.set(k, (totals.get(k) ?? 0) + h);
  const ids = [...totals.keys()].sort(kinds ? kinds.compare : (a, b) => (a < b ? -1 : a > b ? 1 : 0));
  /** @type {Pouch[]} */
  const out = [];
  for (const id of ids) {
    let left = /** @type {number} */ (totals.get(id));
    while (left > 0) { const h = Math.min(full, left); out.push([id, h]); left -= h; }
  }
  return out;
}

/** A copy of a pack with its own arrays. @param {Pack} pack @returns {Pack} */
const copy = (pack) => ({ version: 1, carriers: pack.carriers.slice(), ...(pack.worn ? { worn: pack.worn } : {}), pouches: pack.pouches.map((p) => /** @type {Pouch} */ ([p[0], p[1]])),
  heaps: pack.heaps.map((h) => /** @type {Heap} */ (/** @type {unknown} */ (h.slice()))), holding: pack.holding });

/**
 * The pack in normal form: part-filled pouches of a kind merged, then sorted.
 * @param {Pack} pack @param {Kinds} kinds @param {any} [recipe] @returns {Pack}
 */
export function normalize(pack, kinds, recipe) {
  return { ...copy(pack), pouches: formPouches(pack.pouches, kinds, fullOf(recipe)) };
}

/**
 * Adds up to n handfuls of a kind. A handful tops up the kind's part-filled pouch first, else opens
 * a flat pouch if one is free. What finds no room is `left`.
 * @param {Pack} pack @param {string} kind @param {number} n @param {Kinds} kinds @param {any} recipe
 * @returns {{ pack: Pack, added: number, left: number }}
 */
export function add(pack, kind, n, kinds, recipe) {
  const want = Math.max(0, Math.floor(n));
  const full = fullOf(recipe);
  const total = handfulsOf(pack, kind);
  const own = pack.pouches.filter((p) => p[0] === kind).length;
  const others = pack.pouches.length - own;
  const may = Math.max(own, sizeOf(pack, recipe) - others);
  const added = Math.min(want, Math.max(0, may * full - total));
  if (added === 0) return { pack: normalize(pack, kinds, recipe), added: 0, left: want };
  const pouches = [...pack.pouches.filter((p) => p[0] !== kind), /** @type {Pouch} */ ([kind, total + added])];
  return { pack: { ...copy(pack), pouches: formPouches(pouches, kinds, full) }, added, left: want - added };
}

/**
 * Takes up to n handfuls of a kind out of the pack.
 * @param {Pack} pack @param {string} kind @param {number} n @param {Kinds} kinds @param {any} [recipe]
 * @returns {{ pack: Pack, taken: number }}
 */
export function take(pack, kind, n, kinds, recipe) {
  const total = handfulsOf(pack, kind);
  const taken = Math.min(total, Math.max(0, Math.floor(n)));
  const pouches = [...pack.pouches.filter((p) => p[0] !== kind), /** @type {Pouch} */ ([kind, total - taken])];
  return { pack: { ...copy(pack), pouches: formPouches(pouches, kinds, fullOf(recipe)) }, taken };
}

/**
 * True when the pack holds every handful a need asks for. A key is a kind id or a group name (a
 * group counts every kind in it): { fuel: 1, stones: 2 }.
 * @param {Pack} pack @param {Record<string, number>} need @param {Kinds} kinds
 */
export function packHolds(pack, need, kinds) {
  for (const [key, n] of Object.entries(need)) {
    let got = 0;
    if (kinds.groups.includes(key)) { for (const [k, h] of pack.pouches) if (kinds.groupOf(k) === key) got += h; }
    else got = handfulsOf(pack, key);
    if (got < n) return false;
  }
  return true;
}

/** A made carrier, added once, and put on. @param {Pack} pack @param {string} id @returns {Pack} */
export function addCarrier(pack, id) {
  const out = copy(pack);
  if (!out.carriers.includes(id)) out.carriers.push(id);
  out.worn = id;
  return out;
}

/**
 * Put on another carrier (null: the starting pack), one that is made. It fits only if what the pack
 * holds goes into its pouches; a smaller one never drops anything. ok: worn now.
 * @param {Pack} pack @param {string | null} id @param {any} recipe @returns {{ pack: Pack, ok: boolean }}
 */
export function wear(pack, id, recipe) {
  if (id !== null && !pack.carriers.includes(id)) return { pack: copy(pack), ok: false };
  if (pack.pouches.length > pouchesOf(id, recipe)) return { pack: copy(pack), ok: false };
  const out = copy(pack);
  if (id === null) delete out.worn; else out.worn = id;
  return { pack: out, ok: true };
}

/**
 * Takes the whole pouch at sorted index i out of the pack (Set down, Empty).
 * @param {Pack} pack @param {number} i @returns {{ pack: Pack, kind: string | null, handfuls: number }}
 */
export function removePouch(pack, i) {
  const p = pack.pouches[i];
  if (!p) return { pack: copy(pack), kind: null, handfuls: 0 };
  const out = copy(pack);
  out.pouches.splice(i, 1);
  return { pack: out, kind: p[0], handfuls: p[1] };
}

/**
 * Lays a small heap at the walker's feet (K-21). Past the cap, the oldest heap goes.
 * @param {Pack} pack @param {string} kind @param {number} x @param {number} z @param {number} day game day
 * @param {number} handfuls @param {number} [cap] @returns {Pack}
 */
export function addHeap(pack, kind, x, z, day, handfuls, cap = HEAP_CAP) {
  const out = copy(pack);
  out.heaps.push([kind, x, z, day, handfuls]);
  while (out.heaps.length > Math.max(0, cap)) out.heaps.shift();
  return out;
}

/**
 * Takes up to n handfuls back from the heap at index i; an emptied heap is gone.
 * @param {Pack} pack @param {number} i @param {number} n @returns {{ pack: Pack, kind: string | null, taken: number }}
 */
export function takeFromHeap(pack, i, n) {
  const h = pack.heaps[i];
  if (!h) return { pack: copy(pack), kind: null, taken: 0 };
  const taken = Math.min(h[4], Math.max(0, Math.floor(n)));
  const out = copy(pack);
  if (h[4] - taken > 0) out.heaps[i][4] = h[4] - taken;
  else out.heaps.splice(i, 1);
  return { pack: out, kind: h[0], taken };
}

/**
 * Heaps from an earlier game day go at the first dawn after their day.
 * @param {Pack} pack @param {number} today game day index @returns {Pack}
 */
export function expireHeaps(pack, today) {
  const out = copy(pack);
  out.heaps = out.heaps.filter((h) => h[3] >= today);
  return out;
}

/**
 * A pack read from a save (or anything else): handfuls clamped to 0..3 (empty pouches dropped),
 * unknown kinds kept as they are (they sort last), heaps capped, then normal form. A save holding
 * more pouches than the pack's size keeps them all. Unreadable input is a new pack.
 * @param {any} v @param {Kinds} [kinds] @param {any} [recipe] @returns {Pack}
 */
export function cleanPack(v, kinds, recipe) {
  if (!v || typeof v !== 'object' || !Array.isArray(v.pouches)) return emptyPack();
  const full = fullOf(recipe);
  const carriers = (Array.isArray(v.carriers) ? v.carriers : [])
    .filter((/** @type {any} */ c, /** @type {number} */ i, /** @type {any[]} */ a) => typeof c === 'string' && a.indexOf(c) === i);
  /** @type {Pouch[]} */
  const pouches = v.pouches
    .filter((/** @type {any} */ p) => Array.isArray(p) && typeof p[0] === 'string' && Number.isFinite(p[1]))
    .map((/** @type {any} */ p) => /** @type {Pouch} */ ([p[0], Math.max(0, Math.min(full, Math.floor(p[1])))]))
    .filter((/** @type {Pouch} */ p) => p[1] > 0);
  const cap = Number.isInteger(recipe?.heaps?.cap) ? recipe.heaps.cap : HEAP_CAP;
  /** @type {Heap[]} */
  const heaps = (Array.isArray(v.heaps) ? v.heaps : [])
    .filter((/** @type {any} */ h) => Array.isArray(h) && typeof h[0] === 'string' && Number.isFinite(h[1]) && Number.isFinite(h[2])
      && Number.isInteger(h[3]) && Number.isFinite(h[4]) && h[4] > 0)
    .map((/** @type {any} */ h) => /** @type {Heap} */ ([h[0], h[1], h[2], h[3], Math.floor(h[4])]))
    .slice(-Math.max(1, cap));
  // A pack from before P2f wore nothing made: the starting pack.
  const worn = typeof v.worn === 'string' && carriers.includes(v.worn) ? { worn: v.worn } : {};
  return { version: 1, carriers, ...worn, pouches: formPouches(pouches, kinds ?? null, full), heaps: cap > 0 ? heaps : [], holding: v.holding === 'pot' ? 'pot' : null };
}
