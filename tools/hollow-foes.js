// @ts-check
// Hollow foes (H2): Matt's soot mote close up on a turntable, at its size in the game, so its look,
// its eyes and its shader motion can be judged. One mote runs the same swarm code as the arena
// (src/world/hollow/mote-swarm.js) on a stand-in cluster that loops through what it does: drifting,
// bunching up for its tell, darting in to nip, a light hitting it, scattering. The page clock drives
// the loop; nothing here is seeded game state.

import { createStage } from './walker-figure-stage.js';
import { loadMoteModel, moteScale } from '../src/world/hollow/mote-model.js';
import { createSwarm } from '../src/world/hollow/mote-swarm.js';
import { createMotePass } from './arena/mote-pass.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const view = /** @type {HTMLCanvasElement} */ ($('view'));
const made = await createStage(view);
if (!made.ok) { $('note').textContent = `This page needs WebGPU (${made.reason}).`; throw new Error(made.reason); }
const stage = made.stage;
const HR = await (await fetch(new URL('../recipes/world/hollow.json', import.meta.url))).json();
const K = HR.foes.motes, M = K.mote, L = HR.lantern;
const model = await loadMoteModel(new URL('../assets/models/hollow/mote.glb', import.meta.url));
const pass = await createMotePass(stage.gpu, model, M);
stage.setGround(() => 0, 4, 40);

/** A stand-in cluster of one mote, at the middle. */
const foe = { x: 0, z: 0, yaw: 0, step: 'rest', t: 0, stunS: 0, hurtS: 0, broken: false, members: [[0.4, 1, 0]] };
const swarm = createSwarm(foe, M, 1, model.acrossM);
const lamp = { x: 0.6, z: 1.2, reachM: L.reachM, raised: false };

/** What it is doing: each a loop of [step, seconds, where the cluster goes (x), lamp raised]. */
const ACTS = /** @type {Record<string, [string, number, number, boolean][]>} */ ({
  drift: [['rest', 4, 0, false]],
  tell: [['rest', 1.2, 0, false], ['wind', 1.4, 0, false]],
  nip: [['rest', 1, 0, false], ['wind', K.windS, 0, false], ['strike', K.strikeS, 1.2, false], ['recover', 1.6, 0, false]],
  widen: [['rest', 1.4, 0, false], ['rest', 1.6, 0, true]],
  scatter: [['rest', 1.2, 0, false], ['recover', 1.6, -0.5, true]],
});
let act = 'drift', actT = 0, spin = true, spinA = 0;
const cam = { yaw: 0.35, pitch: 0.18, dist: 0.8 };
let light = 'day';
/** Where the view aims (eased onto the mote). */
let aim = [0, M.heightM, 0];

for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ ($('act').querySelectorAll('button'))) b.addEventListener('click', () => {
  act = /** @type {string} */ (b.dataset.act); actT = 0;
  for (const o of $('act').querySelectorAll('button')) o.setAttribute('aria-pressed', String(o === b));
});
for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ ($('light').querySelectorAll('button'))) b.addEventListener('click', () => {
  light = /** @type {string} */ (b.dataset.light);
  for (const o of $('light').querySelectorAll('button')) o.setAttribute('aria-pressed', String(o === b));
});
$('spin').addEventListener('click', () => { spin = !spin; $('spin').setAttribute('aria-pressed', String(spin)); });
$('close').addEventListener('click', () => Object.assign(cam, { dist: 0.42, pitch: 0.12, yaw: 0 }));
$('whole').addEventListener('click', () => Object.assign(cam, { dist: 0.8, pitch: 0.18, yaw: 0.35 }));

// Drag turns the view round the mote; the wheel comes closer.
let drag = /** @type {{ x: number, y: number } | null} */ (null);
view.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
window.addEventListener('pointerup', () => { drag = null; });
view.addEventListener('pointermove', (e) => {
  if (!drag) return;
  cam.yaw -= (e.clientX - drag.x) * 0.008;
  cam.pitch = Math.min(1.4, Math.max(-0.6, cam.pitch + (e.clientY - drag.y) * 0.006));
  drag = { x: e.clientX, y: e.clientY };
});
view.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = Math.min(3, Math.max(0.25, cam.dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });

