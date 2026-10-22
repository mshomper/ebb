// @ts-check
// The turtle rig (M2 turtle life, TL1; docs 11, 12): how a European pond turtle's bones move. The
// bones themselves are listed in recipes/species/turtle.json (body.bones: body, neck, head, jaw, two
// eyes, each leg in two parts, tail) and the shell is stiff, so only the skin bends. A turtle's pose
// is a blend of a few ways of holding itself (layers: swimming, walking, basking, the periscope,
// tucked in, hauling out, sliding off, grazing), each weighted 0..1 on the turtle (f.w) and eased
// toward what it is doing (easeWeights). Every angle, distance and timing is in turtle.json's
// motion.pose, in degrees and meters of the body as baked (displayScale applies after).
//
// The haul-out and the slide each follow a path over their progress k (haulPath, slidePath), the
// same in the game (bask.js) and the turtle lab (tools/turtle-lab.html). Live animation only (never
// saved); plain Math is fine here. Pure and worker-safe.

const DEG = Math.PI / 180;

/** The layers a pose blends, in a fixed order. */
export const LAYERS = Object.freeze(['swim', 'walk', 'bask', 'peri', 'tuck', 'haul', 'slide', 'graze']);

/**
 * What a turtle is doing, as far as its pose goes (bask.js keeps the rest):
 * @typedef {{ id: number, t: number, mode: string, w: Record<string, number>, ph: number, stroke: number,
 *   haulK: number, slideK: number, look: number, lookUp: number, jaw: number, wet: number, pitch: number, roll: number, bob?: number }} TurtlePose
 *   t: seconds of its own clock; w: each layer's weight; ph: the stroke or stride, in cycles; stroke:
 *   how hard it strokes (0 glides or hangs still, 1 swims); haulK, slideK: progress through a haul-out
 *   or a slide; look, lookUp: where its head turns (radians); jaw: 0..1 open (a bite, a yawn)
 */

/** Each mode's layer weights (anything not listed is 0). */
const MODE_LAYERS = {
  swim: { swim: 1 }, under: { swim: 1, tuck: 0.15 }, glide: { swim: 1 }, walk: { walk: 1 }, bottom: { walk: 1 },
  haul: { haul: 1 }, climb: { haul: 1 }, bask: { bask: 1 }, peri: { peri: 1 }, peek: { peri: 1 },
  slide: { slide: 1 }, hide: { swim: 1, tuck: 0.6 }, low: { peri: 0.35, tuck: 0.25 }, graze: { swim: 0.6, graze: 1 },
  shuffle: { walk: 0.7, bask: 0.3 },
};

/**
 * Ease a turtle's layer weights toward its mode's. @param {TurtlePose} f @param {number} dt @param {any} P motion.pose
 */
export function easeWeights(f, dt, P) {
  const want = /** @type {Record<string, number>} */ (MODE_LAYERS[/** @type {keyof typeof MODE_LAYERS} */ (f.mode)] ?? {});
  const k = Math.min(1, dt * (P.easeHz ?? 4));
  for (const L of LAYERS) f.w[L] = (f.w[L] ?? 0) + ((want[L] ?? 0) - (f.w[L] ?? 0)) * k;
}

/** A fresh pose state, all in one mode. @param {number} id @param {string} mode */
export function poseState(id, mode) {
  /** @type {Record<string, number>} */ const w = {};
  const want = /** @type {Record<string, number>} */ (MODE_LAYERS[/** @type {keyof typeof MODE_LAYERS} */ (mode)] ?? {});
  for (const L of LAYERS) w[L] = want[L] ?? 0;
  return { id, t: 0, mode, w, ph: 0, stroke: 1, haulK: 0, slideK: 0, look: 0, lookUp: 0, jaw: 0, wet: 1, pitch: 0, roll: 0 };
}

const clamp01 = (/** @type {number} */ x) => Math.max(0, Math.min(1, x));
const smooth = (/** @type {number} */ x) => { const k = clamp01(x); return k * k * (3 - 2 * k); };
const frac = (/** @type {number} */ x) => x - Math.floor(x);
const lerp = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ k) => a + (b - a) * k;

