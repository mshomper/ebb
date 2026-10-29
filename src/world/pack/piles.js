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
 * 'stick-pale' or 'stone'), how far it has built up, and its footprint across in meters (the piece
 * record's size, which a tap and the grass clear go by). A pile builds up piece by piece at its real
 * size (pile-pieces.js): stage 0, 1 and 2 are the small, good and big heap, stage 3 the full pile
 * (all its handfuls); a K-21 heap is stage 'heap', its bottom few pieces. A kind the look does not
 * list wears otherModel ('heap': a mound in its own colour).
 * @param {string} kind @param {number} handfuls @param {any} recipe pack.json @param {boolean} [heap]
 * @returns {{ model: string, stage: number | 'heap', scale: number, size: number }}
 */
export function pileShape(kind, handfuls, recipe, heap = false) {
  const L = recipe?.piles?.look ?? {};
  const model = L.models?.[kind] ?? L.otherModel ?? 'stick';
  const base = model === 'stick-pale' ? 'stick' : model;
  const full = recipe?.piles?.handfuls ?? 12;
  const stage = heap ? 'heap' : handfuls >= full ? 3 : pileLook(handfuls, recipe);
  // otherModel 'heap' (October 29, 2026): a soft mound in the kind's own colour, scaled by stage.
  if (model === 'heap') {
    const H = L.heap ?? {}, scale = stage === 'heap' ? H.heapScale ?? 0.4 : H.stageScales?.[stage] ?? 1;
    return { model, stage, scale, size: 2 * Math.max(H.radiiM?.[0] ?? 0.3, H.radiiM?.[2] ?? 0.3) * scale };
  }
  return { model, stage, scale: 1, size: L.footprintM?.[base] ?? (base === 'stone' ? 1.0 : 1.2) };
}

/**
 * Where a set-down pouch of this kind goes: its own pile's slot, its preferred slot if free, else
 * the first free heap slot; or why it cannot be piled.
 * @param {string} kind @param {Pile[]} piles the camp's piles @param {Slot[]} slots
 * @param {import('./kinds.js').Kinds} kinds @param {boolean} [noHeaps] the heap slots are retired (a
 *   hamper stands at camp, P2j): only a kind's own store takes it @returns {SlotPick}
 */
export function slotFor(kind, piles, slots, kinds, noHeaps = false) {
  const camp = kinds.campOf(kind);
  if (REFUSE[camp]) return { refuse: REFUSE[camp] };
  const live = piles.filter((p) => p.handfuls > 0);
  const own = live.find((p) => p.holds === kind && slots.some((s) => s.id === p.slot));
  if (own) return { slot: own.slot };
  const taken = new Set(live.map((p) => p.slot));
  if (camp !== 'heap' && slots.some((s) => s.id === camp) && !taken.has(camp)) return { slot: camp };
  const heap = noHeaps ? null : slots.find((s) => /^heap\d+$/.test(s.id) && !taken.has(s.id));
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

// ---- the drying rack (S2): herbs hang in bunches, one kind a bunch, and dry by the clock ----

/** @typedef {[string, number, number][]} Bunches one [kind, handfuls, hour hung] per bunch, in the order hung */

/** Saved bunches made safe. @param {any} v @returns {Bunches} */
export function cleanBunches(v) {
  /** @type {Bunches} */ const out = [];
  for (const b of Array.isArray(v) ? v : []) {
    if (Array.isArray(b) && typeof b[0] === 'string' && Number.isInteger(b[1]) && b[1] > 0 && Number.isFinite(b[2])) out.push([b[0], b[1], b[2]]);
  }
  return out;
}

/**
 * Hang handfuls of a herb: onto a bunch of the same kind hung the same game day while it has room
 * (perBunch), then as new bunches while the rack has places (most). What does not fit stays out.
 * @param {Bunches} bunches @param {string} kind @param {number} n @param {number} hour
 * @param {number} perBunch @param {number} most @returns {{ bunches: Bunches, moved: number }}
 */
export function hang(bunches, kind, n, hour, perBunch, most) {
  /** @type {Bunches} */ const out = bunches.map(([k, h, at]) => [k, h, at]);
  const day = Math.floor(hour / 24);
  let left = Math.max(0, Math.floor(n));
  for (const b of out) if (left > 0 && b[0] === kind && Math.floor(b[2] / 24) === day && b[1] < perBunch) { const m = Math.min(left, perBunch - b[1]); b[1] += m; left -= m; }
  while (left > 0 && out.length < most) { const m = Math.min(left, perBunch); out.push([kind, m, hour]); left -= m; }
  return { bunches: out, moved: Math.max(0, Math.floor(n)) - left };
}

/** How dry a bunch is now, 0 just hung to 1 dry, over dryDays game days. @param {number} hung @param {number} now @param {number} dryDays */
export const dryShare = (hung, now, dryDays) => Math.max(0, Math.min(1, (now - hung) / Math.max(1e-6, dryDays * 24)));

/** A bunch's word: "Hung today. Still green.", "Drying." or "Dry and crisp." @param {number} share @param {any} W pack.json words.rack */
export const rackWord = (share, W) => (share >= 1 ? W.dry : share < 1 / 3 ? W.fresh : W.drying);

/**
 * Take a bunch down (Take up on the rack): up to max handfuls; an empty bunch is gone.
 * @param {Bunches} bunches @param {number} i @param {number} max @returns {{ bunches: Bunches, kind: string | null, taken: number }}
 */
export function takeBunch(bunches, i, max) {
  const b = bunches[i];
  if (!b) return { bunches, kind: null, taken: 0 };
  const taken = Math.max(0, Math.min(b[1], max));
  const out = bunches.map(([k, h, at], j) => /** @type {[string, number, number]} */ ([k, j === i ? h - taken : h, at])).filter(([, h]) => h > 0);
  return { bunches: out, kind: b[0], taken };
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
