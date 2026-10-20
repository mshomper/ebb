// @ts-check
// Placed pieces (doc 09, docs/future/10): objects that rest on the ground rather than being part of
// it, as the Stone brush's boulders are. The first is the loose stone, the naturalist's reward at six
// finds (doc 13): a small rounded stone you can set with Sculpt's Loose stone mode and tap to lift.
// Records are all the save keeps (section `pieces`, doc 18); meshes are baked from the recipe on
// load (meshes.js). Pure and deterministic; the live side is index.js.
//
// A record: { id, kind: 'stone', x, z, yaw, seed, size, placedHour }. size is the stone's length in
// meters; seed picks its shape and size; placedHour is the game hour it was set or came.

import { hash32, det } from '../../core/rng.js';
import { WATER_CLASS } from '../water/summary.js';
import { waterCellCenter } from '../water/grid.js';
import { groundOfCell } from '../water/shore.js';

/**
 * @typedef {{ id: string, kind: 'stone', x: number, z: number, yaw: number, seed: number, size: number, placedHour: number }} Piece
 * @typedef {{ version: number, list: Piece[], nextId: number, arrived: boolean }} PiecesState
 *   nextId: the number the next piece's id takes; arrived: the reward's stones have come (once per island)
 */

/** Kinds of piece this build knows. Driftwood and logs join later. */
export const PIECE_KINDS = ['stone'];
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
    ids.add(r.id);
    list.push({ id: r.id, kind: r.kind, x: r.x, z: r.z, yaw: r.yaw, seed: r.seed >>> 0, size: r.size, placedHour: fin(r.placedHour) ? r.placedHour : 0 });
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
 * The pieces with one more, or null at the cap. Pure: a new state.
 * @param {PiecesState} s @param {Piece} p @param {number} cap
 * @returns {PiecesState | null}
 */
export function addPiece(s, p, cap) {
  if (s.list.length >= cap) return null;
  return { ...s, list: [...s.list, p], nextId: Math.max(s.nextId, idNumber(p.id) + 1) };
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
 * The piece nearest a ground point, if a tap there would pick it: within r, or within about half
 * its own length, whichever is more.
 * @param {Piece[]} list @param {number} x @param {number} z @param {number} r
 * @returns {Piece | null}
 */
export function pieceAt(list, x, z, r) {
  let best = null, bestD = Infinity;
  for (const p of list) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d <= Math.max(r, p.size * 0.55) && d < bestD) { bestD = d; best = p; }
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
  const room = Math.min(A.count, recipe.cap - (p.existing?.length ?? 0));
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
