// @ts-check
// Where a pouch set down at camp goes (docs/future/13 P2j, Matt, October 24, 2026): a kind's own place
// first (a herb to the drying rack; sticks, stones and clay to their store's pile), then the hamper.
// Until a hamper exists the heap slots take what has no place, as before; once it does they retire.
// What fits moves and the rest stays in the pouch, with the line for the place that filled.

/** @typedef {'rack' | 'piles' | 'hamper'} Place */

/**
 * The places to try for a kind, in order. Pure.
 * @param {string} camp the kind's camp place (kinds.campOf: 'sticks', 'stones', 'clay', 'heap',
 *   'rack', 'bowl', 'none' for worms, 'pouch' for seeds and clumps)
 * @param {{ rack: boolean, hamper: boolean }} have what stands at camp now
 * @returns {Place[]}
 */
export function routeOf(camp, have) {
  // Worms dig themselves in: the piles say so. Seed, seed balls and clumps keep in the hamper, one
  // slot a species (P2g G6); with no hamper they wait in the pouch.
  if (camp === 'none') return ['piles'];
  if (camp === 'pouch') return have.hamper ? ['hamper'] : ['piles'];
  const hamper = have.hamper ? /** @type {Place[]} */ (['hamper']) : [];
  // Herbs hang on the rack; with no rack and no hamper, the piles give the rack's reason.
  if (camp === 'rack') return have.rack ? ['rack', ...hamper] : have.hamper ? hamper : ['piles'];
  if (camp === 'bowl' || camp === 'heap') return have.hamper ? hamper : ['piles'];
  return ['piles', ...hamper];
}

/**
 * Set handfuls of a kind down at camp, place by place.
 * @param {string} kind @param {number} n
 * @param {{ campOf: (kind: string) => string,
 *   piles: { setDown: (kind: string, n: number) => { moved: number, refuse?: string, pile?: string | null } },
 *   rack: { here: () => boolean, hang: (kind: string, n: number) => number, at: () => { x: number, z: number } | null },
 *   hamper: { here: () => boolean, put: (kind: string, n: number) => number, at: () => { x: number, z: number } | null } }} k
 * @returns {{ moved: number, refuse?: string, pile: string | null, at: { x: number, z: number } | null, full?: string }}
 *   refuse: why nothing moved (a pack.json words key); full: the line when only some moved
 */
export function setDownAtCamp(kind, n, k) {
  const places = routeOf(k.campOf(kind), { rack: k.rack.here(), hamper: k.hamper.here() });
  let moved = 0, refuse = /** @type {string | undefined} */ (undefined), pile = /** @type {string | null} */ (null);
  let at = /** @type {{ x: number, z: number } | null} */ (null), last = /** @type {Place | null} */ (null);
  for (const p of places) {
    const left = n - moved;
    if (left <= 0) break;
    last = p;
    if (p === 'piles') {
      const r = k.piles.setDown(kind, left);
      if (r.refuse === 'worms') return { moved: r.moved, refuse: 'worms', pile: null, at: null };
      if (r.refuse) refuse = r.refuse;
      moved += r.moved;
      if (r.moved > 0) pile = r.pile ?? null;
    } else if (p === 'rack') {
      const m = k.rack.hang(kind, left);
      if (m > 0 && !at) at = k.rack.at();
      moved += m;
    } else {
      const m = k.hamper.put(kind, left);
      if (m > 0 && !at) at = k.hamper.at();
      moved += m;
    }
  }
  const fullWord = last === 'hamper' ? 'hamperFull' : last === 'rack' ? 'rackFull' : 'pileFull';
  if (moved <= 0) return { moved: 0, refuse: last === 'piles' ? refuse ?? 'noSlot' : fullWord, pile: null, at: null };
  return { moved, pile, at, ...(moved < n ? { full: fullWord } : {}) };
}
