// @ts-check
// Walker figure tests for tools/unit-tests.html (doc 23, W5): the GLB reader reads the figure, the
// rig has its 20 bones parents first with skin weights that add up, the IK reaches, blinks keep
// their spacing, a planted foot never slides while walking, the feet stand on a slope, the same
// walk poses the same twice, and the figure never changes the walker's state. The keeper's camp acts
// (drink, pitch, lay, strike, crawlIn, climbOut) each end after their recipe length with finite
// bones, the feet stay put while a kneeling act's hands work, crawlIn stays low until climbOut, and
// a placed figure starts in its posture.

import { readGlb, meshesByName, materialMaps } from '../src/render/gltf.js';
import { buildFigure, anchorWeights } from '../src/world/figure/rig.js';
import { createFigureMotion } from '../src/world/figure/motion.js';
import { loadFigureClips } from '../src/world/figure/clips.js';
import { twoBone, len, sub, qrot } from '../src/world/figure/kinematics.js';
import { blinkAt } from '../src/world/figure/eyes.js';
import { matPoint } from '../src/world/figure/kinematics.js';
import { createFootprints } from '../src/world/figure/footprints.js';
import { ACTS, actLength, gestureNames, gestureLength } from '../src/world/figure/acts.js';
import { paceAt, footInCycle } from '../src/world/figure/gait.js';
import { createLean } from '../src/world/figure/lean.js';
import { createLook } from '../src/world/figure/look.js';

const FIG = 'walker figure';

/**
 * Stand the figure still for a second, play an act, and report each frame from the act's start to
 * a second past its end: the ankles in the world, the posture weights, and whether it ended then.
 * @param {any} R @param {any} built @param {any} motion @param {string} name @param {'stand'|'kneel'} [posture]
 */
function playAct(R, built, motion, name, posture = 'stand') {
  const feet = ['foot.l', 'foot.r'].map((n) => built.skeleton.findIndex((/** @type {any} */ b) => b.name === n));
  const k = R.body.displayScale ?? 1, dt = 1 / 60;
  const s = Object.freeze({ x: 0, z: 0, y: 0, yaw: 0, speed: 0, moving: false, ground: () => 0, depth: () => 0, below: true, posture });
  for (let f = 0; f < 60; f++) motion.update(dt, s);
  const len = motion.act(name);
  const frames = [];
  for (let f = 0; f < (len + 1) * 60; f++) {
    const r = motion.update(dt, s);
    const ankles = feet.map((i) => matPoint(motion.bones, i * 16, built.skeleton[i].pivot).map((v) => v * k));
    frames.push({ u: (f + 1) * dt, done: r.actDone, ankles, info: { ...motion.info }, finite: motion.bones.every(Number.isFinite) });
  }
  return { len, frames };
}

async function load() {
  const R = await (await fetch('../recipes/world/figure.json')).json();
  const glb = readGlb(await (await fetch(`../${R.model}`)).arrayBuffer());
  return { R, glb, built: buildFigure(glb, R) };
}

/**
 * Walk the figure in a straight line along +x at `speed` over ground h, and report each frame's
 * ankle positions in the world. @param {any} R @param {any} built @param {number} speed
 * @param {(x: number, z: number) => number} h @param {number} seconds
 * @param {any} [clips] Matt's clips (clips.js), or the code's own stride
 */
