// @ts-check
// The creature studio's species (docs/future/11, "Tools that take any species"): for each creature,
// its recipe file, how the stage frames it, the sliders for the look half of its recipe, and the
// motions it can show, each posed by the game's own code (the frog's idle moves, pose.js; a
// minnow's tail beat, school.js; a dragonfly's wing beat, patrol.js). A size slider ("Fore wing
// length") is not a number in the recipe: it stretches the named pieces (body.prims) from their
// bone's pivot, so a wing grows out from its root, and saving writes those pieces' numbers.

import { idleMoves, axisAngle } from '../src/world/creatures/pose.js';
import { poseSchool } from '../src/world/creatures/school.js';
import { posePatrol } from '../src/world/creatures/patrol.js';

/**
 * A slider row. path: a number or color in the recipe. size: a stretch of some pieces instead.
 * @typedef {{ path?: string, size?: Size, label: string, min?: number, max?: number, step?: number,
 *   unit?: (v: number) => string, color?: boolean, rebake?: boolean }} Row
 * @typedef {{ pick: (p: any) => boolean, how: 'radius' | 'fromJoint' | 'length' | 'thick', axes?: number[] }} Size
 *   radius: the piece's radii only (an eye grows where it is); fromJoint: radii and place, away
 *   from the bone's pivot, on axes (all three if none); length: a capsule's far end, away from its
 *   near end; thick: a capsule's radii
 * @typedef {{ title: string, note: string, rows: Row[] }} Group
 * @typedef {{ id: string, label: string }} Mode
 * @typedef {{ phase: number }} Clock  per-species animation state the pose carries between frames
 */

const x = (/** @type {number} */ v) => `${v.toFixed(2)}x`;
const n2 = (/** @type {number} */ v) => v.toFixed(2);
const pct = (/** @type {number} */ v) => `${Math.round(v * 100)}%`;
const hz = (/** @type {number} */ v) => `${v.toFixed(1)} a second`;
const rad = (/** @type {number} */ v) => `${Math.round((v * 180) / Math.PI)} degrees`;
const SIZE = { min: 0.5, max: 1.8, step: 0.01, unit: x };

/** Rows every species shares: how large it is drawn and how much individuals differ. @param {string} many */
const sizeGroup = (many) => ({ title: 'Size in the game', note: `How large the ${many} are drawn, and how much they differ from each other.`, rows: [
  { path: 'body.displayScale', label: 'Drawn size in the game', min: 1, max: 4, step: 0.1, unit: x, rebake: false },
  { path: 'body.sizeJitter', label: 'Size difference', min: 0, max: 0.25, step: 0.01, unit: pct, rebake: false },
] });

