// @ts-check
// Hen tests for tools/unit-tests.html (docs/future/15, slice 1): her model folds to the recipe's
// bones, parents first, with skin weights that add up, standing on y = 0 at her real height; the Idle
// clip samples to finite moves and every clip poses finite bones; the scrub is found only where
// enough grown bushes stand together; the same seed lives the same life; the walker inside her ring
// makes her freeze, then run, and the camera never does; she never steps into water; her stride is
// timed to the distance she walks; and the head lock stays within its reach.

import { readGlb } from '../src/render/gltf.js';
import { buildHen } from '../src/world/hen/rig.js';
import { createHenPoser, stillPose } from '../src/world/hen/motion.js';
import { createHenLife, scrubHome } from '../src/world/hen/life.js';

const HEN = 'hen';

/** The recipe and the model, rigged, once. */
let made = /** @type {Promise<{ R: any, built: ReturnType<typeof buildHen> }> | null} */ (null);
const load = () => made ?? (made = (async () => {
  const R = await (await fetch('../recipes/species/hen.json')).json();
  const glb = readGlb(await (await fetch(`../${R.model}`)).arrayBuffer());
  return { R, built: buildHen(glb, R) };
})());

/**
 * A presence source for her: the walker (felt) or the camera above (whose body the game never lets
 * creatures feel). @param {'walker'|'camera'} kind @param {number} x @param {number} z
 * @returns {import('../src/world/creatures/presence.js').PresenceSource}
 */
const source = (kind, x, z) => ({ id: kind, kind, pos: [x, 0.9, z], speed: 0.9, editing: false, edits: [], stillS: 0,
  body: kind === 'walker', posture: kind === 'walker' ? 'stand' : undefined, gaze: null, ringK: 1 });

/** A hen on flat dry ground (or water past x = wetX), at home at the origin. @param {any} R @param {number} [seed] @param {number} [wetX] */
function henAt(R, seed = 7, wetX = Infinity) {
  const life = createHenLife({ R, seed, ground: () => 0, wet: (x) => x > wetX });
  life.setHome({ x: 0, z: 0 }, R.home.rangeM, true);
  return life;
}

