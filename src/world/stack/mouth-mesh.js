// @ts-check
// The cave mouth in the stack's foot, on the island (docs/future/19): the island's ground is a
// heightfield and cannot roof a passage, so the porch is cut through to the apron and the roof is
// stones: a capstone across the passage's top, an arch of stones framing its opening (two jambs, the
// arch's ring, the wall above it filled to the capstone), and the dark beyond the arch. Baked in code,
// seeded, drawn in the pieces pass (the stones with the rock scan, the dark plain). Pure.
// Frame: meters from the passage's front at the apron's height, +z out toward the island, x across.

import { hash32 } from '../../core/rng.js';
import { pebbleMesh } from '../pack/pickup-meshes.js';
import { joinMeshes } from '../setpieces/cairn-rules.js';

/** @typedef {import('../pack/pickup-meshes.js').Mesh} Mesh */

/** A seeded share 0..1. @param {number} seed @param {...number} k */
const u01 = (seed, ...k) => (hash32(seed, ...k) >>> 8) / 16777216;

/**
 * The stones: capstone, jambs, the arch's ring and the fill above it.
 * @param {any} S the land recipe's stack block @param {number} seed @param {number[]} col rock albedo (linear)
 * @returns {Mesh}
 */
export function mouthStones(S, seed, col) {
  const P = S.porch, M = S.mouth, hw = M.halfWidthM, top = P.heightM;
  /** @type {{ m: Mesh, dx: number, dy: number, dz: number, yaw: number }[]} */ const parts = [];
  let n = 0;
  /** @param {number} x @param {number} y @param {number} z @param {number[]} r radii */
  const stone = (x, y, z, r) => {
    const i = n++, u = (/** @type {number} */ k) => u01(seed, i, k);
    const k = 0.85 + 0.3 * u(1);
    parts.push({ m: pebbleMesh(hash32(seed, 0x6d, i), [r[0] * k, r[1] * (0.85 + 0.3 * u(2)), r[2]], 0.16, col, 0.02), dx: x, dy: y, dz: z, yaw: (u(3) - 0.5) * 0.5 });
  };
  // The capstone: one great flat stone across the passage, lying on the porch either side.
  stone(0, top - 0.2, -(P.outM + M.backM) / 2 + 0.1, [hw + 0.8, 0.26, (P.outM + M.backM) / 2 + 0.2]);
  // The arch's line: jambs up to the spring, then a half-ellipse to the crown.
  const curve = (/** @type {number} */ x) => M.springM + (M.archM - M.springM) * Math.sqrt(Math.max(0, 1 - (x / hw) ** 2));
  for (const side of [-1, 1]) {
    for (let y = 0.22; y < M.springM; y += 0.42) stone(side * (hw + 0.2), y, -0.12, [0.26, 0.24, 0.32]);
  }
  for (let k = 0; k <= 8; k++) {
    const th = (Math.PI * k) / 8, x = -hw * Math.cos(th), y = M.springM + (M.archM - M.springM) * Math.sin(th);
    stone(x * 1.12, y + 0.12 * Math.sin(th) + 0.04, -0.1, [0.24, 0.2, 0.3]);
  }
  // The wall above the ring, filled to the capstone.
  for (let x = -hw - 0.1; x <= hw + 0.1; x += 0.34) {
    for (let y = curve(Math.min(hw, Math.abs(x))) + 0.32; y < top - 0.05; y += 0.3) stone(x, y, -0.2, [0.22, 0.18, 0.34]);
  }
  return joinMeshes(parts);
}

/**
 * The dark past the arch: the opening's shape a little in, black (lit as anything is, it stays dark).
 * @param {any} S @returns {Mesh}
 */
export function mouthDark(S) {
  const M = S.mouth, hw = M.halfWidthM + 0.05, z = -0.45, c = [0.004, 0.004, 0.005];
  /** @type {number[][]} */ const ring = [[hw, 0], [hw, M.springM]];
  for (let k = 1; k < 12; k++) { const th = (Math.PI * k) / 12; ring.push([hw * Math.cos(th), M.springM + (M.archM + 0.05 - M.springM) * Math.sin(th)]); }
  ring.push([-hw, M.springM], [-hw, 0]);
  const v = [0, M.springM * 0.6, z, 0, 0, 1, ...c], idx = [];
  for (const [x, y] of ring) v.push(x, y, z, 0, 0, 1, ...c);
  for (let i = 1; i < ring.length; i++) idx.push(0, i, i + 1);
  return { vertices: new Float32Array(v), count: v.length / 9, indices: new Uint32Array(idx) };
}
