// @ts-check
// A point on a log's surface in the world, and which way the wood faces there (autumn's fungi sit on
// kept logs, src/world/finds/autumn.js). The log's mesh is built ring by ring (meshes.js bakeLog:
// rings along it, `around` vertices round each, vertex j at the angle 2 pi j / around, 0 its right
// flank and pi/2 its top), so a point is read between the four vertices round it, then posed exactly
// as the draw pass poses the mesh (piece-draw.wgsl vsPiece: the bone, the log's length, its yaw, its
// spot). A bowed, tapered, knotted log carries its fungi on the wood itself. Pure.

/**
 * @param {{ vertices: Float32Array }} mesh the log shape's mesh (meshes.js logShapes) @param {number} rings @param {number} around
 * @param {{ bone: Float32Array, size: number, yaw: number, at: number[] }} pose
 *   bone: the log's bone (column-major 4 x 4, index.js logBeing); size: its length (m); at: the
 *   ground under its middle
 * @param {number} t 0..1 along the log, over its rings @param {number} a radians round it
 * @returns {{ p: number[], n: number[] }} the point and the wood's outward normal, in the world
 */
export function logSurface(mesh, rings, around, pose, t, a) {
  const V = mesh.vertices;
  const fn = Math.max(0, Math.min(rings - 1 - 1e-6, t * (rings - 1)));
  const n0 = Math.floor(fn), dn = fn - n0;
  const fa = (((a / (2 * Math.PI)) * around) % around + around) % around;
  const j0 = Math.floor(fa), da = fa - j0, j1 = (j0 + 1) % around;
  /** @type {number[]} */ const p = [0, 0, 0], nm = [0, 0, 0];
  for (const [n, j, w] of /** @type {[number, number, number][]} */ ([[n0, j0, (1 - dn) * (1 - da)], [n0, j1, (1 - dn) * da], [n0 + 1, j0, dn * (1 - da)], [n0 + 1, j1, dn * da]])) {
    const o = (n * around + j) * 9;
    for (let c = 0; c < 3; c++) { p[c] += V[o + c] * w; nm[c] += V[o + 3 + c] * w; }
  }
  const B = pose.bone;
  const posed = [0, 1, 2].map((r) => B[r] * p[0] + B[4 + r] * p[1] + B[8 + r] * p[2] + B[12 + r]);
  // The bone squeezes the log across, so its normals take the inverse squeeze (as the draw pass does).
  const sq = Math.hypot(B[0], B[1], B[2]) || 1;
  const nIn = [nm[0] / (sq * sq), nm[1] / (sq * sq), nm[2]];
  const nPosed = [0, 1, 2].map((r) => B[r] * nIn[0] + B[4 + r] * nIn[1] + B[8 + r] * nIn[2]);
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  /** turn(d, yaw), as piece-draw.wgsl. @param {number[]} d */
  const turn = (d) => [c * d[0] + s * d[2], d[1], -s * d[0] + c * d[2]];
  const w = turn(posed.map((x) => x * pose.size));
  const nw = turn(nPosed), l = Math.hypot(nw[0], nw[1], nw[2]) || 1;
  return { p: [w[0] + pose.at[0], w[1] + pose.at[1], w[2] + pose.at[2]], n: nw.map((x) => x / l) };
}
