// @ts-check
// The boat's stand-in meshes (docs/future/13 section 3.9; recipes/world/boat.json), until Matt's boat
// model: a lofted wooden rowing-boat hull with two thwarts and two oars resting on them, a mooring
// stake, and a rope. Built in meters in the creature pass's layout (position, normal, linear albedo),
// like the nets (src/world/nets/net-mesh.js). The hull lies along local z with its bow at +z, beam
// along x, its keel's lowest point at y = 0. The stake stands on y = 0 (its foot buried below). The
// rope runs from z = 0 to z = 1 along local z (posed by a bone that stretches it from the stake to
// the bow), sagging in local -y by sagM meters. Pure.

/** @typedef {{ vertices: Float32Array, indices: Uint32Array, count: number }} Mesh */

/** A small mesh builder: vertices of 9 floats and triangle indices. */
function builder() {
  /** @type {number[]} */ const V = [];
  /** @type {number[]} */ const I = [];
  const vert = (/** @type {number[]} */ p, /** @type {number[]} */ n, /** @type {number[]} */ c) => { V.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2]); return V.length / 9 - 1; };

  /**
   * A grid of rows x cols points, smooth normals from its faces, turned so that `outward(normal, i, j)`
   * holds at a reference point (i0, j0). @param {number[][][]} P P[i][j] = [x, y, z] @param {number[]} c
   * @param {number[]} ref [i0, j0, sign of the reference normal's y]
   */
  const grid = (P, c, ref) => {
    const rows = P.length, cols = P[0].length;
    const N = P.map((r) => r.map(() => [0, 0, 0]));
    const face = (/** @type {number[]} */ a, /** @type {number[]} */ b, /** @type {number[]} */ d) => {
      const pa = P[a[0]][a[1]], pb = P[b[0]][b[1]], pd = P[d[0]][d[1]];
      const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], e2 = [pd[0] - pa[0], pd[1] - pa[1], pd[2] - pa[2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      for (const q of [a, b, d]) for (let k = 0; k < 3; k++) N[q[0]][q[1]][k] += n[k];
    };
    for (let i = 0; i + 1 < rows; i++) for (let j = 0; j + 1 < cols; j++) {
      face([i, j], [i + 1, j], [i, j + 1]);
      face([i, j + 1], [i + 1, j], [i + 1, j + 1]);
    }
    const flip = Math.sign(N[ref[0]][ref[1]][1]) === Math.sign(ref[2]) ? 1 : -1;
    const base = V.length / 9;
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      // Where every face round a point has closed up (the bow's last row), the reference's way.
      const n = N[i][j], l = Math.hypot(n[0], n[1], n[2]);
      vert(P[i][j], l > 1e-12 ? [flip * n[0] / l, flip * n[1] / l, flip * n[2] / l] : [0, Math.sign(ref[2]), 0], c);
    }
    for (let i = 0; i + 1 < rows; i++) for (let j = 0; j + 1 < cols; j++) {
      const a = base + i * cols + j;
      I.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
    }
  };

  /** A flat fan from a middle point to a closed run of points, all with one normal. */
  const fan = (/** @type {number[]} */ mid, /** @type {number[][]} */ ring, /** @type {number[]} */ n, /** @type {number[]} */ c) => {
    const m = vert(mid, n, c);
    const first = V.length / 9;
    for (const p of ring) vert(p, n, c);
    for (let k = 0; k + 1 < ring.length; k++) I.push(m, first + k, first + k + 1);
  };

  /** An axis-aligned box: centre and half sizes. */
  const box = (/** @type {number[]} */ c0, /** @type {number[]} */ h, /** @type {number[]} */ c) => {
    for (let ax = 0; ax < 3; ax++) for (const s of [-1, 1]) {
      const u = (ax + 1) % 3, w = (ax + 2) % 3;
      const n = [0, 0, 0]; n[ax] = s;
      const base = V.length / 9;
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p = [...c0]; p[ax] += s * h[ax]; p[u] += a * h[u]; p[w] += b * h[w];
        vert(p, n, c);
      }
      I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };

  /** A round rod from a to b (no caps). */
  const tube = (/** @type {number[]} */ a, /** @type {number[]} */ b, /** @type {number} */ r, /** @type {number[]} */ c, sides = 6) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    const t = d.map((x) => x / l);
    const up = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let u = [t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0]];
    const ul = Math.hypot(u[0], u[1], u[2]);
    u = u.map((x) => x / ul);
    const w = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
    const base = V.length / 9;
    for (const p of [a, b]) for (let s = 0; s < sides; s++) {
      const ang = (s / sides) * Math.PI * 2, cs = Math.cos(ang), sn = Math.sin(ang);
      const n = [u[0] * cs + w[0] * sn, u[1] * cs + w[1] * sn, u[2] * cs + w[2] * sn];
      vert([p[0] + n[0] * r, p[1] + n[1] * r, p[2] + n[2] * r], n, c);
    }
    for (let s = 0; s < sides; s++) {
      const s1 = (s + 1) % sides;
      I.push(base + s, base + sides + s, base + s1, base + s1, base + sides + s, base + sides + s1);
    }
  };

  /** @returns {Mesh} */
  const done = () => ({ vertices: new Float32Array(V), indices: new Uint32Array(I), count: V.length / 9 });
  return { grid, fan, box, tube, done };
}

/**
 * The hull's lines at a share u of its length (0 stern, 1 bow): half beam, keel and gunwale heights.
 * @param {any} H recipes/world/boat.json boat.hull @param {number} u
 * @returns {{ z: number, half: number, keel: number, gun: number }}
 */
