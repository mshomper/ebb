// @ts-check
// A Hollow floor's plan (H1, the floor maker; doc 16, A floor): from the island seed, the trip
// number, the floor's place in the trip and its level, a small graph of chambers joined by bent
// passages. The way in (with the way up), a main path of fights ending at the way down, and a few
// side chambers (quiet, find, seep). The level picks the depth, with soft edges, and now and then
// the sponge takes the place of the depth's rock. Every number is in recipes/world/hollow.json
// (floors). Pure and deterministic: the same inputs give the same plan.

import { stream, subSeed, det } from '../../core/rng.js';

/** @typedef {'in'|'fight'|'down'|'quiet'|'find'|'seep'} ChamberKind */
/**
 * @typedef {Object} Chamber
 * @property {number} id
 * @property {ChamberKind} kind
 * @property {boolean} main on the main path
 * @property {number} parent the chamber it hangs off (-1 for the way in)
 * @property {number} x centre (m)
 * @property {number} z
 * @property {number} y floor height (m)
 * @property {number} r half its width (m)
 * @property {number} yaw facing (radians), with its cos and sin
 * @property {number} cos
 * @property {number} sin
 * @property {{ x: number, z: number, y: number, to: number }[]} doors where passages meet it
 */
/**
 * @typedef {Object} Passage
 * @property {number} a chamber id
 * @property {number} b chamber id
 * @property {number} r tube radius (m)
 * @property {number[][]} pts the bent polyline [x, y, z] (y the floor there)
 */
/**
 * @typedef {Object} FloorPlan
 * @property {{ seed: number, trip: number, floor: number, level: number, attempt: number }} inputs
 * @property {number} depth 0 wet shelf .. 3 glass halls
 * @property {string} depthId
 * @property {'rock'|'sponge'|'roots'} flavor
 * @property {Chamber[]} chambers
 * @property {Passage[]} passages
 * @property {number} layoutTries how many layouts were started before one fitted
 */

/**
 * Which depth a level falls in: past each border, or inside its soft band with a chance that slides
 * from 0 to 1 across it. @param {number} level @param {any} L recipe floors.level @param {number} u 0..1
 */
export function depthForLevel(level, L, u) {
  let d = 0;
  for (const b of L.borders) {
    const lo = b - L.softLevels, hi = b + L.softLevels;
    if (level >= hi || (level > lo && u < (level - lo) / (hi - lo))) d++;
  }
  return d;
}

/**
 * The share of floors that are root halls. A hook for the later piece: it will follow the island's
 * tree count (doc 16, The root halls). Until then the recipe's share (0) stands.
 * @param {any} F recipe floors @param {{ trees?: number }} [island]
 */
export function rootHallsShare(F, island) { // eslint-disable-line no-unused-vars
  return F.flavors.roots.share;
}

/** Distance from point (px, pz) to segment a-b in plan. */
function segDist(/** @type {number} */ px, /** @type {number} */ pz, /** @type {number[]} */ a, /** @type {number[]} */ b) {
  const bx = b[0] - a[0], bz = b[2] - a[2];
  const l2 = bx * bx + bz * bz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((px - a[0]) * bx + (pz - a[2]) * bz) / l2)) : 0;
  const dx = px - a[0] - bx * t, dz = pz - a[2] - bz * t;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Least distance between two plan segments (they never cross when it is above 0). */
function segSeg(/** @type {number[]} */ a, /** @type {number[]} */ b, /** @type {number[]} */ c, /** @type {number[]} */ d) {
  const cross = (/** @type {number[]} */ o, /** @type {number[]} */ p, /** @type {number[]} */ q) => (p[0] - o[0]) * (q[2] - o[2]) - (p[2] - o[2]) * (q[0] - o[0]);
  const s1 = cross(a, b, c), s2 = cross(a, b, d), s3 = cross(c, d, a), s4 = cross(c, d, b);
  if (((s1 > 0) !== (s2 > 0)) && ((s3 > 0) !== (s4 > 0))) return 0;
  return Math.min(segDist(a[0], a[2], c, d), segDist(b[0], b[2], c, d), segDist(c[0], c[2], a, b), segDist(d[0], d[2], a, b));
}

