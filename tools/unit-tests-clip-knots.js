// @ts-check
// Clip timing knots (the Hollow moves' cinematic pass, November 3, 2026): a shot may carry knots that
// retime it (a slow rise into a wind-up, a held top, a fast release), and with no knots every clip
// must play exactly as it did before knots existed. The walk, the run, the roll, the island's acts
// (Lift, picking up, planting) and the lantern raise are sampled frame by frame and hashed; the hash
// was taken on main before clips.js gained knots (orchestrator's guardrail 1).

import { createFigureMotion } from '../src/world/figure/motion.js';
import { loadFigureClips, knotShare } from '../src/world/figure/clips.js';
import { load } from './unit-tests-figure.js';

const G = 'clip knots';
/** Poses hashed on main before knots (rounded to 1e-4, FNV-1a over the rounded numbers). */
const BEFORE = { walk: 'fbfb430b', run: 'f6ffc504', roll: 'fa27d3b7', acts: '4e912dea', shot: '66ce7ac8', raise: 'b9657316' };

/** FNV-1a over the bones rounded to 1e-4. @param {Float32Array[]} frames */
function hash(frames) {
  let h = 0x811c9dc5;
  for (const f of frames) for (let i = 0; i < f.length; i++) {
    const v = Math.round(f[i] * 1e4) | 0;
    h = Math.imul(h ^ (v & 0xffff), 16777619) >>> 0;
    h = Math.imul(h ^ (v >>> 16), 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Each case's frames. @param {any} R @param {any} built @param {any} C @param {any} F the fight clip file */
export function poseRuns(R, built, C, F) {
  const dt = 1 / 60;
  const make = () => { const m = createFigureMotion(R, built.skeleton, C); if (F) m.addClips(F); return m; };
  const st = (/** @type {any} */ o = {}) => ({ x: 0, z: 0, y: 0, yaw: 0, speed: 0, moving: false, ground: () => 0, depth: () => 0, below: true, ...o });
  /** @param {(m: any, f: number) => any} state @param {number} n @param {(m: any) => void} [start] */
  const run = (state, n, start) => {
    const m = make(), out = [];
    for (let f = 0; f < 20; f++) m.update(dt, st());
    start?.(m);
    for (let f = 0; f < n; f++) { m.update(dt, state(m, f)); out.push(m.bones.slice()); }
    return out;
  };
  /** @type {Record<string, Float32Array[]>} */
  const r = {};
  r.walk = run((_m, f) => st({ x: f * dt * 2.2, speed: 2.2, moving: true }), 90);
  r.run = run((_m, f) => st({ x: f * dt * 4.2, speed: 4.2, moving: true }), 90);
  r.roll = run((_m, f) => st({ x: f * dt * 3, speed: 3, moving: true, rolling: f < 30 ? f / 30 : -1 }), 70);
  // The camp's acts (digging, lifting a clump, laying) and the gestures (picking up, Lift) play their island clips.
  r.acts = [...['dig', 'liftClump', 'lay'].map((n) => run(() => st(), 80, (m) => m.act(n))), ...['gather', 'lift'].map((n) => run(() => st(), 80, (m) => m.gesture(n)))].flat();
  r.shot = F ? run(() => st(), 100, (m) => m.shoot('swingDouble', { feet: true })) : [];
  r.raise = F ? run((m, f) => { m.holdClip('raiseLantern', f < 40, { span: [0.15, 0.65], mask: ['upperArm.l', 'foreArm.l', 'hand.l'], upS: 0.15, downS: 0.2 }); return st(); }, 70) : [];
  return r;
}

/** @param {(group: string, name: string, fn: () => any) => void} test @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq */
export function addClipKnotsTests(test, assert, eq) {
  test(G, 'no knots: the walk, run, roll, acts, a swing and the lantern raise sample exactly as before knots', async () => {
    const { R, built } = await load();
    const C = await loadFigureClips(R);
    const FR = await (await fetch('../recipes/world/fight-clips.json')).json();
    const F = await (await fetch(`../${FR.file}`)).json();
    const r = poseRuns(R, built, C, F);
    const got = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, hash(v)]));
    for (const k of Object.keys(BEFORE)) eq(got[k], BEFORE[/** @type {keyof typeof BEFORE} */ (k)], `${k} as before knots`);
    return Object.entries(got).map(([k, v]) => `${k} ${v}`).join(', ');
  });

  test(G, 'knots: identity knots play as none; a held knot holds the clip still; shares stay in 0..1', async () => {
    eq(knotShare(undefined, 0.37), 0.37, 'no knots: the share is the time share');
    eq(knotShare([[0, 0], [1, 1]], 0.37), 0.37, 'identity');
    eq(knotShare([[0, 0], [0.5, 0.4], [0.7, 0.4], [1, 1]], 0.6), 0.4, 'a held stretch');
    assert(Math.abs(knotShare([[0, 0], [0.5, 0.4], [1, 1]], 0.75) - 0.7) < 1e-12, 'straight between knots');
    eq(knotShare([[0, 0], [1, 1]], 1.5), 1, 'clamped');
    const { R, built } = await load();
    const C = await loadFigureClips(R);
    const FR = await (await fetch('../recipes/world/fight-clips.json')).json();
    const F = await (await fetch(`../${FR.file}`)).json();
    const dt = 1 / 60, s = { x: 0, z: 0, y: 0, yaw: 0, speed: 0, moving: false, ground: () => 0, depth: () => 0, below: true };
    const play = (/** @type {any} */ knots) => {
      const m = createFigureMotion(R, built.skeleton, C); m.addClips(F);
      for (let f = 0; f < 20; f++) m.update(dt, s);
      m.shoot('throwToss', { lenS: 1, knots, feet: true });
      const out = []; for (let f = 0; f < 60; f++) { m.update(dt, s); out.push(m.bones.slice()); }
      return out;
    };
    const a = play(undefined), b = play([[0, 0], [1, 1]]);
    assert(a.every((f, i) => f.every((v, j) => v === b[i][j])), 'identity knots give the same bones, bit for bit');
    const h = play([[0, 0], [0.3, 0.5], [0.6, 0.5], [1, 1]]);
    // The hat's tip is a trailing spring of its own (it settles after the body stops), so it is left out.
    const hat = new Set(built.skeleton.flatMap((/** @type {any} */ bn, /** @type {number} */ i) => (bn.name.startsWith('hat') ? [i] : [])));
    // The code's own life (breathing, the look) goes on over a held clip, so held is measured against the same frames played evenly.
    const moved = (/** @type {Float32Array[]} */ fr) => Math.max(...fr[24].map((v, j) => (hat.has(Math.floor(j / 16)) ? 0 : Math.abs(v - fr[33][j]))));
    const d = moved(h), even = moved(a);
    assert(d < even * 0.25, `held between 0.3 and 0.6 of its time the pose all but stays (${d.toFixed(3)} against ${even.toFixed(3)} played evenly)`);
    return `held ${d.toFixed(3)}, even ${even.toFixed(3)}`;
  });
}