export function hullLines(H, u) {
  const fore = 0.42;
  const half = u >= fore
    ? (H.beamM / 2) * Math.pow(Math.max(0, 1 - ((u - fore) / (1 - fore)) ** 2), 0.8)
    : (H.beamM / 2) * (1 - (1 - H.transom) * ((fore - u) / fore) ** 2);
  const keel = u > 0.5 ? H.rockerM * ((u - 0.5) / 0.5) ** 2 : H.rockerM * 0.25 * ((0.5 - u) / 0.5) ** 2;
  const gun = H.depthM + (u > 0.4 ? H.sheerM * ((u - 0.4) / 0.6) ** 2 : H.sheerM * 0.3 * ((0.4 - u) / 0.4) ** 2);
  return { z: -H.lengthM / 2 + u * H.lengthM, half, keel, gun };
}

/**
 * The stand-in boat's meshes, and where the rope ties on at the bow (hull-local meters).
 * @param {any} B recipes/world/boat.json boat
 * @returns {{ hull: Mesh, stake: Mesh, rope: Mesh, bow: number[] }}
 */
export function boatMeshes(B) {
  const H = B.hull, C = B.albedo, t = H.plankM;
  const hb = builder();
  const rows = H.stations, cols = H.around;
  /** One surface of the shell: offset inward by `inset` meters (0 the outside). */
  const shell = (/** @type {number} */ inset) => {
    /** @type {number[][][]} */ const P = [];
    for (let i = 0; i <= rows; i++) {
      const L = hullLines(H, i / rows);
      const half = Math.max(0, L.half - inset), keel = L.keel + inset;
      /** @type {number[][]} */ const row = [];
      for (let j = 0; j <= cols; j++) {
        const a = (j / cols - 0.5) * Math.PI, s = Math.sin(a);
        // A round bilge, a little fuller than a circle so the bottom reads flat.
        row.push([half * Math.sign(s) * Math.abs(s) ** 0.7, keel + (L.gun - keel) * (1 - Math.cos(a)), L.z]);
      }
      P.push(row);
    }
    return P;
  };
  const mid = [Math.round(rows * 0.45), Math.round(cols / 2)];
  const outer = shell(0), inner = shell(t);
  hb.grid(outer, C.hull, [mid[0], mid[1], -1]);
  hb.grid(inner, C.inside, [mid[0], mid[1], 1]);
  // The gunwale's top: a strip from the outside's edge to the inside's on each side.
  for (const j of [0, cols]) {
    const P = outer.map((r, i) => [r[j], inner[i][j]]);
    hb.grid(P, C.inside, [mid[0], 0, 1]);
  }
  // The transom: a flat panel across the stern, its outside facing aft and its inside forward.
  const st = hullLines(H, 0);
  hb.fan([0, st.gun, st.z], outer[0], [0, 0, -1], C.hull);
  hb.fan([0, st.gun, st.z + t], inner[0].map((p) => [p[0], p[1], p[2] + t]), [0, 0, 1], C.inside);
  // Thwarts across the inside, and the oars lying along them.
  const T = H.thwarts;
  let seat = 0;
  for (const at of T.at) {
    const L = hullLines(H, at), y = L.keel + (L.gun - L.keel) * T.height;
    // Across to the inside of the planking at that height (the section's x at that y).
    const a = Math.acos(1 - (y - L.keel) / (L.gun - L.keel));
    const x = Math.max(0, L.half - t) * Math.sin(a) ** 0.7;
    hb.box([0, y, L.z], [x, T.thickM / 2, T.widthM / 2], C.thwart);
    seat = Math.max(seat, y + T.thickM / 2);
  }
  const O = B.oars;
  const z0 = -H.lengthM / 2 + (H.lengthM - O.lengthM) * 0.35, z1 = z0 + O.lengthM;
  for (const side of [-1, 1]) {
    const x = side * O.spreadM, y = seat + O.shaftM;
    hb.tube([x, y, z0], [x, y, z1 - O.bladeLengthM], O.shaftM, C.oar, 8);
    hb.box([x, y, z1 - O.bladeLengthM / 2], [O.bladeWidthM / 2, O.bladeThickM / 2, O.bladeLengthM / 2], C.oar);
  }
  const bowL = hullLines(H, 0.985);
  const bow = [0, bowL.gun - 0.04, bowL.z];

  // The stake: a rod with a flat top, its foot buried.
  const S = B.stake, sb = builder(), top = S.lengthM - S.buriedM, r = S.thickM / 2;
  sb.tube([0, -S.buriedM, 0], [0, top, 0], r, C.stake, 8);
  sb.fan([0, top, 0], Array.from({ length: 9 }, (_, k) => [Math.cos((k / 8) * Math.PI * 2) * r, top, -Math.sin((k / 8) * Math.PI * 2) * r]), [0, 1, 0], C.stake);

  // The rope: a sagging line from z 0 to z 1.
  const R = B.rope, rb = builder();
  /** @type {number[][]} */ const pts = [];
  for (let k = 0; k <= R.segments; k++) { const s = k / R.segments; pts.push([0, -R.sagM * 4 * s * (1 - s), s]); }
  for (let k = 0; k + 1 < pts.length; k++) rb.tube(pts[k], pts[k + 1], R.radiusM, C.rope, 5);

  return { hull: hb.done(), stake: sb.done(), rope: rb.done(), bow };
}
