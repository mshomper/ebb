// @ts-check
// The hen's camp perch (docs/future/15, slice 3): two forked sticks pushed into the ground and a bar
// laid across the forks, standing off the camp pad once she is Familiar. She roosts on it at night
// (life.js, bands.js), sitting across the bar. Session-made, a basic shape: round sticks in the props
// pass's layout. Where it stands: perch.offM from the fire ring toward her scrub, turned turnDeg
// round, stepped further out while that spot is on the pad. Pure. Numbers: recipes/species/hen.json perch.

/** @typedef {{ data: Float32Array, indices: Uint32Array }} PropMesh */

/**
 * A round stick from a to b, radius r0 at a and r1 at b, `sides` round, pushed into V and I (props
 * layout: position, normal, uv; 8 floats a vertex). @param {number[]} V @param {number[]} I
 * @param {number[]} a @param {number[]} b @param {number} r0 @param {number} r1 @param {number} [sides]
 */
function stick(V, I, a, b, r0, r1, sides = 7) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(d[0], d[1], d[2]) || 1;
  const t = d.map((v) => v / l);
  // Two directions across the stick.
  const up = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = [t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0]];
  const ul = Math.hypot(u[0], u[1], u[2]);
  const n1 = u.map((v) => v / ul);
  const n2 = [t[1] * n1[2] - t[2] * n1[1], t[2] * n1[0] - t[0] * n1[2], t[0] * n1[1] - t[1] * n1[0]];
  const base = V.length / 8;
  for (let e = 0; e < 2; e++) {
    const c = e ? b : a, r = e ? r1 : r0;
    for (let s = 0; s <= sides; s++) {
      const ang = (s / sides) * Math.PI * 2, cs = Math.cos(ang), sn = Math.sin(ang);
      const n = [0, 1, 2].map((k) => n1[k] * cs + n2[k] * sn);
      V.push(c[0] + n[0] * r, c[1] + n[1] * r, c[2] + n[2] * r, n[0], n[1], n[2], s / sides, e);
    }
  }
  for (let s = 0; s < sides; s++) {
    const p = base + s, q = base + s + 1, P = p + sides + 1, Q = q + sides + 1;
    I.push(p, P, q, q, P, Q);
  }
  // The cut ends, capped.
  for (let e = 0; e < 2; e++) {
    const c = e ? b : a, ci = V.length / 8, sg = e ? 1 : -1;
    V.push(c[0], c[1], c[2], t[0] * sg, t[1] * sg, t[2] * sg, 0.5, e);
    const ring = base + e * (sides + 1);
    for (let s = 0; s < sides; s++) { if (e) I.push(ci, ring + s, ring + s + 1); else I.push(ci, ring + s + 1, ring + s); }
  }
}

/**
 * The perch: two forked posts barM apart along x, the bar across their forks at heightM, the origin
 * on the ground at its middle. @param {any} P recipes/species/hen.json perch @returns {PropMesh}
 */
export function perchMesh(P) {
  /** @type {number[]} */ const V = [];
  /** @type {number[]} */ const I = [];
  const h = P.heightM, half = P.barM / 2 - 0.05, f = P.forkM;
  for (const sx of [-1, 1]) {
    const x = sx * half, lean = sx * 0.015;
    // The post, a little thinner at the top, pushed in below the ground.
    stick(V, I, [x, -0.06, 0], [x + lean, h - f * 0.3, 0], P.stickR, P.stickR * 0.85);
    // The fork's two prongs, opened along the bar's line so it rests between them.
    stick(V, I, [x + lean, h - f * 0.3, 0], [x + lean, h + f * 0.7, f * 0.55], P.stickR * 0.8, P.stickR * 0.5);
    stick(V, I, [x + lean, h - f * 0.3, 0], [x + lean, h + f * 0.6, -f * 0.5], P.stickR * 0.8, P.stickR * 0.5);
  }
  // The bar, laid in the forks, a touch past each post.
  stick(V, I, [-P.barM / 2, h + P.barR * 0.6, 0.004], [P.barM / 2, h + P.barR * 0.6, -0.004], P.barR, P.barR * 0.9);
  return { data: new Float32Array(V), indices: new Uint32Array(I) };
}

/**
 * Where the perch stands, and her roost on it: offM from the ring toward her scrub, turned turnDeg,
 * stepped out half a metre at a time while `onPad` says the spot is on the camp pad. The bar runs
 * across the line from the ring, so she sits on it facing the fire. Pure.
 * @param {any} P recipes/species/hen.json perch @param {{ x: number, z: number }} ring
 * @param {{ x: number, z: number }} home @param {(x: number, z: number) => boolean} [onPad]
 * @returns {{ x: number, z: number, yaw: number, h: number }} yaw: the bar's turn (the mesh's x along it); h: her feet's height
 */
export function perchSpot(P, ring, home, onPad) {
  const a = Math.atan2(home.x - ring.x, home.z - ring.z) + (P.turnDeg * Math.PI) / 180;
  let d = P.offM, x = 0, z = 0;
  for (let i = 0; i < 8; i++, d += 0.5) {
    x = ring.x + Math.sin(a) * d; z = ring.z + Math.cos(a) * d;
    if (!onPad?.(x, z)) break;
  }
  return { x, z, yaw: a, h: P.heightM + P.barR * 1.6 };
}

/**
 * Her roost on the perch: the bar's middle, sitting across it facing the ring (yaw: her heading).
 * @param {{ x: number, z: number, yaw: number, h: number }} at perchSpot
 */
export const perchRoost = (at) => ({ x: at.x, z: at.z, h: at.h, yaw: at.yaw + Math.PI });

/** The perch's card (a tap on it). @param {{ x: number, z: number }} at @param {any} W recipes/species/hen.json perch.words */
export const perchCard = (at, W) => ({ sp: 'hen-perch', perch: true, name: W.card, sub: null, icon: 'hen-perch', text: W.line,
  wx: at.x, wz: at.z, r: 0.4, stage: -1, noPage: true });
