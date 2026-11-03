// @ts-check
// The Hollow moves' cinematic pass (November 3, 2026): the fight's clock bends and comes back (and
// never runs when switched off), the camera's offset is zero at rest and with Camera motion off, its
// kick and shake die away, the lantern dims and comes back, a move's clip reaches its release share
// exactly as the wind-up ends, a roll out of a wind-up gives every cost back, the effects' dust is
// lit (negative colour), embers bounce and stay on the floor, flash lights carry their shadow flag,
// a flame thrown at a floater lands at its height, and the shadow capsules pack into the light buffer.

import { createCineTime } from '../src/world/hollow/cine-time.js';
import { createCineCamera } from '../src/world/hollow/cine-camera.js';
import { createCineLight } from '../src/world/hollow/cine-light.js';
import { createCine, moveKnots } from '../src/world/hollow/cine.js';
import { createMoves } from '../src/world/hollow/moves.js';
import { createMoveFx } from '../src/world/hollow/move-fx.js';
import { knotShare } from '../src/world/figure/clips.js';
import { packFxLights, MAX_FX_OCCLUDERS } from './arena/fx-lights.js';
import { MAX_FX_LIGHTS, SPARK_FLOATS, LIGHT_FLOATS } from '../src/world/hollow/fx-layout.js';

