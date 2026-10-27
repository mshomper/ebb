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

/**
 * A flat band on the ground between two radii over an arc (a swing's arc, a curved arrow's body), as
 * thin quads following the ground. yaw: the middle of the arc (+z turned by yaw); arcDeg its width.
 * @param {number[]} out @param {number} x @param {number} z @param {number} r0 @param {number} r1 @param {number} yaw @param {number} arcDeg
 * @param {(x: number, z: number) => number} ground @param {number[]} col
 */
export function pushArc(out, x, z, r0, r1, yaw, arcDeg, ground, col, sides = 24) {
  const half = (arcDeg / 2) * Math.PI / 180;
  for (let i = 0; i < sides; i++) {
    const pts = [i, i + 1].flatMap((k) => {
      const a = yaw - half + (k / sides) * 2 * half, s = Math.sin(a), c = Math.cos(a);
      return [[x + s * r0, z + c * r0], [x + s * r1, z + c * r1]];
    }).map(([px, pz]) => [px, ground(px, pz) + 0.035, pz]);
    for (const k of [0, 1, 3, 0, 3, 2]) out.push(...pts[k], 0, 1, 0, ...col);
  }
}

/**
 * A straight band on the ground from (x0, z0) to (x1, z1), widthM wide (a crack, a beam's lane).
 * @param {number[]} out @param {number} x0 @param {number} z0 @param {number} x1 @param {number} z1 @param {number} widthM
 * @param {(x: number, z: number) => number} ground @param {number[]} col
 */
export function pushLane(out, x0, z0, x1, z1, widthM, ground, col, pieces = 16, lift = 0.035) {
  const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1, nx = (-dz / l) * widthM / 2, nz = (dx / l) * widthM / 2;
  for (let i = 0; i < pieces; i++) {
    const pts = [i, i + 1].flatMap((k) => { const t = k / pieces, px = x0 + dx * t, pz = z0 + dz * t; return [[px - nx, pz - nz], [px + nx, pz + nz]]; })
      .map(([px, pz]) => [px, ground(px, pz) + lift, pz]);
    for (const k of [0, 1, 3, 0, 3, 2]) out.push(...pts[k], 0, 1, 0, ...col);
  }
}

/** A flat disc on the ground (the floor dot). @param {number[]} out @param {number} x @param {number} z @param {number} r @param {(x: number, z: number) => number} ground @param {number[]} col */
export function pushDisc(out, x, z, r, ground, col, sides = 20) {
  const y = ground(x, z) + 0.04;
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * 2 * Math.PI, a1 = ((i + 1) / sides) * 2 * Math.PI;
    out.push(x, y, z, 0, 1, 0, ...col, x + Math.sin(a0) * r, y, z + Math.cos(a0) * r, 0, 1, 0, ...col, x + Math.sin(a1) * r, y, z + Math.cos(a1) * r, 0, 1, 0, ...col);
  }
}

/**
 * A solid's edges as line pairs (a faded wall's outline): a box's twelve edges, or a cylinder's top
 * and foot rings and four uprights. @param {number[]} out @param {{ x: number, z: number, r?: number, hw?: number, hd?: number, yaw?: number, heightM: number }} s
 * @param {number} y its foot @param {number[]} col
 */
export function pushSolidEdges(out, s, y, col, sides = 16) {
  const v = (/** @type {number[]} */ p) => out.push(p[0], p[1], p[2], 0, 1, 0, ...col);
  const seg = (/** @type {number[]} */ a, /** @type {number[]} */ b) => { v(a); v(b); };
  if (s.r !== undefined) {
    const r = /** @type {number} */ (s.r);
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * 2 * Math.PI, a1 = ((i + 1) / sides) * 2 * Math.PI;
      for (const h of [y, y + s.heightM]) seg([s.x + Math.sin(a0) * r, h, s.z + Math.cos(a0) * r], [s.x + Math.sin(a1) * r, h, s.z + Math.cos(a1) * r]);
      if (i % (sides / 4) === 0) seg([s.x + Math.sin(a0) * r, y, s.z + Math.cos(a0) * r], [s.x + Math.sin(a0) * r, y + s.heightM, s.z + Math.cos(a0) * r]);
    }
    return;
  }
  const cs = Math.cos(s.yaw ?? 0), sn = Math.sin(s.yaw ?? 0), hw = s.hw ?? 0, hd = s.hd ?? 0;
  const c = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, lz]) => [s.x + cs * lx + sn * lz, s.z - sn * lx + cs * lz]);
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4];
    for (const h of [y, y + s.heightM]) seg([a[0], h, a[1]], [b[0], h, b[1]]);
    seg([a[0], y, a[1]], [a[0], y + s.heightM, a[1]]);
  }
}
