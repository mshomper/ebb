// @ts-check
// Things the walker carries on a bone (P2f: the rush satchel at the hip, the willow basket on the
// pack's spring): where a point of the rest model is as the bone holds it, and the bone's turn with
// the thing's own, as a camp prop's yaw, pitch and roll (prop-draw.wgsl: roll about z, then pitch
// about x, then the yaw). A bone folded small (the baked pack, hidden while another carrier is worn)
// still carries at full size: only its turn is read. Pure.

const DEG = Math.PI / 180;

/** a * b, 3 by 3, rows. @param {number[][]} a @param {number[][]} b */
const mul3 = (a, b) => a.map((r) => [0, 1, 2].map((c) => r[0] * b[0][c] + r[1] * b[1][c] + r[2] * b[2][c]));
/** @param {number} a */
const ry = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
/** @param {number} a */
const rx = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
/** @param {number} a */
const rz = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];

/**
 * A turn as a prop's yaw, pitch and roll: m = Ry(yaw) Rx(pitch) Rz(roll). @param {number[][]} m rows
 * @returns {{ yaw: number, pitch: number, roll: number }}
 */
export function propAngles(m) {
  const pitch = Math.asin(Math.max(-1, Math.min(1, -m[1][2])));
  return { yaw: Math.atan2(m[0][2], m[2][2]), pitch, roll: Math.atan2(m[1][0], m[1][1]) };
}

/**
 * Where a thing carried on a bone sits now, from the walker's feet, in world meters, and how it is
 * turned. @param {Float32Array} bones the posed matrices (16 floats a bone, column-major, body m)
 * @param {number} i the bone @param {number[]} pivot its rest pivot @param {number[]} at the thing's
 * origin in rest model meters @param {number[]} turnDeg the thing's own pitch, yaw and roll on the bone
 * @param {number} yaw the figure's facing @param {number} k body.displayScale
 * @returns {{ dx: number, dy: number, dz: number, yaw: number, pitch: number, roll: number }}
 */
export function carriedOn(bones, i, pivot, at, turnDeg, yaw, k) {
  const m = bones.subarray(i * 16, i * 16 + 16);
  const p = [0, 1, 2].map((r) => m[r] * pivot[0] + m[4 + r] * pivot[1] + m[8 + r] * pivot[2] + m[12 + r]);
  // The bone's turn alone: each column brought back to unit length.
  const col = [0, 1, 2].map((c) => { const v = [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]], l = Math.hypot(...v) || 1; return v.map((x) => x / l); });
  const R = [0, 1, 2].map((r) => [col[0][r], col[1][r], col[2][r]]);
  const d = [at[0] - pivot[0], at[1] - pivot[1], at[2] - pivot[2]];
  const b = [0, 1, 2].map((r) => (p[r] + R[r][0] * d[0] + R[r][1] * d[1] + R[r][2] * d[2]) * k);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const [tp, ty, tr] = turnDeg.map((v) => v * DEG);
  const W = mul3(ry(yaw), mul3(R, mul3(ry(ty), mul3(rx(tp), rz(tr)))));
  return { dx: c * b[0] + s * b[2], dy: b[1], dz: -s * b[0] + c * b[2], ...propAngles(W) };
}

/**
 * The triangles of one part of the figure (the pack, to hang at camp while another carrier is worn),
 * as indices into the whole mesh's vertices. @param {Uint32Array} indices @param {Uint8Array | number[]} partOf
 * each vertex's part id @param {number} part @returns {Uint32Array}
 */
export function partIndices(indices, partOf, part) {
  const out = [];
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    if (partOf[a] === part && partOf[b] === part && partOf[c] === part) out.push(a, b, c);
  }
  return Uint32Array.from(out);
}