/** A small hash to 0..1 for a turtle's own timing. @param {number} id @param {number} k */
export function h01(id, k) {
  let x = Math.imul(id ^ Math.imul(k, 0x9e3779b1), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/**
 * The haul-out's path over its progress k: how far along (h) and up (v) from the water to the
 * resting spot, and the shell's pitch (radians, nose up). Front claws reach, the shell tips up, the
 * hind legs heave it over the edge, then it pauses before settling. @param {number} k @param {any} P motion.pose
 */
export function haulPath(k, P) {
  const H = P.haul, total = H.reachS + H.tipS + H.heaveS + H.pauseS;
  const a = H.reachS / total, b = a + H.tipS / total, c = b + H.heaveS / total;
  const tip = H.tipDeg * DEG;
  if (k < a) { const e = smooth(k / a); return { h: 0.05 * e, v: 0, pitch: tip * 0.2 * e }; }
  if (k < b) { const e = smooth((k - a) / (b - a)); return { h: 0.05 + 0.1 * e, v: 0.25 * e, pitch: tip * (0.2 + 0.8 * e) }; }
  if (k < c) {
    const e = smooth((k - b) / (c - b));
    // The heave comes in two shoves, a breath between them.
    const shove = e < 0.5 ? smooth(e * 2) * 0.55 : 0.55 + smooth((e - 0.5) * 2) * 0.45;
    return { h: 0.15 + 0.85 * shove, v: 0.25 + 0.75 * Math.min(1, shove * 1.3), pitch: tip * (1 - smooth(e * 1.25)) };
  }
  return { h: 1, v: 1, pitch: 0 };
}

/** Which part of the haul-out k falls in: 0 reach, 1 tip, 2 heave, 3 pause, and how far into it. @param {number} k @param {any} P */
export function haulPart(k, P) {
  const H = P.haul, total = H.reachS + H.tipS + H.heaveS + H.pauseS;
  const ends = [H.reachS, H.reachS + H.tipS, H.reachS + H.tipS + H.heaveS, total].map((s) => s / total);
  let i = 0;
  while (i < 3 && k >= ends[i]) i++;
  const from = i ? ends[i - 1] : 0;
  return { part: i, e: clamp01((k - from) / Math.max(1e-6, ends[i] - from)) };
}

/** The haul-out's length in seconds. @param {any} P motion.pose */
export const haulS = (P) => P.haul.reachS + P.haul.tipS + P.haul.heaveS + P.haul.pauseS;

/**
 * The slide off a spot over its progress k: along (h) and down (v), nose dipping (pitch < 0).
 * @param {number} k @param {any} P motion.pose
 */
export function slidePath(k, P) {
  const e = smooth(k);
  return { h: Math.pow(clamp01(k), 1.4), v: e, pitch: -P.slide.pitchDeg * DEG * Math.sin(Math.min(1, k * 1.15) * Math.PI * 0.9) };
}

/**
 * One limb's turn: swing (+ back), lift (+ up), twist (about its length) for the upper part; bend
 * and turn of the flipper below. All radians, for a left limb (the right is mirrored).
 * @typedef {{ sw: number, li: number, tw: number, bs: number, bl: number, bt: number, out?: number }} Limb
 *   out: a shift outward (+) or in (-), meters
 */
const NO_LIMB = () => ({ sw: 0, li: 0, tw: 0, bs: 0, bl: 0, bt: 0, out: 0 });

/** The swim stroke for one limb. @param {number} p stroke phase 0..1 @param {boolean} front @param {any} S motion.pose.swim @param {number} stroke 0..1 */
function swimLimb(p, front, S, stroke) {
  const L = front ? S.front : S.hind;
  const fwd = L.fwdDeg * DEG, back = L.backDeg * DEG;
  // Hold: flippers laid back along the shell in the glide (front), legs trailing (hind).
  const hold = { sw: back * 0.9, li: -4 * DEG, tw: 0, bs: L.foldDeg * DEG, bl: 0, bt: 0 };
  const P = S.power, R = S.recover;
  /** @type {Limb} */ let o;
  if (p < P) {
    // Power: a sweep from forward to back, the blade turned square to the water.
    const e = smooth(p / P);
    o = { sw: lerp(-fwd, back, e), li: -L.liftDeg * DEG * 0.4 * Math.sin(e * Math.PI), tw: L.featherDeg * DEG * Math.sin(Math.min(1, e * 1.2) * Math.PI * 0.95),
      bs: lerp(-L.bendDeg * DEG * 0.4, L.bendDeg * DEG, e), bl: 0, bt: L.spreadDeg * DEG * Math.sin(e * Math.PI) };
  } else if (p < 1 - R) {
    o = { ...hold };
  } else {
    // Recovery: forward again, raised and edge-on, slicing through.
    const e = smooth((p - (1 - R)) / R);
    o = { sw: lerp(hold.sw, -fwd, e), li: L.liftDeg * DEG * Math.sin(e * Math.PI), tw: 0, bs: lerp(hold.bs, -L.bendDeg * DEG * 0.4, e), bl: 0, bt: 0 };
  }
  // A slow stroke is a gentle scull about a half-trailing hold.
  const k = clamp01(stroke);
  const idle = { sw: back * 0.35 + Math.sin(p * Math.PI * 2) * S.scullDeg * DEG, li: -6 * DEG, tw: Math.cos(p * Math.PI * 2) * S.scullDeg * DEG, bs: L.foldDeg * DEG * 0.4, bl: 0, bt: 0 };
  return mixLimb(idle, o, k);
}

/** The walk for one limb: a stance pushing back and a lifted step forward. @param {number} s stride phase 0..1 @param {boolean} front @param {any} W motion.pose.walk */
function walkLimb(s, front, W) {
  const L = front ? W.front : W.hind;
  const fwd = L.fwdDeg * DEG, back = L.backDeg * DEG, down = L.downDeg * DEG;
  const st = W.stance;
  if (s < st) {
    const e = s / st;
    return { sw: lerp(-fwd, back, e), li: -down, tw: 0, bs: 0, bl: -L.footDeg * DEG, bt: 0 };
  }
  const e = smooth((s - st) / (1 - st));
  return { sw: lerp(back, -fwd, e), li: -down + L.stepDeg * DEG * Math.sin(e * Math.PI), tw: 0, bs: 0, bl: -L.footDeg * DEG * (1 - Math.sin(e * Math.PI)), bt: 0 };
}

/** @param {Limb} a @param {Limb} b @param {number} k */
function mixLimb(a, b, k) {
  return { sw: lerp(a.sw, b.sw, k), li: lerp(a.li, b.li, k), tw: lerp(a.tw, b.tw, k), bs: lerp(a.bs, b.bs, k), bl: lerp(a.bl, b.bl, k), bt: lerp(a.bt, b.bt, k), out: lerp(a.out ?? 0, b.out ?? 0, k) };
}

/**
 * The neck and head: how far the neck reaches out (m, - draws it in), its turn up and about, the
 * head's own turn up and about, and the jaw's opening (radians).
 * @typedef {{ ext: number, up: number, yaw: number, hUp: number, hYaw: number, jaw: number, tail: number, tailUp: number }} Axial
 */

/**
 * Every layer's limbs and neck for this turtle now.
 * @param {TurtlePose} f @param {any} P motion.pose
 */
function layers(f, P) {
  const t = f.t;
  /** @type {Record<string, { limbs: Limb[], ax: Axial }>} */ const out = {};
  const ax0 = () => ({ ext: 0, up: 0, yaw: 0, hUp: 0, hYaw: 0, jaw: 0, tail: 0, tailUp: 0 });
  // Limbs in order: front left, front right, hind left, hind right.
  const order = [[true, 0], [true, 1], [false, 0], [false, 1]];

  if (f.w.swim > 1e-3) {
    const S = P.swim;
    // Diagonal pairs: front left with hind right, then front right with hind left.
    const limbs = order.map(([front, side]) => {
      const off = (front ? side : 1 - side) * S.pairGap;
      return swimLimb(frac(f.ph - off), /** @type {boolean} */ (front), S, f.stroke);
    });
    out.swim = { limbs, ax: { ...ax0(), ext: S.neckOutM, up: S.headUpDeg * DEG, tail: Math.sin(f.ph * Math.PI * 2) * S.tailDeg * DEG } };
  }
  if (f.w.walk > 1e-3) {
    const W = P.walk;
    const limbs = order.map(([front, side]) => walkLimb(frac(f.ph + (front ? side : 1 - side) * 0.5), /** @type {boolean} */ (front), W));
    out.walk = { limbs, ax: { ...ax0(), ext: W.neckOutM, up: W.headUpDeg * DEG + Math.sin(f.ph * Math.PI * 4) * W.neckBobDeg * DEG,
      tail: Math.sin(f.ph * Math.PI * 2) * W.tailDeg * DEG, tailUp: -6 * DEG } };
  }
  if (f.w.bask > 1e-3) {
    const B = P.bask;
    // Breathing: the limbs pump in and out of their pockets, the neck with them; the throat flutters.
    const br = Math.sin((t / B.breathS + h01(f.id, 4)) * Math.PI * 2);
    const front = { sw: -B.frontFwdDeg * DEG, li: -B.frontDownDeg * DEG + br * B.pumpDeg * DEG, tw: 0, bs: -B.frontHandDeg * DEG * 0.5, bl: -B.frontHandDeg * DEG, bt: 0, out: br * B.pumpM };
    const hind = { sw: B.hindSplayDeg * DEG, li: -4 * DEG + br * B.pumpDeg * DEG * 0.5, tw: B.hindTwistDeg * DEG, bs: B.hindFootDeg * DEG, bl: 0, bt: 0, out: br * B.pumpM * 0.6 };
    out.bask = { limbs: [front, front, hind, hind], ax: { ...ax0(), ext: B.neckOutM + br * B.pumpM * 0.6, up: B.neckUpDeg * DEG, hUp: B.headUpDeg * DEG, tailUp: -10 * DEG } };
  }
  if (f.w.peri > 1e-3) {
    const Q = P.peri;
    const sc = Math.sin((t / Q.scullS) * Math.PI * 2), cs = Math.cos((t / Q.scullS) * Math.PI * 2);
    const front = { sw: Q.frontBackDeg * DEG + sc * Q.scullDeg * DEG, li: -Q.frontDownDeg * DEG, tw: cs * Q.scullDeg * DEG * 1.5, bs: sc * Q.scullDeg * DEG * 0.5, bl: 0, bt: 0 };
    const frontR = { ...front, sw: Q.frontBackDeg * DEG - sc * Q.scullDeg * DEG, tw: -cs * Q.scullDeg * DEG * 1.5 };
    const hind = { sw: -10 * DEG + cs * Q.scullDeg * DEG * 0.4, li: -Q.hindDownDeg * DEG, tw: 0, bs: 0, bl: -10 * DEG, bt: 0 };
    out.peri = { limbs: [front, frontR, hind, { ...hind, sw: -10 * DEG - cs * Q.scullDeg * DEG * 0.4 }], ax: { ...ax0(), ext: Q.neckOutM, up: Q.neckUpDeg * DEG, hUp: Q.headUpDeg * DEG, tailUp: -20 * DEG } };
  }
  if (f.w.tuck > 1e-3) {
    const T = P.tuck;
    const front = { sw: T.frontBackDeg * DEG, li: -10 * DEG, tw: 0, bs: T.foldDeg * DEG, bl: 0, bt: 0, out: -T.limbInM };
    const hind = { sw: -T.hindFwdDeg * DEG, li: -10 * DEG, tw: 0, bs: -T.foldDeg * DEG, bl: 0, bt: 0, out: -T.limbInM };
    out.tuck = { limbs: [front, front, hind, hind], ax: { ...ax0(), ext: -T.neckInM, up: 0, tail: 12 * DEG } };
  }
  if (f.w.haul > 1e-3) out.haul = haulLayer(f, P);
  if (f.w.slide > 1e-3) {
    const D = P.slide, e = smooth(f.slideK);
    const front = { sw: -D.frontFwdDeg * DEG, li: -D.frontDownDeg * DEG, tw: 0, bs: 0, bl: -20 * DEG, bt: 0 };
    const hind = { sw: lerp(-20, D.hindPushDeg, e) * DEG, li: -15 * DEG, tw: 0, bs: 20 * DEG * e, bl: 0, bt: 0 };
    out.slide = { limbs: [front, front, hind, hind], ax: { ...ax0(), ext: -D.neckInM * Math.sin(Math.min(1, f.slideK * 1.5) * Math.PI * 0.5), up: -10 * DEG } };
  }
  if (f.w.graze > 1e-3) {
    const G = P.graze;
    // Bites: the head jabs forward, the jaw snaps open and shut, a pause between.
    const c = frac(t / G.biteS + h01(f.id, 9));
    const bite = c < G.biteShare ? Math.sin((c / G.biteShare) * Math.PI) : 0;
    const swimHold = swimLimb(frac(f.ph), true, P.swim, 0);
    out.graze = { limbs: [swimHold, swimHold, swimHold, swimHold], ax: { ...ax0(), ext: G.neckOutM + bite * G.jabM, up: -G.headDownDeg * DEG, jaw: bite * G.jawDeg * DEG } };
  }
  return out;
}

/** The haul-out layer: claws reach, the shell tips, the hind legs heave, a pause. @param {TurtlePose} f @param {any} P */
function haulLayer(f, P) {
  const H = P.haul;
  const { part, e } = haulPart(f.haulK, P);
  const ax = { ext: H.neckOutM, up: H.neckUpDeg * DEG, yaw: 0, hUp: 0, hYaw: 0, jaw: 0, tail: 0, tailUp: -10 * DEG };
  const reach = { sw: -H.reachDeg * DEG, li: H.reachLiftDeg * DEG, tw: 0, bs: 0, bl: -H.clawDeg * DEG, bt: 0 };
  const pulled = { sw: 25 * DEG, li: -H.pressDeg * DEG, tw: 0, bs: 0, bl: -H.clawDeg * DEG, bt: 0 };
  const under = { sw: -H.hindFwdDeg * DEG, li: -H.hindDownDeg * DEG, tw: 0, bs: 0, bl: -15 * DEG, bt: 0 };
  const pushed = { sw: H.hindPushDeg * DEG, li: -H.hindDownDeg * DEG * 0.6, tw: 0, bs: 30 * DEG, bl: -5 * DEG, bt: 0 };
  const trail = { sw: 30 * DEG, li: -5 * DEG, tw: 0, bs: 10 * DEG, bl: 0, bt: 0 };
  const rest = { sw: -10 * DEG, li: -12 * DEG, tw: 0, bs: 0, bl: -10 * DEG, bt: 0 };
  let fl, fr, hl, hr;
  if (part === 0) {
    // One claw then the other reaches up over the edge.
    const a = smooth(e * 1.6), b = smooth(e * 1.6 - 0.6);
    fl = mixLimb(NO_LIMB(), reach, a); fr = mixLimb(NO_LIMB(), reach, b);
    hl = hr = mixLimb(NO_LIMB(), trail, e);
  } else if (part === 1) {
    fl = fr = mixLimb(reach, pulled, smooth(e));
    hl = hr = mixLimb(trail, under, smooth(e));
  } else if (part === 2) {
    // Two shoves: the hind legs push back, draw forward a little, push again.
    const s1 = smooth(e * 2), s2 = smooth(e * 2 - 1);
    const push = e < 0.5 ? s1 : 1;
    const back = e < 0.5 ? 0 : Math.sin(clamp01((e - 0.5) * 4) * Math.PI) * 0.5;
    const hk = clamp01(push - back + (e >= 0.5 ? s2 * 0.5 : 0));
    hl = mixLimb(under, pushed, hk); hr = mixLimb(under, pushed, clamp01(hk * 0.9 + 0.05));
    fl = fr = mixLimb(pulled, rest, smooth(e));
    ax.ext = lerp(H.neckOutM, H.neckOutM * 0.5, Math.sin(e * Math.PI));
  } else {
    // The pause: still, head up, getting its breath.
    fl = fr = rest;
    hl = hr = mixLimb(pushed, { sw: P.bask.hindSplayDeg * DEG * 0.6, li: -6 * DEG, tw: 0, bs: 10 * DEG, bl: 0, bt: 0 }, smooth(e));
    ax.up = lerp(H.neckUpDeg, P.bask.neckUpDeg, smooth(e)) * DEG;
  }
  return { limbs: [fl, fr, hl, hr], ax };
}

/** Bone indices by name, per rig. @type {WeakMap<object, Record<string, number>>} */
const INDEX = new WeakMap();

/**
 * The bone moves for one turtle: its layers blended by weight, its head turned where it looks, its
 * eyes blinking now and then, a rare yawn while basking.
 * @param {{ name: string, parent: number, pivot?: number[] }[]} rig @param {TurtlePose} f @param {any} M motion
 * @param {number[]} q the root's turn (pitch and roll) @param {(a: number[], angle: number) => number[]} axisAngle
 * @returns {({ q?: number[], s?: number[], t?: number[] } | null)[]}
 */
export function poseTurtle(rig, f, M, q, axisAngle) {
  const P = M.pose;
  let at = INDEX.get(rig);
  if (!at) { at = {}; rig.forEach((b, i) => { /** @type {Record<string, number>} */ (at)[b.name] = i; }); INDEX.set(rig, at); }
  const { limbs, ax } = blend(f, P);

  const moves = rig.map(() => /** @type {{ q?: number[], s?: number[], t?: number[] } | null} */ (null));
  // The shell: held up off the ground on its legs while walking, bobbing and rocking from side to
  // side with each stride; a small heave with each swim stroke.
  const W = P.walk, ww = f.w.walk ?? 0, sw = (f.w.swim ?? 0) * clamp01(f.stroke);
  const lift = ww * (W.liftM + W.bobM * Math.abs(Math.sin(f.ph * Math.PI * 2))) + sw * P.swim.bobM * Math.sin(f.ph * Math.PI * 2);
  const rock = axisAngle([0, 0, 1], ww * Math.sin(f.ph * Math.PI * 2) * W.rollDeg * DEG);
  moves[at.body] = { q: qmul(q, rock), t: [0, lift + (f.bob ?? 0), 0] };
  // A turn: twist x about the part's own length (axis, unit), then lift z, then swing y.
  const rot = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z, axis = [1, 0, 0]) =>
    qmul(axisAngle([0, 1, 0], y), qmul(axisAngle([0, 0, 1], z), axisAngle(axis, x)));
  // Neck: out along the body (+z) or drawn in; up is a turn about x (- raises it).
  if (at.neck !== undefined) moves[at.neck] = { q: qmul(axisAngle([0, 1, 0], ax.yaw), axisAngle([1, 0, 0], -ax.up)), t: [0, 0, ax.ext] };
  if (at.head !== undefined) moves[at.head] = { q: qmul(axisAngle([0, 1, 0], ax.hYaw), axisAngle([1, 0, 0], -ax.hUp)) };
  if (at.jaw !== undefined) moves[at.jaw] = { q: axisAngle([1, 0, 0], Math.max(0, ax.jaw)) };
  if (at.tail !== undefined) moves[at.tail] = { q: rot(ax.tailUp, ax.tail, 0) };
  // Limbs: a left limb as it is; a right one mirrored (its swing, lift and twist turn the other
  // way, the twist about its own mirrored length). Each part twists about the way it points at rest:
  // the leg from its pivot to the flipper's, the flipper along P.flipperDeg.
  const names = [['arm.l', 'hand.l', 1, 'front'], ['arm.r', 'hand.r', -1, 'front'], ['leg.l', 'foot.l', 1, 'hind'], ['leg.r', 'foot.r', -1, 'hind']];
  names.forEach(([up, lo, s, end], i) => {
    const l = limbs[i], m = /** @type {number} */ (s);
    const ua = at[up], la = at[lo];
    if (ua !== undefined) {
      const a = rig[ua].pivot ?? [0, 0, 0], b = la !== undefined ? rig[la].pivot ?? a : a;
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], n = Math.hypot(d[0], d[1], d[2]) || 1;
      moves[ua] = { q: rot(l.tw * m, l.sw * m, l.li * m, [d[0] / n, d[1] / n, d[2] / n]), t: l.out ? [l.out * m, 0, 0] : undefined };
    }
    if (la !== undefined) {
      const fa = (P.flipperDeg?.[/** @type {string} */ (end)] ?? 0) * DEG;
      moves[la] = { q: rot(l.bt * m, l.bs * m, l.bl * m, [Math.cos(fa) * m, 0, Math.sin(fa)]) };
    }
  });
  // Blinking: the eyes close every few seconds, out of step with other turtles.
  const K = P.blink, span = lerp(K.everyS[0], K.everyS[1], h01(f.id, 2));
  const into = (f.t + h01(f.id, 3) * span) % span;
  const closed = into < K.s ? 1 - Math.abs((into / K.s) * 2 - 1) : 0;
  // Tucked in hard, they stay shut.
  const shut = Math.max(closed, clamp01((f.w.tuck - 0.5) * 2));
  if (shut > 0) for (const e of ['eye.l', 'eye.r']) if (at[e] !== undefined) moves[at[e]] = { s: [1, 1 - 0.85 * shut, 1] };
  return moves;
}

