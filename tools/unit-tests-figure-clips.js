// @ts-check
// Walker clip tests for tools/unit-tests.html (C1 and C3, October 27, 2026; split from
// unit-tests-figure.js): the fighting clips sit in their own file on the same driven bones, each
// named under its pose, and the lantern arm stays the code's while a masked one plays; the island's
// pick-up, gather and kneel clips each play a span inside their clip, never lengthen the act, and
// leave the walker standing again.

import { createFigureMotion } from '../src/world/figure/motion.js';
import { loadFigureClips } from '../src/world/figure/clips.js';
import { len, sub, matPoint, matPointInv } from '../src/world/figure/kinematics.js';
import { actLength, gestureLength } from '../src/world/figure/acts.js';
import { load, playAct } from './unit-tests-figure.js';

const FIG = 'walker figure';

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addFigureClipTests(test, assert, eq) {
  test(FIG, 'fighting clips (C1): their own file on the same bones, every clip the recipe names by pose, finite; the lantern arm stays the code\'s while one plays', async () => {
    const { R, built } = await load();
    const C = await loadFigureClips(R);
    const FR = await (await fetch('../recipes/world/fight-clips.json')).json();
    const F = await (await fetch(`../${FR.file}`)).json();
    eq(F.bones.join(), C.bones.join(), 'the same driven bones as the walk clips');
    assert(Object.keys(C.clips).every((n) => !F.clips[n]), 'none of them in the game\'s own clip file');
    for (const [name, c] of Object.entries(FR.clips)) {
      const k = F.clips[name];
      assert(k && k.data.length === k.frames * (3 + 4 * F.bones.length) && k.data.every(Number.isFinite), `${name} there and finite`);
      assert(FR.poses[/** @type {any} */ (c).pose]?.includes(name), `${name} listed under its pose`);
    }
    for (const pose of ['Swing', 'Plant', 'Raise', 'Throw', 'Point']) assert(FR.poses[pose]?.length, `a clip for ${pose}`);
    // The point is mirrored onto the weapon hand: at its height the right hand is well above the left.
    const PC = F.clips.pointCast, stride = 3 + 4 * F.bones.length;
    const pointer = createFigureMotion(R, built.skeleton, C);
    pointer.addClips(F);
    const hand = (/** @type {string} */ n) => { const i = built.skeleton.findIndex((b) => b.name === n); return matPoint(pointer.bones, i * 16, built.skeleton[i].pivot)[1]; };
    pointer.shoot('pointCast', { mask: FR.mask, feet: FR.clips.pointCast.feet });
    let lift = 0;
    for (let f = 0; f < PC.dur * 60; f++) { pointer.update(1 / 60, { x: 0, z: 0, y: 0, yaw: 0, speed: 0, moving: false, ground: () => 0, depth: () => 0, below: true }); lift = Math.max(lift, hand('hand.r') - hand('hand.l')); }
    assert(lift > 0.3 && PC.data.length === PC.frames * stride, `the right hand points (up to ${(lift * 100).toFixed(0)} cm over the left)`);
    assert(!FR.mask.some((/** @type {string} */ b) => b.endsWith('.l') && /Arm|hand/.test(b)), 'the mask leaves the left arm out');
    // A swing played standing, masked and not: the left forearm matches a still walker only when masked.
    const dt = 1 / 60, still = { x: 0, z: 0, y: 0, yaw: 0, speed: 0, moving: false, ground: () => 0, depth: () => 0, below: true };
    const run = (/** @type {string[] | null} */ mask) => {
      const m = createFigureMotion(R, built.skeleton, C);
      m.addClips(F);
      for (let f = 0; f < 30; f++) m.update(dt, still);
      const len = m.shoot('swingDouble', { mask: mask ?? undefined, feet: true });
      const out = [];
      for (let f = 0; f < len * 60 + 30; f++) { m.update(dt, still); out.push(m.bones.slice()); }
      return { len, out, done: m.shooting === null };
    };
    const base = createFigureMotion(R, built.skeleton, C), ref = [];
    for (let f = 0; f < 30 + 60 * 3.5; f++) { base.update(dt, still); if (f >= 30) ref.push(base.bones.slice()); }
    // The hand as the chest carries it (the masked arm still rides the body's twist and bend).
    const ch = built.skeleton.findIndex((b) => b.name === 'chest'), fa = built.skeleton.findIndex((b) => b.name === 'hand.l'), p = built.skeleton[fa].pivot;
    const onChest = (/** @type {Float32Array} */ b) => matPointInv(b, ch * 16, matPoint(b, fa * 16, p));
    const spread = (/** @type {Float32Array[]} */ fr) => Math.max(...fr.slice(0, 160).map((b, i) => len(sub(onChest(b), onChest(ref[i])))));
    const masked = run(FR.mask), whole = run(null);
    assert(masked.len > 2 && masked.done, 'it plays its length and ends');
    assert(masked.out.every((b) => b.every(Number.isFinite)), 'finite');
    const m1 = spread(masked.out), m2 = spread(whole.out);
    assert(m1 < 0.03, `masked, the lantern hand moved ${(m1 * 100).toFixed(1)} cm on the chest`);
    assert(m2 > 0.1, `unmasked, Meshy's left arm swings (${(m2 * 100).toFixed(1)} cm)`);
    return `${Object.keys(F.clips).length} clips; lantern hand ${(m1 * 100).toFixed(1)} cm on the chest masked, ${(m2 * 100).toFixed(0)} cm not`;
  });

  test(FIG, 'island clips (C3): each act, gesture and the kneel names a clip and a span inside it, never lengthens the act, and plays finite and back to rest', async () => {
    const { R, built } = await load();
    const C = await loadFigureClips(R);
    const S = R.clips.shots;
    for (const [name, sh] of Object.entries(S)) {
      const c = C.clips[/** @type {any} */ (sh).clip];
      assert(c && !c.loop, `${name}: ${sh.clip} is a one-shot`);
      for (const span of [sh.span, sh.down, sh.up].filter(Boolean)) assert(span[0] >= 0 && span[1] <= c.dur + 1e-3 && span[1] > span[0], `${name}: span inside the clip`);
    }
    const lift = playAct(R, built, createFigureMotion(R, built.skeleton, C), 'liftClump');
    eq(lift.len, actLength(R.poses, 'liftClump'), 'Lift keeps its length');
    assert(lift.frames.every((f) => f.finite), 'Lift finite');
    assert(lift.frames.some((f) => f.done === 'liftClump'), 'Lift ends');
    const motion = createFigureMotion(R, built.skeleton, C), dt = 1 / 60;
    const s = (/** @type {'stand'|'kneel'} */ posture) => ({ x: 0, z: 0, y: 0, yaw: 0, speed: 0, moving: false, ground: () => 0, depth: () => 0, below: true, posture });
    for (let f = 0; f < 30; f++) motion.update(dt, s('stand'));
    motion.update(dt, s('kneel'));
    assert(motion.shooting === 'squat', 'going down to kneel plays the squat');
    eq(motion.gesture('gather'), gestureLength(R.poses, 'gather'), 'gather keeps its length');
    for (let f = 0; f < 120; f++) motion.update(dt, s('kneel'));
    for (let f = 0; f < 120; f++) { motion.update(dt, s('stand')); assert(motion.bones.every(Number.isFinite), 'finite getting up'); }
    eq(motion.shooting, null, 'nothing left playing');
    const head = built.skeleton.findIndex((b) => b.name === 'head');
    const up = matPoint(motion.bones, head * 16, built.skeleton[head].pivot)[1];
    assert(Math.abs(up - built.skeleton[head].pivot[1]) < 0.08, `standing again (head ${up.toFixed(2)} m)`);
    return `Lift ${lift.len.toFixed(2)} s, gather ${gestureLength(R.poses, 'gather').toFixed(2)} s, kneel ${R.ease.postureS} s`;
  });
}