/**
 * Make a floor's plan.
 * @param {{ seed: number, trip: number, floor: number, level: number, attempt?: number, island?: { trees?: number },
 *   depth?: number, flavor?: 'rock'|'sponge'|'roots' }} inputs
 * @param {any} F recipe floors
 * @returns {FloorPlan}
 */
export function planFloor(inputs, F) {
  const attempt = inputs.attempt ?? 0;
  const root = subSeed(inputs.seed, 'hollow-floor');
  const pick = stream(root, inputs.trip, inputs.floor, attempt, 1);
  const du = pick.next(), fu = pick.next();
  // The cave lab can force a depth or a flavor (inputs.depth, inputs.flavor); the draws still happen.
  const depth = inputs.depth ?? depthForLevel(inputs.level, F.level, du);
  /** @type {'rock'|'sponge'|'roots'} */
  let flavor = 'rock';
  const spongeShare = depth >= F.flavors.sponge.fromDepth ? F.flavors.sponge.share : 0;
  const rootsShare = depth >= F.flavors.roots.fromDepth ? rootHallsShare(F, inputs.island) : 0;
  if (fu < spongeShare) flavor = 'sponge';
  else if (fu < spongeShare + rootsShare) flavor = 'roots';
  if (inputs.flavor) flavor = inputs.flavor;

  // How many chambers: from about total[0] near the top to total[1] deep down.
  const C = F.count;
  const total = Math.round(C.total[0] + (C.total[1] - C.total[0]) * (depth / 3) + pick.range(-C.jitter, C.jitter));
  let side = Math.min(C.side[1], Math.max(C.side[0], Math.round(total * 0.4) - pick.int(2)));
  const main = Math.min(C.main[1], Math.max(C.main[0], total - side));
  side = Math.min(C.side[1], Math.max(C.side[0], total - main));

  // Side kinds: at most one seep, from the dripstone down; the rest quiet or find.
  /** @type {ChamberKind[]} */ const sideKinds = [];
  let seep = depth >= C.seepFromDepth && pick.next() < C.seepShare;
  for (let s = 0; s < side; s++) {
    if (seep) { sideKinds.push('seep'); seep = false; } else sideKinds.push(pick.next() < 0.5 ? 'find' : 'quiet');
  }

  for (let t = 0; t < F.layout.tries; t++) {
    const laid = layout(stream(root, inputs.trip, inputs.floor, attempt, 2, t), F, main, sideKinds, depth);
    if (laid) {
      return { inputs: { seed: inputs.seed, trip: inputs.trip, floor: inputs.floor, level: inputs.level, attempt }, depth, depthId: F.depths[depth].id, flavor, chambers: laid.chambers, passages: laid.passages, layoutTries: t + 1 };
    }
  }
  throw new Error(`hollow plan: no layout fitted after ${F.layout.tries} tries`);
}

/**
 * Lay the chambers out on the plan, or null when one will not fit.
 * @param {import('../../core/rng.js').Stream} s @param {any} F @param {number} main @param {ChamberKind[]} sideKinds @param {number} depth
 * @returns {{ chambers: Chamber[], passages: Passage[] } | null}
 */