/** The frog (rig code in src/world/creatures/rigs/frog.js reshapes it by body.shape). */
const frog = {
  id: 'frog', name: 'Common frog', many: 'frogs',
  frame: { target: [0, 0.018, 0.002], dist: 0.17, liftM: 0, shadow: [0.032, 0.042, 0.45] },
  /** @type {Group[]} */ groups: [
    { title: 'Shape', note: 'Proportions of the body. 1 is the recipe body; each frog then varies a little around it.', rows: [
      { path: 'body.shape.torsoLen', label: 'Torso length', min: 0.65, max: 1.4, step: 0.01, unit: x },
      { path: 'body.shape.torsoWid', label: 'Torso width', min: 0.55, max: 1.5, step: 0.01, unit: x },
      { path: 'body.shape.torsoHgt', label: 'Torso height', min: 0.55, max: 1.7, step: 0.01, unit: x },
      { path: 'body.shape.headSize', label: 'Head size', min: 0.7, max: 1.4, step: 0.01, unit: x },
      { path: 'body.shape.eyeSize', label: 'Eye size', min: 0.6, max: 1.45, step: 0.01, unit: x },
      { path: 'body.shape.sacSize', label: 'Throat sac size', min: 0.6, max: 1.6, step: 0.01, unit: x },
      { path: 'body.shape.hindThick', label: 'Hind leg thickness', min: 0.6, max: 1.6, step: 0.01, unit: x },
    ] },
    { title: 'Color and pattern', note: 'Physical colors (albedo). In the game the palette still paints last, so the island may look warmer or cooler than here.', rows: [
      { path: 'body.albedo.back', label: 'Back', color: true },
      { path: 'body.albedo.belly', label: 'Belly', color: true },
      { path: 'body.albedo.blotch', label: 'Blotches', color: true },
      { path: 'body.blotch.amount', label: 'Blotch cover', min: 0, max: 1, step: 0.01, unit: n2 },
      { path: 'body.blotch.scale', label: 'Blotch fineness', min: 60, max: 320, step: 5, unit: (v) => `${v} per m` },
    ] },
    { title: 'Eyes', note: 'A dark pupil in a flecked gold iris, hooded by the lids.', rows: [
      { path: 'body.albedo.eyeRing', label: 'Iris', color: true },
      { path: 'body.albedo.fleck', label: 'Iris flecks', color: true },
      { path: 'body.eyeLook.pupil.0', label: 'Pupil width', min: 0.3, max: 0.95, step: 0.01, unit: n2 },
      { path: 'body.eyeLook.pupil.1', label: 'Pupil height', min: 0.2, max: 0.8, step: 0.01, unit: n2 },
      { path: 'body.eyeLook.fleckShare', label: 'Fewer flecks', min: 0, max: 0.9, step: 0.01, unit: n2 },
      { path: 'body.eyeGlint.strength', label: 'Wet glint (game only)', min: 0, max: 2, step: 0.05, unit: n2, rebake: false },
    ] },
    { title: 'Variety and size', note: 'How much frogs differ from each other, and how large they are drawn in the game.', rows: [
      { path: 'body.variation', label: 'Variation between frogs', min: 0, max: 0.12, step: 0.005, unit: pct },
      { path: 'body.sizeJitter', label: 'Size difference', min: 0, max: 0.2, step: 0.01, unit: pct, rebake: false },
      { path: 'body.displayScale', label: 'Drawn size in the game', min: 1, max: 4, step: 0.1, unit: x, rebake: false },
    ] },
    { title: 'Idle motion', note: 'Breathing, blinking and the call, as the frogs do them.', rows: [
      { path: 'motion.breath.hz', label: 'Breaths a second', min: 0.3, max: 3, step: 0.05, unit: n2 },
      { path: 'motion.breath.sac', label: 'Throat swell when breathing', min: 0, max: 0.3, step: 0.01, unit: n2 },
      { path: 'motion.blink.retractM', label: 'How far the eyes sink in a blink', min: 0, max: 0.007, step: 0.0005, unit: (v) => `${(v * 1000).toFixed(1)} mm` },
      { path: 'motion.call.inflate', label: 'Sac size when calling', min: 0.5, max: 3, step: 0.05, unit: x },
    ] },
  ],
  /** @type {Mode[]} */ modes: [{ id: 'rest', label: 'Rest pose' }, { id: 'idle', label: 'Breathing' }, { id: 'call', label: 'Calling' }],
  defaultMode: 'idle',
  /**
   * @param {{ name: string, parent: number, pivot: number[] }[]} bones @param {string} mode @param {number} t animation seconds
   * @param {number} dt @param {any} R the recipe as edited @param {Clock} clock
   */
  pose(bones, mode, t, dt, R, clock) {
    const moves = idleMoves(bones, t, 1, R.motion);
    if (mode === 'call') {
      // A call every three seconds: the sac swells over pulseS and settles.
      const C = R.motion.call, p = (t % 3) / C.pulseS;
      const k = p < 1 ? Math.sin(Math.PI * p) * C.inflate : 0;
      const i = bones.findIndex((b) => b.name === 'throat');
      if (i >= 0 && k > 0) moves[i] = { s: [1 + 0.4 * k, 1 + k, 1 + 0.7 * k] };
    }
    return moves;
  },
};

