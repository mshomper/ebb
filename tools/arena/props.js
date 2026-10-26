// @ts-check
// Boxes and cylinders as plain coloured triangles for the arena's stage (walker-figure-stage.js
// setProps: 9 floats a vertex, position, normal, colour). Pure.

/**
 * Append a box: centre, half sizes, turned by yaw about +y (as the walker's facing), and colour.
 * @param {number[]} out @param {number[]} c [x, y, z] @param {number[]} h [hx, hy, hz] @param {number} yaw @param {number[]} col
 */
export function pushBox(out, c, h, yaw, col) {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  // A local point to world (+z forward turned by yaw, as solids.js reads it).
  const w = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => [c[0] + cs * x + sn * z, c[1] + y, c[2] - sn * x + cs * z];
  const n = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => [cs * x + sn * z, y, -sn * x + cs * z];
  const faces = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ];
  for (const [f, a, b] of faces) {
    const p = (/** @type {number} */ s, /** @type {number} */ t) => w(
      (f[0] + a[0] * s + b[0] * t) * h[0], (f[1] + a[1] * s + b[1] * t) * h[1], (f[2] + a[2] * s + b[2] * t) * h[2]);
    const nn = n(f[0], f[1], f[2]);
    for (const [s, t] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) out.push(...p(s, t), ...nn, ...col);
  }
}

/**
 * Append an upright cylinder (a stone, a pillar): centre of its base, radius, height, colour.
 * @param {number[]} out @param {number[]} c @param {number} r @param {number} hgt @param {number[]} col
 */
export function pushCylinder(out, c, r, hgt, col, sides = 16) {
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * 2 * Math.PI, a1 = ((i + 1) / sides) * 2 * Math.PI, am = (a0 + a1) / 2;
    const p = (/** @type {number} */ a, /** @type {number} */ y) => [c[0] + Math.sin(a) * r, c[1] + y, c[2] + Math.cos(a) * r];
    const side = [Math.sin(am), 0, Math.cos(am)];
    for (const [a, y] of [[a0, 0], [a1, 0], [a1, hgt], [a0, 0], [a1, hgt], [a0, hgt]]) out.push(...p(a, y), ...side, ...col);
    for (const [a, y] of [[a0, hgt], [a1, hgt]]) out.push(...p(a, y), 0, 1, 0, ...col);
    out.push(c[0], c[1] + hgt, c[2], 0, 1, 0, ...col);
  }
}

/**
 * A flat ring on the ground (the creep zone, a frog's ring), as thin quads following the ground.
 * @param {number[]} out @param {number} x @param {number} z @param {number} r @param {(x: number, z: number) => number} ground @param {number[]} col
 */
export function pushRing(out, x, z, r, ground, col, widthM = 0.05, sides = 48) {
  for (let i = 0; i < sides; i++) {
    const pts = [i, i + 1].flatMap((k) => {
      const a = (k / sides) * 2 * Math.PI, s = Math.sin(a), c = Math.cos(a);
      return [[x + s * (r - widthM), z + c * (r - widthM)], [x + s * (r + widthM), z + c * (r + widthM)]];
    }).map(([px, pz]) => [px, ground(px, pz) + 0.03, pz]);
    for (const k of [0, 1, 3, 0, 3, 2]) out.push(...pts[k], 0, 1, 0, ...col);
  }
}
