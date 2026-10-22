// @ts-check
// Piles at camp (docs/future/13, section 4.1): the only store. Pure. A pouch set down at camp goes
// onto its kind's pile, one pile per kind, in a fixed slot at the pad's edge. A kind prefers its own
// slot (sticks, stones, clay); if another kind's pile sits there, or the kind has no slot of its own,
// it takes the first free heap slot. Herbs hang on the rack, food sits in bowls, worms dig themselves
// in, and seeds and clumps wait in the pouch, so those are refused here with the reason. A pile holds
// up to twelve handfuls and is drawn small, good or big.
//
// A pile is a piece record { id, kind: 'pile', x, z, yaw, seed, size, placedHour, holds, handfuls, slot }.

/**
 * @typedef {{ id: string, kind: 'pile', x: number, z: number, yaw: number, seed: number, size: number,
 *   placedHour: number, holds: string, handfuls: number, slot: string }} Pile
 * @typedef {{ id: string, x: number, z: number }} Slot a camp pile slot, resolved to world meters
 * @typedef {{ slot: string } | { refuse: 'noRack' | 'noBowl' | 'worms' | 'pouch' | 'noSlot' }} SlotPick
 */

const PILE_CAP = 12;
const LOOKS = [3, 8, 12];

/** Camps that are not a ground pile, and the reason Set down gives instead. */
const REFUSE = /** @type {Record<string, 'noRack' | 'noBowl' | 'worms' | 'pouch'>} */ ({ rack: 'noRack', bowl: 'noBowl', none: 'worms', pouch: 'pouch' });

/**
 * A pile's look step: 0 small (1 to 3), 1 good (4 to 8), 2 big (9 to 12).
 * @param {number} handfuls @param {any} [recipe] @returns {0 | 1 | 2}
 */
export function pileLook(handfuls, recipe) {
  const looks = Array.isArray(recipe?.piles?.looks) ? recipe.piles.looks : LOOKS;
  for (let i = 0; i < 2; i++) if (handfuls <= looks[i]) return /** @type {0 | 1} */ (i);
  return 2;
}

/** The pile card's word: "A small heap.", "A good heap." or "A big heap." @param {number} handfuls @param {any} recipe */
export const pileWord = (handfuls, recipe) => recipe?.words?.pile?.[pileLook(handfuls, recipe)] ?? '';

/**
 * How a pile of a kind is drawn (recipes/world/pack.json piles.look): which model it wears ('stick',
 * 'stick-pale' or 'stone'), its scale at this look step, and its footprint across in meters (the
 * piece record's size, which a tap and the grass clear go by). A kind the look does not list wears
 * the stick pile at its smallest. A K-21 heap (heap true) is the same model, smaller.
 * @param {string} kind @param {number} handfuls @param {any} recipe pack.json @param {boolean} [heap]
 * @returns {{ model: string, scale: number, size: number }}
 */
export function pileShape(kind, handfuls, recipe, heap = false) {
  const L = recipe?.piles?.look ?? {};
  const listed = L.models?.[kind];
  const model = listed ?? L.otherModel ?? 'stick';
  const base = model === 'stick-pale' ? 'stick' : model;
  const scales = Array.isArray(L.scale) ? L.scale : [0.5, 0.7, 0.9];
  const scale = heap ? (L.heapScale ?? 0.3) : listed ? scales[pileLook(handfuls, recipe)] : (L.otherScale ?? scales[0]);
  return { model, scale, size: (L.footprintM?.[base] ?? (base === 'stone' ? 1.0 : 1.2)) * scale };
}

/**
 * Where a set-down pouch of this kind goes: its own pile's slot, its preferred slot if free, else
 * the first free heap slot; or why it cannot be piled.
 * @param {string} kind @param {Pile[]} piles the camp's piles @param {Slot[]} slots
 * @param {import('./kinds.js').Kinds} kinds @returns {SlotPick}
 */
export function slotFor(kind, piles, slots, kinds) {
  const camp = kinds.campOf(kind);
  if (REFUSE[camp]) return { refuse: REFUSE[camp] };
  const live = piles.filter((p) => p.handfuls > 0);
  const own = live.find((p) => p.holds === kind && slots.some((s) => s.id === p.slot));
  if (own) return { slot: own.slot };
  const taken = new Set(live.map((p) => p.slot));
  if (camp !== 'heap' && slots.some((s) => s.id === camp) && !taken.has(camp)) return { slot: camp };
  const heap = slots.find((s) => /^heap\d+$/.test(s.id) && !taken.has(s.id));
  return heap ? { slot: heap.id } : { refuse: 'noSlot' };
}

/**
 * Sets handfuls down onto a pile: what fits moves, the rest stays in the pouch.
 * @param {Pile} pile @param {number} handfuls @param {number} [cap]
 * @returns {{ handfuls: number, moved: number, left: number }} handfuls: the pile's new count
 */
export function setDown(pile, handfuls, cap = PILE_CAP) {
  const have = Math.max(0, pile.handfuls);
  const moved = Math.max(0, Math.min(handfuls, cap - have));
  return { handfuls: have + moved, moved, left: handfuls - moved };
}

/**
 * Takes up to max handfuls off a pile (one pouch's worth for Take up).
 * @param {Pile} pile @param {number} [max] @returns {{ handfuls: number, taken: number }} handfuls: what is left
 */
export function takeUp(pile, max = 3) {
  const have = Math.max(0, pile.handfuls);
  const taken = Math.max(0, Math.min(have, max));
  return { handfuls: have - taken, taken };
}
