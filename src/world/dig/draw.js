// @ts-check
// Drawing a dig (docs/future/13 10.8.1): the spoil heap beside each hole, a low mound of the deepest
// layer's earth baked from blended ellipsoids (as the loose stones are) and drawn plain in the pieces
// pass, shrinking as the hole slumps; the hole's mouth and the darker fresh soil round it as marks for
// the terrain shader (lib-holes.wgsl); and the shovel in the walker's hands while it digs, its shaft
// running from the right hand through the left. Drawing only: plain Math is fine here.

import { hash32 } from '../../core/rng.js';
import { bakeBody } from '../creatures/body-bake.js';

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/**
 * The spoil heaps' meshes, one set of shapes per layer: 1 mesh unit across, base on y = 0, coloured
 * the layer's earth, a little darker where it meets the ground. @param {any} R recipes/world/dig.json
 * @returns {Record<string, { vertices: Float32Array, count: number, indices: Uint32Array }[]>}
 */
export function spoilMeshes(R) {
  const L = R.look, S = L.spoil;
  // Each shape is baked once and coloured per layer (baking per layer cost seconds at start-up).
  const shapes = [];
  for (let i = 0; i < S.shapes; i++) {
    const h = hash32(S.seed, i);
    const r = (/** @type {number} */ k) => u01(hash32(h, k));
    /** @type {any[]} */ const prims = [{ type: 'ellipsoid', c: [0, 0, 0], r: [0.5, 0.2, 0.38], rot: [0, 0, 0], region: 'rock' }];
    // A few clods and lumps blended in, so it reads as dug earth, not a dome.
    for (let l = 0; l < 5; l++) {
      const a = (l / 5 + r(10 + l) * 0.15) * Math.PI * 2;
      prims.push({ type: 'ellipsoid', c: [Math.cos(a) * 0.26, 0.08 + r(20 + l) * 0.08, Math.sin(a) * 0.18],
        r: [0.16 + r(30 + l) * 0.08, 0.08 + r(40 + l) * 0.05, 0.13], rot: [0, r(50 + l) * 90, 0], k: 0.05, region: 'rock' });
    }
    const b = bakeBody({ prims, albedo: { rock: [1, 1, 1], back: [1, 1, 1] } }, S.cellM);
    const V = b.vertices;
    let x0 = Infinity, x1 = -Infinity;
    for (let v = 0; v < b.count; v++) { x0 = Math.min(x0, V[v * 9]); x1 = Math.max(x1, V[v * 9]); }
    // Cut at the ground: only the part above y = 0 shows; fit to 1 unit across.
    const w = x1 - x0;
    const shade = new Float32Array(b.count);
    for (let v = 0; v < b.count; v++) {
      const o = v * 9;
      V[o] /= w; V[o + 2] /= w; V[o + 1] = Math.max(0, V[o + 1]) / w;
      const low = Math.max(0, 1 - V[o + 1] / 0.04);
      shade[v] = (1 - 0.35 * low) * (0.9 + 0.2 * r(60 + (v % 7)));
    }
    shapes.push({ b, shade });
  }
  /** @type {Record<string, any[]>} */ const out = {};
  for (const [layer, col] of Object.entries(L.walls)) {
    out[layer] = shapes.map(({ b, shade }) => {
      const V = b.vertices.slice();
      for (let v = 0; v < b.count; v++) for (let c = 0; c < 3; c++) V[v * 9 + 6 + c] = col[c] * shade[v];
      return { vertices: V, count: b.count, indices: b.indices };
    });
  }
  return out;
}

/**
 * Where a hole's spoil heap lies: beside it on the side the walker's tip threw it (the walker's
 * right as it dug, side 1). @param {any} hole @param {any} R
 */
export function spoilAt(hole, R) {
  const d = R.look.spoil.fromM * (hole.side ?? 1);
  return [hole.x - Math.cos(hole.yaw) * d, hole.z + Math.sin(hole.yaw) * d];
}

/**
 * The spoil heaps as the pieces pass draws them, each shrinking with its hole's stage.
 * @param {{ hole: any, stage: number, fill: number }[]} holes @param {(x: number, z: number) => number} ground @param {any} R
 * @returns {import('../../render/passes/pieces.js').PieceBeing[]}
 */
