// @ts-check
// The Stone brush's boulder (docs/future/10, "Boulders as stamps"): a tap drops a seeded boulder,
// a main stone and sometimes one or two smaller ones against it, made like the spring outcrop's
// stones (landform.js): a rounded, lumpy dome set a little into the ground, painted rock. It is
// part of the heightfield, so it saves with the edited chunk, undoes like any stroke, and is rock
// at once for moss, lichen, wrack and the journal. Pure: it writes into the mirror's arrays and
// returns the cells it touched; terrain/index.js uploads, marks and records the undo.

import { hash32, det } from '../../core/rng.js';
import { makeFbm, fbm } from './landform.js';
import { CELL, WORLD_CELLS, WORLD_ORIGIN, quantize, dequantize, cellCenter } from './grid.js';

/** Hash layer for boulders, apart from the landform's layers. */
const L_BOULDER = 41;

/**
 * @typedef {{ x: number, z: number, h: number, ra: number, rb: number, cp: number, sp: number }} Stone
 * @typedef {{ stones: Stone[], lumps: any, lump: number, sink: number, reach: number }} Boulder
 */

/**
 * A boulder at a ground point. The same seed and point give the same boulder.
 * @param {number} seed terrain seed @param {number} x @param {number} z
 * @param {number} sizeM the main stone's radius (m)
 * @param {any} r terrain.json `stone`
 * @returns {Boulder}
 */
export function makeBoulder(seed, x, z, sizeM, r) {
  const s = hash32(seed >>> 0, L_BOULDER, hash32(Math.round(x * 16), Math.round(z * 16), 7));
  /** @param {number} a @param {number} b */
  const u = (a, b) => (hash32(s, a, b) >>> 8) / 16777216;
  /** @param {number[]} range @param {number} t */
  const lerp = (range, t) => range[0] + (range[1] - range[0]) * t;
  /** @type {Stone[]} */ const stones = [];
  /** @param {number} sx @param {number} sz @param {number} rad @param {number} i */
  const stone = (sx, sz, rad, i) => {
    const aspect = 1 + r.elongate * u(i, 4);
    const phi = u(i, 5) * det.PI;
    stones.push({ x: sx, z: sz, h: rad * lerp(r.heightShare, u(i, 3)), ra: rad * Math.sqrt(aspect), rb: rad / Math.sqrt(aspect),
      cp: det.cos(phi), sp: det.sin(phi) });
  };
  const main = sizeM * lerp([0.85, 1.15], u(1, 2));
  stone(x, z, main, 1);
  // Sometimes one or two smaller stones lean against it, as boulders come to rest in groups.
  const extra = Math.floor(u(2, 1) * (r.companions + 1) * 0.999);
  for (let i = 0; i < extra; i++) {
    const ang = det.PI * 2 * u(10 + i, 1);
    const rad = main * lerp(r.companionShare, u(10 + i, 2));
    const d = (main + rad) * 0.7;
    stone(x + det.cos(ang) * d, z + det.sin(ang) * d, rad, 10 + i);
  }
  const lumps = makeFbm(s, L_BOULDER + 1, { scale: r.lumpScale / Math.max(main, 0.1), octaves: 2 });
  let reach = 0;
  for (const st of stones) reach = Math.max(reach, Math.hypot(st.x - x, st.z - z) + Math.max(st.ra, st.rb) * (1 + r.lump));
  return { stones, lumps, lump: r.lump, sink: r.sinkShare * main, reach };
}

/**
 * Lift the boulder into the mirror and paint it rock. Cells outside `bounds` (open chunks) and
 * where `edge` (0..1 per cell, the open-bounds fade) is 0 are left alone.
 * @param {{ heightQ: Uint16Array, heightF: Float32Array, material: Uint8Array }} mirror
 * @param {Boulder} b @param {number} x @param {number} z
 * @param {{ x: number, y: number, w: number, h: number }} bounds cells
 * @param {(i: number, j: number) => number} [edge]
 * @returns {{ x: number, y: number, w: number, h: number }} the cells written
 */
export function applyBoulder(mirror, b, x, z, bounds, edge = () => 1) {
  const N = WORLD_CELLS;
  const i0 = Math.max(bounds.x, Math.floor((x - b.reach - WORLD_ORIGIN) / CELL));
  const j0 = Math.max(bounds.y, Math.floor((z - b.reach - WORLD_ORIGIN) / CELL));
  const i1 = Math.min(bounds.x + bounds.w, Math.ceil((x + b.reach - WORLD_ORIGIN) / CELL) + 1);
  const j1 = Math.min(bounds.y + bounds.h, Math.ceil((z + b.reach - WORLD_ORIGIN) / CELL) + 1);
  const rect = { x: i0, y: j0, w: Math.max(0, i1 - i0), h: Math.max(0, j1 - j0) };
  for (let j = j0; j < j1; j++) {
    const pz = cellCenter(j);
    for (let i = i0; i < i1; i++) {
      const px = cellCenter(i);
      const lump = 1 + b.lump * fbm(b.lumps, px, pz);
      let lift = 0;
      for (const s of b.stones) {
        const sx = px - s.x, sz = pz - s.z;
        const a = (sx * s.cp + sz * s.sp) / s.ra, c = (sz * s.cp - sx * s.sp) / s.rb;
        const t2 = (a * a + c * c) / (lump * lump);
        if (t2 >= 1) continue;
        const l = s.h * lump * Math.sqrt(1 - t2) - b.sink;
        if (l > lift) lift = l;
      }
      const e = edge(i, j);
      if (!(lift > 0) || !(e > 0)) continue;
      const k = j * N + i;
      const q = quantize(mirror.heightF[k] + lift * e);
      mirror.heightQ[k] = q;
      mirror.heightF[k] = dequantize(q);
      paintRock(mirror.material, k * 4, smootherRock(lift) * e);
    }
  }
  return rect;
}

/** How much of a cell turns to rock for a lift (as landform.js's stones: fully by 3 cm). @param {number} lift */
function smootherRock(lift) {
  const t = Math.min(1, Math.max(0, lift / 0.03));
  return t * t * (3 - 2 * t);
}

/**
 * Blend a cell's four weights (grass, sand, rock, soil) toward rock by `w`, keeping their sum at
 * exactly 255. @param {Uint8Array} m @param {number} at @param {number} w
 */
export function paintRock(m, at, w) {
  const g = m[at] * (1 - w), s = m[at + 1] * (1 - w), so = m[at + 3] * (1 - w);
  const g1 = Math.round(g), s1 = Math.round(s), so1 = Math.round(so);
  m[at] = g1; m[at + 1] = s1; m[at + 3] = so1;
  m[at + 2] = 255 - g1 - s1 - so1;
}
