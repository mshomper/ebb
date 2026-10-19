// @ts-check
// Live frog tests for tools/unit-tests.html (S6b-2, docs 11, 12): the legs reach by IK, the chorus
// never starts two calls within its gap, frogs keep their distance and their leash, never swim
// where lilies grow, repeat exactly for the same seed, and slip away when they leave. On a made-up
// bank: land for z < 0, shallows to 0.25 m for 0 < z < 2, deeper beyond.

import { createFrogAgents } from '../src/world/creatures/agents.js';
import { twoBoneIK, qrot } from '../src/world/creatures/motion.js';
import { createPerches } from '../src/world/creatures/perches.js';
import { padsOf, lilyShape, lilyWind } from '../src/world/growth/lily-pads.js';
import { hash32 } from '../src/core/rng.js';

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

  test(FROGS, 'lily pads: the frogs\' pad formula matches the pad shader', async () => {
    const lily = await fetch('../recipes/flora/lilies.json').then((x) => x.json());
    const wgsl = await fetch('../src/shaders/flora-lilies.wgsl').then((x) => x.text());
    // The shader's numbers this formula copies; if one changes there, change lily-pads.js too.
    for (const s of ['select(1.0, 0.3, pad == 0u)', '0.7 + 0.3 * v.z', 't * 0.35', 't * 0.21', 't * 0.17', 'h * 4.1', '* 4.0 - t * 1.3', '* 3.1 + t * 0.9',
      'const LAYER_M: f32 = 0.0008', '(pad * 5u + plantU) % 16u', 'windT * 0.7 + v.w * 6.2831853', '1.0 - ld.pad.x * 0.5 + ld.pad.x * v.z']) {
      assert(wgsl.includes(s), `flora-lilies.wgsl no longer has "${s}"`);
    }
    const L = lilyShape(lily);
    const w = lilyWind({ time: 123.25, wind: 0.4, windDir: 0.785 });
    const plant = { id: 17, x: 3, z: -2, size: 1, stage: 3 };
    const pads = padsOf(plant, L, w);
    // The shader's vertex code, transcribed line by line, for pad 2.
    const u = Math.floor(Math.fround(hash32(17, 0x51ed) / 4294967296) * 16777216) >>> 0;
    const h0 = hash32(u, 2, (lily.seed >>> 0) % 100000), h1 = hash32(h0), h2 = hash32(h1), h3 = hash32(h2);
    const f = (/** @type {number} */ h) => (h >>> 8) / 16777216;
    const spread = lily.shape.spreadRadius * (lily.look.radiusMin + (1 - lily.look.radiusMin) * 1);
    const ang = f(h0) * 6.2831853, rr = spread * Math.sqrt(f(h1));
    const gust = 0.75 + 0.25 * Math.sin(w.t * 0.35 + (3 * w.x + -2 * w.z) * 0.4);
    const reach = 0.7 + 0.3 * f(h2), hh = f(h3);
    const sx = (w.x * w.s * gust * reach + Math.sin(w.t * 0.21 + hh * 6.2831853) * 0.25) * lily.wind.swingM;
    const sz = (w.z * w.s * gust * reach + Math.cos(w.t * 0.17 + hh * 4.1) * 0.25) * lily.wind.swingM;
    const want = [3 + Math.cos(ang) * rr + sx, -2 + Math.sin(ang) * rr + sz, lily.shape.padRadius * (1 - lily.shape.padVar * 0.5 + lily.shape.padVar * f(h2))];
    const got = pads[2];
    const miss = Math.max(Math.abs(got.x - want[0]), Math.abs(got.z - want[1]), Math.abs(got.radius - want[2]));
    assert(miss < 1e-9, `pad 2 is ${miss} m off the shader's`);
    eq(got.layer, (2 * 5 + u) % 16, 'pad 2 layer');
    eq(pads.length, lily.shape.padsPerPlant[1], 'pads on a full plant');
    return `${pads.length} pads; pad 2 matches to ${(miss * 1e9).toFixed(1)} nm`;
  });

  test(FROGS, 'a frog on a lily pad rides it for minutes, its seat always on the leaf; swimmers duck under pads', async () => {
    const r = await recipe();
    const lily = await fetch('../recipes/flora/lilies.json').then((x) => x.json());
    // A pond beyond z = 0, deep enough for lilies from z = 0.6; lily plants out on it, the nearest
    // pads beyond a hop from the bank (frogs swim out to them).
    const water = (/** @type {number} */ x, /** @type {number} */ z) => (z <= 0 ? { depth: 0, surface: 0 } : { depth: z < 0.6 ? 0.15 : 0.6, surface: 0.15 });
    const perches = createPerches({ lily, P: { ...r.motion.pads, clumps: r.motion.clumps }, water });
    const plants = [0, 1, 2, 3].map((i) => ({ id: 40 + i, sp: 'lilies', x: -3 + i * 2, z: 1.9, size: 1, stage: 3 }));
    const env = { ...bank, water, pads: perches };
    const { agents } = pond(r, 5, 11);
    let onPads = 0, offLeaf = 0, through = 0, seen = new Set();
    for (let s = 0; s < 360 * 30; s++) {
      const t = s / 30;
      perches.update({ time: t, wind: 0.6, windDir: 0.4 + 0.3 * Math.sin(t / 50) }, plants, {});
      agents.advance(1 / 30, { ...env, hourOfDay: 21 });
      for (const a of agents.list()) {
        if (a.perch && !a.hop) {
          onPads++;
          seen.add(a.perch.key);
          if (!perches.onLeaf(a.perch)) offLeaf++;
        }
        // A swimmer under a pad must be down under it, not at the surface (a leap off a pad starts on it).
        if (!a.hop && (a.mode === 'swim' || a.mode === 'float') && perches.underPad(a.x, a.z) && a.under < 0.5 * r.motion.pads.submergeM * r.body.displayScale) through++;
      }
    }
    const st = agents.stats();
    assert(st.perches > 0, 'no frog sat on a pad in six minutes');
    eq(offLeaf, 0, 'checks with a frog off its pad\'s leaf');
    eq(through, 0, 'checks with a swimmer at the surface under a pad');
    const keys = agents.list().filter((a) => a.perch).map((a) => a.perch?.key);
    eq(new Set(keys).size, keys.length, 'two frogs on one pad');
    return `${st.perches} times onto a pad (${seen.size} pads), ${(onPads / 30).toFixed(0)} frog-seconds riding them, never off the leaf`;
  });

  test(FROGS, 'a frog floating far out with no bank in reach swims back and hops home', async () => {
    const r = await recipe();
    const { agents } = pond(r, 3, 5);
    const env = { ...bank, hourOfDay: 12 };
    agents.advance(1 / 30, env);
    // Three frogs out on the pond, 1.5 to 2.5 m from the bank, floating.
    agents.list().forEach((a, i) => Object.assign(a, { x: a.x + 0.4, z: 1.5 + i * 0.5, mode: 'float', until: 0, nextAt: 0, hop: null, swim: null }));
    let back = -1;
    for (let s = 0; s < 240 * 30 && back < 0; s++) {
      agents.advance(1 / 30, env);
      if (agents.list().every((a) => !a.hop && env.water(a.x, a.z).depth === 0)) back = s / 30;
    }
    assert(back >= 0, `still in the water after four minutes: ${agents.list().map((a) => `${a.mode} at z ${a.z.toFixed(2)}`).join(', ')}`);
    return `all three ashore after ${back.toFixed(0)} s`;
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
