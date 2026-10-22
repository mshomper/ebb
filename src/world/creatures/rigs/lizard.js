// @ts-check
// The common lizard's rig (M2 turtle life, LZ; docs 11, 13): how its bones move. The bones are
// listed in recipes/species/lizard.json (body.bones: body, head, each leg in two parts, four tail
// segments). At rest it lies in a low sprawl, legs splayed and toes spread on the stone, its tail
// curled to one side; its flanks breathe; its head lifts and turns in quick small jerks (bodily
// eased fast, then held); now and then it does a push-up display; running, the diagonal pairs of legs
// sweep out to the side as the spine and tail wave. Every number is in lizard.json's motion block.
// Live animation only; plain Math is fine here. Pure.

const DEG = Math.PI / 180;

/**
 * A lizard's pose state (lizard-live.js keeps it).
 * @typedef {{ id: number, t: number, look: number, lookUp: number, push: number, run: number, ph: number, curl: number }} LizardPose
 *   look, lookUp: the head's turn and lift (radians); push: 0..1 through a push-up's rise; run: 0..1
 *   how much it is running (the gait), ph: the stride in cycles; curl: -1..1 the tail's curl to a side
 */

/** Quaternion product p * q (q first, then p). @param {number[]} p @param {number[]} q */
function qmul(p, q) {
  return [
    p[3] * q[0] + p[0] * q[3] + p[1] * q[2] - p[2] * q[1],
    p[3] * q[1] - p[0] * q[2] + p[1] * q[3] + p[2] * q[0],
    p[3] * q[2] + p[0] * q[1] - p[1] * q[0] + p[2] * q[3],
    p[3] * q[3] - p[0] * q[0] - p[1] * q[1] - p[2] * q[2],
  ];
}

/** A small hash to 0..1 for a lizard's own timing. @param {number} id @param {number} k */
function h01(id, k) {
  let x = Math.imul(id ^ Math.imul(k, 0x9e3779b1), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Bone indices by name, per rig. @type {WeakMap<object, Record<string, number>>} */
const INDEX = new WeakMap();

/**
 * The bone moves for one lizard.
 * @param {{ name: string }[]} rig @param {LizardPose} f @param {any} M lizard.json motion
 * @param {(a: number[], angle: number) => number[]} axisAngle
 * @returns {({ q?: number[], s?: number[], t?: number[] } | null)[]}
 */
export function poseLizard(rig, f, M, axisAngle) {
  let at = INDEX.get(rig);
  if (!at) { at = {}; rig.forEach((b, i) => { /** @type {Record<string, number>} */ (at)[b.name] = i; }); INDEX.set(rig, at); }
  const moves = rig.map(() => /** @type {{ q?: number[], s?: number[], t?: number[] } | null} */ (null));
  const G = M.gait, run = f.run, ph = f.ph * Math.PI * 2;
  // The body: breathing flanks; a push-up raises the chest on straightened front legs; running,
  // the spine swings from side to side.
  const breath = 1 + M.breath * (0.5 + 0.5 * Math.sin((f.t / M.breathS + h01(f.id, 1)) * Math.PI * 2)) * (1 - run);
  const pitch = f.push * M.pushPitchDeg * DEG;
  const spine = Math.sin(ph) * M.spineDeg * DEG * run;
  moves[at.body] = { q: qmul(axisAngle([0, 1, 0], spine), axisAngle([1, 0, 0], -pitch)), t: [0, f.push * M.pushLiftM, 0], s: [breath, 1 + (breath - 1) * 0.4, 1] };
  // The head: its quick turns and lifts, against the spine's swing so it stays on target.
  moves[at.head] = { q: qmul(axisAngle([0, 1, 0], f.look - spine * 0.8), axisAngle([1, 0, 0], -f.lookUp + pitch * 0.5)) };
  // Legs (a left one as it is, the right mirrored): splayed at rest; running, diagonal pairs sweep
  // back along the ground and swing forward lifted; in a push-up the front legs straighten.
  const legs = [['arm.l', 'hand.l', 1, true, 0], ['arm.r', 'hand.r', -1, true, 0.5], ['leg.l', 'foot.l', 1, false, 0.5], ['leg.r', 'foot.r', -1, false, 0]];
  for (const [up, lo, s, front, off] of legs) {
    const L = front ? G.front : G.hind, m = /** @type {number} */ (s);
    const p = (f.ph + /** @type {number} */ (off)) % 1;
    const stance = p < 0.5;
    const e = stance ? p / 0.5 : (p - 0.5) / 0.5;
    // Swing + is back: a stance sweeps forward to back, the swing returns it.
    const sw = (stance ? -1 + 2 * e : 1 - 2 * e) * L.swingDeg * DEG * run;
    const li = (stance ? 0 : Math.sin(e * Math.PI) * L.liftDeg * DEG) * run - (front ? f.push * M.pushArmDeg * DEG : 0);
    const bend = front ? f.push * M.pushArmDeg * DEG * 0.6 : 0;
    if (at[up] !== undefined) moves[at[up]] = { q: qmul(axisAngle([0, 1, 0], sw * m), axisAngle([0, 0, 1], li * m)) };
    if (at[lo] !== undefined) moves[at[lo]] = { q: axisAngle([0, 0, 1], bend * m) };
  }
  // The tail: curled to one side, tighter toward the tip; running, a wave travels down it.
  for (let i = 0; i < 4; i++) {
    const b = at[`tail.${i}`];
    if (b === undefined) continue;
    const curl = f.curl * M.curlDeg * DEG * (0.6 + 0.25 * i) * (1 - run);
    const wave = Math.sin(ph - i * 0.9 - 1) * M.waveDeg * DEG * run * (0.6 + 0.2 * i);
    moves[b] = { q: axisAngle([0, 1, 0], curl + wave) };
  }
  return moves;
}