export function spoilBeings(holes, ground, R) {
  const S = R.look.spoil, out = [];
  for (const { hole, stage, fill } of holes) {
    // From full at the dig to half when slumped to none once settled, eased between.
    const a = S.byStage[Math.min(3, Math.floor(fill))] ?? 0, b = S.byStage[Math.min(3, Math.floor(fill) + 1)] ?? 0;
    const k = stage >= 3 ? 0 : a + (b - a) * (fill - Math.floor(fill));
    if (k < 0.02) continue;
    const [x, z] = spoilAt(hole, R);
    const shape = (hole.seed >>> 0) % S.shapes;
    // The mesh is 1 unit across (sizeM wide when drawn); the bone lowers it as the hole fills.
    const sx = S.sizeM;
    const bone = new Float32Array([1, 0, 0, 0, 0, k, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    out.push({ x, y: ground(x, z), z, yaw: hole.yaw, size: sx, mesh: `spoil-${hole.layer}-${shape}`, bone,
      slope: [0, 0], seed: ((hole.seed >>> 8) / 16777216) * 10, half: [0.5, 0.38], plain: true });
  }
  return out;
}

/**
 * A hole's marks for the terrain shader: [x, z, radius, mouth darkness] and [wall r, g, b, fresh
 * soil darkening]; nearest the view first, at most look.max.
 * @param {{ hole: any, stage: number, fill: number, dark: number }[]} holes @param {number[]} focus [x, z] @param {any} R
 * @returns {Float32Array} 8 floats a hole, look.max holes
 */
export function holeMarks(holes, focus, R) {
  const L = R.look, out = new Float32Array(L.max * 8);
  const near = holes.map((h) => ({ ...h, d: (h.hole.x - focus[0]) ** 2 + (h.hole.z - focus[1]) ** 2 }))
    .filter((h) => h.d < L.nearM * L.nearM).sort((a, b) => a.d - b.d).slice(0, L.max);
  near.forEach((h, i) => {
    const f = h.fill, s = Math.min(3, Math.floor(f));
    const a = L.mouth.byStage[s] ?? 0, b = L.mouth.byStage[Math.min(3, s + 1)] ?? 0;
    const mouth = h.stage >= 3 ? 0 : (a + (b - a) * (f - s)) * L.mouth.dark;
    // A seep pool shows until the hole has slumped.
    const wall = h.hole.seep && f < 1 ? L.fresh.seep : L.walls[h.hole.layer] ?? L.walls.topsoil;
    out.set([h.hole.x, h.hole.z, h.hole.size / 2, mouth, wall[0], wall[1], wall[2], L.fresh.darken * h.dark], i * 8);
  });
  return out;
}

/**
 * The shovel in the walker's hands: its blade end gripM past the right hand, through the left, its
 * shaft (the model's +y) pointing back up from the blade to the handle. Null without both hands.
 * @param {{ x: number, y: number, z: number } | null} r @param {{ x: number, y: number, z: number } | null} l
 * @param {any} A recipes/world/dig.json act
 * @returns {{ key: string, x: number, y: number, z: number, yaw: number, pitch: number, scale: number } | null}
 */
export function shovelProp(r, l, A) {
  if (!r || !l) return null;
  let dx = l.x - r.x, dy = l.y - r.y, dz = l.z - r.z;
  const n = Math.hypot(dx, dy, dz);
  if (n < 1e-4) return null;
  dx /= n; dy /= n; dz /= n;
  const g = A.gripM * (A.scale ?? 1);
  // The shaft's up is back toward the right hand: (-dx, -dy, -dz) = (sin yaw sin pitch, cos pitch, cos yaw sin pitch).
  const pitch = Math.acos(Math.max(-1, Math.min(1, -dy))), yaw = Math.atan2(-dx, -dz);
  return { key: 'shovel', x: r.x + dx * g, y: r.y + dy * g, z: r.z + dz * g, yaw, pitch, scale: A.scale ?? 1 };
}

export { IDENTITY };
