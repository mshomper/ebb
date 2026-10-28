// @ts-check
// The move effects lab (the move effects, October 27, 2026): one move's effect at a time, in the
// Hollow by lantern, with the walker as a pale block holding the lantern and a Hollow thing as a dark
// block ahead. Each move plays as it does in the arena (tools/arena/moves.js): the same cues, the same
// timings from recipes/world/hollow-moves.json, drawn by the same pass (tools/arena/fx-pass.js) with
// the same lights. Sliders for every number of the move's look, and its recipe to copy back.

import { createStage } from './walker-figure-stage.js';
import { createFxPass } from './arena/fx-pass.js';
import { pushBox, pushCylinder, pushRing, pushArc, pushLane, pushDisc } from './arena/props.js';
import { createMoveFx } from '../src/world/hollow/move-fx.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const recipe = async (/** @type {string} */ p) => (await fetch(new URL(`../recipes/${p}.json`, import.meta.url))).json();
const view = /** @type {HTMLCanvasElement} */ ($('view'));
const made = await createStage(view);
if (!made.ok) { $('note').textContent = `This page needs WebGPU (${made.reason}).`; throw new Error(made.reason); }
const stage = made.stage;
const pass = await createFxPass(stage.gpu);
const [FX, MR] = await Promise.all([recipe('world/hollow-move-fx'), recipe('world/hollow-moves')]);
const ground = (/** @type {number} */ x, /** @type {number} */ z) => 0.08 * Math.sin(x * 0.7) * Math.cos(z * 0.6);
stage.setGround(ground, 14, 90);
stage.view({ yaw: 0.9, pitch: 0.75, dist: 11 });

/** The order the moves sit in, by track. */
const ORDER = ['anchor', 'hookTurn', 'groundline', 'castFlame', 'wickSnare', 'kindlingBurst', 'backStep', 'feint', 'snuff', 'taproot', 'springChorus', 'mothLure'];
const lampS = /** @type {HTMLInputElement} */ ($('lamp')), distS = /** @type {HTMLInputElement} */ ($('dist')), loop = /** @type {HTMLInputElement} */ ($('loop'));

let fx = createMoveFx(FX, { seed: 1, ground });
let pick = 'castFlame', age = 0, snuffed = false;
/** Things to do a while after the move starts. @type {{ at: number, go: () => void }[]} */
let plan = [];
/** The crack Groundline draws itself (as the arena does): how far it has gone, and how long it shows after. */
let crack = /** @type {{ m: number, to: number, after: number } | null} */ (null);

const you = { x: 0, z: 0, yaw: 0 };
const target = () => ({ x: 0, z: Number(distS.value), size: 0.45 });
const lampAt = () => [you.x + 0.28, ground(you.x, you.z) + 1.05, you.z + 0.1];
const hand = () => [you.x - 0.25, ground(you.x, you.z) + 1.25, you.z];
const M = (/** @type {string} */ id) => MR.moves[id];

