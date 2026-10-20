// @ts-check
// Placed pieces (doc 09, docs/future/10): objects that rest on the ground rather than being part of
// it, as the Stone brush's boulders are. The first is the loose stone, the naturalist's reward at six
// finds (doc 13): a small rounded stone you can set with Sculpt's Loose stone mode and tap to lift.
// Records are all the save keeps (section `pieces`, doc 18); meshes are baked from the recipe on
// load (meshes.js). Pure and deterministic; the live side is index.js.
//
// A record: { id, kind: 'stone', x, z, yaw, seed, size, placedHour }. size is the stone's length in
// meters; seed picks its shape and size; placedHour is the game hour it was set or came. A log
// (driftwood carried off the strandline, the turtles' gift) is { id, kind: 'log', x, z, yaw, seed,
// size, length, placedHour }: size is its thickness and length its length, in meters; seed picks its
// shape (the strand log it was, so it is drawn the same and never washes up twice).

import { hash32, det } from '../../core/rng.js';
import { WATER_CLASS } from '../water/summary.js';
import { waterCellCenter } from '../water/grid.js';
import { groundOfCell } from '../water/shore.js';

/**
 * @typedef {{ id: string, kind: 'stone' | 'log', x: number, z: number, yaw: number, seed: number, size: number, length?: number, placedHour: number }} Piece
 *   length: a log's length (m); stones have none
 * @typedef {{ version: number, list: Piece[], nextId: number, arrived: boolean }} PiecesState
 *   nextId: the number the next piece's id takes; arrived: the reward's stones have come (once per island)
 */

/** Kinds of piece this build knows. */
export const PIECE_KINDS = ['stone', 'log'];

/** How many pieces of a kind a list holds. @param {Piece[]} list @param {string} kind */
export const countKind = (list, kind) => list.reduce((n, p) => n + (p.kind === kind ? 1 : 0), 0);
/** Painted ground channels, as terrain/brushes.js LAYER_INDEX. */
const GROUNDS = ['grass', 'sand', 'rock', 'soil'];
const TAU = 2 * det.PI;

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/** @returns {PiecesState} */
export const emptyPieces = () => ({ version: 1, list: [], nextId: 1, arrived: false });

/** The number in an id like 'p12' (0 if none). @param {string} id */
const idNumber = (id) => Number.parseInt(String(id).slice(1), 10) || 0;

/**
 * A saved `pieces` section made safe: anything missing or unreadable restores to empty, and a
 * record with a bad field is left out (it was a piece this build cannot draw).
 * @param {any} v @returns {PiecesState}
 */
export function cleanPieces(v) {
  if (!v || typeof v !== 'object' || !Array.isArray(v.list)) return emptyPieces();
  const fin = (/** @type {any} */ n) => typeof n === 'number' && Number.isFinite(n);
  /** @type {Set<string>} */ const ids = new Set();
  /** @type {Piece[]} */ const list = [];
  for (const r of v.list) {
    if (!r || !PIECE_KINDS.includes(r.kind) || typeof r.id !== 'string' || ids.has(r.id)) continue;
    if (!fin(r.x) || !fin(r.z) || !fin(r.yaw) || !fin(r.size) || !(r.size > 0) || !fin(r.seed)) continue;
    if (r.kind === 'log' && !(fin(r.length) && r.length > 0)) continue;
    ids.add(r.id);
    // In the order makeStone and makeLog write them, so a record comes back exactly.
    list.push({ id: r.id, kind: r.kind, x: r.x, z: r.z, yaw: r.yaw, seed: r.seed >>> 0, size: r.size,
      ...(r.kind === 'log' ? { length: r.length } : {}), placedHour: fin(r.placedHour) ? r.placedHour : 0 });
  }
  const after = list.reduce((m, r) => Math.max(m, idNumber(r.id) + 1), 1);
  return { version: 1, list, nextId: Math.max(Number.isInteger(v.nextId) ? v.nextId : 1, after), arrived: !!v.arrived };
}

/**
 * A new loose stone: its shape, size and turn from a seed of the island's piece seed and its number.
 * @param {number} piecesSeed subSeed(worldSeed, 'pieces') @param {number} n its number (the id is p<n>)
 * @param {number} x @param {number} z @param {number} hour @param {any} recipe pieces.json
 * @returns {Piece}
 */
export function makeStone(piecesSeed, n, x, z, hour, recipe) {
  const seed = hash32(piecesSeed, n);
  const [lo, hi] = recipe.sizeM;
  return { id: `p${n}`, kind: 'stone', x, z, yaw: u01(hash32(seed, 1)) * TAU, seed, size: lo + (hi - lo) * u01(hash32(seed, 2)), placedHour: hour };
}

