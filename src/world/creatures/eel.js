// @ts-check
// The eel, rigged (B3 wave 2; the creature rigging rule): a long body on a chain of bones, one per
// segment, the head first, built in code from a few numbers (recipes/species/eel.json body), as the
// slow worm's is. It moves by a wave along the chain: the body lies on a curve y(s) = A(s) sin(ks - w)
// and each joint turns by the change in the curve's heading there, so the joints together trace the
// curve. Swimming, the wave runs back faster than the eel goes (it slips through the water) and
// grows toward the tail; crossing grass, the wave stays where it is on the ground while the body
// slides through it (a snake's track), wider and nearly even along the body; at rest only a slow
// ripple runs down the tail. The live motion (eel-swim.js) keeps the wave's phase and size; this
// file turns them into bone moves. Pure; live animation only.

/**
 * An eel's body as prims on a chain of bones: straight along z (the snout at +z, origin at the
 * middle, as a fish's: it swims), round and thickest a third along, flattened into a fin at the
 * tail. A soft fin ridge runs along the back from finFrom and round the tail to the belly, two small
 * fins sit behind the head, and two eyes on its flat head. Bones seg.0 (the head) to seg.n-1.
 * @param {any} B eel.json body @returns {any} a body to bake (the recipe's own fields kept)
 */
export function eelBody(B) {
  const n = B.segments, L = B.lengthM, R = B.radiusM, prims = [], bones = [];
  /** A point along the body at share s (0 the snout, 1 the tail tip). @param {number} s */
  const at = (s) => [0, 0, L * (0.5 - s)];
  /** Its radius at s: a blunt head, thickest a third along, tapering to the tail. @param {number} s */
  const rad = (s) => R * (s < 0.06 ? 0.55 + 7.5 * s : s < 0.4 ? 1 : 1 - (1 - B.tipShare) * ((s - 0.4) / 0.6));
  for (let i = 0; i < n; i++) {
    const s0 = i / n, s1 = (i + 1) / n;
    prims.push({ type: 'capsule', bone: `seg.${i}`, a: at(s0), b: at(s1), r: [rad(s0), rad(s1)], k: R * 0.5, region: 'back' });
    // The fin ridge: a thin keel above (from finFrom) and below (from finUnder), meeting round the tail.
    const mid = (s0 + s1) / 2, h = B.finM * Math.min(1, (mid - B.finFrom) / 0.15);
    if (mid >= B.finFrom) prims.push({ type: 'ellipsoid', bone: `seg.${i}`, c: [0, rad(mid) * 0.7, at(mid)[2]], r: [R * 0.12, rad(mid) * 0.3 + h, (L / n) * 0.75], k: R * 0.25, region: 'fin' });
    if (mid >= B.finUnder) prims.push({ type: 'ellipsoid', bone: `seg.${i}`, c: [0, -rad(mid) * 0.7, at(mid)[2]], r: [R * 0.12, rad(mid) * 0.3 + h * 0.8, (L / n) * 0.75], k: R * 0.25, region: 'fin' });
    bones.push({ name: `seg.${i}`, parent: i - 1, pivot: at(s0) });
  }
  // The head a little wide and flat, the small fins behind it, the eyes high and forward.
  const hz = at(0.04)[2];
  prims.push({ type: 'ellipsoid', bone: 'seg.0', c: [0, R * 0.05, hz], r: [R * 0.85, R * 0.62, L * 0.045], k: R * 0.4, region: 'back' });
  for (const side of [1, -1]) {
    prims.push({ type: 'ellipsoid', bone: 'seg.1', c: [side * R * 1.05, -R * 0.15, at(0.11)[2]], r: [R * 0.5, R * 0.12, R * 0.6], rot: [0, side * 25, 0], k: R * 0.2, region: 'fin' });
    prims.push({ type: 'sphere', bone: 'seg.0', c: [side * R * 0.48, R * 0.4, at(0.03)[2]], r: R * 0.17, k: 0, region: 'eye' });
  }
  return { ...B, prims, bones, blotch: B.blotch ?? { scale: 1, amount: 0 } };
}

/**
 * The bone moves for one eel. f.wave is the wave's phase (radians, at the head), f.amp its size
 * (m, body-local, at the tail), f.even how even it is along the body (0: all at the tail, as it
 * swims; 1: the same everywhere, crossing grass). The wave has `waves` whole waves over the body.
 * @param {{ name: string, pivot: number[] }[]} rig @param {{ wave: number, amp: number, even: number }} f
 * @param {any} M eel.json motion @param {number[]} q the root's own turn (bank and pitch)
 * @param {(a: number[], angle: number) => number[]} axisAngle
 * @returns {({ q: number[] } | null)[]}
 */
export function poseEel(rig, f, M, q, axisAngle) {
  const segs = rig.filter((b) => b.name.startsWith('seg.'));
  const n = segs.length;
  if (n < 2) return rig.map(() => null);
  // The body's length from the chain's pivots (each segment as long as the one before it).
  const L = ((segs[0].pivot[2] - segs[n - 1].pivot[2]) * n) / (n - 1);
  const k = (Math.PI * 2 * M.waves) / L;
  const head = M.headShare + (1 - M.headShare) * f.even;
  // The curve's heading at s: dy/ds of A(s) sin(k L s - wave), A growing from head to tail.
  const heading = (/** @type {number} */ s) => {
    const A = f.amp * (head + (1 - head) * s);
    return Math.atan(A * k * Math.cos(k * L * s - f.wave) + f.amp * (1 - head) / L * Math.sin(k * L * s - f.wave));
  };
  let before = 0;
  return rig.map((b) => {
    if (!b.name.startsWith('seg.')) return null;
    const i = Number(b.name.slice(4));
    const h = heading(i / n);
    const turn = i === 0 ? h : h - before;
    before = h;
    const yaw = axisAngle([0, 1, 0], turn);
    return { q: i === 0 ? qmul(q, yaw) : yaw };
  });
}

/** Quaternion product p * q (q first, then p). @param {number[]} p @param {number[]} q */
function qmul(p, q) {
  return [
    p[3] * q[0] + p[0] * q[3] + p[1] * q[2] - p[2] * q[1],
    p[3] * q[1] - p[0] * q[2] + p[1] * q[3] + p[2] * q[0],
    p[3] * q[2] + p[0] * q[1] - p[1] * q[0] + p[2] * q[3],
    p[3] * q[3] - p[0] * q[0] - p[1] * q[1] - p[2] * q[2],
  ];
}
