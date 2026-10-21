// @ts-check
// The walker figure page (doc 23, W5): the figure on a turntable and on test ground, moving through
// every part of its animation set. A stand-in walker paces between two marks with the game's own
// numbers (recipes/world/walker.json pace: easing up, slowing into the stop, turning fast), so the
// gait, the closing step and the turn on the spot look as they will on the island. Nothing here is
// saved.

import { createStage } from './walker-figure-stage.js';
import { loadFigureModel, eyeUniforms } from '../src/world/figure/index.js';
import { buildFigure } from '../src/world/figure/rig.js';
import { createFigureMotion } from '../src/world/figure/motion.js';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
const note = /** @type {HTMLElement} */ (document.getElementById('note'));
const stats = /** @type {HTMLElement} */ (document.getElementById('stats'));
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

const made = await createStage(canvas);
if (!made.ok) {
  note.textContent = `This page needs WebGPU (${made.reason}).`;
  throw new Error(made.reason);
}
const stage = made.stage;
const R = await (await fetch('../recipes/world/figure.json')).json();
const W = await (await fetch('../recipes/world/walker.json')).json();
const glb = await loadFigureModel(R);
const built = buildFigure(glb, R);
stage.setMesh(built);
const motion = createFigureMotion(R, built.skeleton);
const headBone = built.skeleton.findIndex((b) => b.name === 'head');
const eyeBuf = new Float32Array(20);

// The test grounds.
/** @type {Record<string, (x: number, z: number) => number>} */
const GROUNDS = {
  flat: () => 0,
  slope: (x) => Math.tan(15 * Math.PI / 180) * x,
  shelf: (x) => 0.3 * Math.min(1, Math.max(0, (x - 0.55) / 0.06)),
};
let groundName = 'flat';
let ground = GROUNDS.flat;
stage.setGround(ground);
let water = 0;

// The stand-in walker: walks between x = -1.8 and 1.8 at the chosen pace, eases up and slows into
// each stop as the game's walker does, waits, and turns round.
const P = W.pace;
const w = { x: -1.8, z: 0, yaw: Math.PI / 2, speed: 0, goal: 1.8, wait: 1.2 };
let pace = 0.9, posture = /** @type {'stand' | 'sit' | 'kneel'} */ ('stand'), below = true, look = false;
let slow = false, night = false, weights = false;
let lastT = performance.now(), cpu = 0, frames = 0;
/** @type {any} */ (window).figurePage = { walker: w, motion };

function stepWalker(/** @type {number} */ dt) {
  const moving = pace > 0 && posture === 'stand' && w.wait <= 0;
  let want = 0;
  if (moving) {
    const left = Math.abs(w.goal - w.x);
    const depth = Math.max(0, water - ground(w.x, w.z));
    const base = depth > (W.grid.wadeAnkleM ?? 0.12) && W.pace.wadeMps ? Math.min(pace, W.pace.wadeMps) : pace;
    want = Math.min(base, Math.sqrt(2 * P.accelMps2 * left) + 0.05);
    const face = Math.sign(w.goal - w.x) > 0 ? Math.PI / 2 : -Math.PI / 2;
    let turn = Math.atan2(Math.sin(face - w.yaw), Math.cos(face - w.yaw));
    const most = (P.turnDegPerS * Math.PI / 180) * dt;
    w.yaw += Math.max(-most, Math.min(most, turn));
  }
  const dv = want - w.speed;
  w.speed += Math.sign(dv) * Math.min(Math.abs(dv), (dv > 0 ? P.accelMps2 : P.accelMps2 * 3) * dt);
  const dir = Math.sign(w.goal - w.x);
  w.x += dir * w.speed * dt;
  if (moving && Math.abs(w.goal - w.x) < 0.02) { w.x = w.goal; w.speed = 0; w.goal = -w.goal; w.wait = 1.6; }
  if (!moving || w.wait > 0) w.wait -= dt;
  return moving && w.speed > 0;
}

