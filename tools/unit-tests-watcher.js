// @ts-check
// The hagstone watcher (H2, doc 16; the orchestrator's draft 2, approved by Matt on October 27, 2026) for
// tools/unit-tests.html: the model from the generator (about 15k triangles on the stone, cut from a finer
// field with its barnacles kept, 0.8 m across, its baked maps), its rig of a root and four blades of five
// bones with whole skin weights; the weed streaming back from the stone's movement and swaying at rest;
// the hole's light through its states (rest, noticing, the tell building over 1.5 s, the call's pulse,
// ring and cue, dimmed by Snuff and Unmade); breaking; and the same seed giving the same watcher.

import { loadWatcherModel } from '../src/world/hollow/watcher-model.js';
import { createWatcherMotion, WATCHER_BONES, WATCHER_FLOATS } from '../src/world/hollow/watcher-motion.js';

const G = 'watcher';
const DT = 1 / 60;
const recipe = async () => (await fetch('../recipes/world/hollow.json')).json();
const model = () => loadWatcherModel('../assets/models/hollow/watcher.glb');

/** A rest point carried by one bone's matrix. @param {Float32Array} B @param {number} bone @param {number[]} p */
const carry = (B, bone, p) => [0, 1, 2].map((r) => B[bone * 16 + r] * p[0] + B[bone * 16 + 4 + r] * p[1] + B[bone * 16 + 8 + r] * p[2] + B[bone * 16 + 12 + r]);
/** A stand-in foe as foes.js gives it. */
const stub = () => ({ x: 0, z: 0, yaw: 0, step: 'rest', t: 0, stunS: 0, broken: false, hits: { front: 0, side: 0, back: 0 }, lureS: 0, unmade: false });
const world = (/** @type {any} */ lamp = {}) => ({ ground: () => 0, you: { x: 0, z: 3 }, lamp: { x: 0, z: 3, y: 1.2, snuffed: false, ...lamp } });

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addWatcherTests(test, assert, eq) {
  test(G, 'the generator\'s stone: about 15k triangles cut from a finer field, barnacles kept, 0.8 m across, maps baked', async () => {
    const H = await recipe(), m = await model(), P = H.foes.watcher.stone.prep;
    assert(Math.abs(m.parts.stone - P.targetTris) <= 200, `the stone ${m.parts.stone} triangles (aim ${P.targetTris})`);
    assert(m.cutFrom > 3 * m.parts.stone, `cut from a finer field (${m.cutFrom})`);
    eq(m.parts.weed, 384, 'four ribbon blades, both faces');
    eq(m.barnacles, P.crust.count, 'every barnacle');
    assert(Math.abs(m.widthM - 0.8) < 0.05, `${(m.widthM * 100).toFixed(1)} cm across`);
    assert(m.albedo && m.albedo.bytes.length > 1000 && m.normal && m.normal.bytes.length > 1000, 'albedo and normal maps baked in');
    // The barnacles survived the cut: plenty of the stone's vertices sit in the crust on the lower left.
    let crust = 0;
    for (let i = 0; i < m.stoneVerts; i++) if (m.positions[i * 3] < -0.1 && m.positions[i * 3 + 1] < 0.05) crust++;
    assert(crust > m.stoneVerts * 0.12, `vertices kept in the crusted lower left (${crust} of ${m.stoneVerts})`);
  });

  test(G, 'the rig: a root and four blades of five bones, parents first, every weight whole', async () => {
    const m = await model();
    eq(m.skeleton.length, WATCHER_BONES, '21 bones');
    eq(m.skeleton[0].name, 'root', 'the root first');
    m.skeleton.forEach((b, i) => assert(b.parent < i, `${b.name} after its parent`));
    for (let s = 0; s < 4; s++) for (let j = 0; j < 5; j++) assert(m.skeleton.some((b) => b.name === `weed.${s}.${j}`), `weed.${s}.${j}`);
    let bad = 0, stoneOff = 0;
    for (let i = 0; i < m.count; i++) {
      const w = m.weights.subarray(i * 4, i * 4 + 4);
      if (w[0] + w[1] + w[2] + w[3] !== 255) bad++;
      if (i < m.stoneVerts && (m.joints[i * 4] !== 0 || w[0] !== 255)) stoneOff++;
    }
    eq(bad, 0, 'weights sum to one');
    eq(stoneOff, 0, 'the stone is rigid, all on the root');
  });

  test(G, 'the weed sways at rest and streams back when the stone moves', async () => {
    const H = await recipe(), m = await model(), K = H.foes.watcher;
    const tip = (/** @type {Float32Array} */ B, /** @type {number} */ s) => carry(B, 1 + s * 5 + 4, m.blades[s].tip);
    const foe = stub(), mo = createWatcherMotion(foe, m, K, 3);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 600; i++) { mo.update(DT, i * DT, world()); const t = tip(mo.bones, 2); lo = Math.min(lo, t[0]); hi = Math.max(hi, t[0]); }
    assert(hi - lo > 0.01, `the longest blade sways in its current (${((hi - lo) * 100).toFixed(1)} cm)`);
    // Drifting along +x at 0.6 m/s: each tip trails behind its root (-x) by more than at rest.
    const still = [0, 1, 2, 3].map((s) => tip(mo.bones, s)[0] - m.blades[s].tip[0]);
    for (let i = 0; i < 120; i++) { foe.x += 0.6 * DT; mo.update(DT, 10 + i * DT, world()); }
    const moving = [0, 1, 2, 3].map((s) => tip(mo.bones, s)[0] - m.blades[s].tip[0]);
    for (let s = 0; s < 4; s++) assert(moving[s] < still[s] - 0.02, `blade ${s} streams back (${(still[s] * 100).toFixed(1)} to ${(moving[s] * 100).toFixed(1)} cm)`);
    assert(mo.bones.every(Number.isFinite), 'no runaway springs');
  });

  test(G, 'the hole\'s light: rest, noticing, the 1.5 s tell building, the call with its ring and cue, dimmed', async () => {
    const H = await recipe(), m = await model(), K = H.foes.watcher, L = K.stone.look;
    const foe = stub(), cues = /** @type {string[]} */ ([]);
    const mo = createWatcherMotion(foe, m, K, 5, (c) => cues.push(c));
    const run = (/** @type {number} */ s, /** @type {any} */ lamp = {}) => { for (let i = 0; i < Math.round(s / DT); i++) { foe.t += DT; mo.update(DT, i * DT, world(lamp)); } };
    run(3);
    const rest = mo.nits;
    assert(rest > L.restNits * 0.5 && rest < L.restNits * 1.5, `faint at rest (${rest.toFixed(2)})`);
    assert(mo.warm < 0.1, 'cool at rest');
    Object.assign(foe, { step: 'notice', t: 0 }); run(0.3); Object.assign(foe, { step: 'close', t: 0 }); run(2);
    assert(mo.nits > rest * 1.8 && mo.warm > 0.8, `warmer and brighter noticing (${mo.nits.toFixed(2)})`);
    Object.assign(foe, { step: 'wind', t: 0 });
    const build = [];
    for (let k = 0; k < 6; k++) { run(K.windS / 6); build.push(mo.nits); }
    for (let k = 1; k < build.length; k++) assert(build[k] > build[k - 1], 'the tell builds all the way');
    assert(Math.abs(build[5] - L.tellNits) < 0.2, `bright at the tell's end (${build[5].toFixed(2)})`);
    assert(mo.flare > 0.7, 'the weed flares out in the tell');
    eq(cues.join(), 'tell', 'a cue as the tell starts');
    Object.assign(foe, { step: 'strike', t: 0 }); run(0.08);
    assert(mo.nits > L.tellNits, `the call's pulse is brighter still (${mo.nits.toFixed(2)})`);
    eq(cues.join(), 'tell,call', 'a cue for the call');
    const inst = new Float32Array(WATCHER_FLOATS);
    mo.instance(inst, 0, 0); const r0 = inst[8];
    run(0.3); mo.instance(inst, 0, 0);
    assert(inst[8] > r0 && inst[9] > 0, `the ring runs out over the floor (${r0.toFixed(2)} to ${inst[8].toFixed(2)} m)`);
    Object.assign(foe, { step: 'recover', t: 0 }); run(2); mo.instance(inst, 0, 0);
    eq(inst[9], 0, 'the ring is gone');
    // Snuffed in the tell, it dims and the glow can't build; Unmade, the same.
    Object.assign(foe, { step: 'wind', t: 0 }); run(1.2, { snuffed: true });
    assert(mo.nits < L.restNits, `snuffed, it dims (${mo.nits.toFixed(3)})`);
    foe.unmade = true; Object.assign(foe, { step: 'close', t: 0 }); run(2);
    assert(mo.nits < L.restNits, `Unmade, it stays dim (${mo.nits.toFixed(3)})`);
  });

  test(G, 'breaking: its light goes out, it drops to the floor and sinks away in grit and motes', async () => {
    const H = await recipe(), m = await model(), K = H.foes.watcher;
    const foe = stub(), mo = createWatcherMotion(foe, m, K, 2), inst = new Float32Array(WATCHER_FLOATS);
    for (let i = 0; i < 60; i++) mo.update(DT, i * DT, world());
    mo.instance(inst, 0, 0);
    assert(Math.abs(inst[1] - K.stone.motion.hoverM) < 1e-6, 'floating at its hover');
    foe.broken = true;
    mo.update(DT, 1, world());
    assert(mo.dust.count > 0, 'grit and motes thrown');
    for (let i = 0; i < Math.round(K.stone.motion.breakup.dropS / DT); i++) mo.update(DT, 1 + i * DT, world());
    mo.instance(inst, 0, 0);
    assert(inst[1] < m.heightM * 0.6, `down on the floor (${inst[1].toFixed(2)} m)`);
    assert(mo.nits < 0.02, 'its light is out');
    for (let i = 0; i < 200; i++) mo.update(DT, 3 + i * DT, world());
    assert(mo.gone, 'sunk away');
  });

  test(G, 'the same seed gives the same watcher', async () => {
    const H = await recipe(), m = await model(), K = H.foes.watcher;
    const go = () => {
      const foe = stub(), mo = createWatcherMotion(foe, m, K, 9);
      for (let i = 0; i < 240; i++) { foe.x += 0.3 * DT; foe.yaw += 0.4 * DT; mo.update(DT, i * DT, world()); }
      return Array.from(mo.bones);
    };
    const a = go(), b = go();
    eq(a.length, b.length);
    assert(a.every((v, i) => v === b[i]), 'every bone the same');
  });
}