function layout(s, F, main, sideKinds, depth) {
  const Lo = F.layout, P = F.passage;
  const DEG = det.PI / 180;
  // Silt chambers are long: their reach along the path is longer than their width.
  const reachShare = depth === 2 ? F.shapes.silt.lengthShare : 1;
  /** @type {Chamber[]} */ const chambers = [];
  /** @type {Passage[]} */ const passages = [];
  const radius = () => s.range(Lo.acrossM[0], Lo.acrossM[1]) / 2;
  /** @param {number} id @param {ChamberKind} kind @param {boolean} isMain @param {number} parent @param {number} x @param {number} z @param {number} y @param {number} r @param {number} yaw */
  const make = (id, kind, isMain, parent, x, z, y, r, yaw) => ({ id, kind, main: isMain, parent, x, z, y, r, yaw, cos: det.cos(yaw), sin: det.sin(yaw), doors: [] });

  /** Does a chamber at (x, z, r) keep clear of every other chamber and passage? @param {number} x @param {number} z @param {number} r @param {number} skip */
  const fits = (x, z, r, skip) => {
    for (const c of chambers) {
      if (c.id === skip) continue;
      const dx = x - c.x, dz = z - c.z;
      if (Math.sqrt(dx * dx + dz * dz) < (r + c.r) * reachShare + Lo.gapM) return false;
    }
    for (const p of passages) for (let i = 1; i < p.pts.length; i++) if (segDist(x, z, p.pts[i - 1], p.pts[i]) < r * reachShare + p.r + P.clearM) return false;
    return true;
  };

  /**
   * Join chamber a to a new chamber at angle `ang`: the passage, bent to one side, and the new chamber.
   * @param {Chamber} a @param {number} ang @param {number} r @param {ChamberKind} kind @param {boolean} isMain @param {number} drift
   */
  const join = (a, ang, r, kind, isMain, drift) => {
    const len = s.range(P.lengthM[0], P.lengthM[1]);
    const dist = (a.r + r) * reachShare + len;
    const dx = det.cos(ang), dz = det.sin(ang);
    const x = a.x + dx * dist, z = a.z + dz * dist;
    if (!fits(x, z, r, a.id)) return null;
    const y = a.y + s.range(-Lo.floorStepM, Lo.floorStepM) - drift;
    // Doors sit well inside each chamber so the tube opens into it; the middle bends aside.
    const da = a.r * reachShare * 0.7, db = r * reachShare * 0.7;
    const p0 = [a.x + dx * da, a.y, a.z + dz * da], p2 = [x - dx * db, y, z - dz * db];
    const bend = s.range(P.bendM[0], P.bendM[1]) * (s.next() < 0.5 ? -1 : 1);
    const p1 = [(p0[0] + p2[0]) / 2 - dz * bend, (a.y + y) / 2, (p0[2] + p2[2]) / 2 + dx * bend];
    const pts = [p0, p1, p2];
    // The tube must miss every other chamber and passage.
    const pr = s.range(P.radiusM[0], P.radiusM[1]);
    for (const c of chambers) {
      if (c.id === a.id) continue;
      for (let i = 1; i < 3; i++) if (segDist(c.x, c.z, pts[i - 1], pts[i]) < c.r * reachShare + pr + P.clearM) return null;
    }
    for (const q of passages) {
      if (q.a === a.id || q.b === a.id) continue;
      for (let i = 1; i < 3; i++) for (let j = 1; j < q.pts.length; j++) if (segSeg(pts[i - 1], pts[i], q.pts[j - 1], q.pts[j]) < pr + q.r + P.clearM) return null;
    }
    const id = chambers.length;
    const yaw = depth === 2 ? ang : s.range(0, 2 * det.PI);
    const c = make(id, kind, isMain, a.id, x, z, y, r, yaw);
    chambers.push(c);
    passages.push({ a: a.id, b: id, r: pr, pts });
    a.doors.push({ x: p0[0], z: p0[2], y: a.y, to: id });
    c.doors.push({ x: p2[0], z: p2[2], y, to: a.id });
    return c;
  };

  // The main path: the way in, fights, the way down, each turned a little off the last.
  let heading = s.range(0, 2 * det.PI);
  chambers.push(make(0, 'in', true, -1, 0, 0, 0, radius(), depth === 2 ? heading : s.range(0, 2 * det.PI)));
  for (let m = 1; m < main; m++) {
    const kind = m === main - 1 ? 'down' : 'fight';
    const r = radius();
    let placed = null;
    for (let t = 0; t < 8 && !placed; t++) {
      const ang = heading + s.range(-Lo.turnDeg, Lo.turnDeg) * DEG;
      placed = join(chambers[m - 1], ang, r, kind, true, Lo.downM);
      if (placed) heading = ang;
    }
    if (!placed) return null;
  }
  // Side chambers hang off the fights (or the way in when there is only one fight).
  const fights = chambers.filter((c) => c.kind === 'fight');
  for (const kind of sideKinds) {
    let placed = null;
    for (let t = 0; t < 12 && !placed; t++) {
      const parent = fights.length ? fights[s.int(fights.length)] : chambers[0];
      placed = join(parent, s.range(0, 2 * det.PI), radius(), kind, false, 0);
    }
    if (!placed) return null;
  }
  return { chambers, passages };
}