/**
 * A log carried off the strandline, now kept: its shape, size and turn are the strand log's.
 * @param {number} n its number (the id is p<n>) @param {{ x: number, z: number, yaw: number, seed: number, size: number, length: number }} log
 * @param {number} hour @returns {Piece}
 */
export function makeLog(n, log, hour) {
  return { id: `p${n}`, kind: 'log', x: log.x, z: log.z, yaw: log.yaw, seed: log.seed >>> 0, size: log.size, length: log.length, placedHour: hour };
}

/**
 * The pieces with one more, or null when that kind is at its cap (stones and logs are capped
 * apart). Pure: a new state.
 * @param {PiecesState} s @param {Piece} p @param {number} cap
 * @returns {PiecesState | null}
 */
export function addPiece(s, p, cap) {
  if (countKind(s.list, p.kind) >= cap) return null;
  return { ...s, list: [...s.list, p], nextId: Math.max(s.nextId, idNumber(p.id) + 1) };
}

/**
 * The pieces with one moved to a new spot (carried and set down). Pure.
 * @param {PiecesState} s @param {string} id @param {number} x @param {number} z
 * @returns {PiecesState}
 */
export function movePiece(s, id, x, z) {
  return { ...s, list: s.list.map((p) => (p.id === id ? { ...p, x, z } : p)) };
}

/**
 * The pieces without one. Pure. @param {PiecesState} s @param {string} id
 * @returns {{ state: PiecesState, removed: Piece | null }}
 */
export function removePiece(s, id) {
  const removed = s.list.find((p) => p.id === id) ?? null;
  return { state: removed ? { ...s, list: s.list.filter((p) => p.id !== id) } : s, removed };
}

/**
 * How far a ground point is from a piece: from a stone's middle, or from the nearest point on a
 * log's line, end to end. @param {{ x: number, z: number, yaw: number, kind: string, length?: number }} p
 * @param {number} x @param {number} z
 */
export function pieceDistance(p, x, z) {
  const dx = x - p.x, dz = z - p.z;
  if (p.kind !== 'log') return Math.hypot(dx, dz);
  // A log lies along its own z, which its yaw turns to (sin yaw, cos yaw) (piece-draw.wgsl turn).
  const ax = Math.sin(p.yaw), az = Math.cos(p.yaw), half = (p.length ?? 0) / 2;
  const t = Math.max(-half, Math.min(half, dx * ax + dz * az));
  return Math.hypot(dx - ax * t, dz - az * t);
}

/**
 * The piece nearest a ground point, if a tap there would pick it: within r, or within about half
 * a stone's length (a log's half thickness and logReach: a tap on a low log's top lands on the
 * ground behind it), whichever is more.
 * @template {{ x: number, z: number, yaw: number, kind: string, size: number, length?: number }} T
 * @param {T[]} list @param {number} x @param {number} z @param {number} r @param {number} [logReach]
 * @returns {T | null}
 */
export function pieceAt(list, x, z, r, logReach = 0) {
  let best = null, bestD = Infinity;
  for (const p of list) {
    const d = pieceDistance(p, x, z);
    const reach = p.kind === 'log' ? p.size * 0.5 + logReach : p.size * 0.55;
    if (d <= Math.max(r, reach) && d < bestD) { bestD = d; best = p; }
  }
  return best;
}

/**
 * Where the reward's stones come by themselves: on painted grass or soil a few meters from fresh
 * water (a pond or a stream, never the sea or a damp hollow), never in water, on gentle ground, apart
 * from each other and from any piece already there. Which cells is decided by a seeded hash of each
 * cell's place in the world, so the same seed and the same land give the same stones, live or in
 * catch-up. Pure.
 * @param {{ seed: number, summary: { rect: {x:number,y:number,w:number,h:number}, cls: Uint8Array, band: Uint8Array, basin: Uint16Array, shore?: Uint8Array },
 *   material: Uint8Array | null, ground?: (x: number, z: number) => number, recipe: any, hour: number, nextId: number, existing?: Piece[] }} p
 *   seed: subSeed(worldSeed, 'pieces'); material: the painted ground (768 x 768 x 4), null to skip that test;
 *   ground: terrain height, for the slope test (left out: flat)
 * @returns {Piece[]}
 */
