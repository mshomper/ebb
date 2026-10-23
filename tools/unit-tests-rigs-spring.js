// @ts-check
// Spring creatures rigged (m2-rigs-spring; the creature rigging rule), for tools/unit-tests.html:
// froglets hop on the frog's rig and land with its squash.

import { frogletHop, landSquash } from '../src/world/creatures/froglets.js';
import { frogMoves, legsOf } from '../src/world/creatures/motion.js';
import { skeletonOf, bodyFor, MAX_BONES } from '../src/world/creatures/bodies.js';
import { poseSkeleton } from '../src/world/creatures/pose.js';

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