/** The common minnow (bones listed in its recipe: body, mid, tail). */
const minnow = {
  id: 'minnow', name: 'Common minnow', many: 'minnows',
  frame: { target: [0, 0.02, -0.006], dist: 0.15, liftM: 0.02, shadow: [0.012, 0.034, 0.22] },
  /** @type {Group[]} */ groups: [
    { title: 'Shape', note: 'Sizes of the fins and parts. 1 is the recipe body; a fin grows out from where it joins the body.', rows: [
      { size: { pick: (p) => p.bone === 'tail', how: 'fromJoint' }, label: 'Tail fin size', ...SIZE },
      { size: { pick: (p) => p.region === 'fin' && p.bone === 'body', how: 'fromJoint' }, label: 'Back fin size', ...SIZE },
      { size: { pick: (p) => p.region === 'fin' && p.bone === 'mid', how: 'fromJoint' }, label: 'Belly fin size', ...SIZE },
      { size: { pick: (p) => p.type === 'ellipsoid' && p.region === 'back', how: 'fromJoint', axes: [1] }, label: 'Body depth', min: 0.7, max: 1.4, step: 0.01, unit: x },
      { size: { pick: (p) => p.type === 'capsule', how: 'thick' }, label: 'Tail stalk thickness', min: 0.6, max: 1.5, step: 0.01, unit: x },
      { size: { pick: (p) => p.region === 'eye', how: 'radius' }, label: 'Eye size', min: 0.6, max: 1.6, step: 0.01, unit: x },
    ] },
    { title: 'Color and pattern', note: 'Physical colors (albedo). The silver flash in the game is the wet sheen catching the sun, not a color.', rows: [
      { path: 'body.albedo.back', label: 'Back', color: true },
      { path: 'body.albedo.belly', label: 'Lower flank', color: true },
      { path: 'body.albedo.blotch', label: 'Dark bars', color: true },
      { path: 'body.albedo.fin', label: 'Fins', color: true },
      { path: 'body.albedo.eyeRing', label: 'Eye ring', color: true },
      { path: 'body.blotch.amount', label: 'Bar cover', min: 0, max: 1, step: 0.01, unit: n2 },
      { path: 'body.blotch.scale', label: 'Bar fineness', min: 60, max: 600, step: 5, unit: (v) => `${v} per m` },
      { path: 'body.bellyBelowNormalY', label: 'How high the pale flank reaches', min: -0.9, max: 0.5, step: 0.01, unit: n2 },
      { path: 'body.wetSpecular.strength', label: 'Wet sheen (game only)', min: 0, max: 2, step: 0.05, unit: n2, rebake: false },
    ] },
    sizeGroup('minnows'),
    { title: 'Tail beat', note: 'The tail beats faster the faster a fish swims: beats at rest, plus more for each meter a second.', rows: [
      { path: 'motion.tailSwing', label: 'Tail swing', min: 0, max: 0.8, step: 0.01, unit: rad },
      { path: 'motion.tailHz.0', label: 'Beats a second at rest', min: 0.5, max: 8, step: 0.1, unit: hz },
      { path: 'motion.tailHz.1', label: 'Extra beats per meter a second', min: 0, max: 40, step: 0.5, unit: n2 },
    ] },
  ],
  /** @type {Mode[]} */ modes: [{ id: 'rest', label: 'Rest pose' }, { id: 'cruise', label: 'Cruising' }, { id: 'dart', label: 'Darting' }, { id: 'night', label: 'Night' }],
  defaultMode: 'cruise',
  /** @param {{ name: string, parent: number }[]} bones @param {string} mode @param {number} t @param {number} dt @param {any} R @param {Clock} clock */
  pose(bones, mode, t, dt, R, clock) {
    const M = R.motion;
    // As the school does it (school.js): the beat quickens with the swimming speed.
    const v = mode === 'dart' ? M.dartMps : mode === 'night' ? M.nightMps : M.cruiseMps;
    clock.phase += dt * 2 * Math.PI * (M.tailHz[0] + M.tailHz[1] * v);
    return poseSchool(bones, clock, M, [0, 0, 0, 1], axisAngle);
  },
};