function frame() {
  const now = performance.now();
  const realDt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  const dt = slow ? realDt * 0.25 : realDt;
  const moving = stepWalker(dt);
  const t0 = performance.now();
  const r = motion.update(dt, {
    x: w.x, z: w.z, y: ground(w.x, w.z), yaw: w.yaw, speed: w.speed, moving,
    ground, depth: (x, z) => Math.max(0, water - ground(x, z)),
    look: look ? { yaw: w.yaw + Math.sin(now / 1500) * 1.4 } : null,
    posture, below, sleepy: night,
  });
  cpu += performance.now() - t0; frames++;
  stage.draw({
    bones: motion.bones, eyes: eyeUniforms(R.eyes, headBone, r.eyes, eyeBuf),
    place: [w.x, ground(w.x, w.z), w.z, r.yaw], weights, night, water: water > 0 ? water : -9,
    follow: [w.x, ground(w.x, w.z), w.z], dt: realDt,
  });
  if (frames % 15 === 0) {
    const i = motion.info;
    stats.innerHTML = [
      ['Model', `${built.count.toLocaleString()} vertices, ${(built.indices.length / 3).toLocaleString()} triangles, ${((built.data.byteLength + built.indices.byteLength) / 1048576).toFixed(2)} MB`],
      ['Pose cost', `${(cpu / frames).toFixed(3)} ms a frame`],
      ['Speed', `${w.speed.toFixed(2)} m/s`],
      ['Feet', i.mode === 'gait' ? 'walking (stride by distance)' : 'pinned (step to turn or settle)'],
      ['Step', `${(i.pace?.stepM ?? 0).toFixed(2)} m`],
      ['Wading', `${Math.round((i.wade ?? 0) * 100)} %`],
      ['Posture', i.sitW > 0.5 ? 'sitting' : i.kneelW > 0.5 ? 'kneeling' : 'standing'],
      ['Eyes', i.expression],
    ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    if (frames > 600) { cpu = 0; frames = 0; }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Controls.
/** @param {Element} el @param {boolean} on */
const press = (el, on) => el.setAttribute('aria-pressed', on ? 'true' : 'false');
document.querySelectorAll('[data-pace]').forEach((b) => b.addEventListener('click', () => {
  pace = Number(/** @type {HTMLElement} */ (b).dataset.pace);
  document.querySelectorAll('[data-pace]').forEach((o) => press(o, o === b));
  if (pace > 0) { posture = 'stand'; press($('sit'), false); press($('kneel'), false); }
  note.textContent = pace === 0 ? 'Standing: breathing, a weight shift now and then, a glance at the ground.' : '';
}));
$('turn').addEventListener('click', () => {
  pace = 0;
  document.querySelectorAll('[data-pace]').forEach((o) => press(o, o.getAttribute('data-pace') === '0'));
  w.yaw += Math.PI * 0.75;
  note.textContent = 'A turn on the spot: small steps, one foot then the other.';
});
$('slow').addEventListener('click', (e) => { slow = !slow; press(/** @type {Element} */ (e.currentTarget), slow); });
document.querySelectorAll('[data-ground]').forEach((b) => b.addEventListener('click', () => {
  groundName = /** @type {HTMLElement} */ (b).dataset.ground ?? 'flat';
  ground = GROUNDS[groundName];
  stage.setGround(ground);
  document.querySelectorAll('[data-ground]').forEach((o) => press(o, o === b));
  note.textContent = groundName === 'shelf' ? 'A 30 cm shelf: the walker steps up it and down again.' : groundName === 'slope' ? 'A 15 degree slope: the pelvis drops for the lower foot, the feet tilt to the ground.' : '';
}));
$('water').addEventListener('input', (e) => {
  water = Number(/** @type {HTMLInputElement} */ (e.target).value);
  $('water-out').textContent = water > 0 ? `${water.toFixed(2)} m` : 'none';
});
/** @param {'sit' | 'kneel'} p */
function setPosture(p) {
  posture = posture === p ? 'stand' : p;
  press($('sit'), posture === 'sit'); press($('kneel'), posture === 'kneel');
  note.textContent = posture === 'stand' ? '' : `The walker ${posture === 'sit' ? 'sits' : 'kneels'} once it has stopped.`;
}
$('sit').addEventListener('click', () => setPosture('sit'));
$('kneel').addEventListener('click', () => setPosture('kneel'));
$('feed').addEventListener('click', () => { motion.feed(); note.textContent = 'Feed: kneel, reach low with an open hand, hold, and back.'; });
$('down').addEventListener('click', () => { below = true; press($('wait'), false); motion.arrive(); note.textContent = 'Go down: a look about, then a tug of the brim.'; });
$('up').addEventListener('click', () => { motion.leave(); note.textContent = 'Go up: the walker looks up after you.'; });
$('wait').addEventListener('click', (e) => {
  below = !below;
  press(/** @type {Element} */ (e.currentTarget), !below);
  if (!below) { motion.leave(); note.textContent = `You are above: after ${R.poses.leave.sitAfterS} seconds still, the walker sits down to wait.`; }
});
document.querySelectorAll('[data-face]').forEach((b) => b.addEventListener('click', () => {
  const e = /** @type {any} */ (/** @type {HTMLElement} */ (b).dataset.face);
  motion.express(e, e === 'sleepy' ? 4 : undefined);
}));
$('night').addEventListener('click', (e) => { night = !night; press(/** @type {Element} */ (e.currentTarget), night); note.textContent = night ? 'After dark the eyes glow faintly.' : ''; });
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => stage.view(/** @type {any} */ (/** @type {HTMLElement} */ (b).dataset.view))));
$('spin').addEventListener('click', (e) => { const on = e.currentTarget instanceof Element && e.currentTarget.getAttribute('aria-pressed') !== 'true'; press(/** @type {Element} */ (e.currentTarget), on); stage.spin(on); });
$('weights').addEventListener('click', (e) => { weights = !weights; press(/** @type {Element} */ (e.currentTarget), weights); note.textContent = weights ? 'Each colour is a bone; blends show where the skin follows two.' : ''; });
$('look').addEventListener('click', (e) => { look = !look; press(/** @type {Element} */ (e.currentTarget), look); note.textContent = look ? 'The head follows where you look, less while walking.' : ''; });