export function arrivingStones(p) {
  const { summary: s, recipe } = p;
  const A = recipe.arrive;
  const R = s.rect, n = R.w * R.h;
  if (!n) return [];
  // Fresh water: still or moving water off the tide band, in no hollow the sea reaches.
  const tidal = new Set();
  for (let k = 0; k < n; k++) if (s.basin[k] && s.band[k]) tidal.add(s.basin[k]);
  const C = WATER_CLASS;
  // Distance from fresh water by a two-pass chamfer (2 a side step of 0.5 m, 3 a diagonal), in quarter meters.
  const far = 0xffff, d = new Uint16Array(n).fill(far);
  for (let k = 0; k < n; k++) {
    const c = s.cls[k];
    if ((c === C.still || c === C.slow || c === C.running) && !s.band[k] && !(s.basin[k] && tidal.has(s.basin[k]))) d[k] = 0;
  }
  const at = (/** @type {number} */ i, /** @type {number} */ j) => (i < 0 || j < 0 || i >= R.w || j >= R.h ? far : d[j * R.w + i]);
  for (let j = 0; j < R.h; j++) for (let i = 0; i < R.w; i++) {
    const k = j * R.w + i;
    d[k] = Math.min(d[k], at(i - 1, j) + 2, at(i - 1, j - 1) + 3, at(i, j - 1) + 2, at(i + 1, j - 1) + 3);
  }
  for (let j = R.h - 1; j >= 0; j--) for (let i = R.w - 1; i >= 0; i--) {
    const k = j * R.w + i;
    d[k] = Math.min(d[k], at(i + 1, j) + 2, at(i + 1, j + 1) + 3, at(i, j + 1) + 2, at(i - 1, j + 1) + 3);
  }
  const lo = Math.round(A.nearM[0] * 4), hi = Math.round(A.nearM[1] * 4);
  const grounds = (A.grounds ?? ['grass', 'soil']).map((/** @type {string} */ g) => GROUNDS.indexOf(g));
  const ground = p.ground ?? (() => 0);
  /** @type {{ k: number, h: number, x: number, z: number }[]} */ const cand = [];
  for (let j = 0; j < R.h; j++) for (let i = 0; i < R.w; i++) {
    const k = j * R.w + i, c = s.cls[k];
    if ((c !== C.dry && c !== C.damp) || s.band[k] || s.shore?.[k] || d[k] < lo || d[k] > hi) continue;
    const gx = R.x + i, gz = R.y + j;
    if (p.material && !grounds.includes(groundOfCell(p.material, gx, gz))) continue;
    const h = hash32(p.seed, gx, gz, 0x570e);
    // Somewhere in the cell, not always its middle.
    const x = waterCellCenter(gx) + (u01(hash32(h, 1)) - 0.5) * 0.4, z = waterCellCenter(gz) + (u01(hash32(h, 2)) - 0.5) * 0.4;
    const y0 = ground(x, z);
    const slope = Math.max(Math.abs(ground(x + 0.5, z) - ground(x - 0.5, z)), Math.abs(ground(x, z + 0.5) - ground(x, z - 0.5)));
    if (!(slope <= A.maxSlope) || !Number.isFinite(y0)) continue;
    cand.push({ k, h, x, z });
  }
  cand.sort((a, b) => a.h - b.h || a.k - b.k);
  /** @type {Piece[]} */ const out = [];
  const taken = [...(p.existing ?? [])].map((q) => [q.x, q.z]);
  const room = Math.min(A.count, recipe.cap - countKind(p.existing ?? [], 'stone'));
  // Squared distances: plain arithmetic is the same on every device (rng.js), Math.hypot may not be.
  const apart = A.spacingM * A.spacingM;
  for (const c of cand) {
    if (out.length >= room) break;
    if (taken.some(([x, z]) => (x - c.x) * (x - c.x) + (z - c.z) * (z - c.z) < apart)) continue;
    out.push(makeStone(p.seed, p.nextId + out.length, c.x, c.z, p.hour, recipe));
    taken.push([c.x, c.z]);
  }
  return out;
}

/**
 * How far a lifted stone is tipped (radians), e seconds after the tap: up over tipS (easing out),
 * held for holdS, back down over settleS (easing in and out); 0 before and after.
 * @param {number} e @param {{ tipDeg: number, tipS: number, holdS: number, settleS: number }} T pieces.json tip
 */
export function tipAngle(e, T) {
  let f = 0;
  if (e < 0) f = 0;
  else if (e < T.tipS) { const k = 1 - e / T.tipS; f = 1 - k * k * k; }
  else if (e < T.tipS + T.holdS) f = 1;
  else if (e < T.tipS + T.holdS + T.settleS) { const k = (e - T.tipS - T.holdS) / T.settleS; f = 1 - k * k * (3 - 2 * k); }
  return (f * T.tipDeg * Math.PI) / 180;
}