const G = 'hollow cine';
/** @param {string} p */
const load = async (p) => (await fetch(new URL(`../recipes/world/${p}.json`, import.meta.url))).json();
const run = (/** @type {{ update: (dt: number, t?: any) => any }} */ x, /** @type {number} */ s, /** @type {any} */ arg = undefined) => { let r; for (let i = 0; i < Math.round(s * 60); i++) r = x.update(1 / 60, arg); return r; };

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addHollowCineTests(test, assert, eq) {
  test(G, 'time: a hit-stop holds the fight to stopRate, a slow-down eases back to full; off, every step is whole', async () => {
    const CR = await load('hollow-cine');
    const T = createCineTime(CR.time);
    eq(T.step(1 / 60), 1 / 60, 'at rest the step is whole');
    T.hitStop(0.1);
    eq(T.scale, CR.time.stopRate, 'held');
    let fight = 0;
    for (let i = 0; i < 6; i++) fight += T.step(1 / 60);
    assert(fight < 0.01, `six frames of a stop move the fight ${fight.toFixed(4)} s`);
    T.hitStop(5);
    let held = 0; while (T.scale < 1 && held < 600) { T.step(1 / 60); held++; }
    assert(held <= Math.ceil(CR.time.maxStopS * 60) + 1, `a stop never lasts past maxStopS (${held} frames)`);
    T.slow(0.4, 0.4);
    eq(T.scale, 0.4, 'slowed');
    for (let i = 0; i < 30; i++) T.step(1 / 60);
    assert(T.scale > 0.4 && T.scale <= 1, 'easing back');
    for (let i = 0; i < 30; i++) T.step(1 / 60);
    eq(T.scale, 1, 'back to full');
    T.on = false; T.hitStop(0.1);
    eq(T.step(1 / 60), 1 / 60, 'off: the step is whole');
  });

  test(G, 'camera: no offset at rest or with Camera motion off; a kick, a push and a shake all die away', async () => {
    const CR = await load('hollow-cine');
    const C = createCineCamera(structuredClone(CR.camera));
    const zero = (/** @type {any} */ o) => Math.abs(o.distM) + Math.abs(o.pitch) + Math.abs(o.yaw) + o.target.reduce((n, v) => n + Math.abs(v), 0) + o.eye.reduce((n, v) => n + Math.abs(v), 0);
    eq(zero(C.update(1 / 60, [0, 1, 0])), 0, 'at rest, nothing');
    C.kick({ pitchDeg: 2, distM: 0.2 }); C.shake(0.6); C.push({ distM: 0.5, inS: 0.2, holdS: 0.2, outS: 0.3 }); C.reframe({ x: 4, y: 0, z: 0, weight: 0.4, inS: 0.2, holdS: 0.2, outS: 0.3 });
    const mid = run(C, 0.15, [0, 1, 0]);
    assert(zero(mid) > 0.05, 'moving while they play');
    assert(mid.target[0] > 0, 'the aim slides toward the effect');
    const after = run(C, 2, [0, 1, 0]);
    assert(zero(after) < 1e-3, `all gone after 2 s (${zero(after).toExponential(1)})`);
    const off = createCineCamera({ ...structuredClone(CR.camera), amount: 0 });
    off.kick({ pitchDeg: 3 }); off.shake(1); off.push({ distM: 1, inS: 0.1, holdS: 1, outS: 0.1 }); off.reframe({ x: 5, y: 0, z: 0, weight: 1, inS: 0.1, holdS: 1, outS: 0.1 });
    eq(zero(run(off, 0.3, [0, 1, 0])), 0, 'Camera motion off: nothing at all');
    C.hold('snuff', { distM: -0.3, inS: 0.2, outS: 0.3 });
    assert(Math.abs(run(C, 1, [0, 1, 0]).distM + 0.3) < 1e-6, 'a hold stays while the move lasts');
    C.letGo('snuff');
    assert(Math.abs(run(C, 0.5, [0, 1, 0]).distM) < 1e-6, 'and eases away once let go');
  });

  test(G, 'light: the lantern dims while a move gathers and comes back to full after the release; a hold stays until let go', async () => {
    const CR = await load('hollow-cine');
    const L = createCineLight(CR.light);
    eq(run(L, 0.1).gain, 1, 'full at rest');
    L.gather(0.5, 0.8, 0.3);
    const g = run(L, 0.4);
    assert(Math.abs(g.gain - 0.5) < 1e-6 && Math.abs(g.reach - 0.8) < 1e-6, 'gathered');
    L.release(1.6, 0.6, 1);
    const sw = run(L, 1 / 60);
    assert(sw.gain > 1, `a swell as it leaves (${sw.gain.toFixed(2)})`);
    const back = run(L, 0.7);
    assert(Math.abs(back.gain - 1) < 1e-6 && Math.abs(back.reach - 1) < 1e-6, 'back to full');
    L.hold('moths', 0.8, 0.9);
    assert(Math.abs(run(L, 0.2).gain - 0.8) < 1e-6, 'held lower while the moths are out');
    L.letGo('moths');
    eq(run(L, 0.1).gain, 1, 'and back');
    L.gather(0.4, 0.5, 0.3); run(L, 0.2); L.cancel();
    assert(Math.abs(run(L, 0.4).gain - 1) < 1e-6, 'a roll out of the wind-up brings it back');
  });

  test(G, 'clip timing: every move\'s clip reaches its release share exactly as its wind-up ends; Back step plays evenly', async () => {
    const [CR, MR] = await Promise.all([load('hollow-cine'), load('hollow-moves')]);
    for (const [id, m] of Object.entries(MR.moves)) {
      const B = CR.moves[id]?.body, k = moveKnots(/** @type {any} */ (m), B);
      if (!B || !(/** @type {any} */ (m).windS > 0)) { eq(k, null, `${id} plays evenly`); continue; }
      const M = /** @type {any} */ (m), uw = M.windS / (M.windS + M.activeS + M.recoverS);
      assert(k && Math.abs(knotShare(k, uw) - B.release) < 1e-9, `${id}: at the end of the wind-up the clip is at its release`);
      assert(k && k.every((p, i) => i === 0 || (p[0] >= k[i - 1][0] && p[1] >= k[i - 1][1])), `${id}: the knots never run backward`);
      assert(k && knotShare(k, 1) === 1, `${id}: it ends at the clip's end`);
    }
    const cine = createCine(CR, MR, { seed: 1 });
    /** @type {any[]} */ const heard = [];
    const loud = createCine(CR, MR, { emit: (n, p) => heard.push([n, p]) });
    loud.beat('castFlame', 'wind'); loud.beat('castFlame', 'release'); loud.contact('land', { x: 0, y: 1, z: 0 });
    eq(heard.map((h) => h[1].move + '.' + h[1].beat).join(), 'castFlame.wind,castFlame.release,swing.land', 'a sound cue for each beat');
    eq(heard[0][0], 'hollow:beat', 'on hollow:beat');
    cine.beat('groundline', 'release');
    assert(cine.time.scale < 1, 'the slam holds the fight a moment');
  });

  test(G, 'a roll out of a wind-up: the move is cancelled with every cost given back; once it has left it cannot be', async () => {
    const MR = await load('hollow-moves');
    const mv = createMoves(MR);
    mv.start('taproot', { x: 0, z: 0 });
    eq(mv.seeds, MR.seeds - 1, 'the seed left the pack');
    mv.update(0.05);
    assert(mv.winding, 'in its wind-up');
    eq(mv.cancel(), 'taproot', 'cancelled');
    eq(mv.seeds, MR.seeds, 'the seed is back');
    eq(mv.why('taproot'), null, 'and it is ready again at once');
    mv.start('kindlingBurst', { x: 0, z: 0 });
    mv.cancel();
    assert(!mv.spent('kindlingBurst'), 'a once-a-floor move is unspent');
    mv.start('castFlame', { x: 0, z: 0 });
    mv.update(MR.moves.castFlame.windS + 0.01);
    eq(mv.cancel(), null, 'once it has left, nothing to cancel');
    eq(mv.why('castFlame'), 'waiting', 'and its wait stands');
    // A move cancelled while an earlier wait was still running gets that wait back, not a fresh one.
    const m2 = createMoves(MR);
    m2.start('feint', { x: 0, z: 0 }); m2.update(5);
    const left = m2.ready('feint');
    m2.newFloor(); m2.start('feint', { x: 0, z: 0 }); m2.cancel();
    eq(m2.why('feint'), null, `after a new floor, a cancelled feint is ready (earlier ${left.toFixed(2)} ready)`);
  });

  test(G, 'effects: dust is lit (negative colour), embers bounce and lie glowing, flashes carry shadows, a throw at a floater lands at its height', async () => {
    const FX = await load('hollow-move-fx');
    const fx = createMoveFx(FX, { seed: 3, ground: () => 0 });
    fx.cue('groundline.slam', { x: 0, z: 0, yaw: 0 });
    fx.update(1 / 60);
    let g = fx.gpu(), dust = 0, glow = 0;
    for (let i = 0; i < g.nSparks; i++) { if (g.sparks[i * SPARK_FLOATS + 4] < 0) dust++; else glow++; }
    assert(dust > 0 && glow > 0, `dust (${dust}) and glowing chips (${glow})`);
    let shadow = false;
    for (let i = 0; i < g.nLights; i++) if (g.lights[i * LIGHT_FLOATS + 7] === 1) shadow = true;
    assert(shadow, 'the slam\'s flash casts shadows');
    for (let i = 0; i < 60; i++) fx.update(1 / 60);
    g = fx.gpu();
    let lying = 0;
    for (let i = 0; i < g.nSparks; i++) { const b = i * SPARK_FLOATS; if (g.sparks[b + 4] > 0 && g.sparks[b + 1] < 0.02) lying++; }
    assert(lying > 0, `embers lying on the floor after a second (${lying})`);
    const fx2 = createMoveFx(FX, { seed: 3, ground: () => 0 });
    fx2.cue('castFlame.throw', { from: [0, 1.2, 0], x: 0, y: 1.5, z: 4, flightS: 0.3 });
    for (let i = 0; i < 19; i++) fx2.update(1 / 60);
    const after = fx2.gpu();
    let atHeight = false;
    for (let i = 0; i < after.nLights; i++) if (Math.abs(after.lights[i * LIGHT_FLOATS + 1] - 1.5) < 0.05 && Math.abs(after.lights[i * LIGHT_FLOATS + 2] - 4) < 0.05) atHeight = true;
    assert(atHeight, 'the burst\'s light is at the stone\'s height, 1.5 m');
    // The same seed and steps give the same effects.
    const a = createMoveFx(FX, { seed: 9, ground: () => 0 }), b = createMoveFx(FX, { seed: 9, ground: () => 0 });
    for (const e of [a, b]) { e.cue('castFlame.burst', { x: 1, z: 2, ringM: 1.3, scorchS: 3 }); for (let i = 0; i < 30; i++) e.update(1 / 60); }
    const ga = a.gpu(), gb = b.gpu();
    assert(ga.nSparks === gb.nSparks && ga.sparks.every((v, i) => v === gb.sparks[i]), 'deterministic');
  });

  test(G, 'shadow capsules pack after the lights, with their count and softness; lights keep their shadow flag', () => {
    const src = new Float32Array(2 * LIGHT_FLOATS);
    src.set([1, 2, 3, 4, 0.5, 0.6, 0.7, 1], 0);
    src.set([0, 0, 0, 0, 1, 1, 1, 0], LIGHT_FLOATS);
    const occ = { list: Array.from({ length: 14 }, (_, i) => ({ x: i, z: -i, r: 0.3, y0: 0.1, y1: 1.2 + i })), softM: 0.4 };
    const out = packFxLights(src, undefined, undefined, occ);
    eq(out[0], 1, 'the light with no reach is skipped');
    eq(out[11], 1, 'its shadow flag');
    eq(out[1], MAX_FX_OCCLUDERS, 'capsules capped');
    assert(Math.abs(out[2] - 0.4) < 1e-6, 'softness');
    const base = 4 + MAX_FX_LIGHTS * 8, tops = base + MAX_FX_OCCLUDERS * 4;
    eq([out[base + 4], out[base + 5]].join(), '1,-1', 'the second capsule');
    assert(Math.abs(out[tops + 1] - 2.2) < 1e-6, 'its top');
    eq(packFxLights(src)[1], 0, 'no capsules, no shadows');
  });
}
