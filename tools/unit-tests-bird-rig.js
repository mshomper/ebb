// @ts-check
// Small-bird rig tests for tools/unit-tests.html (B3 R1): the rig's fifteen roles come parents
// first with mirrored pivots read from the recipe's shape (a different shape moves them); a leg's
// reach puts the foot where it is asked, the ankle bending back; a foot on the ground stays put
// while the bird walks or runs over it; the wing telescopes open to a flat span and folds to its
// rest; every clip poses finite bones from start to end, the stone turns all the way over, take-off
// ends aloft with the legs tucked and landing ends on the ground with the wings folded; and the
// turnstone bakes to a skinned mesh standing on y = 0 at its real length, every piece on its bone.

import { birdRig, legReach, wingMoves, BIRD_ROLES } from '../src/world/creatures/bird-rig.js';
import { poseBird, restPose, footAt, idlePose, gaitPose, peckPose, flipPose, preenPose, flyPose, takeoffPose, landPose, flapAt } from '../src/world/creatures/bird-motion.js';
import { bakeBird } from '../src/world/creatures/bird-model.js';
import { poseSkeleton } from '../src/world/creatures/pose.js';
import { MAX_BONES, VERTEX_BYTES } from '../src/world/creatures/bodies.js';

const G = 'bird rig';
/** @type {Promise<any> | null} */ let loaded = null;
const load = () => loaded ?? (loaded = fetch(new URL('../recipes/birds/turnstone.json', import.meta.url)).then((r) => r.json()));

/** A point through bone i of a posed skeleton. @param {Float32Array} m @param {number} i @param {number[]} p */
const through = (m, i, p) => [0, 1, 2].map((a) => m[i * 16 + a] * p[0] + m[i * 16 + 4 + a] * p[1] + m[i * 16 + 8 + a] * p[2] + m[i * 16 + 12 + a]);
/** Every bone's matrix for a pose. @param {any} rig @param {any} P @param {any} M */
const posed = (rig, P, M) => { const out = new Float32Array(MAX_BONES * 16); poseSkeleton(rig.skeleton, poseBird(rig, P, M), out, 0); return out; };