function walk(R, built, speed, h, seconds, clips = null) {
  const motion = createFigureMotion(R, built.skeleton, clips);
  const feet = ['foot.l', 'foot.r'].map((n) => built.skeleton.findIndex((/** @type {any} */ b) => b.name === n));
  const dt = 1 / 60;
  let x = 0;
  const frames = [];
  for (let f = 0; f < seconds * 60; f++) {
    const moving = f > 10;
    const v = moving ? speed : 0;
    x += v * dt;
    const s = Object.freeze({ x, z: 0, y: h(x, 0), yaw: Math.PI / 2, speed: v, moving, ground: h, depth: () => 0, below: true });
    const r = motion.update(dt, s);
    const c = Math.cos(r.yaw), sn = Math.sin(r.yaw);
    const ankles = feet.map((i) => {
      const p = matPoint(motion.bones, i * 16, built.skeleton[i].pivot);
      const k = R.body.displayScale ?? 1;   // the figure is drawn at this size (the shader scales the rig)
      return [x + k * (c * p[0] + sn * p[2]), h(x, 0) + k * p[1], k * (-sn * p[0] + c * p[2])];
    });
    frames.push({ ankles, info: { ...motion.info }, bones: motion.bones.slice() });
  }
  return frames;
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addFigureTests(test, assert, eq) {
  test(FIG, 'the hurry pace is a run: a flight between steps, a longer stride and lean, the hips lowest over the foot; the walk is its own pace (October 26, 2026: walk 2.2 m/s, about 3 body m/s)', async () => {
    const R = await (await fetch('../recipes/world/figure.json')).json();
    const G = R.gait, DS = R.body.displayScale;
    const W = await (await fetch('../recipes/world/walker.json')).json();
    const stroll = paceAt(G, W.pace.strollMps / DS, 0), run = paceAt(G, W.pace.briskMps / DS, 0), top = G.paces.find((/** @type {any} */ p) => p.speed === 3);
    for (const k of ['stance', 'stepM', 'armDeg', 'leanDeg', 'bobM']) assert(Math.abs(stroll[k] - top[k]) <= Math.abs(top[k]) * 0.02 + 1e-6, `walk ${k} is the walk pace: ${stroll[k]}`);
    assert(run.stance < 0.5 && run.bobM < 0, 'the run: under half a stride down, hips lowest over the planted foot');
    // Short, quick strides at the run (Matt, October 26, 2026: long ones over-reached and bobbed), still longer than the walk.
    assert(run.stepM > stroll.stepM * 1.3 && run.kickM <= 0.06 && Math.abs(run.bobM) <= 0.012 && run.leanDeg > stroll.leanDeg && run.elbowDeg > stroll.elbowDeg + 40, 'a longer stride, a small heel kick and bob, more lean, elbows bent to pump');
    // Somewhere in the cycle both feet are off the ground at the run, never at the stroll.
    const airborne = (/** @type {any} */ P) => Array.from({ length: 200 }, (_, i) => i / 200).some((p) =>
      !footInCycle(p, P.stance, P.stepM, P.liftM).down && !footInCycle((p + 0.5) % 1, P.stance, P.stepM, P.liftM).down);
    assert(airborne(run) && !airborne(stroll), 'a flight phase at the run only');
    // Each pace names the same things, so the blend never meets a gap.
    const keys = Object.keys(G.paces[0]).sort().join();
    assert(G.paces.every((/** @type {any} */ p) => Object.keys(p).sort().join() === keys), 'every pace has the same keys');
    return `run: stance ${run.stance.toFixed(2)}, stride ${run.stepM.toFixed(2)} m, lean ${run.leanDeg.toFixed(0)} degrees`;
  });

  test(FIG, 'the body leans into a start and a stop: forward setting off, more at a jog than a stroll, back past upright once on stopping, then still', async () => {
    const R = await (await fetch('../recipes/world/figure.json')).json();
    const W = await (await fetch('../recipes/world/walker.json')).json();
    const G = R.gait, DS = R.body.displayScale, a = W.pace.accelMps2 / DS, dt = 1 / 60;
    const lean = createLean(R.lean, (v) => paceAt(G, v, 0));
    /** Ease up to `top` (body m/s), hold, brake at three times the rate, stand: the lean each frame. @param {number} top */
    const run = (top) => {
      lean.reset();
      const out = [];
      let v = 0;
      for (let f = 0; f < 600; f++) {
        const t = f * dt, want = t < 0.2 ? 0 : t < 3 ? top : 0;
        const nv = v + Math.sign(want - v) * Math.min(Math.abs(want - v), (want > v ? a : a * 3) * dt);
        // The lean the pace asks for (motion.js eases between them; here it steps, a harder test),
        // measured from where it rests standing.
        const base = nv > 0.05 ? paceAt(G, nv, 0).leanDeg : 1.5;
        out.push({ t, v: nv, deg: lean.update(dt, nv, (nv - v) / dt, base) - (nv > 0.05 || t < 0.2 ? base : 1.5) });
        v = nv;
      }
      return out;
    };
    const stroll = run(W.pace.strollMps / DS), jog = run(W.pace.briskMps / DS);
    const peak = (/** @type {any[]} */ r, /** @type {number} */ t0, /** @type {number} */ t1, /** @type {number} */ s) => Math.max(...r.filter((q) => q.t >= t0 && q.t < t1).map((q) => s * q.deg));
    const sTip = peak(stroll, 0, 1.5, 1), jTip = peak(jog, 0, 2, 1);
    assert(sTip > 2 && jTip > sTip * 1.3, `tips forward setting off: stroll ${sTip.toFixed(1)}, jog ${jTip.toFixed(1)} degrees`);
    const stop = stroll.findIndex((q) => q.t > 3 && q.v === 0), back = peak(stroll.slice(stop), 0, 99, -1);
    assert(back > 1 && back < sTip, `settles back past its resting lean, gently: ${back.toFixed(1)} degrees`);
    // One swing back, not a wobble: it never comes forward again by more than a third of that.
    const after = stroll.slice(stop).findIndex((q) => q.deg < -back * 0.99) + stop;
    assert(peak(stroll.slice(after), 0, 99, 1) < back / 3 + 0.05, 'one swing back, then it settles');
    assert(Math.abs(stroll[stroll.length - 1].deg) < 0.05, 'still, at rest');
    // Walking on at a steady pace, no wobble behind the pace's lean.
    assert(peak(stroll.filter((q) => q.t > 1.6 && q.t < 3), 0, 99, -1) < 0.3, 'never leans back while walking on');
    return `stroll tip ${sTip.toFixed(1)}, jog tip ${jTip.toFixed(1)}, settle back ${back.toFixed(1)} degrees`;
  });

  test(FIG, 'the head looks at things in front (eyes first, eased, within limits), never behind, a click first, and lets a passing thing be', async () => {
    const R = await (await fetch('../recipes/world/figure.json')).json();
    const L = R.look, D = Math.PI / 180, dt = 1 / 60;
    const look = createLook(L);
    const at = (/** @type {number} */ deg, /** @type {number} */ m, kind = 'find') => ({ x: Math.sin(deg * D) * m, y: 0, z: Math.cos(deg * D) * m, kind });
    /** Run for `s` seconds with these interests; every frame's result. @param {number} s @param {any[]} interests */
    const run = (s, interests = [], m = 0) => Array.from({ length: Math.round(s / dt) }, () => look.update(dt, { x: 0, z: 0, eyeY: 1, yaw: 0, m, viewYaw: null, extraYaw: 0, interests }));
    // Nothing: ahead.
    assert(Math.abs(run(1).at(-1).yaw) < 1e-6, 'ahead with nothing to look at');
    // A creature 80 degrees to the left: the eyes move before the head, the turn eases and stays in its limits.
    const frog = at(80, 2, 'creature');
    const r = run(2, [frog]);
    const eyeFirst = r.findIndex((q) => Math.abs(q.eyes[0]) > 0.003), headFirst = r.findIndex((q) => Math.abs(q.yaw) > 1 * D);
    assert(eyeFirst >= 0 && eyeFirst < headFirst, `the eyes lead (frame ${eyeFirst}, the head at ${headFirst})`);
    let fastest = 0;
    for (let i = 1; i < r.length; i++) fastest = Math.max(fastest, Math.abs(r[i].yaw - r[i - 1].yaw) / dt);
    assert(fastest <= L.degPerS * D + 1e-6, `never faster than ${L.degPerS} degrees a second (${(fastest / D).toFixed(0)})`);
    const end = r.at(-1);
    assert(Math.abs(end.yaw) <= L.maxYawDeg * D + 1e-6 && Math.abs(end.chest) <= L.chestMaxDeg * D + 1e-6, 'head and chest in their limits');
    assert(Math.abs(end.yaw + end.chest - 75 * D) < 2 * D && end.eyes[0] > 0, `head and chest turn 75 of the 80 degrees (${((end.yaw + end.chest) / D).toFixed(1)}), the eyes the rest`);
    // Behind you: never.
    look.reset();
    assert(Math.abs(run(2, [at(160, 1, 'creature')]).at(-1).yaw) < 1e-6, 'a creature behind you is not looked round at');
    // A find in front, then a click elsewhere takes over at once (after the head's short wait).
    look.reset();
    run(1, [at(-30, 1)]);
    look.focus(Math.sin(40 * D) * 3, 0, Math.cos(40 * D) * 3);
    const f = run(1.5, [at(-30, 1)]).at(-1);
    assert(f.target?.kind === 'focus' && f.yaw + f.chest > 30 * D, 'a click wins over a find');
    // A find is looked at for its dwell, then let be: the head comes back to ahead.
    look.reset();
    const find = run(L.kinds.find.dwellS + 3, [at(20, 1.5)]);
    assert(find.some((q) => q.target?.kind === 'find') && find.at(-1).target === null && Math.abs(find.at(-1).yaw) < 1 * D, 'a find is looked at, then let be');
    // Walking it turns less.
    look.reset();
    const walking = run(2, [at(40, 3, 'creature')], 1).at(-1);
    look.reset();
    const still = run(2, [at(40, 3, 'creature')], 0).at(-1);
    assert(Math.abs(walking.yaw + walking.chest) < Math.abs(still.yaw + still.chest) * 0.7, 'walking, it turns less');
    return `eyes lead by ${headFirst - eyeFirst} frames, top speed ${(fastest / D).toFixed(0)} degrees a second`;
  });

  test(FIG, 'each gesture plays over the posture and ends back at rest, feet planted, every bone finite; sow is one quick flick; a walk fades one; getting up plays rise', async () => {
    const { R, built } = await load();
    const k = R.body.displayScale ?? 1, dt = 1 / 60, D = R.poses.gestures;
    const feet = ['foot.l', 'foot.r'].map((n) => built.skeleton.findIndex((/** @type {any} */ b) => b.name === n));
    const ankles = (/** @type {any} */ m) => feet.map((i) => matPoint(m.bones, i * 16, built.skeleton[i].pivot).map((v) => v * k));
    /** @param {'stand'|'kneel'} posture @param {boolean} [moving] */
    const s = (posture = 'stand', moving = false) => Object.freeze({ x: 0, z: 0, y: 0, yaw: 0, speed: moving ? 0.6 : 0, moving, ground: () => 0, depth: () => 0, below: true, posture });
    const report = [];
    const names = gestureNames(R.poses);
    for (const name of names.filter((n) => D[n].keys.length)) {
      // A twin that never gestures, stepped alongside, for the pose at rest (breathing and blinks keep time).
      const m = createFigureMotion(R, built.skeleton), rest = createFigureMotion(R, built.skeleton);
      const both = (/** @type {any} */ q) => { m.update(dt, q); rest.update(dt, q); };
      for (let f = 0; f < 60; f++) both(s());
      const before = ankles(m), len = m.gesture(name);
      eq(len, gestureLength(R.poses, name), `${name} length`);
      assert(len > 0.5 && len < 9, `${name} lasts ${len} s`);
      let finite = true, worst = 0, played = false;
      for (let f = 0; f < (len + 0.2) * 60; f++) {
        both(s());
        finite &&= m.bones.every(Number.isFinite);
        played ||= m.info.gesture === name;
        // Feet stay where they were planted (a kneel's own step is allowed: only standing gestures here).
        if (!D[name].keys.some((/** @type {any} */ q) => q.kneel)) for (let i = 0; i < 2; i++) worst = Math.max(worst, Math.hypot(...[0, 2].map((j) => ankles(m)[i][j] - before[i][j])));
      }
      assert(finite && played, `${name} played with finite bones`);
      assert(worst < 0.005, `${name}: a foot moved ${(worst * 100).toFixed(2)} cm`);
      eq(m.info.gesture, null, `${name} is over`);
      // A few seconds on, back at rest: the same pose as a figure that never gestured, near enough.
      for (let f = 0; f < 600; f++) both(s());
      let off = 0;
      for (let j = 0; j < m.bones.length; j++) off = Math.max(off, Math.abs(m.bones[j] - rest.bones[j]));
      assert(off < 0.02, `${name}: ${off.toFixed(3)} off rest afterwards`);
      report.push(`${name} ${len} s`);
    }
    // sow (D1a): one quick flick, under a second, so a click after click never queues up.
    const sowS = createFigureMotion(R, built.skeleton).gesture('sow');
    assert(sowS > 0.5 && sowS < 1, `sow is one quick flick (${sowS} s)`);
    eq(createFigureMotion(R, built.skeleton).gesture('cartwheel'), 0, 'an unknown gesture plays nothing');
    // A walk fades a gesture out over ease.gestureFadeS, never cutting it.
    const w = createFigureMotion(R, built.skeleton);
    for (let f = 0; f < 60; f++) w.update(dt, s());
    w.gesture('empty');
    for (let f = 0; f < 20; f++) w.update(dt, s());
    let x = 0, frames = 0;
    while (w.info.gesture && frames < 120) { x += 0.6 * dt; w.update(dt, { ...s('stand', true), x }); frames++; }
    assert(frames > 2 && frames <= Math.ceil(R.ease.gestureFadeS / dt) + 1, `a walk faded it over ${frames} frames`);
    // While a camp act plays, no gesture.
    const a = createFigureMotion(R, built.skeleton);
    a.act('strike');
    eq(a.gesture('gather'), 0, 'no gesture over a camp act');
    // Getting up from a kneel, standing still: rise plays.
    const g = createFigureMotion(R, built.skeleton);
    for (let f = 0; f < 180; f++) g.update(dt, s('kneel'));
    g.update(dt, s('stand'));
    eq(g.info.gesture, 'rise', 'getting up plays rise');
    return report.join(', ');
  });

  test(FIG,'the GLB reader reads the figure: a body and two arms, with colour, part labels and the arms\' shoulders', async () => {
    const R = await (await fetch('../recipes/world/figure.json')).json();
    const glb = readGlb(await (await fetch(`../${R.model}`)).arrayBuffer());
    const m = meshesByName(glb);
    eq([...m.keys()].sort().join(','), 'arm.l,arm.r,body', 'parts');
    for (const [name, part] of m) {
      for (const a of ['POSITION', 'NORMAL', 'COLOR_0', '_PART']) assert(part.attributes[a], `${name} has ${a}`);
      assert(part.indices.length % 3 === 0, `${name} indices make triangles`);
    }
    assert(glb.json.extras.arms['arm.l'].shoulder.length === 3, 'left shoulder');
    let bad = false;
    try { readGlb(new ArrayBuffer(24)); } catch { bad = true; }
    assert(bad, 'a file that is not a GLB is refused');
    return `${m.get('body')?.indices.length / 3} body triangles`;
  });

  test(FIG, 'the rig has 20 bones, parents first, and every vertex\'s weights add to one', async () => {
    const { built } = await load();
    eq(built.skeleton.length, 20, 'bones');
    built.skeleton.forEach((/** @type {any} */ b, /** @type {number} */ i) => assert(b.parent < i, `${b.name} after its parent`));
    const u = new Uint8Array(built.data);
    for (let v = 0; v < built.count; v++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += u[v * 44 + 40 + k];
        assert(u[v * 44 + 36 + k] < 20, 'joint in range');
      }
      if (sum !== 255) throw new Error(`vertex ${v} weights add to ${sum}`);
    }
    const w = anchorWeights([[0, 'a'], [1, 'b']], 0.5);
    assert(Math.abs(w[0][1] + w[1][1] - 1) < 1e-9 && Math.abs(w[0][1] - 0.5) < 1e-9, 'halfway blends evenly');
    eq(anchorWeights([[0, 'a'], [1, 'b']], -1)[0][0], 'a', 'below the first anchor');
    return `${built.count} vertices`;
  });

  test(FIG, 'two-bone IK reaches a target in reach, bending toward the pole', () => {
    const H = [0, 1, 0], K = [0, 0.5, 0.01], A = [0, 0, 0];
    const T = [0.2, 0.3, 0.3];
    const r = twoBone(H, K, A, T, [0, 0, 1]);
    // The end at rest, carried by both turns about their joints.
    const knee = r.joint;
    const end = [0, 1, 2].map((i) => knee[i] + qrot(r.q1, qrot(r.q2, sub(A, K)))[i]);
    assert(len(sub(end, T)) < 1e-6, `reaches the target (off by ${len(sub(end, T))})`);
    assert(knee[2] > 0.1, 'the knee bends toward the pole');
  });

  test(FIG, 'blinks come every 3 to 7 seconds, the same every time', async () => {
    const { R } = await load();
    const starts = [];
    let was = 0;
    for (let t = 0; t < 300; t += 0.005) {
      const b = blinkAt(t, R.eyes.blink);
      if (b > 0 && was === 0) starts.push(t);
      was = b;
    }
    const gaps = starts.slice(1).map((s, i) => s - starts[i]);
    assert(gaps.length > 40, 'blinks happen');
    assert(Math.min(...gaps) >= R.eyes.blink.everyS[0] - 0.02 && Math.max(...gaps) <= R.eyes.blink.everyS[1] + 0.02, `gaps ${Math.min(...gaps).toFixed(2)} to ${Math.max(...gaps).toFixed(2)} s`);
    eq(blinkAt(123.456, R.eyes.blink), blinkAt(123.456, R.eyes.blink), 'the same time gives the same lid');
    return `${starts.length} blinks in 5 minutes`;
  });

  test(FIG, 'walking, a planted foot never slides (at a creep, a stroll and brisk)', async () => {
    const { R, built } = await load();
    const report = [];
    for (const speed of [0.3, 0.9, 1.5]) {
      const frames = walk(R, built, speed, () => 0, 6);
      let worst = 0;
      for (let i = 0; i < 2; i++) {
        // Runs of frames where the foot is on the ground (low and the stride's settled).
        let anchor = null;
        for (const f of frames.slice(120)) {
          const a = f.ankles[i];
          const down = a[1] < R.legs.ankleM * (R.body.displayScale ?? 1) + 0.004;
          if (down && anchor) worst = Math.max(worst, Math.hypot(a[0] - anchor[0], a[2] - anchor[2]));
          anchor = down ? anchor ?? a : null;
        }
      }
      report.push(`${speed} m/s ${(worst * 100).toFixed(1)} cm`);
      assert(worst < 0.012, `a planted foot slid ${(worst * 100).toFixed(1)} cm at ${speed} m/s`);
    }
    return report.join(', ');
  });

  test(FIG, 'the baked texture: colour and object-space normal maps in the GLB, and every vertex of the textured build carries a UV inside the atlas', async () => {
    const { R, glb } = await load();
    const maps = materialMaps(glb);
    assert(maps.baseColor && maps.normal, 'both maps are in the model');
    eq(glb.json.materials[0].extras?.normalSpace, 'object', 'the normal map is in the rest pose\'s own space');
    const built = buildFigure(glb, R, { textured: true });
    assert(built.textured, 'the build reads the UVs');
    const v = new Float32Array(built.data);
    let bad = 0;
    const stride = v.length / built.count;
    for (let k = 0; k < built.count; k++) {
      const u = v[k * stride + 6], w = v[k * stride + 7], flag = v[k * stride + 8];
      if (!(u >= 0 && u <= 1 && w >= 0 && w <= 1 && flag === 2)) bad++;
    }
    eq(bad, 0, 'UVs in 0..1 and marked');
    return `${built.count.toLocaleString()} vertices, maps ${maps.baseColor.bytes.length} and ${maps.normal.bytes.length} bytes`;
  });

  test(FIG, 'Meshy clips: the file holds every clip on our driven bones, finite, the walks and runs in place with a forward stride and left landings', async () => {
    const { R } = await load();
    const C = await loadFigureClips(R);
    assert(C, 'the clip file loads');
    eq(C.bones.length, 16, 'sixteen driven bones (hat, hat tip, skirt and pack are the springs\')');
    for (const p of R.clips.paces) {
      const c = C.clips[p.clip];
      assert(c && c.loop, `${p.clip} is a loop`);
      assert(c.speed > 0.2 && c.cycleM > 0.3, `${p.clip} strides forward (${c.speed} m/s)`);
      assert(c.landsL.length >= 1 && c.landsL.every((t) => t >= 0 && t < c.dur), `${p.clip} has its landings`);
    }
    for (const [name, c] of Object.entries(C.clips)) {
      eq(c.data.length, c.frames * (3 + 4 * C.bones.length), `${name} frame count`);
      assert(c.data.every(Number.isFinite), `${name} finite`);
    }
    assert(C.clips[R.clips.roll.clip] && !C.clips[R.clips.roll.clip].loop, 'the roll is there, not a loop');
    return `${Object.keys(C.clips).length} clips`;
  });

  test(FIG, 'Meshy clips: a planted foot never slides (at a creep, wading, a stroll and with Shift), and the same walk poses the same twice', async () => {
    const { R, built } = await load();
    const C = await loadFigureClips(R);
    const report = [];
    for (const speed of [0.45, 1.0, 2.2, 4.2]) {
      const frames = walk(R, built, speed, () => 0, 6, C);
      let worst = 0;
      for (let i = 0; i < 2; i++) {
        let anchor = null;
        for (const f of frames.slice(120)) {
          const a = f.ankles[i];
          const down = a[1] < R.legs.ankleM * (R.body.displayScale ?? 1) + 0.004;
          if (down && anchor) worst = Math.max(worst, Math.hypot(a[0] - anchor[0], a[2] - anchor[2]));
          anchor = down ? anchor ?? a : null;
        }
      }
      assert(frames.slice(60).every((f) => f.info.clip && f.info.clip.weight > 0.99), `the clips lead at ${speed} m/s`);
      report.push(`${speed} m/s ${(worst * 100).toFixed(1)} cm`);
      assert(worst < 0.02, `a planted foot slid ${(worst * 100).toFixed(1)} cm at ${speed} m/s`);
    }
    const a = walk(R, built, 2.2, () => 0, 2, C), b = walk(R, built, 2.2, () => 0, 2, C);
    for (let f = 0; f < a.length; f += 7) {
      for (let k = 0; k < a[f].bones.length; k++) if (a[f].bones[k] !== b[f].bones[k]) throw new Error(`frame ${f} differs`);
    }
    return report.join(', ');
  });

  test(FIG, 'Meshy clips: the roll plays on Space, never under the ground, and stands back up', async () => {
    const { R, built } = await load();
    const C = await loadFigureClips(R);
    const W = await (await fetch('../recipes/world/walker.json')).json();
    const motion = createFigureMotion(R, built.skeleton, C);
    const RL = W.steer.roll, dt = 1 / 60;
    let x = 0, lowest = Infinity, rolled = 0;
    for (let f = 0; f < 120; f++) {
      const t = f * dt, u = (t - 0.5) / RL.durS, rolling = u >= 0 && u <= 1 ? u : -1;
      if (rolling >= 0) x += (RL.distM / RL.durS) * dt;
      motion.update(dt, { x, z: 0, y: 0, yaw: 0, speed: rolling >= 0 ? RL.distM / RL.durS : 0, moving: rolling >= 0, rolling, ground: () => 0, depth: () => 0, below: true });
      assert(motion.bones.every(Number.isFinite), `finite at ${t.toFixed(2)} s`);
      // (From a few frames in: the very first frame settles the hips from nothing.)
      if (f > 5) built.skeleton.forEach((b, i) => { lowest = Math.min(lowest, matPoint(motion.bones, i * 16, b.pivot)[1]); });
      if (motion.info.clip.roll > 0.99) rolled++;
    }
    assert(rolled > RL.durS * 40, 'the clip leads through the roll');
    assert(lowest > -0.01, `a joint went ${(lowest * 100).toFixed(1)} cm under the ground`);
    const head = built.skeleton.findIndex((b) => b.name === 'head');
    const up = matPoint(motion.bones, head * 16, built.skeleton[head].pivot)[1];
    assert(Math.abs(up - built.skeleton[head].pivot[1]) < 0.08, `standing again (head ${up.toFixed(2)} m)`);
    return `lowest joint ${(lowest * 100).toFixed(1)} cm`;
  });

  test(FIG, 'standing on a 15 degree slope, both feet are on the ground', async () => {
    const { R, built } = await load();
    const h = (/** @type {number} */ x) => Math.tan((15 * Math.PI) / 180) * x;
    const motion = createFigureMotion(R, built.skeleton);
    const feet = ['foot.l', 'foot.r'].map((n) => built.skeleton.findIndex((/** @type {any} */ b) => b.name === n));
    let r = null;
    // Facing along z, so the slope runs across the feet.
    for (let f = 0; f < 240; f++) r = motion.update(1 / 60, { x: 0, z: 0, y: 0, yaw: 0, speed: 0, moving: false, ground: h });
    const off = feet.map((i) => {
      const k = R.body.displayScale ?? 1, p = matPoint(motion.bones, i * 16, built.skeleton[i].pivot);
      return k * (p[1] - R.legs.ankleM) - h(k * p[0]);
    });
    assert(Math.max(...off.map(Math.abs)) < 0.02, `ankles off the ground by ${off.map((o) => (o * 100).toFixed(1)).join(' and ')} cm`);
    assert(r && Math.abs(r.yaw) < 1e-9, 'facing kept');
    return off.map((o) => `${(o * 100).toFixed(1)} cm`).join(', ');
  });

  test(FIG, 'footprints stay in sand and mud, not on grass, rock or under water; they fade in a day and the tide takes them', async () => {
    const { R } = await load();
    const F = R.footprints;
    // Sand for x < 0, grass for 0..5, rock past 5, soil (mud) for z > 10; water deep past x = -10.
    const material = (/** @type {number} */ x, /** @type {number} */ z) => z > 10 ? { grass: 0, sand: 0, rock: 0, soil: 1 }
      : x < 0 ? { grass: 0, sand: 1, rock: 0, soil: 0 } : x < 5 ? { grass: 1, sand: 0, rock: 0, soil: 0 } : { grass: 0, sand: 0, rock: 1, soil: 0 };
    const prints = createFootprints(F, { ground: (x) => (x < 0 ? 0.2 + x * 0.01 : 0.5), material, depth: (x) => (x < -10 ? 0.2 : 0) });
    const step = (/** @type {number} */ x, /** @type {number} */ z) => prints.step({ x, z, yaw: 0, side: 1 }, 100);
    assert(step(-2, 0), 'a print in sand');
    assert(step(2, 12), 'a print in mud');
    assert(!step(2, 0), 'no print on grass');
    assert(!step(7, 0), 'no print on rock');
    assert(!step(-12, 0), 'no print under water');
    const p = prints.prints[0];
    assert(prints.strength(p, 100) > prints.strength(p, 110) && prints.strength(p, 110) > 0, 'fades with the hours');
    eq(prints.update(100 + F.fadeH + 1, -9).length, 0, 'gone after a day');
    step(-2, 0); step(-8, 0);
    // The tide rises to 0.15 m: the print at x = -8 (ground 0.12 m) is covered, the one at -2 (0.18 m) is not.
    const left = prints.update(101, 0.15);
    eq(left.length, 1, 'the tide took the covered print');
    for (let i = 0; i < F.max + 20; i++) step(-1, 0);
    eq(prints.prints.length, F.max, 'no more than max at once');
    return `${F.max} at most, ${F.fadeH} h to fade`;
  });

  test(FIG, 'the same walk poses the same twice, and the walker\'s state is only read', async () => {
    const { R, built } = await load();
    // walk() freezes every input; a write would throw in a module's strict code.
    const a = walk(R, built, 0.9, () => 0, 3), b = walk(R, built, 0.9, () => 0, 3);
    for (let f = 0; f < a.length; f += 7) {
      for (let k = 0; k < a[f].bones.length; k++) if (a[f].bones[k] !== b[f].bones[k]) throw new Error(`frame ${f} differs`);
    }
    return `${a.length} frames`;
  });

  test(FIG, 'each keeper\'s camp act runs to its end after its recipe length, with every bone finite', async () => {
    const { R, built } = await load();
    const report = [];
    for (const name of ACTS) {
      const motion = createFigureMotion(R, built.skeleton);
      const { len, frames } = playAct(R, built, motion, name);
      eq(len, actLength(R.poses, name), `${name} length`);
      assert(len > 1 && len < 5, `${name} lasts ${len} s`);
      const ends = frames.filter((f) => f.done === name);
      eq(ends.length, 1, `${name} reports its end once`);
      assert(Math.abs(ends[0].u - len) < 1.5 / 60, `${name} ended at ${ends[0].u.toFixed(3)} s, not ${len} s`);
      assert(frames.every((f) => f.finite), `${name} gave a bone that is not a number`);
      assert(frames.some((f) => f.info.act === name) && frames[frames.length - 1].info.act === null, `${name} plays, then is over`);
      report.push(`${name} ${len} s`);
    }
    eq(createFigureMotion(R, built.skeleton).act('cartwheel'), 0, 'an unknown act plays nothing');
    return report.join(', ');
  });

  test(FIG, 'while a kneeling act\'s hands work, the feet stay planted (no slide)', async () => {
    const { R, built } = await load();
    const report = [];
    for (const name of ['drink', 'pitch', 'lay', 'strike']) {
      const { frames } = playAct(R, built, createFigureMotion(R, built.skeleton), name);
      const knelt = frames.filter((f) => f.info.act === name && f.info.kneelW > 0.999);
      assert(knelt.length > 30, `${name} kneels for ${knelt.length} frames`);
      let worst = 0;
      for (const f of knelt) for (let i = 0; i < 2; i++) worst = Math.max(worst, Math.hypot(...[0, 1, 2].map((j) => f.ankles[i][j] - knelt[0].ankles[i][j])));
      assert(worst < 0.005, `${name}: a foot moved ${(worst * 100).toFixed(2)} cm while kneeling`);
      report.push(`${name} ${(worst * 1000).toFixed(1)} mm`);
    }
    return report.join(', ');
  });

  test(FIG, 'kneeling, the left knee rests on the ground and no knee ever goes through it', async () => {
    const { R, built } = await load();
    const k = R.body.displayScale ?? 1, dt = 1 / 60;
    const knees = ['shin.l', 'shin.r'].map((n) => built.skeleton.findIndex((/** @type {any} */ b) => b.name === n));
    const kneeY = (/** @type {any} */ m) => knees.map((i) => matPoint(m.bones, i * 16, built.skeleton[i].pivot)[1] * k);
    const motion = createFigureMotion(R, built.skeleton);
    /** @param {'stand'|'kneel'} posture */
    const still = (posture) => Object.freeze({ x: 0, z: 0, y: 0, yaw: 0, speed: 0, moving: false, ground: () => 0, depth: () => 0, below: true, posture });
    let lowest = Infinity;
    // Settled standing first (the hips' spring starts from nothing on the very first frame).
    for (let f = 0; f < 30; f++) motion.update(dt, still('stand'));
    // Down, held, and up again.
    for (const [posture, seconds] of /** @type {const} */ ([['stand', 1], ['kneel', 3], ['stand', 3]])) {
      for (let f = 0; f < seconds * 60; f++) { motion.update(dt, still(posture)); lowest = Math.min(lowest, ...kneeY(motion)); }
      if (posture === 'kneel') {
        const [l, r] = kneeY(motion);
        assert(l < 0.07 && l > 0.01, `the kneeling knee is ${(l * 100).toFixed(1)} cm up`);
        assert(r > 0.15, `the front knee is up (${(r * 100).toFixed(1)} cm)`);
      }
    }
    // Every kneeling act, from standing.
    for (const name of ['drink', 'pitch', 'lay', 'strike']) {
      const m = createFigureMotion(R, built.skeleton);
      for (let f = 0; f < 60; f++) m.update(dt, still('stand'));
      const len = m.act(name);
      for (let f = 0; f < (len + 1) * 60; f++) { m.update(dt, still('stand')); lowest = Math.min(lowest, ...kneeY(m)); }
    }
    assert(lowest > 0.01, `a knee went down to ${(lowest * 100).toFixed(1)} cm`);
    return `lowest knee ${(lowest * 100).toFixed(1)} cm`;
  });

  test(FIG, 'crawlIn ends low on hands and knees and stays there; climbOut stands up from it', async () => {
    const { R, built } = await load();
    const motion = createFigureMotion(R, built.skeleton);
    const inn = playAct(R, built, motion, 'crawlIn', 'kneel');
    const last = inn.frames[inn.frames.length - 1];
    assert(last.info.crawlW > 0.999, `a second after crawlIn the crawl is ${last.info.crawlW.toFixed(2)}`);
    const out = playAct(R, built, motion, 'climbOut', 'stand');
    assert(out.frames[0].info.crawlW > 0.95, 'climbOut starts from low');
    const end = out.frames[out.frames.length - 1].info;
    assert(end.crawlW < 0.001 && end.kneelW < 0.001, `after climbOut: crawl ${end.crawlW.toFixed(2)}, kneel ${end.kneelW.toFixed(2)}`);
  });

  test(FIG, 'a placed figure starts in its posture, with no steps to get there', async () => {
    const { R, built } = await load();
    const motion = createFigureMotion(R, built.skeleton);
    const s = { x: 0, z: 0, y: 0, yaw: 0, speed: 0, moving: false, ground: () => 0, below: true, posture: /** @type {'kneel'} */ ('kneel') };
    for (let f = 0; f < 30; f++) motion.update(1 / 60, { ...s, posture: 'stand' });
    motion.place('kneel');
    const r = motion.update(1 / 60, { ...s, x: 0.6 });
    eq(motion.info.kneelW, 1, 'kneeling at once');
    eq(r.footfalls.length, 0, 'no step taken');
  });
}
