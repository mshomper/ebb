// @ts-check
// The hearth and the clay pieces, pure (docs/future/13 sections 3.12, 4.1 K-26 and 6.5; S4, S5): the
// hearth stones in the ring's middle hold one pot at a time (the hearth's slot record names it); each
// fired pot, and the cup, has its own slot at the ring's side and waits there when it is not on the
// hearth. A pot's water rides on its own record. Shaped pieces wait pale on the workbench (its
// record's `shaped`) until they are laid at the fire. All of it is camp slot records (model.js), so
// it rides in the save's camp section with no format bump. The pot in your arms is pack.holding
// 'pot': the hearth's pot, taken up; it goes back on the hearth as it is.

/**
 * @typedef {null | 'fresh' | 'sea'} Water
 * @typedef {{ stonesTopM: number, slots: Record<string, string>, pots: string[] }} HearthRecipe recipes/world/camp.json hearth
 */

const WATERS = ['fresh', 'sea'];

/**
 * A saved slot record's hearth and clay fields made safe, onto its clean record r.
 * @param {any} s the saved record @param {import('./model.js').SlotRecord} r @returns {import('./model.js').SlotRecord}
 */
export function cleanPieceFields(s, r) {
  if (s.kind === 'hearth-stones') r.pot = typeof s.pot === 'string' ? s.pot : null;
  if (s.water !== undefined) r.water = WATERS.includes(s.water) ? s.water : null;
  if (s.kind === 'workbench') r.shaped = Array.isArray(s.shaped) ? s.shaped.filter((/** @type {any} */ k) => typeof k === 'string') : [];
  return r;
}

/** @param {import('./model.js').Camp} c @param {string} slot */
const rec = (c, slot) => c.slots.find((s) => s.slot === slot) ?? null;
/** One slot record's fields changed. @param {import('./model.js').Camp} c @param {string} slot @param {Record<string, any>} f */
const patch = (c, slot, f) => ({ ...c, slots: c.slots.map((s) => (s.slot === slot ? { ...s, ...f } : s)) });

/** The hearth stones stand? @param {import('./model.js').Camp} c */
export const hearthBuilt = (c) => !!rec(c, 'hearth');

/** The pot on the hearth (a kind), or null. @param {import('./model.js').Camp} c */
export const potOnHearth = (c) => rec(c, 'hearth')?.pot ?? null;

/** A fired piece's own record (a pot, the cup), by its kind, or null. @param {import('./model.js').Camp} c @param {string} kind */
export const pieceOf = (c, kind) => c.slots.find((s) => s.kind === kind && s.slot !== 'hearth') ?? null;

/** The pots that are fired and stand at the camp, in the recipe's order. @param {import('./model.js').Camp} c @param {HearthRecipe} H */
export const potsMade = (c, H) => H.pots.filter((k) => !!pieceOf(c, k));

/**
 * Set a fired pot on the hearth stones (a click on a waiting pot swaps it on); the pot that was there
 * goes back to its own slot. The same camp with no hearth or no such pot.
 * @param {import('./model.js').Camp} c @param {string} kind @returns {import('./model.js').Camp}
 */
export function swapOn(c, kind) {
  if (!hearthBuilt(c) || !pieceOf(c, kind)) return c;
  return patch(c, 'hearth', { pot: kind });
}

/** A pot's water now. @param {import('./model.js').Camp} c @param {string} kind @returns {Water} */
export const waterIn = (c, kind) => /** @type {Water} */ (pieceOf(c, kind)?.water ?? null);

/**
 * A pot filled or poured out. @param {import('./model.js').Camp} c @param {string} kind @param {Water} water
 * @returns {import('./model.js').Camp}
 */
export function setWater(c, kind, water) {
  const r = pieceOf(c, kind);
  return r ? patch(c, r.slot, { water }) : c;
}

/** The pieces waiting pale on the workbench. @param {import('./model.js').Camp} c @returns {string[]} */
export const shapedOn = (c) => rec(c, 'workbench')?.shaped ?? [];