/** The southern hawker (bones listed in its recipe: body and four wings). */
const dragonfly = {
  id: 'dragonfly', name: 'Southern hawker', many: 'dragonflies',
  frame: { target: [0, 0.02, -0.018], dist: 0.21, liftM: 0.02, shadow: [0.04, 0.036, 0.2] },
  /** @type {Group[]} */ groups: [
    { title: 'Shape', note: 'Sizes of the wings and parts. 1 is the recipe body; a wing grows out from its root on the thorax.', rows: [
      { size: { pick: (p) => p.bone?.startsWith('wing.f'), how: 'fromJoint', axes: [0] }, label: 'Fore wing length', ...SIZE },
      { size: { pick: (p) => p.bone?.startsWith('wing.f'), how: 'fromJoint', axes: [2] }, label: 'Fore wing width', ...SIZE },
      { size: { pick: (p) => p.bone?.startsWith('wing.h'), how: 'fromJoint', axes: [0] }, label: 'Hind wing length', ...SIZE },
      { size: { pick: (p) => p.bone?.startsWith('wing.h'), how: 'fromJoint', axes: [2] }, label: 'Hind wing width', ...SIZE },
      { size: { pick: (p) => p.type === 'capsule', how: 'length' }, label: 'Abdomen length', min: 0.6, max: 1.5, step: 0.01, unit: x },
      { size: { pick: (p) => p.type === 'capsule', how: 'thick' }, label: 'Abdomen thickness', min: 0.6, max: 1.6, step: 0.01, unit: x },
      { size: { pick: (p) => p.region === 'eye', how: 'radius' }, label: 'Eye size', min: 0.7, max: 1.4, step: 0.01, unit: x },
    ] },
    { title: 'Color and pattern', note: 'Physical colors (albedo). In the game the palette still paints last, and the wings catch the sun as a glossy sheen.', rows: [
      { path: 'body.albedo.back', label: 'Body', color: true },
      { path: 'body.albedo.blotch', label: 'Spots', color: true },
      { path: 'body.albedo.wing', label: 'Wings', color: true },
      { path: 'body.albedo.eye', label: 'Eyes, top and front', color: true },
      { path: 'body.albedo.eyeRing', label: 'Eyes, sides', color: true },
      { path: 'body.blotch.amount', label: 'Spot cover', min: 0, max: 1, step: 0.01, unit: n2 },
      { path: 'body.blotch.scale', label: 'Spot fineness', min: 100, max: 900, step: 10, unit: (v) => `${v} per m` },
      { path: 'body.wetSpecular.strength', label: 'Gloss (game only)', min: 0, max: 2, step: 0.05, unit: n2, rebake: false },
    ] },
    sizeGroup('dragonflies'),
    { title: 'Wing beat', note: 'Fore and hind wings beat out of step. At real speed the beat is a blur, as it is in life; slow it down below the stage to see it.', rows: [
      { path: 'motion.wingHz.0', label: 'Beats a second hovering', min: 5, max: 40, step: 0.5, unit: hz },
      { path: 'motion.wingHz.1', label: 'Beats a second darting', min: 5, max: 40, step: 0.5, unit: hz },
      { path: 'motion.wingSwing', label: 'Wing swing', min: 0, max: 1.2, step: 0.01, unit: rad },
      { path: 'motion.hindLag', label: 'Hind wings behind the fore', min: 0, max: 3.14, step: 0.02, unit: rad },
      { path: 'motion.restDroop', label: 'Wing droop when perched', min: 0, max: 0.5, step: 0.01, unit: rad },
    ] },
  ],
  /** @type {Mode[]} */ modes: [{ id: 'rest', label: 'Rest pose' }, { id: 'hover', label: 'Hovering' }, { id: 'dart', label: 'Darting' }, { id: 'perch', label: 'Perched' }],
  defaultMode: 'hover',
  /** @param {{ name: string, parent: number }[]} bones @param {string} mode @param {number} t @param {number} dt @param {any} R @param {Clock} clock */
  pose(bones, mode, t, dt, R, clock) {
    const M = R.motion;
    // As the patrol does it (patrol.js): the hover beat, the faster dart beat, still on a perch.
    if (mode !== 'perch') clock.phase += dt * 2 * Math.PI * (mode === 'hover' ? M.wingHz[0] : M.wingHz[1]);
    return posePatrol(bones, /** @type {any} */ ({ ...clock, mode }), M, [0, 0, 0, 1], axisAngle);
  },
};