/**
 * How high the nose sits over the body's origin (body meters, before displayScale), with the shell
 * pitched by f.pitch and the neck as the pose holds it: the periscope keeps this at the surface.
 * Worked in the body's side plane from the recipe's bones (neck and head pivots).
 * @param {{ name: string, pivot: number[] }[]} bones recipe body.bones @param {TurtlePose} f @param {any} M motion
 */
export function noseY(bones, f, M) {
  const { ax } = blend(f, M.pose);
  const pv = (/** @type {string} */ n) => bones.find((b) => b.name === n)?.pivot ?? [0, 0, 0];
  const n = pv('neck'), h = pv('head');
  const tip = M.pose.peri.tip ?? [0, 0.004, 0.032];
  // In (y, z): a turn of a (nose up) takes z toward y.
  const turn = (/** @type {number[]} */ p, /** @type {number} */ a) => [p[0] * Math.cos(a) + p[1] * Math.sin(a), -p[0] * Math.sin(a) + p[1] * Math.cos(a)];
  let p = turn([tip[1], tip[2]], ax.hUp);
  p = turn([h[1] - n[1] + p[0], h[2] - n[2] + p[1]], ax.up);
  p = [n[1] + p[0], n[2] + ax.ext + p[1]];
  return turn(p, f.pitch)[0];
}

