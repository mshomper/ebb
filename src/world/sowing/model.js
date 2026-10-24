// @ts-check
// Planting on foot (D1a; Matt, October 24, 2026): what the seed tin and the gift spot hold, and how
// a tossed seed flies. Pure: no store, no DOM (src/world/sowing/index.js wires it).
//
// The seed tin holds the endless seeds (recipes/world/sowing.json tin.endless) and, later, the
// gathered seed pouches (D1b): each an item sown the same way. The gift spot holds what a species'
// gift left to place, a recipe count of each, less those placed (saved in the unlocks' `earned.placed`).

/**
 * @typedef {{ kind: 'seed', id: string, species: string, icon: string, endless: boolean, left: number }} TinItem
 *   left: Infinity for an endless seed, else how many sowings the pouch has
 * @typedef {{ kind: 'gift', id: string, place: 'plant' | 'raft', species: string | null, icon: string, left: number }} GiftItem
 * @typedef {{ kind: 'net', id: 'net' }} NetItem
 * @typedef {TinItem | GiftItem | NetItem} HandItem
 */

/**
 * The seed tin's items: the endless seeds, then any gathered pouches (D1b's hook: { species, left }
 * from the satchel; none yet).
 * @param {any} R recipes/world/sowing.json @param {{ species: string, left: number }[]} [gathered]
 * @returns {TinItem[]}
 */
export function tinItems(R, gathered = []) {
  /** @type {TinItem[]} */ const out = R.tin.endless.map((/** @type {string} */ sp) => ({ kind: 'seed', id: sp, species: sp, icon: sp, endless: true, left: Infinity }));
  for (const g of gathered) {
    if (!(g.left > 0) || R.tin.endless.includes(g.species)) continue;
    out.push({ kind: 'seed', id: `pouch:${g.species}`, species: g.species, icon: g.species, endless: false, left: g.left });
  }
  return out;
}

/** Is a species one of the tin's endless seeds? @param {any} R @param {string} sp */
export const isEndless = (R, sp) => R.tin.endless.includes(sp);

/** A value at a dotted path in an object ('seeds.pondweed'). @param {any} o @param {string} path */
const at = (o, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), o);

/**
 * The gift spot's items: each gift the unlocks give, with how many are left to place (none left,
 * none shown).
 * @param {any} R recipes/world/sowing.json @param {any} unlocks the live unlocks (test links too);
 *   `earned.placed` counts what was placed
 * @returns {GiftItem[]}
 */
export function giftItems(R, unlocks) {
  const placed = unlocks?.earned?.placed ?? {};
  /** @type {GiftItem[]} */ const out = [];
  for (const g of R.gifts) {
    if (!at(unlocks, g.unlock)) continue;
    const left = g.count - (placed[g.id] ?? 0);
    if (left > 0) out.push({ kind: 'gift', id: g.id, place: g.place, species: g.species ?? null, icon: g.icon, left });
  }
  return out;
}

/**
 * The saved unlocks with one more of a gift placed, for good. Pure: a new object.
 * @param {Record<string, any>} earned @param {string} id
 */
export function notePlaced(earned, id) {
  const placed = earned?.placed ?? {};
  return { ...(earned ?? {}), placed: { ...placed, [id]: (placed[id] ?? 0) + 1 } };
}

/**
 * A toss from the hand to a ground point: near (a short drop) or far (an arc), how high its top
 * rises over the straight line and how long it flies.
 * @param {ArrayLike<number>} from the hand (x, y, z) @param {ArrayLike<number>} to the ground (x, y, z)
 * @param {any} T recipes/world/sowing.json toss
 * @returns {{ near: boolean, distM: number, riseM: number, s: number }}
 */
export function tossPlan(from, to, T) {
  const distM = Math.hypot(to[0] - from[0], to[2] - from[2]);
  const near = distM <= T.nearM;
  if (near) return { near, distM, riseM: 0.05, s: T.nearS };
  const riseM = Math.min(T.arcMaxM, Math.max(T.arcMinM, distM * T.arcRise));
  const s = Math.min(T.flightS[1], Math.max(T.flightS[0], distM * T.flightPerM));
  return { near, distM, riseM, s };
}

/**
 * Where a tossed seed is k of the way (0..1) along its flight: the straight line from hand to
 * ground, lifted by a parabola that tops out at riseM half way.
 * @param {ArrayLike<number>} from @param {ArrayLike<number>} to @param {{ riseM: number }} plan @param {number} k
 * @returns {[number, number, number]}
 */
export function tossAt(from, to, plan, k) {
  const u = Math.min(1, Math.max(0, k));
  return [from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u + 4 * plan.riseM * u * (1 - u), from[2] + (to[2] - from[2]) * u];
}

/**
 * What a seed does where it lands: a splash on water, a puff of soil on land; rings of splash
 * further out. @param {number} depthM water over the spot @param {boolean} near
 * @param {any} S recipes/world/sowing.json splash
 * @returns {{ kind: 'puff' } | { kind: 'splash', rings: number }}
 */
export function landing(depthM, near, S) {
  return depthM > 0.02 ? { kind: 'splash', rings: near ? S.nearRings : S.farRings } : { kind: 'puff' };
}

/**
 * The item's name and what is left, for its hover label. @param {any} R @param {HandItem} item
 */
export function itemLabel(R, item) {
  const W = R.words;
  const name = W.names[item.kind === 'seed' || item.kind === 'gift' ? (item.kind === 'seed' ? item.species : item.id) : 'net'] ?? item.id;
  if (item.kind === 'net' || (item.kind === 'seed' && item.endless)) return name;
  const n = item.left;
  return (n === 1 ? W.left.one : W.left.many).replace('{name}', name).replace('{n}', String(n));
}

/** Two hand items are the same pick. @param {{ kind: string, id: string } | null} a @param {{ kind: string, id: string } | null} b */
export const samePick = (a, b) => !!a && !!b && a.kind === b.kind && a.id === b.id;