/** A shaped piece laid on the workbench to wait. @param {import('./model.js').Camp} c @param {string} kind */
export const addShaped = (c, kind) => (rec(c, 'workbench') ? patch(c, 'workbench', { shaped: [...shapedOn(c), kind] }) : c);

/** A shaped piece taken off the workbench (laid at the fire). @param {import('./model.js').Camp} c @param {string} kind */
export function takeShaped(c, kind) {
  const s = shapedOn(c), i = s.indexOf(kind);
  return i < 0 ? c : patch(c, 'workbench', { shaped: s.filter((_, j) => j !== i) });
}

/**
 * A fired piece to its place: a pot or the cup into its own slot at the ring's side (the first pot
 * fired onto the empty hearth), with its seed. The same camp if it already stands.
 * @param {import('./model.js').Camp} c @param {string} kind @param {number} hour @param {number} seed
 * @param {HearthRecipe} H @returns {import('./model.js').Camp}
 */
export function placeFired(c, kind, hour, seed, H) {
  const slot = H.slots[kind];
  if (!slot || pieceOf(c, kind)) return c;
  let out = { ...c, slots: [...c.slots, { slot, kind, seed: seed >>> 0, placedHour: hour, ...(H.pots.includes(kind) ? { water: null } : {}) }] };
  if (H.pots.includes(kind) && hearthBuilt(out) && !potOnHearth(out)) out = patch(out, 'hearth', { pot: kind });
  return out;
}

/**
 * The water within reach of a point, for Fill (K-26): 'fresh' for running or slow water or a pool
 * a spring feeds (the spring's pool, its stream, a rill led past camp), 'sea' for the sea, 'still'
 * for standing water no spring feeds, else null. Fresh before sea, sea before still. Off the
 * summary's rect is open sea. Pure.
 * @param {{ rect: { x: number, y: number, w: number, h: number }, cls: Uint8Array, basin?: Uint16Array, basinSource?: Uint8Array }} s the water summary
 * @param {number} x @param {number} z @param {number} reachM
 * @param {{ cellOf: (m: number) => number, cellM: number, fresh: number[], sea: number, still: number, spring: number, seaFill: boolean }} W
 *   cellOf: a world meter to its water cell; fresh: the classes that fill fresh (running, slow); sea,
 *   still: their classes; spring: the basin source a spring is; seaFill: the sea fills the pot
 * @returns {null | 'fresh' | 'sea' | 'still'}
 */
export function waterHere(s, x, z, reachM, W) {
  const n = Math.ceil(reachM / W.cellM);
  const ci = W.cellOf(x) - s.rect.x, cj = W.cellOf(z) - s.rect.y;
  let sea = false, still = false;
  for (let dj = -n; dj <= n; dj++) {
    for (let di = -n; di <= n; di++) {
      if ((di * di + dj * dj) * W.cellM * W.cellM > reachM * reachM) continue;
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= s.rect.w || j >= s.rect.h) { sea = true; continue; }
      const k = j * s.rect.w + i, c = s.cls[k];
      if (W.fresh.includes(c)) return 'fresh';
      if (c === W.still) {
        if (s.basin && s.basinSource && s.basinSource[s.basin[k]] === W.spring) return 'fresh';
        still = true;
      }
      if (c === W.sea) sea = true;
    }
  }
  return sea && W.seaFill ? 'sea' : still ? 'still' : null;
}

/**
 * The hearth stones made: set in the ring's middle, with the first pot already fired on them.
 * @param {import('./model.js').Camp} c @param {number} hour @param {number} seed @param {HearthRecipe} H
 * @returns {import('./model.js').Camp}
 */
export function setHearth(c, hour, seed, H) {
  if (hearthBuilt(c)) return c;
  return { ...c, slots: [...c.slots, { slot: 'hearth', kind: 'hearth-stones', seed: seed >>> 0, placedHour: hour, pot: potsMade(c, H)[0] ?? null }] };
}