/** The layers blended by their weights: four limbs and the neck. @param {TurtlePose} f @param {any} P motion.pose */
function blend(f, P) {
  const L = layers(f, P);
  // The weights, with what is left over going to the rest pose (the body as baked).
  let sum = 0;
  for (const k of Object.keys(L)) sum += f.w[k];
  const norm = sum > 1 ? 1 / sum : 1;
  /** @type {Limb[]} */ const limbs = [NO_LIMB(), NO_LIMB(), NO_LIMB(), NO_LIMB()];
  /** @type {Axial} */ const ax = { ext: 0, up: 0, yaw: 0, hUp: 0, hYaw: 0, jaw: 0, tail: 0, tailUp: 0 };
  for (const [k, l] of Object.entries(L)) {
    const w = f.w[k] * norm;
    l.limbs.forEach((x, i) => { for (const key of /** @type {(keyof Limb)[]} */ (['sw', 'li', 'tw', 'bs', 'bl', 'bt', 'out'])) limbs[i][key] = (limbs[i][key] ?? 0) + (x[key] ?? 0) * w; });
    for (const key of /** @type {(keyof Axial)[]} */ (Object.keys(ax))) ax[key] += l.ax[key] * w;
  }
  // Looking about: most of the turn in the neck, the rest in the head.
  ax.yaw += f.look * 0.6; ax.hYaw += f.look * 0.4;
  ax.up += f.lookUp * 0.5; ax.hUp += f.lookUp * 0.5;
  ax.jaw += f.jaw * P.yawn.jawDeg * DEG;
  // A yawn now and then while basking: the neck stretches up, the jaw opens wide, slowly.
  const Y = P.yawn, every = lerp(Y.everyS[0], Y.everyS[1], h01(f.id, 11));
  const yc = (f.t + h01(f.id, 12) * every) % every;
  if (yc < Y.s && f.w.bask > 0.5) {
    const e = Math.sin((yc / Y.s) * Math.PI);
    ax.jaw += e * e * Y.jawDeg * DEG * f.w.bask;
    ax.up += e * Y.neckUpDeg * DEG * f.w.bask;
    ax.ext += e * Y.neckOutM * f.w.bask;
  }

  return { limbs, ax };
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
