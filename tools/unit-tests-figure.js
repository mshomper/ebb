// @ts-check
// Walker figure tests for tools/unit-tests.html (doc 23, W5): the GLB reader reads the figure, the
// rig has its 20 bones parents first with skin weights that add up, the IK reaches, blinks keep
// their spacing, a planted foot never slides while walking, the feet stand on a slope, the same
// walk poses the same twice, and the figure never changes the walker's state.

import { readGlb, meshesByName } from '../src/render/gltf.js';
import { buildFigure, anchorWeights } from '../src/world/figure/rig.js';
import { createFigureMotion } from '../src/world/figure/motion.js';
import { twoBone, len, sub, qrot } from '../src/world/figure/kinematics.js';
import { blinkAt } from '../src/world/figure/eyes.js';
import { matPoint } from '../src/world/figure/kinematics.js';

const FIG = 'walker figure';

async function load() {
  const R = await (await fetch('../recipes/world/figure.json')).json();
  const glb = readGlb(await (await fetch(`../${R.model}`)).arrayBuffer());
  return { R, glb, built: buildFigure(glb, R) };
}

/**
 * Walk the figure in a straight line along +x at `speed` over ground h, and report each frame's
 * ankle positions in the world. @param {any} R @param {any} built @param {number} speed
 * @param {(x: number, z: number) => number} h @param {number} seconds
 */
function walk(R, built, speed, h, seconds) {
  const motion = createFigureMotion(R, built.skeleton);
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
      return [x + c * p[0] + sn * p[2], h(x, 0) + p[1], -sn * p[0] + c * p[2]];
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
  test(FIG, 'the GLB reader reads the figure: a body and two arms, with colour, part labels and the arms\' shoulders', async () => {
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
          const down = a[1] < R.legs.ankleM + 0.004;
          if (down && anchor) worst = Math.max(worst, Math.hypot(a[0] - anchor[0], a[2] - anchor[2]));
          anchor = down ? anchor ?? a : null;
        }
      }
      report.push(`${speed} m/s ${(worst * 100).toFixed(1)} cm`);
      assert(worst < 0.012, `a planted foot slid ${(worst * 100).toFixed(1)} cm at ${speed} m/s`);
    }
    return report.join(', ');
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
      const p = matPoint(motion.bones, i * 16, built.skeleton[i].pivot);
      return p[1] - R.legs.ankleM - h(p[0]);
    });
    assert(Math.max(...off.map(Math.abs)) < 0.02, `ankles off the ground by ${off.map((o) => (o * 100).toFixed(1)).join(' and ')} cm`);
    assert(r && Math.abs(r.yaw) < 1e-9, 'facing kept');
    return off.map((o) => `${(o * 100).toFixed(1)} cm`).join(', ');
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
}
