// @ts-check
// Tests for life under a log (docs/future/11 L3a): the woodlouse and beetle meshes
// (src/world/finds/under-log-meshes.js), their leg bones (leg-rig.js) and how they run when
// uncovered (under-log-motion.js). Pure, so they run in a worker.

import { woodlouseMesh, beetleMesh } from '../src/world/finds/under-log-meshes.js';
import { legRig, legBones } from '../src/world/finds/leg-rig.js';
import { scuttle, scuttleEnds } from '../src/world/finds/under-log-motion.js';

const G = 'under-log meshes';

async function underLogRecipe() {
  const r = await fetch('../recipes/species/under-log.json');
  if (!r.ok) throw new Error(`recipes/species/under-log.json: HTTP ${r.status}`);
  return r.json();
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addUnderLogMeshTests(test, assert, eq) {
  const kinds = /** @type {const} */ ([['woodlice', woodlouseMesh, 14], ['beetle', beetleMesh, 6]]);

  test(G, 'each mesh is built, finite, its base on y = 0 and its body the real length', async () => {
    const R = await underLogRecipe();
    for (const [id, make] of kinds) {
      const m = make(R[id].shape), V = m.vertices;
      assert(m.count > 100 && m.indices.length > 300, `${id}: has vertices and triangles`);
      eq(V.length, m.count * 9, `${id}: 9 floats a vertex`);
      let lo = Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < V.length; i++) assert(Number.isFinite(V[i]), `${id}: finite`);
      for (let i = 0; i < m.count; i++) {
        lo = Math.min(lo, V[i * 9 + 1]);
        // The body only (bone 0): not the antennae or legs reaching beyond it.
        if (m.bind.bone[i] === 0) { z0 = Math.min(z0, V[i * 9 + 2]); z1 = Math.max(z1, V[i * 9 + 2]); }
      }
      assert(Math.abs(lo) < 1e-6, `${id}: base on y = 0 (got ${lo})`);
      const len = z1 - z0, want = R[id].shape.lengthM;
      assert(Math.abs(len - want) / want < 0.2, `${id}: ${(len * 1000).toFixed(1)} mm long, wanted about ${(want * 1000).toFixed(0)}`);
      for (const k of m.indices) assert(k < m.count, `${id}: indices in range`);
    }
  });

  test(G, 'the leg rig finds 14 woodlouse legs and 6 beetle legs, each bone with weighted vertices', async () => {
    const R = await underLogRecipe();
    for (const [id, make, n] of kinds) {
      const m = make(R[id].shape), rig = legRig(m, R[id].legs);
      eq(rig.legs.length, n, `${id}: legs`);
      eq(rig.antennae.length, 2, `${id}: antennae`);
      eq(rig.legs.filter((L) => L.side > 0).length, n / 2, `${id}: half the legs on each side`);
      const heavy = new Map();
      for (let i = 0; i < m.count; i++) if (rig.weights[i * 4 + 1] > 128) heavy.set(rig.joints[i * 4 + 1], (heavy.get(rig.joints[i * 4 + 1]) ?? 0) + 1);
      for (let b = 1; b <= n + 2; b++) assert((heavy.get(b) ?? 0) > 4, `${id}: bone ${b} moves some vertices`);
      // Legs leave the body sideways: every leg's tip is out past its root.
      rig.legs.forEach((L, i) => {
        let far = 0;
        for (let v = 0; v < m.count; v++) if (rig.joints[v * 4 + 1] === i + 1) far = Math.max(far, Math.abs(m.vertices[v * 9]));
        assert(far > Math.abs(L.pivot[0]), `${id}: leg ${i} reaches out past its root`);
      });
    }
  });

  test(G, 'legBones gives finite matrices for every bone, legs moving and antennae swaying', async () => {
    const R = await underLogRecipe();
    for (const [id, make, n] of kinds) {
      const rig = legRig(make(R[id].shape), R[id].legs);
      for (const ph of [0, 0.7, 2.1, 4.4]) {
        const B = legBones(rig, ph, R[id].legs);
        eq(B.length, (n + 3) * 16, `${id}: one matrix a bone`);
        for (const x of B) assert(Number.isFinite(x), `${id}: finite at phase ${ph}`);
      }
      const a = legBones(rig, 0.5, R[id].legs), b = legBones(rig, 2.0, R[id].legs);
      let moved = 0;
      for (let i = 16; i < a.length; i++) moved = Math.max(moved, Math.abs(a[i] - b[i]));
      assert(moved > 1e-3, `${id}: the bones change with the phase`);
    }
  });

  test(G, 'the crab rig is unchanged: no antennae, the same bones as before', () => {
    // A tiny shell with legs out each side, rigged the way the edible crab is.
    const V = [];
    for (let i = 0; i < 40; i++) { const x = -0.02 + (i / 39) * 0.04, z = ((i * 7) % 11) / 11 * 0.02 - 0.01; V.push(x, (i % 3) * 0.002, z, 0, 1, 0, 1, 1, 1); }
    const rig = legRig({ vertices: new Float32Array(V), count: 40 }, { shellShare: 0.42, bands: 4 });
    eq(rig.legs.length, 8, 'eight legs');
    eq(rig.antennae.length, 0, 'no antennae');
    const B = legBones(rig, 1.3, { liftDeg: 18, sweepDeg: 14, clawShare: 0.35 });
    eq(B.length, 9 * 16, 'nine bones');
    // Leg 1 (band 1, side +1): phase + pi; its lift and sweep about its root as before.
    const ph = 1.3 + Math.PI;
    const lift = (Math.max(0, Math.sin(ph)) * 18 * Math.PI) / 180, sweep = (Math.cos(ph) * 14 * Math.PI) / 180;
    assert(Math.abs(B[2 * 16] - Math.cos(sweep) * Math.cos(lift)) < 1e-6, 'same rotation');
    assert(Math.abs(B[2 * 16 + 1] - Math.sin(lift)) < 1e-6, 'same lift');
  });

  test(G, 'scuttle is the same for the same input, freezes first, and ends at its target', async () => {
    const R = await underLogRecipe();
    for (const id of ['woodlice', 'beetle']) {
      const S = R[id].scuttle;
      const e = { x: 0.01, z: -0.02, yaw: 1.1, r: 0.43, tx: -0.03, tz: 0.04 };
      for (const t of [0, 0.3, 1.2, 2.5, 4]) {
        const a = scuttle(e, t, S), b = scuttle({ ...e }, t, S);
        eq(JSON.stringify(a), JSON.stringify(b), `${id}: deterministic at ${t} s`);
      }
      const still = scuttle(e, S.freezeS[0] * 0.5, S);
      assert(!still.running && still.x === e.x && still.z === e.z, `${id}: frozen for a beat`);
      const end = scuttleEnds(e, S), done = scuttle(e, end + 5, S);
      assert(!done.running, `${id}: stopped at the end`);
      assert(Math.hypot(done.x - e.tx, done.z - e.tz) < 1e-6, `${id}: ends at its target`);
      let ran = false;
      for (let t = 0; t < end; t += 0.05) if (scuttle(e, t, S).running) ran = true;
      assert(ran, `${id}: runs on the way`);
      // The leg phase runs faster while running than while still.
      const s0 = scuttle(e, 0, S).step, s1 = still.step;
      assert(s1 > s0 && done.step > s1, `${id}: the step phase advances`);
    }
  });

  test(G, 'the beetle runs out into the open before it turns for cover', async () => {
    const S = (await underLogRecipe()).beetle.scuttle;
    const e = { x: 0, z: 0, yaw: 0, r: 0.5, tx: 0, tz: 0.05 };
    let far = 0;
    for (let t = 0; t < scuttleEnds(e, S); t += 0.05) far = Math.max(far, Math.hypot(scuttle(e, t, S).x - e.tx, scuttle(e, t, S).z - e.tz));
    assert(far > 0.05 + S.outM * 0.8, `beetle went ${far.toFixed(3)} m from cover`);
  });
}
