// @ts-check
// Clip strips for tools/walker-strip.html (C1 to C3, October 27, 2026). C1: each fighting clip
// (recipes/world/fight-clips.json) played once on our walker with the lantern arm masked, the lantern
// in the left hand and the driftwood staff in the right, beside the same clip as Meshy made it (both
// arms, no mask). C2: the staff's two looks in hand, standing, walking and swinging. C3: the pick-up,
// gather and kneel clips as Matt made them, whole, to see which part of each serves. The lantern and
// the staff are drawn in hand by walker-held.js.

import { createHeld } from './walker-held.js';

/**
 * @param {{ STRIPS: Record<string, any>, R: any, W: any, built: any, DT: number, createFigureMotion: Function, clips: any,
 *   strideRun: (pace: number, clips?: boolean) => any, stridePicks: (rec: any[]) => any[], digRun: (act?: string, clips?: boolean) => any }} o
 */
export async function addClipStrips(o) {
  const { STRIPS, R, built, DT, clips } = o;
  if (!clips) return;
  const json = async (/** @type {string} */ p) => (await fetch(p)).json();
  const FR = await json('../recipes/world/fight-clips.json');
  const FIGHT = await json(`../${FR.file}`);
  /** What still looks off in Matt's Text-to-Animation pair after the cheap cleaning, for him to decide on regenerating. @type {Record<string, string>} */
  const OFF = {
    throwToss: 'the release goes out level at chest height, not up and forward; the arm then holds out about half a second; the wind-up is a deep bow from the waist.',
    pointCast: 'it points up and across to the left, not straight ahead; the chest still turns that way; the hand comes back near the face before it lowers.',
  };
  const DS = R.body.displayScale ?? 1;
  const H = await createHeld(R, built), SR = H.SR;
  /**
   * What the walker holds now: the lantern, and the staff (a look) or nothing.
   * @param {any} motion @param {string | null} look @param {() => number[]} [place] where the run has the figure
   */
  const held = (motion, look, place = () => [0, 0, 0, 0]) => () => H.held(motion, { lantern: true, look }, place());

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
  const names = Object.keys(FR.clips).filter((n) => !OFF[n] && !FR.clips[n].layer), per = 3;
  /** Marks the row Matt picked (fight-clips.json mask). @param {any} c @param {boolean} masked */
  const pick = (c, masked) => ((c.mask ?? true) === masked ? ' (your pick)' : '');
  for (let s = 0; s * per < names.length; s++) {
    const group = names.slice(s * per, s * per + per);
    STRIPS[`fight${s + 1}`] = {
      title: `Fighting clips ${s + 1}`, tile: [200, 270], view: FRONT,
      rows: group.flatMap((n) => {
        const c = FR.clips[n], picks = evenPicks(durOf(n), 8);
        return [
          { name: `${n} (${c.meshy}, ${c.pose}), lantern arm masked, staff in hand${pick(c, true)}`, run: () => shotRun(n, FR.mask, 'slim'), picks },
          { name: `${n} as Meshy made it: both arms${pick(c, false)}`, run: () => shotRun(n, null, null), picks },
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
        { name: `${n} (${c.pose}), lantern arm masked, from the front and right${pick(c, true)}`, note: `Cleaned: ${c.made}.`, run: () => shotRun(n, FR.mask, 'slim'), picks },
        { name: `${n}, from the right`, note: `Still off: ${OFF[n]}`, view: SIDEV, run: () => shotRun(n, FR.mask, 'slim'), picks },
        { name: `${n} cleaned, no mask: both arms${pick(c, false)}`, run: () => shotRun(n, null, null), picks },
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

  // Raise the lantern (Matt, October 27, 2026): the right mouse held, a layer on the lantern arm over
  // everything (clips.js hold): standing, walking, and through a swing; up for ~0.65 s, then let go.
  const RL = FR.clips.raiseLantern, HOLD = 0.65;
  /** Hold the raise from AT to AT + HOLD in a run whose motion this sets each step. @param {any} r a run */
  const raised = (r) => {
    let t = 0;
    return { ...r, step() { t += DT; r.motion.hold('raiseLantern', t >= AT && t < AT + HOLD, RL.layer); return r.step(); } };
  };
  const raisePicks = () => [0, 0.05, 0.1, 0.15, 0.4, HOLD, HOLD + 0.07, HOLD + 0.14, HOLD + 0.3].map((s) => ({ i: Math.round((AT + s) / DT), label: s < HOLD ? `${s.toFixed(2)} s held` : `${(s - HOLD).toFixed(2)} s let go` }));
  STRIPS.raise = {
    title: `Raise the lantern: up ${RL.layer.upS} s, down ${RL.layer.downS} s`, tile: [200, 270], view: FRONT,
    rows: [
      { name: 'Standing, from the front and right', run: () => raised(shotRun('none', null, 'slim')), picks: raisePicks },
      { name: 'Standing, from the left (the lantern side)', view: { yaw: Math.PI / 2, pitch: 0.12, dist: 4.2 }, run: () => raised(shotRun('none', null, 'slim')), picks: raisePicks },
      { name: `Walking, ${walk} m/s, from the left`, view: { yaw: Math.PI / 2, pitch: 0.12, dist: 4.2 }, run: () => { const r = o.strideRun(walk, true); r.motion.addClips(FIGHT); return raised({ ...r, props: held(r.motion, 'slim', r.place) }); }, picks: raisePicks },
      { name: 'Through the first swing of swingTriple (held all along)', run: () => raised(shotRun('swingTriple', FR.clips.swingTriple.mask ? FR.mask : null, 'slim')), picks: raisePicks },
    ],
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