/** @param {(group: string, name: string, fn: () => any) => void} test @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq */
export function addBirdRigTests(test, assert, eq) {
  test(G, 'fifteen roles, parents first, left and right pivots mirrored, read from the shape', async () => {
    const R = await load();
    const rig = birdRig(R.shape);
    eq(rig.skeleton.length, BIRD_ROLES.length);
    assert(rig.skeleton.length <= MAX_BONES, 'fits the creatures pass');
    rig.skeleton.forEach((b, i) => assert(b.parent < i, `${b.name} after its parent`));
    for (const role of ['wing', 'hand', 'leg', 'shank', 'foot']) {
      const l = rig.skeleton[rig.at[`${role}.l`]].pivot, r = rig.skeleton[rig.at[`${role}.r`]].pivot;
      assert(l[0] > 0 && Math.abs(l[0] + r[0]) < 1e-9 && l[1] === r[1] && l[2] === r[2], `${role} mirrored`);
    }
    // A longer-legged bird (a sandpiper, say) is a new shape, not new code.
    const S = JSON.parse(JSON.stringify(R.shape));
    S.leg.ankle[1] += 0.01; S.leg.hip[1] += 0.01;
    const tall = birdRig(S);
    assert(Math.abs(tall.skeleton[tall.at['shank.l']].pivot[1] - rig.skeleton[rig.at['shank.l']].pivot[1] - 0.01) < 1e-9, 'the ankle moves with the shape');
  });

  test(G, 'a leg reaches where it is asked, the ankle bending back; at rest it does not turn', async () => {
    const R = await load();
    const rig = birdRig(R.shape), L = rig.legs[0];
    const rest = legReach(L.hip, L, L.foot);
    assert(Math.abs(rest.leg) < 1e-9 && Math.abs(rest.shank) < 1e-9 && rest.reached, 'still at rest');
    for (const [dy, dz] of [[0, 0.015], [0, -0.015], [0.008, 0.01], [-0.006, 0]]) {
      const P = restPose();
      P.feet = [{ dz, dy }, { dz: 0, dy: 0 }];
      const m = posed(rig, P, R.motion);
      const foot = through(m, L.foot_, L.foot);
      assert(Math.abs(foot[1] - (L.foot[1] + dy)) < 1e-6 && Math.abs(foot[2] - (L.foot[2] + dz)) < 1e-6, `foot at ${dy}, ${dz}`);
      // The ankle sits behind the hip-to-foot line, as a bird's heel does.
      const ankle = through(m, L.shank, L.ankle);
      const cross = (foot[2] - L.hip[2]) * (ankle[1] - L.hip[1]) - (foot[1] - L.hip[1]) * (ankle[2] - L.hip[2]);
      assert(cross < 0, 'ankle behind the line');
    }
  });

  test(G, 'a foot on the ground stays put while the bird walks or runs over it', async () => {
    const R = await load();
    const rig = birdRig(R.shape), M = R.motion;
    for (const kind of /** @type {const} */ (['walk', 'run'])) {
      const G2 = M[kind];
      for (const L of rig.legs) {
        let planted = /** @type {number | null} */ (null), worst = 0;
        // Through two strides in small steps: on the ground, the foot's place in the world (the
        // bird's travel plus where the bones put it) must not move.
        for (let i = 0; i <= 400; i++) {
          const dist = (i / 400) * G2.strideM * 2;
          const P = gaitPose(i * 0.005, dist / G2.strideM, M, kind);
          const f = footAt(L, P, rig.legs.indexOf(L));
          const m = posed(rig, P, M);
          const z = through(m, L.foot_, L.foot)[2] + dist;
          if (f.swing === 0) { if (planted === null) planted = z; worst = Math.max(worst, Math.abs(z - planted)); } else planted = null;
        }
        assert(worst < 2e-4, `${kind}, ${L.side > 0 ? 'left' : 'right'} foot slid ${(worst * 1000).toFixed(2)} mm`);
      }
    }
  });

  test(G, 'the wing telescopes open to a flat span and folds back to its rest', async () => {
    const R = await load();
    const rig = birdRig(R.shape), W = R.shape.wing;
    for (const w of rig.wings) {
      const folded = wingMoves(w, { spread: 0, up: 0, sweep: 0, handUp: 0, handFold: 0 });
      assert(Math.abs(folded.arm.q[3] - 1) < 1e-9 && Math.abs(folded.hand.q[3] - 1) < 1e-9 && folded.hand.t[2] === 0, 'folded is the rest');
    }
    const P = restPose();
    P.wing = { spread: 1, up: 0, sweep: 0, handUp: 0, handFold: 0 };
    const m = posed(rig, P, R.motion);
    for (const w of rig.wings) {
      const tipRest = [W.tip[0] * w.side, W.tip[1], W.tip[2]];
      const tip = through(m, w.hand, tipRest), sh = w.shoulder;
      assert((tip[0] - sh[0]) * w.side > 0.15, `${w.side > 0 ? 'left' : 'right'} wing reaches out ${(tip[0] - sh[0]).toFixed(3)} m`);
      assert(Math.abs(tip[1] - sh[1]) < 0.03 && Math.abs(tip[2] - sh[2]) < 0.05, 'out to the side, near level');
      // The panel's outer face turns up.
      const o = through(m, w.arm, [sh[0] + w.side * 0.01, sh[1], sh[2] - 0.02]), c = through(m, w.arm, [sh[0], sh[1], sh[2] - 0.02]);
      assert(o[1] - c[1] > 0.006, 'outer face up');
    }
  });

  test(G, 'every clip poses finite bones start to end; the stone turns over; take-off ends aloft; landing ends folded on the ground', async () => {
    const R = await load();
    const rig = birdRig(R.shape), M = R.motion;
    const finite = (/** @type {any} */ P, /** @type {string} */ what) => {
      const m = posed(rig, P, M);
      assert(m.every((x) => Number.isFinite(x)), `${what}: finite bones`);
    };
    let lastLever = 0;
    for (let i = 0; i <= 40; i++) {
      const u = Math.min(0.9999, i / 40), t = i * 0.05;
      finite(idlePose(t, M), 'idle'); finite(gaitPose(t, u * 3, M, 'walk'), 'walk'); finite(gaitPose(t, u * 3, M, 'run'), 'run');
      finite(peckPose(t, u, M), 'peck'); finite(preenPose(t, u, M), 'preen'); finite(flyPose(t, u * 6, u, M), 'fly');
      const f = flipPose(t, u, M);
      finite(f.pose, 'flip');
      assert(f.lever >= lastLever - 1e-9, 'the stone only turns one way');
      lastLever = f.lever;
      finite(takeoffPose(t, u, u * 3, M).pose, 'take-off'); finite(landPose(t, u, u * 3, M).pose, 'land');
    }
    assert(lastLever > 0.999, 'the stone ends over');
    const up = takeoffPose(1, 0.9999, 3, M);
    assert(up.y > 0.2 && up.pose.air > 0.999 && up.pose.wing.spread > 0.999, 'take-off ends aloft, legs tucked, wings open');
    const down = landPose(1, 0.9999, 3, M);
    assert(down.y === 0 && down.v < 1e-6 && down.pose.wing.spread < 0.01 && down.pose.air < 1e-6, 'landing ends standing, wings folded');
    // A wingbeat goes up and down through its range.
    const ups = Array.from({ length: 20 }, (_, i) => flapAt(i / 20, M.flap).up);
    assert(Math.max(...ups) > 0.8 && Math.min(...ups) < -0.4, 'beats through its range');
  });

  test(G, 'the same pose gives the same bones', async () => {
    const R = await load();
    const rig = birdRig(R.shape);
    const a = posed(rig, flipPose(1.3, 0.4, R.motion).pose, R.motion), b = posed(rig, flipPose(1.3, 0.4, R.motion).pose, R.motion);
    assert(a.every((x, i) => x === b[i]), 'same bones');
  });

  test(G, 'the turnstone bakes skinned, standing on y = 0 at its real length, every piece on its bone', async () => {
    const R = await load();
    const b = bakeBird({ shape: R.shape, plumage: R.plumage.winter, wingPattern: R.wingPattern, cellM: 0.004, wingCellM: 0.003 });
    eq(b.data.byteLength, b.count * VERTEX_BYTES);
    const f = new Float32Array(b.data), u8 = new Uint8Array(b.data);
    let low = Infinity, front = -Infinity, back = Infinity;
    for (let v = 0; v < b.count; v++) {
      const o = v * (VERTEX_BYTES / 4);
      for (let a = 0; a < 9; a++) assert(Number.isFinite(f[o + a]), 'finite vertex');
      low = Math.min(low, f[o + 1]); front = Math.max(front, f[o + 2]); back = Math.min(back, f[o + 2]);
      let sum = 0;
      for (let s = 0; s < 4; s++) { sum += u8[v * VERTEX_BYTES + 40 + s]; assert(u8[v * VERTEX_BYTES + 36 + s] < b.bones.length, 'a bone it has'); }
      if (sum !== 255) { assert(false, `weights sum to ${sum}`); break; }
    }
    assert(Math.abs(low) < 0.004, `stands on y = 0 (lowest ${low.toFixed(4)})`);
    const len = front - back;
    assert(Math.abs(len - R.realLengthM) < 0.03, `real length ${len.toFixed(3)} m`);
    assert(Math.abs(len * R.displayScale - R.drawnLengthM) < 0.08 && R.displayScale >= 2.5 && R.displayScale <= 3, 'drawn at the findable scale');
    for (const part of ['body', 'head', 'bill', 'tail', 'leg', 'toe', 'wing.l', 'hand.l', 'wing.r', 'hand.r']) assert((b.parts[part] ?? 0) > 0, `has its ${part}`);
  });
}
