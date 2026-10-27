// @ts-check
// Clip strips for tools/walker-strip.html (C1 to C3, October 27, 2026). C1: each fighting clip
// (recipes/world/fight-clips.json) played once on our walker with the lantern arm masked, the lantern
// in the left hand and the driftwood staff in the right, beside the same clip as Meshy made it (both
// arms, no mask). C2: the staff's two looks in hand, standing, walking and swinging. C3: the pick-up,
// gather and kneel clips as Matt made them, whole, to see which part of each serves. The lantern
// hangs from the hand as the game hangs it (src/world/camp/frame.js), the staff is carried on the
// hand as a carrier is (src/world/figure/carry.js), both drawn in their base colours as the stage's
// plain shapes.

import { readGlb } from '../src/render/gltf.js';
import { campModelMesh, baseColorSampler } from '../src/world/pack/draw.js';
import { carriedOn } from '../src/world/figure/carry.js';

/**
 * @param {{ STRIPS: Record<string, any>, R: any, W: any, built: any, DT: number, createFigureMotion: Function, clips: any,
 *   strideRun: (pace: number, clips?: boolean) => any, stridePicks: (rec: any[]) => any[], digRun: (act?: string, clips?: boolean) => any }} o
 */
export async function addClipStrips(o) {
  const { STRIPS, R, built, DT, clips } = o;
  if (!clips) return;
  const json = async (/** @type {string} */ p) => (await fetch(p)).json();
  const FR = await json('../recipes/world/fight-clips.json'), SR = await json('../recipes/world/staff.json');
  const C = await json('../recipes/world/camp.json');
  const FIGHT = await json(`../${FR.file}`);
  /** What still looks off in Matt's Text-to-Animation pair after the cheap cleaning, for him to decide on regenerating. @type {Record<string, string>} */
  const OFF = {
    throwToss: 'the release goes out level at chest height, not up and forward; the arm then holds out about half a second; the wind-up is a deep bow from the waist.',
    pointCast: 'it points up and across to the left, not straight ahead; the chest still turns that way; the hand comes back near the face before it lowers.',
  };
  const DS = R.body.displayScale ?? 1;
  /** @param {string} file */
  const meshOf = async (file) => { const glb = readGlb(await (await fetch(`../${file}`)).arrayBuffer()); return campModelMesh(glb, [0.4, 0.33, 0.2], await baseColorSampler(glb)); };
  const lantern = await meshOf(C.props.models.lantern.file);
  /** @type {Record<string, any>} */ const staves = {};
  for (const l of SR.looks) staves[l.id] = await meshOf(l.model);
  const bone = (/** @type {string} */ n) => built.skeleton.findIndex((/** @type {any} */ b) => b.name === n);
  const HL = bone('hand.l'), HOLD = bone(SR.hold.bone);

  /** Ry(yaw) Rx(pitch) Rz(roll), as prop-draw.wgsl turns a prop. @param {{ yaw: number, pitch: number, roll: number }} c @param {number[]} v */
  const turn = (c, v) => {
    const cr = Math.cos(c.roll), sr = Math.sin(c.roll), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch), cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    const r = [cr * v[0] - sr * v[1], sr * v[0] + cr * v[1], v[2]];
    const p = [r[0], cp * r[1] - sp * r[2], sp * r[1] + cp * r[2]];
    return [cy * p[0] + sy * p[2], p[1], -sy * p[0] + cy * p[2]];
  };
  /** A mesh's triangles moved: each point (its own m) through at(), each normal through nt(). @param {any} m @param {(v: number[]) => number[]} at @param {(n: number[]) => number[]} nt */
  function tris(m, at, nt) {
    const out = new Float32Array(m.indices.length * 9), V = m.vertices;
    for (let t = 0; t < m.indices.length; t++) {
      const v = m.indices[t] * 9, q = at([V[v], V[v + 1], V[v + 2]]), n = nt([V[v + 3], V[v + 4], V[v + 5]]);
      out.set([q[0], q[1], q[2], n[0], n[1], n[2], V[v + 6], V[v + 7], V[v + 8]], t * 9);
    }
    return out;
  }
  /**
   * The lantern hanging from the left hand, turned with the figure as the game turns it (body m).
   * @param {any} motion @param {number[]} place [x, y, z, yaw]
   */
  function lanternTris(motion, place) {
    const m = motion.bones.subarray(HL * 16, HL * 16 + 16), p = built.skeleton[HL].pivot;
    const b = [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
    const c = Math.cos(place[3]), sn = Math.sin(place[3]), yawed = (/** @type {number[]} */ v) => [c * v[0] + sn * v[2], v[1], -sn * v[0] + c * v[2]];
    const h = yawed(b), drop = (C.lantern.carryDropM ?? 0) / DS, s = 1 / DS;
    return tris(lantern, (v) => { const q = yawed(v); return [place[0] + h[0] + q[0] * s, place[1] + h[1] - drop + q[1] * s, place[2] + h[2] + q[2] * s]; }, yawed);
  }
  /** The staff in the right hand: its grip at the hold, turned with the hand. @param {any} motion @param {string} look @param {number[]} place */
  function staffTris(motion, look, place) {
    const c = carriedOn(motion.bones, HOLD, built.skeleton[HOLD].pivot, SR.hold.at, SR.hold.turnDeg, place[3], 1);
    const s = SR.lengthM / DS;
    // Walking or standing it stays this share upright (leaning tiltDeg forward); a swing (a shot) moves it with the hand alone.
    const a = turn(c, [0, 1, 0]), tilt = (SR.hold.tiltDeg ?? 0) * Math.PI / 180, u = motion.shooting ? 0 : SR.hold.upright ?? 0;
    const want = [Math.sin(place[3]) * Math.sin(tilt), Math.cos(tilt), Math.cos(place[3]) * Math.sin(tilt)];
    const b = a.map((v, k) => v + (want[k] - v) * u), bl = Math.hypot(...b) || 1;
    const fix = fromTo(a, b.map((v) => v / bl));
    const go = (/** @type {number[]} */ v) => fix(turn(c, v));
    return tris(staves[look], (v) => { const q = go([v[0] * s, (v[1] - SR.gripM) * s, v[2] * s]); return [place[0] + c.dx + q[0], place[1] + c.dy + q[1], place[2] + c.dz + q[2]]; }, go);
  }
  /** The turn taking unit a onto unit b (Rodrigues), as a function. @param {number[]} a @param {number[]} b */
  function fromTo(a, b) {
    const v = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], cs = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    if (cs > 0.99999) return (/** @type {number[]} */ p) => p;
    const k = 1 / (1 + cs);
    return (/** @type {number[]} */ p) => {
      const vp = [v[1] * p[2] - v[2] * p[1], v[2] * p[0] - v[0] * p[2], v[0] * p[1] - v[1] * p[0]];
      const vvp = [v[1] * vp[2] - v[2] * vp[1], v[2] * vp[0] - v[0] * vp[2], v[0] * vp[1] - v[1] * vp[0]];
      return [0, 1, 2].map((i) => p[i] + vp[i] + vvp[i] * k);
    };
  }
  /** @param {Float32Array[]} parts */
  const join = (parts) => { const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let k = 0; for (const p of parts) { out.set(p, k); k += p.length; } return out; };
  /**
   * What the walker holds now: the lantern, and the staff (a look) or nothing.
   * @param {any} motion @param {string | null} look @param {() => number[]} [place] where the run has the figure
   */
  const held = (motion, look, place = () => [0, 0, 0, 0]) => () => { const p = place(); return join([lanternTris(motion, p), ...(look ? [staffTris(motion, look, p)] : [])]); };

  const STILL = { x: 0, z: 0, y: 0, yaw: 0, speed: 0, moving: false, ground: () => 0, depth: () => 0, below: true, posture: /** @type {'stand'} */ ('stand') };
  const AT = 0.3;
  /**
   * A still walker playing one clip once at AT seconds. mask: the bones it takes (null: all, as Meshy
   * made it). @param {string} name @param {string[] | null} mask @param {string | null} look
   */
  function shotRun(name, mask, look) {
    const motion = o.createFigureMotion(R, built.skeleton, clips);
    motion.addClips(FIGHT);
    let t = 0;
    return {
      motion,
      step() {
        t += DT;
        if (Math.abs(t - AT) < DT / 2) motion.shoot(name, { mask: mask ?? undefined, feet: FR.clips[name]?.feet ?? true, easeS: FR.easeS });
        return { t, r: motion.update(DT, STILL) };
      },
      place: () => [0, 0, 0, 0],
      props: held(motion, look),
    };
  }
  /** n frames evenly over a clip of dur seconds, from AT. @param {number} dur @param {number} n */
  const evenPicks = (dur, n) => () => Array.from({ length: n }, (_, k) => {
    const s = (dur * k) / (n - 1);
    return { i: Math.round((AT + s) / DT), label: `${s.toFixed(2)} s` };
  });
  const durOf = (/** @type {string} */ n) => (FIGHT.clips[n] ?? clips.clips[n]).dur;
  const FRONT = { yaw: -0.65, pitch: 0.14, dist: 4.4 };

  // C1: the fighting clips, three or so to a strip, each masked and then as Meshy made it. Throw and
  // Point (Matt's Text-to-Animation pair) have a strip of their own, with what still looks off.
  const names = Object.keys(FR.clips).filter((n) => !OFF[n]), per = 3;
  for (let s = 0; s * per < names.length; s++) {
    const group = names.slice(s * per, s * per + per);
    STRIPS[`fight${s + 1}`] = {
      title: `Fighting clips ${s + 1}`, tile: [200, 270], view: FRONT,
      rows: group.flatMap((n) => {
        const c = FR.clips[n], picks = evenPicks(durOf(n), 8);
        return [
          { name: `${n} (${c.meshy}, ${c.pose}), lantern arm masked, staff in hand`, run: () => shotRun(n, FR.mask, 'slim'), picks },
          { name: `${n} as Meshy made it: both arms`, run: () => shotRun(n, null, null), picks },
        ];
      }),
    };
  }

  const SIDEV = { yaw: -Math.PI / 2, pitch: 0.12, dist: 4.2 };
  STRIPS.throwPoint = {
    title: 'Throw and Point', tile: [200, 270], view: FRONT,
    rows: Object.keys(OFF).flatMap((n) => {
      const c = FR.clips[n], picks = evenPicks(durOf(n), 8);
      return [
        { name: `${n} (${c.pose}), lantern arm masked, from the front and right`, note: `Cleaned: ${c.made}.`, run: () => shotRun(n, FR.mask, 'slim'), picks },
        { name: `${n}, from the right`, note: `Still off: ${OFF[n]}`, view: SIDEV, run: () => shotRun(n, FR.mask, 'slim'), picks },
        { name: `${n} cleaned, no mask: both arms`, run: () => shotRun(n, null, null), picks },
      ];
    }),
  };

  // C2: the staff in hand, each look: standing, walking, and the two-hit swing.
  const walk = +(R.clips.paces.find((/** @type {any} */ p) => p.clip === 'walk').speed * DS).toFixed(2);
  /** Walking with the staff. @param {string} look */
  const walkRun = (look) => () => { const r = o.strideRun(walk, true); return { ...r, props: held(r.motion, look, r.place) }; };
  const standPicks = () => [0.2, 1, 2, 3].map((s) => ({ i: Math.round(s / DT), label: 'standing' }));
  const SIDE = { yaw: -Math.PI / 2, pitch: 0.1, dist: 4 };
  STRIPS.staff = {
    title: `Driftwood staff, ${SR.lengthM} m`, tile: [200, 270], view: FRONT,
    rows: SR.looks.flatMap((/** @type {any} */ l) => [
      { name: `${l.name}: standing, from the front and right`, run: () => shotRun('none', null, l.id), picks: standPicks },
      { name: `${l.name}: walking, ${walk} m/s, from the right`, view: SIDE, run: walkRun(l.id), picks: (/** @type {any[]} */ rec) => o.stridePicks(rec).filter((_, i) => i % 2 === 0) },
      { name: `${l.name}: swingDouble, the two-hit swing`, run: () => shotRun('swingDouble', FR.mask, l.id), picks: evenPicks(durOf('swingDouble'), 8) },
    ]),
  };

  // C3: the clips for the island as Matt made them, whole (which part of each serves).
  const raw = /** @type {Record<string, string>} */ ({ pull: 'Pull_Radish: Lift with the shovel', collect: 'Collect_Object: picking up and gathering', squat: 'air_squat: going down to kneel' });
  const RIGHT = { yaw: -Math.PI / 2 + 0.35, pitch: 0.14, dist: 4 };
  STRIPS.c3raw = {
    title: 'Island clips, whole', tile: [180, 250], view: RIGHT,
    rows: Object.entries(raw).map(([n, label]) => ({ name: label, run: () => shotRun(n, null, null), picks: evenPicks(durOf(n), 10) })),
  };

  // C3 as the game plays them: each with Matt's clip (figure.json clips.shots), then as the code
  // alone did it. Gathering kneels for the gather recipe's kneelS with the gather gesture; Lift is
  // the liftClump act, the shovel drawn from the hands; kneeling is the Kneel button held 2 s.
  const G = await json('../recipes/world/gather.json');
  /** @param {'gather' | 'kneel'} kind @param {boolean} withClips */
  function islandRun(kind, withClips) {
    const motion = o.createFigureMotion(R, built.skeleton, withClips ? clips : null);
    const kneelS = kind === 'gather' ? G.kneelS ?? 1.2 : 2;
    let t = 0;
    return {
      motion,
      step() {
        t += DT;
        const posture = /** @type {'stand' | 'kneel'} */ (t >= 0.5 && t < 0.5 + kneelS ? 'kneel' : 'stand');
        if (kind === 'gather' && Math.abs(t - 0.5) < DT / 2) motion.gesture('gather');
        return { t, r: motion.update(DT, { ...STILL, posture }) };
      },
      place: () => [0, 0, 0, 0],
      props: held(motion, null),
    };
  }
  /** n frames from a to b seconds. @param {number} a @param {number} b @param {number} n */
  const spanPicks = (a, b, n) => () => Array.from({ length: n }, (_, k) => { const s = a + ((b - a) * k) / (n - 1); return { i: Math.round(s / DT), label: `${(s - 0.5).toFixed(2)} s` }; });
  const liftLen = R.poses.liftClump.keys.at(-1).t / (R.poses.liftClump.speed ?? 1);
  STRIPS.c3 = {
    title: 'On the island', tile: [200, 270], view: RIGHT,
    rows: [
      { name: 'Gather (Collect_Object), kneeling', run: () => islandRun('gather', true), picks: spanPicks(0.4, 2.4, 9) },
      { name: 'Gather, the code alone (before)', run: () => islandRun('gather', false), picks: spanPicks(0.4, 2.4, 9) },
      { name: 'Lift with the shovel (Pull_Radish)', view: { yaw: -Math.PI / 2, pitch: 0.16, dist: 4 }, run: () => o.digRun('liftClump', true), picks: spanPicks(0.4, 0.6 + liftLen, 9), overlay: true },
      { name: 'Lift with the shovel, the code alone (before)', view: { yaw: -Math.PI / 2, pitch: 0.16, dist: 4 }, run: () => o.digRun('liftClump', false), picks: spanPicks(0.4, 0.6 + liftLen, 9), overlay: true },
      { name: 'Kneel and get up (air_squat)', run: () => islandRun('kneel', true), picks: spanPicks(0.4, 3.6, 9) },
      { name: 'Kneel and get up, the code alone (before)', run: () => islandRun('kneel', false), picks: spanPicks(0.4, 3.6, 9) },
    ],
  };
}