/** @param {(group: string, name: string, fn: () => any) => void} test @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq */
export function addHenTests(test, assert, eq) {
  test(HEN, 'her model folds to the recipe bones, parents first, every vertex weighted to 255, standing on y = 0 at about 0.42 m', async () => {
    const { R, built } = await load();
    eq(built.skeleton.length, R.bones.length, 'one bone a recipe bone');
    built.skeleton.forEach((b, i) => assert(b.parent < i, `${b.name} comes after its parent`));
    eq(built.skeleton[0].parent, -1, 'the root has no parent');
    const u = new Uint8Array(built.data);
    for (let v = 0; v < built.count; v++) {
      const sum = u[v * 44 + 40] + u[v * 44 + 41] + u[v * 44 + 42] + u[v * 44 + 43];
      if (sum !== 255) { assert(false, `vertex ${v} weights sum to ${sum}`); break; }
      for (let k = 0; k < 4; k++) if (u[v * 44 + 36 + k] >= built.skeleton.length) { assert(false, `vertex ${v} names bone ${u[v * 44 + 36 + k]}`); break; }
    }
    const f = new Float32Array(built.data);
    let low = Infinity;
    for (let v = 0; v < built.count; v++) low = Math.min(low, f[v * 11 + 1]);
    assert(Math.abs(low) < 1e-4, `her soles on y = 0 (lowest ${low})`);
    assert(built.height > 0.38 && built.height < 0.46, `a real hen's height (${built.height.toFixed(3)} m)`);
    eq(built.indices.length / 3 - built.wingTris, 1541, 'the model as supplied (and her wing patches on top, slice 3)');
  });

  test(HEN, 'the Idle clip samples to finite moves, and every clip poses finite bones', async () => {
    const { R, built } = await load();
    assert(built.idle && built.idle.frames > 30, 'Idle has frames');
    assert(built.idle?.data.every(Number.isFinite), 'Idle moves are finite');
    const poser = createHenPoser(built.skeleton, R.motion, built.idle);
    const poses = [
      stillPose(),
      { ...stillPose(), t: 0.7, phase: 0.3, walk: 1 },
      { ...stillPose(), phase: 1.6, walk: 1, run: 1 },
      { ...stillPose(), kick: { side: /** @type {'l'} */ ('l'), u: 0.4 } },
      { ...stillPose(), peck: 1, look: { yaw: 0.3, tilt: 0.5, down: 0.3 } },
      { ...stillPose(), alert: 1, lockM: -0.03 },
    ];
    for (const p of poses) assert(poser.pose(p).every(Number.isFinite), `finite bones for ${JSON.stringify(p).slice(0, 60)}`);
  });

  test(HEN, 'the scrub is found only where enough grown gorse or willow stand together, at their middle', async () => {
    const { R } = await load();
    const H = R.home;
    const bush = (/** @type {string} */ sp, /** @type {number} */ x, /** @type {number} */ z, size = 1) => ({ sp, x, z, size });
    eq(scrubHome([], H), null, 'no bushes, no scrub');
    eq(scrubHome([bush('gorse', 0, 0), bush('gorse', 1, 0)], H), null, 'two bushes are not enough');
    eq(scrubHome([bush('gorse', 0, 0), bush('gorse', 1, 0), bush('thrift', 0, 1)], H), null, 'thrift is not cover');
    eq(scrubHome([bush('gorse', 0, 0), bush('gorse', 1, 0), bush('willow', 0, 1, H.minSize / 2)], H), null, 'a seedling is not cover yet');
    eq(scrubHome([bush('gorse', 0, 0), bush('gorse', 30, 0), bush('willow', 0, 30)], H), null, 'bushes far apart are not scrub');
    const s = scrubHome([bush('gorse', 0, 0), bush('gorse', 2, 0), bush('willow', 1, 3), bush('gorse', 40, 40)], H);
    assert(s && Math.abs(s.x - 1) < 1e-9 && Math.abs(s.z - 1) < 1e-9 && s.bushes === 3, `the cluster's middle (${JSON.stringify(s)})`);
  });

  test(HEN, 'the same seed lives the same life, and another seed a different one', async () => {
    const { R } = await load();
    const run = (/** @type {number} */ seed) => {
      const life = henAt(R, seed);
      const track = [];
      for (let i = 0; i < 1800; i++) { life.step(1 / 30, { night: false, sources: [] }); if (i % 60 === 0) track.push(`${life.hen.x.toFixed(6)},${life.hen.z.toFixed(6)},${life.hen.mode}`); }
      return track.join(';');
    };
    eq(run(11), run(11), 'same seed, same life');
    assert(run(11) !== run(12), 'a different seed, a different life');
  });

  test(HEN, 'the walker inside her ring makes her freeze, then run; the camera above never does', async () => {
    const { R } = await load();
    const W = R.wary;
    // The camera right over her: nothing.
    const calm = henAt(R);
    for (let i = 0; i < 300; i++) calm.step(1 / 30, { night: false, sources: [source('camera', calm.hen.x + 0.5, calm.hen.z)] });
    assert(calm.hen.mode !== 'alert' && calm.hen.mode !== 'flee', `the camera never startles her (${calm.hen.mode})`);
    // The walker just inside the ring: alert first, then a run that ends past calmM.
    const hen = henAt(R);
    const at = { x: hen.hen.x + W.ringM * 0.9, z: hen.hen.z };
    hen.step(1 / 30, { night: false, sources: [source('walker', at.x, at.z)] });
    eq(hen.hen.mode, 'alert', 'she freezes first');
    let fled = false, far = 0;
    for (let i = 0; i < 30 * 8; i++) {
      hen.step(1 / 30, { night: false, sources: [source('walker', at.x, at.z)] });
      fled ||= hen.hen.mode === 'flee';
      far = Math.max(far, Math.hypot(hen.hen.x - at.x, hen.hen.z - at.z));
    }
    assert(fled, 'then she runs');
    assert(far >= W.calmM - 0.2, `she runs until she is past calmM (${far.toFixed(2)} m)`);
    // Well inside the ring: she runs at once.
    const near = henAt(R);
    near.step(1 / 30, { night: false, sources: [source('walker', near.hen.x + W.ringM * W.panicShare * 0.5, near.hen.z)] });
    eq(near.hen.mode, 'flee', 'close by, she runs at once');
  });

  test(HEN, 'she never steps into water, walking or running', async () => {
    const { R } = await load();
    const hen = henAt(R, 3, 1.5);
    let most = -Infinity;
    for (let i = 0; i < 30 * 120; i++) {
      // Now and then the walker comes from the dry side, to send her running toward the water.
      const chase = i % 600 > 450 ? [source('walker', hen.hen.x - 2, hen.hen.z)] : [];
      hen.step(1 / 30, { night: false, sources: chase });
      most = Math.max(most, hen.hen.x);
    }
    assert(most <= 1.5 + 1e-9, `she stays on the dry side (furthest x ${most.toFixed(3)})`);
  });

  test(HEN, 'her stride is timed to the distance she walks, and the head lock stays within its reach', async () => {
    const { R } = await load();
    const M = R.motion, HL = M.headLock;
    const hen = henAt(R, 5);
    let worst = 0, checked = 0, reach = 0;
    for (let i = 0; i < 30 * 60; i++) {
      const was = { x: hen.hen.x, z: hen.hen.z, phase: hen.hen.phase };
      hen.step(1 / 30, { night: false, sources: [] });
      reach = Math.max(reach, Math.abs(hen.hen.lockM));
      const d = Math.hypot(hen.hen.x - was.x, hen.hen.z - was.z);
      if (hen.hen.mode === 'walk' && d > 1e-4) {
        const stride = M.strideM + (M.runStrideM - M.strideM) * hen.hen.run;
        worst = Math.max(worst, Math.abs(Math.abs(hen.hen.phase - was.phase) * stride - d));
        checked++;
      }
    }
    assert(checked > 30, `she walked (${checked} frames)`);
    assert(worst < 1e-6, `strides match the ground covered (worst ${worst})`);
    assert(reach <= HL.lockM + HL.leadM + 1e-6, `the head lock stays within reach (${reach.toFixed(4)} m)`);
  });
}