/** Is a lift over? @param {number} e @param {{ tipS: number, holdS: number, settleS: number }} T */
export const tipDone = (e, T) => e >= T.tipS + T.holdS + T.settleS;

/**
 * The bone a stone's mesh is drawn with (mesh units, column-major 4 x 4): set sinkH into the ground,
 * and tipped by angle about its far edge, so the edge toward dir (a unit horizontal direction in the
 * mesh's own frame, toward the eye) rises and its underside turns toward you. The far edge's point
 * on the ground line stays put. (The draw pass then scales by the stone's length, turns it by its yaw
 * and moves it to its spot; creature-draw.wgsl.)
 * @param {number} angle radians @param {number} sinkH mesh units @param {number[]} dir [x, z] @param {number} reach half the footprint along dir, mesh units
 * @returns {Float32Array}
 */
export function stoneBone(angle, sinkH, dir, reach) {
  const c = Math.cos(angle), s = Math.sin(angle);
  // Axis: dir x up, so dir turns toward up.
  const kx = -dir[1], kz = dir[0];
  const r00 = c + (1 - c) * kx * kx, r01 = -s * kz, r02 = (1 - c) * kx * kz;
  const r10 = s * kz, r11 = c, r12 = -s * kx;
  const r20 = (1 - c) * kx * kz, r21 = s * kx, r22 = c + (1 - c) * kz * kz;
  // The pivot: the far edge, on the ground line.
  const px = -dir[0] * reach, py = sinkH, pz = -dir[1] * reach;
  const tx = px - (r00 * px + r01 * py + r02 * pz);
  const ty = py - (r10 * px + r11 * py + r12 * pz) - sinkH;
  const tz = pz - (r20 * px + r21 * py + r22 * pz);
  return new Float32Array([r00, r10, r20, 0, r01, r11, r21, 0, r02, r12, r22, 0, tx, ty, tz, 1]);
}

/**
 * A turn that leans a stone with the ground (column-major 4 x 4, about its middle on the ground
 * line): from upright toward the ground's normal by share of the way. a, b: the ground's rise along
 * the stone's own x and z. @param {number} a @param {number} b @param {number} share 0 level .. 1 flat on the slope
 * @returns {Float32Array}
 */
export function leanBone(a, b, share) {
  const l = Math.hypot(a, 1, b), nx = -a / l, ny = 1 / l, nz = -b / l;
  const kl = Math.hypot(nz, nx);
  if (kl < 1e-9 || share <= 0) return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  // Axis up x n; the angle a share of the way from up to n.
  const kx = nz / kl, kz = -nx / kl, t = Math.acos(Math.min(1, ny)) * share, c = Math.cos(t), s = Math.sin(t);
  return new Float32Array([
    c + (1 - c) * kx * kx, s * kz, (1 - c) * kx * kz, 0,
    -s * kz, c, s * kx, 0,
    (1 - c) * kx * kz, -s * kx, c + (1 - c) * kz * kz, 0,
    0, 0, 0, 1]);
}

/**
 * The bone a log's mesh is drawn with (column-major 4 x 4). The mesh is 1 long along z and 1 thick
 * (meshes.js logShapes): squeezed across to the log's thickness over its length (a), set sinkShare
 * of its thickness into the ground, and rolled by angle about its own length toward side (+1 or -1,
 * along its x), moving over as a log rolls so the ground under it shows.
 * @param {number} angle radians @param {number} side @param {number} a thickness over length @param {number} sinkShare
 * @returns {Float32Array}
 */
export function logBone(angle, side, a, sinkShare) {
  const r = a / 2, phi = -side * angle, c = Math.cos(phi), s = Math.sin(phi);
  // Squeeze, then turn about the axis through the middle (0, r) and roll over by side angle r.
  const tx = r * s + side * angle * r, ty = r - r * c - a * sinkShare;
  return new Float32Array([c * a, s * a, 0, 0, -s * a, c * a, 0, 0, 0, 0, 1, 0, tx, ty, 0, 1]);
}

/** Two column-major 4 x 4 matrices composed: a first, then b (b x a). @param {Float32Array} b @param {Float32Array} a */
export function mul4(b, a) {
  const o = new Float32Array(16);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += b[k * 4 + row] * a[col * 4 + k];
    o[col * 4 + row] = s;
  }
  return o;
}
