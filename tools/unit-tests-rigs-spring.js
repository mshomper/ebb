// @ts-check
// Spring creatures rigged (m2-rigs-spring; the creature rigging rule), for tools/unit-tests.html:
// froglets hop on the frog's rig and land with its squash; the toad walks on the same rig; the slow\n// worm slithers on its chain of bones and flicks its tongue.

import { frogletHop, landSquash } from '../src/world/creatures/froglets.js';
import { frogMoves, legsOf } from '../src/world/creatures/motion.js';
import { skeletonOf, bodyFor, MAX_BONES } from '../src/world/creatures/bodies.js';
import { poseSkeleton, axisAngle } from '../src/world/creatures/pose.js';
import { toadMoves } from '../src/world/creatures/toad-walk.js';
import { slowwormBody, poseSlowworm, tongueOut } from '../src/world/creatures/slowworm.js';

const G = 'spring rigs';

/** @type {import('./unit-tests-parallel.js').AddTests} */
export function addRigsSpringTests(test, assert, eq) {
  const load = (/** @type {string} */ id) => fetch(`../recipes/species/${id}.json`).then((x) => x.json());

  test(G, 'a froglet hops at the start of each share of its way, then sits', async () => {
    const FL = (await load('frogspawn')).body.froglet;
    const a = frogletHop(3.05, 2, FL);
    eq(a.n, 3, 'the fourth hop');
    assert(a.hopT > 0 && a.hopT < 1 && a.sitS === -1, 'in the air early in its share');
    const b = frogletHop(3.9, 2, FL);
    assert(b.hopT === -1 && b.sitS > 0, 'sitting later in its share');
    // When time runs fast the hop never takes more than its most share.
    const c = frogletHop(3 + FL.hopShareMost * 0.99, 0.01, FL);
    assert(c.hopT >= 0, 'a fast hop still has its share');
    eq(frogletHop(3 + FL.hopShareMost + 0.001, 0.01, FL).hopT, -1, 'and no more');
  });

  test(G, 'the landing squash starts at nothing, squashes, and rings down', async () => {
    const S = (await load('frog')).motion.squash;
    eq(landSquash(0, S), 0, 'nothing at the touch');
    let most = 0;
    for (let s = 0; s < 0.2; s += 0.005) most = Math.max(most, landSquash(s, S));
    assert(most > 0.05 && most < 0.5, `squashes (${most.toFixed(3)})`);
    assert(Math.abs(landSquash(1, S)) < 0.01, 'still within a second');
  });

  test(G, 'the toad wears the frog rig and walks with its hind feet planted on the ground', async () => {
    const T = await load('toad');
    const prims = bodyFor('toad', T.body, 0).prims;
    const sk = skeletonOf('toad', prims);
    eq(sk.length, 15, 'the frog rig');
    const tip = (/** @type {string} */ s) => prims.find((/** @type {any} */ q) => q.bone === `foot.${s}`).b;
    const legs = legsOf(sk, { l: tip('l'), r: tip('r') });
    const out = new Float32Array(MAX_BONES * 16);
    const L = legs[1];   // the right hind leg plants first (phase 0)
    /** Where the right ankle is on the ground: body space plus how far the body has walked. @param {number} ph */
    const ankle = (ph) => {
      poseSkeleton(sk, toadMoves(sk, legs, { id: 1, ph, walking: 1 }, ph, T.motion), out, 0);
      const m = out.subarray(L.shank * 16, L.shank * 16 + 16), A = L.A;
      assert([...out.subarray(0, sk.length * 16)].every(Number.isFinite), 'finite');
      return { y: m[1] * A[0] + m[5] * A[1] + m[9] * A[2] + m[13], z: m[2] * A[0] + m[6] * A[1] + m[10] * A[2] + m[14] + ph * T.motion.walk.strideM };
    };
    const a = ankle(0.1), b = ankle(0.45);
    assert(Math.abs(a.z - b.z) < 0.006, `planted while the body passes (${(a.z - b.z).toFixed(4)} m)`);
    assert(ankle(0.8).y > a.y + 0.002, 'lifted as it steps');
  });

  test(G, 'the slow worm: a chain of bones, an S that keeps its place as it slides, tongue flicks', async () => {
    const W = await load('slowworm');
    const body = slowwormBody(W.body);
    const sk = skeletonOf('slowworm', body.prims, body.bones);
    eq(sk.length, W.body.segments + 1, 'a bone per segment and the tongue');
    eq(sk[1].parent, 0, 'a chain from the head');
    const out = new Float32Array(MAX_BONES * 16);
    const turns = (/** @type {number} */ slid) => poseSlowworm(sk, { id: 2, t: 0, slidM: slid }, W.body, { ...W.motion, breathShift: 0 }, axisAngle)
      .slice(1, W.body.segments).map((m) => /** @type {any} */ (m).q[1]);
    // Slid one whole wave along, the S is the same again (it keeps its place on the ground).
    const wl = W.body.lengthM / (W.body.waves / 2);
    const a = turns(0), b = turns(wl);
    a.forEach((v, i) => assert(Math.abs(v - b[i]) < 1e-9, `joint ${i + 1} the same a wave on`));
    assert(Math.max(...a.map(Math.abs)) > 0.05, 'curved, not straight');
    let out1 = 0;
    for (let t = 0; t < 20; t += 0.02) {
      if (tongueOut(t, 2, W.motion.tongue) > 0.5) out1++;
      poseSkeleton(sk, poseSlowworm(sk, { id: 2, t, slidM: t * 0.01 }, W.body, W.motion, axisAngle), out, 0);
      assert([...out.subarray(0, sk.length * 16)].every(Number.isFinite), 'finite');
    }
    assert(out1 > 0 && out1 < 200, `the tongue flicks now and then (${out1} frames out of 1000)`);
  });

  test(G, 'a froglet poses through a whole hop with finite bones', async () => {
    const frog = await load('frog'), FL = (await load('frogspawn')).body.froglet;
    const prims = bodyFor('frog', frog.body, 0).prims;
    const sk = skeletonOf('frog', prims);
    const tip = (/** @type {string} */ s) => prims.find((/** @type {any} */ q) => q.bone === `foot.${s}`).b;
    const legs = legsOf(sk, { l: tip('l'), r: tip('r') });
    const out = new Float32Array(MAX_BONES * 16);
    for (let f = 0; f < 1; f += 0.05) {
      const hop = frogletHop(2 + f, 1.6, FL);
      const sq = hop.sitS >= 0 ? landSquash(hop.sitS, frog.motion.squash) : 0;
      poseSkeleton(sk, frogMoves(sk, legs, { id: 5, hopT: hop.hopT, kick: -1, sq, sac: 0, swimming: false }, f * 1.6, frog.motion), out, 0);
      assert([...out.subarray(0, sk.length * 16)].every(Number.isFinite), `finite at ${f.toFixed(2)}`);
    }
  });
}
