// @ts-check
// Live frog tests for tools/unit-tests.html (S6b-2, docs 11, 12): the legs reach by IK, the chorus
// never starts two calls within its gap, frogs keep their distance and their leash, never swim
// where lilies grow, repeat exactly for the same seed, and slip away when they leave. On a made-up
// bank: land for z < 0, shallows to 0.25 m for 0 < z < 2, deeper beyond.

import { createFrogAgents } from '../src/world/creatures/agents.js';
import { twoBoneIK, qrot } from '../src/world/creatures/motion.js';

const FROGS = 'frogs (live)';

/** A straight bank along x: land below z = 0, shallows, then deep water. */
const bank = {
  ground: () => 0,
  water: (/** @type {number} */ x, /** @type {number} */ z) => (z <= 0 ? { depth: 0, surface: 0 } : { depth: z < 2 ? 0.12 : 0.6, surface: z < 2 ? 0.12 : 0.6 }),
  plop() {},
  hourOfDay: 21,
  duskHour: 19,
};

/** @param {any} recipe @param {number} n @param {number} seed */
function pond(recipe, n, seed) {
  const agents = createFrogAgents(recipe, seed);
  const frogs = Array.from({ length: n }, (_, i) => ({ id: i + 1, x: -4 + i * 0.9, z: -0.3, yaw: 0, mood: 0.9 }));
  agents.sync(frogs, false, bank);
  return { agents, frogs };
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addFrogTests(test, assert, eq) {
  const recipe = () => fetch('../recipes/species/frog.json').then((x) => x.json());

  test(FROGS, 'two-bone IK reaches a reachable target, and leaves a leg at rest still', () => {
    const H = [0.014, 0.007, -0.022], K = [0.028, 0.015, -0.004], A = [0.029, 0.005, -0.026];
    const T = [0.03, -0.01, -0.05];
    const ik = twoBoneIK(H, K, A, T);
    const knee = ik.knee;
    const ankle = [knee[0] + qrot(ik.q1, qrot(ik.q2, [A[0] - K[0], A[1] - K[1], A[2] - K[2]]))[0],
      knee[1] + qrot(ik.q1, qrot(ik.q2, [A[0] - K[0], A[1] - K[1], A[2] - K[2]]))[1],
      knee[2] + qrot(ik.q1, qrot(ik.q2, [A[0] - K[0], A[1] - K[1], A[2] - K[2]]))[2]];
    const miss = Math.hypot(ankle[0] - T[0], ankle[1] - T[1], ankle[2] - T[2]);
    assert(miss < 1e-6, `the ankle missed by ${(miss * 1000).toFixed(4)} mm`);
    const rest = twoBoneIK(H, K, A, A);
    assert(Math.abs(rest.q1[3]) > 0.99999 && Math.abs(rest.q2[3]) > 0.99999, 'a leg at rest turned');
    return `ankle within ${(miss * 1e6).toFixed(2)} micrometres`;
  });

  test(FROGS, 'at dusk content frogs call in turn: never two calls within the gap', async () => {
    const r = await recipe();
    const { agents } = pond(r, 8, 3);
    for (let s = 0; s < 240 * 30; s++) agents.advance(1 / 30, bank);
    const calls = agents.calls();
    assert(calls.length > 20, `only ${calls.length} calls in four minutes`);
    let tightest = Infinity;
    for (let i = 1; i < calls.length; i++) tightest = Math.min(tightest, calls[i].t - calls[i - 1].t);
    assert(tightest >= r.motion.call.gapS - 1e-9, `two calls ${tightest.toFixed(3)} s apart`);
    const callers = new Set(calls.map((c) => c.id)).size;
    assert(callers >= 4, `only ${callers} frogs called`);
    return `${calls.length} calls from ${callers} frogs in four minutes, the tightest ${tightest.toFixed(2)} s apart`;
  });

  test(FROGS, 'foraging frogs keep their distance and their leash, and swim only in the shallows', async () => {
    const r = await recipe();
    const { agents, frogs } = pond(r, 8, 5);
    const night = { ...bank, hourOfDay: 1 };
    const bodyLen = ((r.body.scaleReal[0] + r.body.scaleReal[1]) / 2) * r.body.displayScale;
    let worstLeash = 0, deep = 0, closest = Infinity;
    for (let s = 0; s < 300 * 30; s++) {
      agents.advance(1 / 30, night);
      if (s % 15) continue;
      const list = agents.list();
      for (const a of list) {
        const home = frogs.find((f) => f.id === a.id);
        if (home) worstLeash = Math.max(worstLeash, Math.hypot(a.x - home.x, a.z - home.z));
        if ((a.mode === 'swim' || a.mode === 'float') && a.z > 2) deep++;
      }
      const sitting = list.filter((a) => !a.hop && a.mode !== 'swim' && a.mode !== 'float');
      for (let i = 0; i < sitting.length; i++) for (let j = i + 1; j < sitting.length; j++) {
        closest = Math.min(closest, Math.hypot(sitting[i].x - sitting[j].x, sitting[i].z - sitting[j].z));
      }
    }
    const st = agents.stats();
    assert(st.hops > 40, `only ${st.hops} hops in five minutes`);
    assert(st.flicks > 10, `only ${st.flicks} tongue flicks`);
    eq(deep, 0, 'checks with a frog swimming in deep water');
    assert(worstLeash < r.motion.leashM + r.motion.hop.distM[1] * r.body.displayScale + 0.2, `a frog strayed ${worstLeash.toFixed(2)} m from home`);
    assert(closest > bodyLen, `two sitting frogs ${(closest * 100).toFixed(1)} cm apart`);
    return `${st.hops} hops (${(st.hopM / st.hops * 100).toFixed(0)} cm each), ${st.swims} swims, ${st.flicks} flicks; closest sitting ${(closest * 100).toFixed(0)} cm`;
  });

  test(FROGS, 'the same seed moves the same frogs the same way; frogs that leave slip away', async () => {
    const r = await recipe();
    const a = pond(r, 5, 9).agents, b = pond(r, 5, 9).agents;
    const night = { ...bank, hourOfDay: 1 };
    // One run in whole steps, the other in 60 Hz frames: the same steps either way.
    for (let s = 0; s < 60 * 30; s++) { a.advance(1 / 30, night); b.advance(1 / 60, night); b.advance(1 / 60, night); }
    const where = (/** @type {any} */ g) => g.list().map((x) => `${x.id}:${x.x.toFixed(6)},${x.z.toFixed(6)},${x.mode}`).join(' ');
    eq(where(a), where(b), 'the two runs');
    a.sync([], false, night);
    for (let s = 0; s < 20 * 30; s++) a.advance(1 / 30, night);
    eq(a.list().length, 0, 'frogs left after they all moved on');
    return 'the same twice; all gone within 20 s of moving on';
  });
}