/** Play the picked move from the start, as the arena would. */
function play() {
  fx.clear(); plan = []; age = 0; crack = null; snuffed = false;
  const m = M(pick), t = target(), at = (/** @type {number} */ s, /** @type {() => void} */ go) => plan.push({ at: s, go });
  const wind = m.windS ?? 0;
  switch (pick) {
    case 'anchor':
      at(wind, () => fx.cue('anchor.brace', { x: you.x, z: you.z }));
      at(wind + 0.35, () => fx.cue('anchor.catch', { x: you.x, z: you.z, tx: t.x, tz: Math.min(t.z, 1.2) }));
      break;
    case 'hookTurn': at(wind, () => fx.cue('hookTurn', { x: t.x, z: t.z, r: t.size + 0.35, yaw: Math.PI })); break;
    case 'groundline':
      at(wind, () => { crack = { m: 0, to: m.reachM, after: 1 }; fx.start('crack', 'crackTip', { x: you.x, z: you.z }); });
      break;
    case 'castFlame': at(wind, () => fx.cue('castFlame.throw', { from: hand(), x: t.x, z: t.z, ringM: m.ringM, scorchS: m.scorchS, flightS: m.activeS })); break;
    case 'wickSnare': {
      const w = { x: 0, z: (t.z + you.z) / 2 };
      at(wind, () => fx.start('wick', 'wick', w));
      at(wind + 1.4, () => { fx.stop('wick'); fx.start('bind', 'bind', { x: w.x, z: w.z, r: t.size, forS: m.bindS }); });
      break;
    }
    case 'kindlingBurst': at(wind, () => fx.cue('kindlingBurst', { x0: you.x, z0: you.z, x1: 0, z1: m.reachM, fadeS: m.fadeS, widthM: m.widthM })); break;
    case 'backStep': at(wind, () => fx.cue('backStep', { x: you.x, z: you.z, yaw: 0 })); break;
    case 'feint': at(wind, () => fx.cue('feint', { x: you.x, z: you.z, yaw: 0, r: m.reachM, arcDeg: m.arcDeg })); break;
    case 'snuff': {
      at(wind, () => { const l = lampAt(); snuffed = true; fx.cue('snuff.out', { x: l[0], y: l[1], z: l[2] }); fx.start('snuff', 'snuff', { x: l[0], y: l[1], z: l[2] }); });
      at(wind + 3, () => { snuffed = false; fx.stop('snuff'); });
      break;
    }
    case 'taproot':
      at(wind, () => fx.cue('taproot.throw', { from: hand(), x: t.x, z: t.z, flightS: m.activeS }));
      at(wind + m.activeS, () => fx.start('root', 'root', { x: t.x, z: t.z, size: t.size }));
      at(wind + m.activeS + m.burstS, () => { fx.stop('root'); fx.cue('taproot.burst', { x: t.x, z: t.z, size: t.size }); });
      break;
    case 'springChorus': at(wind, () => fx.cue('springChorus', { x: you.x, z: you.z, r: m.reachM })); break;
    case 'mothLure':
      at(wind, () => fx.start('moths', 'swarm', { from: lampAt(), x: t.x, z: t.z }));
      at(wind + Math.min(m.lureS, 6), () => fx.stop('moths'));
      break;
  }
}
/** How long a move's look takes before it replays. */
const lengthOf = (/** @type {string} */ id) => ({ snuff: 4.5, taproot: 5.2, mothLure: 8.5, wickSnare: 5.2, castFlame: 4, springChorus: 3.6 })[id] ?? 2.6;

// ---- the move buttons ----
const buttons = ORDER.map((id) => {
  const b = document.createElement('button');
  b.textContent = M(id)?.name ?? id;
  b.onclick = () => { pick = id; showTune(); play(); for (const o of buttons) o.classList.toggle('on', o === b); };
  $('moves').append(b);
  return b;
});
buttons[ORDER.indexOf(pick)].classList.add('on');
$('again').onclick = play;

// ---- the sliders: every number in the move's look ----
/** A slider's range from its starting value. @param {number} v @param {string} name */
function rangeFor(v, name) {
  if (/^n$|count|segments|rings/.test(name)) return { min: 0, max: Math.max(4, Math.ceil(v * 3)), step: 1 };
  if (/col/.test(name)) return { min: 0, max: Math.max(2, Math.ceil(v * 2.5)), step: 0.05 };
  if (v === 0) return { min: -2, max: 2, step: 0.01 };
  const lo = v < 0 ? v * 3 : 0, hi = v < 0 ? 0 : v * 3;
  return { min: lo, max: hi, step: Math.abs(v) < 0.1 ? 0.001 : Math.abs(v) < 2 ? 0.01 : 0.1 };
}
function showTune() {
  const box = $('tune');
  box.replaceChildren();
  $('tuneTitle').textContent = `${M(pick)?.name ?? pick}: its look`;
  /** @param {any} obj @param {string} path */
  const walk = (obj, path) => {
    for (const [k, v] of Object.entries(obj)) {
      const name = path ? `${path} ${k}` : k;
      if (typeof v === 'number') add(obj, k, name, v);
      else if (Array.isArray(v) && v.every((x) => typeof x === 'number')) v.forEach((x, i) => add(v, i, `${name} ${k === 'col' ? 'rgb'[i] : i ? 'most' : 'least'}`, x));
      else if (v && typeof v === 'object') walk(v, name);
    }
  };
  /** @param {any} obj @param {string | number} key @param {string} name @param {number} v */
  const add = (obj, key, name, v) => {
    const r = rangeFor(v, String(key) === '0' || String(key) === '1' || String(key) === '2' ? name : String(key));
    const l = document.createElement('label'); l.className = 'slider';
    const s = document.createElement('span'); s.textContent = name;
    const out = document.createElement('output'); out.textContent = String(v);
    const inp = document.createElement('input'); inp.type = 'range'; inp.min = String(r.min); inp.max = String(r.max); inp.step = String(r.step); inp.value = String(v);
    inp.oninput = () => { obj[key] = Number(inp.value); out.textContent = inp.value; writeJson(); };
    inp.onchange = play;
    l.append(s, out, inp);
    box.append(l);
  };
  walk(FX[pick], '');
  writeJson();
}
const writeJson = () => { /** @type {HTMLTextAreaElement} */ ($('json')).value = `"${pick}": ${JSON.stringify(FX[pick], null, 1).replace(/\n\s*/g, ' ')}`; };
showTune();

