// @ts-check
// The lift (F5, Matt, October 23, 2026): a thing the pointer rests on, or whose card is open, is
// lifted a little in its own shader instead of ringed on the ground: a slight warm tint and a thin
// rim of light (src/shaders/lib-lift.wgsl). A ground spot lifts only the things lying in it. The
// first evening's slot glows stay; they mark empty slots, not a choice. Numbers:
// recipes/world/highlight.json.
//
// The API, for every pass that draws things (the creature pass, the pieces pass; the camp's props):
//   liftLook             8 floats for the pass's uniform: tint rgb, tint strength, rim rgb (times
//                        its strength), rim power; liftLookVersion() changes when they do
//   liftAt(group, x, z)  0..1 for one instance this frame, written into a per-instance float
//   liftVersion()        changes whenever any lift may have changed, so a pass rewrites only then
// Groups: 'beings' (creatures, finds, nets, keepsakes), 'piles', 'pickups', 'pieces', 'props'.
// The app sets the targets each frame (setLiftTargets) from the hover tag and the open card
// (liftFor); each eases in over fadeInS and out over fadeOutS.

/** @typedef {'beings' | 'piles' | 'pickups' | 'pieces' | 'props'} LiftGroup */
/** @typedef {{ group: LiftGroup, x: number, z: number, r: number }} LiftTarget */

export const liftLook = new Float32Array(8);
let lookVersion = 0, version = 0;
/** @type {any} */ let R = { fadeInS: 0.18, fadeOutS: 0.35 };
/** Targets by key, with how lifted each is now (0..1) and whether it is still wanted. @type {Map<string, LiftTarget & { v: number, want: boolean }>} */
const live = new Map();

/** The look and timings (recipes/world/highlight.json). @param {any} recipe */
export function setLiftLook(recipe) {
  R = recipe;
  const k = recipe.rimStrength ?? 1;
  liftLook.set([...recipe.tint, recipe.tintStrength, ...recipe.rim.map((/** @type {number} */ c) => c * k), recipe.rimPower]);
  lookVersion++;
}
export const liftLookVersion = () => lookVersion;
export const liftVersion = () => version;

/**
 * This frame's targets; the ones no longer listed fade out. @param {LiftTarget[]} list @param {number} dt real seconds
 */
export function setLiftTargets(list, dt) {
  let changed = false;
  for (const t of live.values()) t.want = false;
  for (const t of list) {
    const key = `${t.group}|${t.x.toFixed(2)}|${t.z.toFixed(2)}`;
    const was = live.get(key);
    if (was) { was.want = true; if (was.r !== t.r) { was.r = t.r; changed = true; } }
    else { live.set(key, { ...t, v: 0, want: true }); changed = true; }
  }
  for (const [key, t] of live) {
    const v = t.want ? Math.min(1, t.v + dt / Math.max(1e-3, R.fadeInS)) : Math.max(0, t.v - dt / Math.max(1e-3, R.fadeOutS));
    if (v !== t.v) { t.v = v; changed = true; }
    if (!t.want && v <= 0) { live.delete(key); changed = true; }
  }
  if (changed) version++;
}

/** How lifted an instance of a group at (x, z) is now, 0..1, eased. @param {LiftGroup} group @param {number} x @param {number} z */
export function liftAt(group, x, z) {
  let best = 0;
  for (const t of live.values()) {
    if (t.group !== group || t.v <= best || (t.x - x) ** 2 + (t.z - z) ** 2 > t.r * t.r) continue;
    best = t.v;
  }
  return best * best * (3 - 2 * best);
}

/**
 * What a card lifts. Pure. A ground spot lifts what lies in it (each spot's pickups, a heap's
 * pieces); a pile its pieces; a log or stone itself; anything else (a creature, a find, a net, a
 * camp prop) whatever stands at its spot. Plants have no lift yet.
 * @param {any} card a card from cardAt, or the store slice `identify`
 * @param {(kind: string) => number} spreadOf how far a spot's pickups lie from its middle (m)
 * @param {any} [H] recipes/world/highlight.json (its match radii)
 * @returns {LiftTarget[]}
 */
export function liftFor(card, spreadOf, H = R) {
  if (!card) return [];
  /** @type {LiftTarget[]} */ const out = [];
  for (const g of card.gathers ?? []) {
    if (g.spot) out.push({ group: 'pickups', x: g.spot.x, z: g.spot.z, r: spreadOf(g.kind) + (H.spotPadM ?? 0.15) });
    else if (g.heap !== undefined) out.push({ group: 'piles', x: g.x, z: g.z, r: H.heapM ?? 0.5 });
  }
  if (out.length || card.ground || card.gathers?.some((/** @type {any} */ g) => g.plant) || !Number.isFinite(card.wx) || !Number.isFinite(card.wz)) return out;
  if (card.pile) out.push({ group: 'piles', x: card.wx, z: card.wz, r: Math.max(card.r ?? 0, H.pileMinM ?? 0.9) });
  else if (card.piece) out.push({ group: 'pieces', x: card.wx, z: card.wz, r: H.pieceMatchM ?? 0.3 });
  else {
    out.push({ group: 'beings', x: card.wx, z: card.wz, r: H.matchM ?? 0.45 });
    out.push({ group: 'props', x: card.wx, z: card.wz, r: Math.max(card.r ?? 0, H.matchM ?? 0.45) });
  }
  return out;
}
