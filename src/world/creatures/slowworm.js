// @ts-check
// The slow worm, rigged (docs/future/11 finds; the creature rigging rule, m2-rigs-spring): a chain
// of bones down its body, one per segment, the head first. At rest it lies in a gentle S; the S is a
// wave along the chain (each joint turned by the curve there). When it shifts along beside its log,
// the wave stays where it is on the ground while the body slides through it, so it slithers; at
// rest the curve drifts a little as it breathes. Now and then it lifts its head a touch and flicks
// its dark forked tongue (a small mesh of its own, following the head). Every number is in
// recipes/species/slowworm.json (body and motion). Pure; live animation only.

/**
 * A slow worm's body as prims on a chain of bones: straight along z (the snout at +z), thickest a
 * third along and tapering to the tail, with its eyes on the head segment. The bones are listed
 * (body.bones): seg.0 (the head) to seg.n-1, and the tongue's at the mouth.
 * @param {any} B slowworm.json body @returns {any} a body to bake
 */
export function slowwormBody(B) {
  const n = B.segments, prims = [], bones = [];
  /** A point along the body at share s (0 the snout, 1 the tail tip). @param {number} s */
  const at = (s) => [0, B.radiusM, B.lengthM * (0.5 - s)];
  /** Its radius at s: the head a little narrower, thickest a third along, the tail tapering. @param {number} s */
  const rad = (s) => B.radiusM * (s < 0.08 ? 0.8 + 2.5 * s : s < 0.4 ? 1 : 1 - (1 - B.tipShare) * ((s - 0.4) / 0.6));
  for (let i = 0; i < n; i++) {
    const s0 = i / n, s1 = (i + 1) / n;
    prims.push({ type: 'capsule', bone: `seg.${i}`, a: at(s0), b: at(s1), r: [rad(s0), rad(s1)], k: B.radiusM * 0.4, region: 'back' });
    bones.push({ name: `seg.${i}`, parent: i - 1, pivot: at(s0) });
  }
  const head = at(0.03);
  for (const side of [1, -1]) prims.push({ type: 'sphere', bone: 'seg.0', c: [side * B.radiusM * 0.6, head[1] + B.radiusM * 0.35, head[2]], r: B.radiusM * 0.22, k: 0, region: 'eye' });
  bones.push({ name: 'tongue', parent: 0, pivot: tongueRoot(B) });
  return { prims, bones, albedo: B.albedo, blotch: { scale: 1, amount: 0 }, bellyBelowNormalY: -0.2, skin: { blendM: 0.003 } };
}

/** Where the tongue comes from: just inside the mouth. @param {any} B */
const tongueRoot = (B) => [0, B.radiusM * 0.85, B.lengthM * 0.5 - B.radiusM * 0.6];

/**
 * The tongue as a body of its own (it lies inside the mouth at rest, so it is baked apart from the
 * worm): a thin dark strip that forks at the tip, on the worm's own bones (the tongue bone), so the
 * worm's posed bones draw it too.
 * @param {any} B slowworm.json body @param {any} T slowworm.json motion.tongue
 */
export function tongueBody(B, T) {
  const r = tongueRoot(B), L = T.lengthM, f = L * 0.3;
  const tip = [r[0], r[1], r[2] + L];
  return {
    prims: [
      { type: 'capsule', bone: 'tongue', a: r, b: tip, r: [T.radiusM, T.radiusM * 0.8], k: 0, region: 'tongue' },
      { type: 'capsule', bone: 'tongue', a: tip, b: [tip[0] + f * 0.5, tip[1], tip[2] + f], r: [T.radiusM * 0.7, T.radiusM * 0.4], k: T.radiusM * 0.3, region: 'tongue' },
      { type: 'capsule', bone: 'tongue', a: tip, b: [tip[0] - f * 0.5, tip[1], tip[2] + f], r: [T.radiusM * 0.7, T.radiusM * 0.4], k: T.radiusM * 0.3, region: 'tongue' },
    ],
    bones: slowwormBody(B).bones,
    albedo: { back: T.albedo, tongue: T.albedo }, blotch: { scale: 1, amount: 0 }, bellyBelowNormalY: -2,
  };
}

/** A small hash to 0..1. @param {number} id @param {number} k */
function h01(id, k) {
  let x = Math.imul(id ^ Math.imul(k, 0x9e3779b1), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/**
 * How far out the tongue is (0 in, 1 all the way) at time t: every so often a quick pair of flicks.
 * @param {number} t seconds @param {number} id @param {any} T motion.tongue
 */
export function tongueOut(t, id, T) {
  const every = T.everyS[0] + (T.everyS[1] - T.everyS[0]) * h01(id, 1);
  const into = (t + h01(id, 2) * every) % every;
  const span = T.flickS * T.flicks;
  if (into >= span) return 0;
  return Math.sin(((into % T.flickS) / T.flickS) * Math.PI);
}

/**
 * The bone moves for one slow worm.
 * @param {{ name: string }[]} rig @param {{ id: number, t: number, slidM: number }} w slidM: how far it has slid along itself
 * @param {any} B slowworm.json body @param {any} M slowworm.json motion
 * @param {(a: number[], angle: number) => number[]} axisAngle
 * @returns {({ q?: number[], s?: number[], t?: number[] } | null)[]}
 */
export function poseSlowworm(rig, w, B, M, axisAngle) {
  const n = B.segments, seg = B.lengthM / n;
  // The S: a curve along the body (waves half-waves over its length). Sliding through it, the curve
  // keeps its place on the ground: its phase moves back along the body as far as the body went.
  const cycles = B.waves / 2, wl = B.lengthM / cycles;
  const drift = Math.sin(w.t / M.breathS * Math.PI * 2 + h01(w.id, 3) * 6) * M.breathShift;
  const phase = (w.slidM / wl + drift) * Math.PI * 2;
  // The joints' turns add up to the curve: each turns by the curvature there times a segment's length.
  const kappa = (/** @type {number} */ s) => B.bend * Math.PI * 2 * cycles / B.lengthM * Math.cos(s * cycles * Math.PI * 2 + phase);
  const moves = rig.map(() => /** @type {{ q?: number[], s?: number[], t?: number[] } | null} */ (null));
  const flick = tongueOut(w.t, w.id, M.tongue);
  for (let i = 0; i < n; i++) {
    const b = rig.findIndex((x) => x.name === `seg.${i}`);
    if (b < 0) continue;
    // The head's own turn is the curve's heading there (bend sin of the phase), so the joints
    // after it trace the same S wherever the body has slid to; it lifts a touch to taste the air.
    const turn = i === 0 ? B.bend * Math.sin(phase) : kappa(i / n) * seg;
    moves[b] = i === 0 ? { q: qmul(axisAngle([0, 1, 0], turn), axisAngle([1, 0, 0], -flick * M.tongue.headLiftRad)) } : { q: axisAngle([0, 1, 0], turn) };
  }
  // The tongue grows out of the mouth along the head and back (it is not drawn while in).
  const tg = rig.findIndex((x) => x.name === 'tongue');
  if (tg >= 0) moves[tg] = { s: [1, 1, Math.max(0.02, flick)] };
  return moves;
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
