// @ts-check
// The nets (docs/future/12, piece K6): what the save keeps of them and the rules of the tide they
// fish by. Pure. A net is cast in the shallows of the tide band (ankle deep, or bare wet sand the
// next high tide will cover), fishes through that next high tide, and is ready from the low water
// after it. A full net waits and never spoils: its haul is rolled when it is lifted, from the tide
// it fished (haul.js), so nothing about it is saved but where it is and which tide it was cast for.
// Lifting brings it in: casting is always something the player chooses (Matt, October 21, 2026).
//
// The store slice `nets` holds a NetsState, saved as the `nets` section (format 7).

/**
 * @typedef {{ x: number, z: number, setTide: number }} NetCast where it is staked, and the high
 *   water (its index: hour = setTide * periodH + phaseH) it fishes through
 * @typedef {{ id: number, kind: string, wear: number, at: NetCast | null }} Net wear: K7, unused
 *   yet (0); at: null while the net is in
 * @typedef {{ kind: string, seed: number, hour: number, rarity?: string }} Released a living catch
 *   let go: the first of each kind (its journal page is traced from it) and distinctive ones, which
 *   a later haul may bring back (haul.js); its rarity rebuilds it exactly
 * @typedef {{ version: 1, nets: Net[], released: Released[], nextId: number }} NetsState
 */

/** At most this many released catches are remembered. */
export const RELEASED_CAP = 40;

/** No nets yet. @returns {NetsState} */
export const emptyNets = () => ({ version: 1, nets: [], released: [], nextId: 1 });

/**
 * Nets read from a save (or anything else): what is readable stays, the rest goes.
 * @param {any} s @returns {NetsState}
 */
export function cleanNets(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.nets)) return emptyNets();
  const castOk = (/** @type {any} */ a) => a && Number.isFinite(a.x) && Number.isFinite(a.z) && Number.isInteger(a.setTide);
  const nets = s.nets
    .filter((/** @type {any} */ n) => n && Number.isInteger(n.id) && typeof n.kind === 'string')
    .map((/** @type {any} */ n) => ({ id: n.id, kind: n.kind, wear: Number.isFinite(n.wear) ? n.wear : 0,
      at: castOk(n.at) ? { x: n.at.x, z: n.at.z, setTide: n.at.setTide } : null }));
  const released = (Array.isArray(s.released) ? s.released : [])
    .filter((/** @type {any} */ r) => r && typeof r.kind === 'string' && Number.isInteger(r.seed) && Number.isFinite(r.hour))
    .slice(-RELEASED_CAP)
    .map((/** @type {any} */ r) => (typeof r.rarity === 'string' ? { kind: r.kind, seed: r.seed, hour: r.hour, rarity: r.rarity } : { kind: r.kind, seed: r.seed, hour: r.hour }));
  const top = nets.reduce((/** @type {number} */ m, /** @type {Net} */ n) => Math.max(m, n.id), 0);
  return { version: 1, nets, released, nextId: Math.max(Number.isInteger(s.nextId) ? s.nextId : 1, top + 1) };
}

/**
 * A net of each kind the island has given you (unlocks.nets, e.g. { general: true }), in.
 * @param {NetsState} s @param {Record<string, boolean> | undefined} kinds @returns {NetsState}
 */
export function ensureNets(s, kinds) {
  let out = s;
  for (const [kind, on] of Object.entries(kinds ?? {})) {
    if (!on || out.nets.some((n) => n.kind === kind)) continue;
    out = { ...out, nets: [...out.nets, { id: out.nextId, kind, wear: 0, at: null }], nextId: out.nextId + 1 };
  }
  return out;
}

/**
 * The high water a net cast now fishes through: the next one after now.
 * @param {number} nowH game hours @param {{ periodH: number, phaseH: number }} tide
 */
export function nextHighTide(nowH, tide) {
  return Math.floor((nowH - tide.phaseH) / tide.periodH) + 1;
}