/** [label, object, key, min, max, step, unit] */
const SLIDERS = /** @type {[string, any, string, number, number, number, string][]} */ ([
  ['Size across', M, 'sizeM', 0.08, 0.4, 0.01, 'm'],
  ['Soot fuzz', M, 'fuzz', 0, 2, 0.05, ''],
  ['Eye glow', M.eyes, 'glowNits', 0, 8, 0.1, 'cd/m2'],
  ['Eyes widen', M.eyes, 'widen', 0, 1, 0.05, ''],
  ['Squint', M.eyes, 'squint', 0, 1, 0.05, ''],
  ['Bob', M.drift, 'bobM', 0, 0.15, 0.005, 'm'],
  ['Breathing', M.drift, 'breath', 0, 0.12, 0.005, ''],
  ['Tell squash', M.tell, 'squash', 0, 0.6, 0.02, ''],
  ['Dart stretch', M.dart, 'stretch', 0, 1.2, 0.05, ''],
]);
for (const [label, obj, key, min, max, step, unit] of SLIDERS) {
  const row = document.createElement('div');
  row.className = 'slider';
  row.innerHTML = `<label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}" value="${obj[key]}"><output></output>`;
  const input = /** @type {HTMLInputElement} */ (row.querySelector('input')), out = /** @type {HTMLOutputElement} */ (row.querySelector('output'));
  const show = () => { out.textContent = `${obj[key]} ${unit}`.trim(); };
  input.addEventListener('input', () => { obj[key] = Number(input.value); show(); });
  show();
  $('sliders').append(row);
}
const eyeMm = (model.eyes[0].radiusM * 2 * moteScale(model, M.sizeM) * 1000).toFixed(0);
$('facts').innerHTML = `<dt>Triangles</dt><dd>${model.triangles.toLocaleString()} (Matt's own decimation, as it is)</dd>`
  + `<dt>Across</dt><dd>${(M.sizeM * 100).toFixed(0)} cm</dd><dt>Eyes</dt><dd>about ${eyeMm} mm each, drawn by the shader on Matt's eye discs</dd>`;

let last = performance.now(), clock = 0, paused = false;
const bones = new Float32Array(16), eyes = new Float32Array(20);
bones.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function frame(/** @type {number} */ now) {
  tick(paused ? 1e-6 : Math.min(0.05, (now - last) / 1000));
  last = now;
  requestAnimationFrame(frame);
}
/** One step of dt seconds, drawn unless draw is false. @param {number} dt */
function tick(dt, draw = true) {
  clock += dt;
  // The loop: which step, where the cluster is going, whether the light is up.
  const loop = ACTS[act], total = loop.reduce((n, s) => n + s[1], 0);
  actT = (actT + dt) % total;
  let at = actT, i = 0;
  while (at >= loop[i][1]) { at -= loop[i][1]; i++; }
  const [step, , goX, raised] = loop[i];
  if (foe.step !== step) { foe.step = step; foe.t = 0; }
  foe.t = at;
  foe.x += (goX - foe.x) * (1 - Math.exp(-dt * (step === 'strike' ? 25 : step === 'recover' && act === 'scatter' ? 14 : 3)));
  lamp.raised = raised;
  // You stand where the view is, so it winds up and darts toward you.
  const you = { x: Math.sin(cam.yaw) * 2, z: Math.cos(cam.yaw) * 2 };
  swarm.update(dt, clock, { ground: () => 0, lamp, you });
  if (spin) spinA += dt * 0.5;
  const inst = swarm.instances(clock);
  // On the turntable it turns slowly; it faces the view while it winds up and darts.
  if (spin && step !== 'wind' && step !== 'strike') inst[3] = spinA;
  pass.set([{ instances: () => inst, puffs: () => swarm.puffs() }], clock);
  // The view follows the mote, eased, so a dart still reads as a dart.
  const m0 = swarm.motes[0], kf = 1 - Math.exp(-dt * 3);
  aim = aim.map((v, k) => v + ([m0.x, m0.y, m0.z][k] - v) * kf);
  if (!draw) return;
  const target = aim;
  const eye = [target[0] + cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw), target[1] + cam.dist * Math.sin(cam.pitch), target[2] + cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw)];
  stage.draw({ bones, eyes, place: [0, -10, 0, 0], weights: false, night: false, water: -9, follow: target, dt, camera: { eye, target }, hideFigure: true,
    extra: (p, u) => pass.draw(p, u),
    ...(light === 'dark' ? { lamp: { at: [target[0] + Math.sin(cam.yaw + 0.5) * 1.6, target[1] + 0.6, target[2] + Math.cos(cam.yaw + 0.5) * 1.6], reachM: L.reachM, ambient: L.ambient, strength: L.strength } } : {}) });
  $('note').textContent = { drift: 'Drifting: a slow bob and turn, breathing.', tell: 'The tell: it bunches up, squashes and quivers, and squints.', nip: 'It winds up, darts at you (stretching along the way it goes), nips (a squash) and scatters back.', widen: 'The light is raised: its eyes open wide, then settle.', scatter: 'Scattering from the raised light, its trail of soot behind it.' }[act] ?? '';
}
requestAnimationFrame(frame);
/** For checking from the console. */
/** @type {any} */ (window).foes = { get swarm() { return swarm; }, foe, M, pass, set(/** @type {string} */ a) { act = a; actT = 0; }, light(/** @type {string} */ l) { light = l; },
  /** Hold time still (the view still draws), for stills. @param {boolean} on */
  pause(on) { paused = on; },
  /** Run until the loop reaches a step at least t seconds in, then hold (for stills). @param {string} step @param {number} t */
  /** Run on s seconds at once, then hold. @param {number} s */
  run(s) { paused = true; for (let n = Math.round(s * 60); n > 0; n--) tick(1 / 60, false); tick(1e-6); },
  holdAt(step, t) { paused = true; for (let n = 0; n < 6000 && !(foe.step === step && foe.t >= t); n++) tick(1 / 60, false); tick(1e-6); } };