// ---- the scene: the walker and the thing as blocks, and a few pillars to catch the light ----
/** @type {number[]} */ const still = [];
for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2 + 0.5, r = 6.5 + (i % 2) * 1.2; pushCylinder(still, [Math.sin(a) * r, ground(Math.sin(a) * r, Math.cos(a) * r) - 0.1, Math.cos(a) * r], 0.5 + (i % 3) * 0.15, 2.6, [0.42, 0.4, 0.37]); }

const bones = new Float32Array(16), eyes = new Float32Array(20);
let last = performance.now();
function frame() {
  const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
  last = now; age += dt;
  for (const p of plan) if (p.at >= 0 && age >= p.at) { p.go(); p.at = -1; }
  if (crack) {
    const G = M('groundline');
    if (crack.m < crack.to) {
      crack.m = Math.min(crack.to, crack.m + (crack.to / G.activeS) * dt);
      fx.set('crack', { x: you.x, z: you.z + crack.m });
      if (crack.m >= crack.to) { fx.stop('crack'); fx.cue('groundline.end', { x0: you.x, z0: you.z, x1: you.x, z1: you.z + crack.to }); }
    } else if ((crack.after -= dt) <= 0) crack = null;
  }
  fx.update(dt);
  if (loop.checked && age > lengthOf(pick)) play();

  const t = target();
  /** @type {number[]} */ const tris = still.slice();
  pushBox(tris, [you.x, ground(you.x, you.z) + 0.8, you.z], [0.2, 0.8, 0.14], 0, [0.66, 0.62, 0.55]);
  const bob = pick === 'taproot' && fx.has('root') ? 0.03 * Math.sin(age * 9) : 0;
  pushBox(tris, [t.x, ground(t.x, t.z) + 0.32 + bob, t.z], [t.size * 0.9, 0.32, t.size], 0.3, [0.22, 0.21, 0.2]);
  if (crack) {
    const k = crack.m < crack.to ? 1 : crack.after;
    pushLane(tris, you.x, you.z, you.x, you.z + crack.m, 0.3, ground, [-2.4 * k, -1 * k, -0.3 * k]);
    pushLane(tris, you.x, you.z, you.x, you.z + crack.m, 0.08, ground, [-0.12, -0.15, -0.14], 16, 0.045);
  }
  const g = FX.markGain ?? 1, neg = (/** @type {number[]} */ c) => [-c[0] * g, -c[1] * g, -c[2] * g];
  for (const k of fx.marks()) {
    if (k.shape === 'ring') pushRing(tris, k.x, k.z, /** @type {number} */ (k.r), ground, neg(k.col), k.w ?? 0.05);
    else if (k.shape === 'disc') pushDisc(tris, k.x, k.z, /** @type {number} */ (k.r), ground, neg(k.col));
    else if (k.shape === 'arc') pushArc(tris, k.x, k.z, /** @type {number} */ (k.r0), /** @type {number} */ (k.r1), /** @type {number} */ (k.yaw), /** @type {number} */ (k.deg), ground, neg(k.col));
    else if (k.shape === 'lane') pushLane(tris, k.x, k.z, /** @type {number} */ (k.x1), /** @type {number} */ (k.z1), k.w ?? 0.5, ground, neg(k.col));
  }
  stage.setProps(new Float32Array(tris));

  const out = fx.gpu();
  stage.setFxLights(out.lights, out.nLights);
  const lamp = Number(lampS.value);
  $('lampOut').textContent = lampS.value; $('distOut').textContent = distS.value;
  const c = fx.counts;
  $('counts').textContent = `Lights ${out.nLights} of 8, sparks ${c.sparks}, threads ${out.nThreads}, moths ${out.nMoths}, floor marks ${c.marks}`;
  stage.draw({ bones, eyes, place: [0, -10, 0, 0], weights: false, night: false, water: -9, follow: [0, 0, 2], dt, hideFigure: true,
    lamp: { at: lampAt(), reachM: snuffed ? 1.2 : 6, ambient: 0.03, strength: lamp * (snuffed ? 0.4 : 1) },
    extra: (p, u) => pass.draw(p, u, out) });
  requestAnimationFrame(frame);
}
play();
requestAnimationFrame(frame);