/** The game hour of a high water by its index. @param {number} tideId @param {{ periodH: number, phaseH: number }} tide */
export const highHour = (tideId, tide) => tideId * tide.periodH + tide.phaseH;

/**
 * When a net cast for a high water is ready: the low water after it.
 * @param {number} setTide @param {{ periodH: number, phaseH: number }} tide
 */
export const readyHour = (setTide, tide) => highHour(setTide, tide) + tide.periodH / 2;

/**
 * Where a net stands now: in, fishing (with the hours left), or ready to lift.
 * @param {Net} net @param {number} nowH @param {{ periodH: number, phaseH: number }} tide
 * @returns {{ state: 'in' } | { state: 'fishing', hoursLeft: number } | { state: 'ready' }}
 */
export function netState(net, nowH, tide) {
  if (!net.at) return { state: 'in' };
  const left = readyHour(net.at.setTide, tide) - nowH;
  return left > 0 ? { state: 'fishing', hoursLeft: left } : { state: 'ready' };
}

/**
 * Can a net be cast at a point? In the tide band, under the coming high water by at least coverM,
 * and no deeper than wadeM now. Water off the tide band is fresh (a pond or a stream).
 * @param {{ band: boolean, depth: number, ground: number, nextHighLevel: number }} at
 *   band: the point's water cell is in the tide band; depth: live water depth (m); ground: its
 *   height (m); nextHighLevel: sea level at the next high water (m)
 * @param {{ wadeM: number, coverM: number }} rule recipes/world/nets.json `set`
 * @returns {{ ok: true } | { ok: false, reason: 'fresh' | 'dry' | 'deep' }}
 */
export function canCast(at, rule) {
  if (!at.band) return { ok: false, reason: at.depth > 0.005 ? 'fresh' : 'dry' };
  if (at.ground > at.nextHighLevel - rule.coverM) return { ok: false, reason: 'dry' };
  if (at.depth > rule.wadeM) return { ok: false, reason: 'deep' };
  return { ok: true };
}

/**
 * Cast a net (or move one already out): it fishes the next high water from now.
 * @param {NetsState} s @param {number} id @param {number} x @param {number} z @param {number} nowH
 * @param {{ periodH: number, phaseH: number }} tide @param {{ readyNow?: boolean }} [o] readyNow:
 *   the ?nets test link, where a net fishes the high water just gone and is ready at once
 * @returns {NetsState}
 */
export function cast(s, id, x, z, nowH, tide, o = {}) {
  const setTide = o.readyNow ? Math.floor((nowH - tide.phaseH - tide.periodH / 2) / tide.periodH) : nextHighTide(nowH, tide);
  return { ...s, nets: s.nets.map((n) => (n.id === id ? { ...n, at: { x, z, setTide } } : n)) };
}

/** Bring a net in (after a lift, or with Bring it in). @param {NetsState} s @param {number} id @returns {NetsState} */
export function bringIn(s, id) {
  return { ...s, nets: s.nets.map((n) => (n.id === id ? { ...n, at: null } : n)) };
}

/**
 * Remember a released catch: always the first of its kind, and any distinctive one (rare and
 * up), the oldest forgotten past the cap (never a kind's first).
 * @param {NetsState} s @param {Released} r @param {boolean} distinctive @returns {NetsState}
 */
export function noteReleased(s, r, distinctive) {
  const first = !s.released.some((e) => e.kind === r.kind);
  if (!first && !distinctive) return s;
  if (s.released.some((e) => e.kind === r.kind && e.seed === r.seed)) return s;
  let released = [...s.released, r.rarity ? { kind: r.kind, seed: r.seed, hour: r.hour, rarity: r.rarity } : { kind: r.kind, seed: r.seed, hour: r.hour }];
  while (released.length > RELEASED_CAP) {
    const firsts = new Set();
    const drop = released.findIndex((e) => { const f = !firsts.has(e.kind); firsts.add(e.kind); return !f; });
    released = released.filter((_, i) => i !== (drop < 0 ? 0 : drop));
  }
  return { ...s, released };
}