/** The species the studio knows, in picker order. */
export const SPECIES = { frog, minnow, dragonfly };
/** @typedef {typeof frog} Species */

/** Every slider of a species, keyed: a path, or "size:<group>.<row>" for a size row. @param {Species} S */
export function rowsOf(S) {
  /** @type {Map<string, Row>} */ const m = new Map();
  S.groups.forEach((g, gi) => g.rows.forEach((r, ri) => m.set(r.path ?? `size:${gi}.${ri}`, r)));
  return m;
}

const round = (/** @type {number} */ v) => Math.round(v * 1e6) / 1e6;
const scaleR = (/** @type {any} */ r, /** @type {number} */ k, /** @type {number[] | null} */ axes) =>
  (Array.isArray(r) ? r.map((c, a) => (!axes || axes.includes(a) ? round(c * k) : c)) : round(r * k));

/**
 * How far a size row is from the recipe file: the first picked piece's size now over its size there.
 * @param {Size} s @param {any} base the recipe as the file is @param {any} work as edited
 */
export function sizeOf(s, base, work) {
  const i = base.body.prims.findIndex(s.pick);
  if (i < 0) return 1;
  const b = base.body.prims[i], w = work.body.prims[i];
  if (s.how === 'length') return Math.hypot(...w.b.map((v, a) => v - w.a[a])) / Math.hypot(...b.b.map((v, a) => v - b.a[a]));
  const a = s.axes?.[0] ?? 0;
  return (Array.isArray(w.r) ? w.r[a] : w.r) / (Array.isArray(b.r) ? b.r[a] : b.r);
}

/**
 * Set a size row: every picked piece becomes the file's piece stretched by k (on this row's axes
 * only, so a length and a width row never undo each other).
 * @param {Size} s @param {number} k @param {any} base @param {any} work
 */
export function setSize(s, k, base, work) {
  const bones = work.body.bones ?? [];
  base.body.prims.forEach((/** @type {any} */ b, /** @type {number} */ i) => {
    if (!s.pick(b)) return;
    const w = work.body.prims[i];
    const axes = s.axes ?? [0, 1, 2];
    if (s.how === 'length') w.b = b.b.map((/** @type {number} */ v, /** @type {number} */ a) => round(b.a[a] + (v - b.a[a]) * k));
    else if (s.how === 'thick') w.r = scaleR(b.r, k, null);
    else if (s.how === 'radius') w.r = scaleR(b.r, k, null);
    else {
      const pivot = bones.find((/** @type {any} */ x) => x.name === b.bone)?.pivot ?? [0, 0, 0];
      w.r = scaleR(b.r, k, Array.isArray(b.r) ? axes : null);
      w.c = b.c.map((/** @type {number} */ v, /** @type {number} */ a) => (axes.includes(a) ? round(pivot[a] + (v - pivot[a]) * k) : w.c[a]));
    }
  });
}
