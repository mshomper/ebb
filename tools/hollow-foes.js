// @ts-check
// Hollow foes (H2): Matt's Hollow things close up on a turntable, at their size in the game, so their
// look and how they move can be judged. The soot mote runs the same swarm code as the arena
// (src/world/hollow/mote-swarm.js) on a stand-in cluster that loops through what it does: drifting,
// bunching up for its tell, darting in to nip, a light hitting it, scattering. The silt crawler runs
// its rig and motion (tools/hollow-foes-crawler.js): resting, shuffling, the rear-up, the lunge, stuck,
// a glance off its plate, a back hit, breaking. The page clock drives the loops; nothing here is seeded
// game state. ?foe=crawler opens on the crawler.

import { createStage } from './walker-figure-stage.js';
import { loadMoteModel, moteScale } from '../src/world/hollow/mote-model.js';
import { createSwarm } from '../src/world/hollow/mote-swarm.js';
import { createMotePass } from './arena/mote-pass.js';
import { createCrawlerStand } from './hollow-foes-crawler.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const view = /** @type {HTMLCanvasElement} */ ($('view'));
const made = await createStage(view);
if (!made.ok) { $('note').textContent = `This page needs WebGPU (${made.reason}).`; throw new Error(made.reason); }
const stage = made.stage;
const HR = await (await fetch(new URL('../recipes/world/hollow.json', import.meta.url))).json();
const K = HR.foes.motes, M = K.mote, L = HR.lantern, CK = HR.foes.lunger, CR = CK.crawler;
const model = await loadMoteModel(new URL('../assets/models/hollow/mote.glb', import.meta.url));
const pass = await createMotePass(stage.gpu, model, M);
const crawler = await createCrawlerStand(stage.gpu, CK);
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
const VIEWS = { mote: { whole: { dist: 0.8, pitch: 0.18, yaw: 0.35 }, close: { dist: 0.42, pitch: 0.12, yaw: 0 } },
  crawler: { whole: { dist: 1.9, pitch: 0.42, yaw: 0.7 }, close: { dist: 1.05, pitch: 0.25, yaw: 0.25 } } };
let kind = new URLSearchParams(location.search).get('foe') === 'crawler' ? 'crawler' : 'mote';
let act = 'drift', actT = 0, spin = true, spinA = 0;
const cam = { ...VIEWS[/** @type {'mote' | 'crawler'} */ (kind)].whole };
let light = 'day';
/** Where the view aims (eased onto the thing). */
let aim = [0, M.heightM, 0], eye = [0, 1, 2];

/** Each button row's pressed one. @param {string} box @param {HTMLElement} on */
const press = (box, on) => { for (const o of $(box).querySelectorAll('button')) o.setAttribute('aria-pressed', String(o === on)); };
for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ ($('act').querySelectorAll('button'))) b.addEventListener('click', () => {
  act = /** @type {string} */ (b.dataset.act); actT = 0; press('act', b);
});
for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ ($('crawler-act').querySelectorAll('button'))) b.addEventListener('click', () => {
  crawler.set(/** @type {string} */ (b.dataset.act)); press('crawler-act', b);
});
for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ ($('light').querySelectorAll('button'))) b.addEventListener('click', () => {
  light = /** @type {string} */ (b.dataset.light); press('light', b);
});
for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ ($('foe').querySelectorAll('button'))) b.addEventListener('click', () => {
  setKind(/** @type {string} */ (b.dataset.foe));
});
$('spin').addEventListener('click', () => { spin = !spin; $('spin').setAttribute('aria-pressed', String(spin)); });
$('close').addEventListener('click', () => Object.assign(cam, VIEWS[/** @type {'mote' | 'crawler'} */ (kind)].close));
$('whole').addEventListener('click', () => Object.assign(cam, VIEWS[/** @type {'mote' | 'crawler'} */ (kind)].whole));

// Drag turns the view round the thing; the wheel comes closer.
let drag = /** @type {{ x: number, y: number } | null} */ (null);
view.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
window.addEventListener('pointerup', () => { drag = null; });
view.addEventListener('pointermove', (e) => {
  if (!drag) return;
  cam.yaw -= (e.clientX - drag.x) * 0.008;
  cam.pitch = Math.min(1.4, Math.max(-0.6, cam.pitch + (e.clientY - drag.y) * 0.006));
  drag = { x: e.clientX, y: e.clientY };
});
view.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = Math.min(4, Math.max(0.25, cam.dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });

/** [label, object, key, min, max, step, unit] */
const SLIDERS = /** @type {Record<string, [string, any, string, number, number, number, string][]>} */ ({
  mote: [
    ['Size across', M, 'sizeM', 0.08, 0.4, 0.01, 'm'],
    ['Soot fuzz', M, 'fuzz', 0, 2, 0.05, ''],
    ['Eye glow', M.eyes, 'glowNits', 0, 8, 0.1, 'cd/m2'],
    ['Eyes widen', M.eyes, 'widen', 0, 1, 0.05, ''],
    ['Squint', M.eyes, 'squint', 0, 1, 0.05, ''],
    ['Bob', M.drift, 'bobM', 0, 0.15, 0.005, 'm'],
    ['Breathing', M.drift, 'breath', 0, 0.12, 0.005, ''],
    ['Tell squash', M.tell, 'squash', 0, 0.6, 0.02, ''],
    ['Dart stretch', M.dart, 'stretch', 0, 1.2, 0.05, ''],
  ],
  crawler: [
    ['Silt grain', CR.look, 'grainShare', 0, 1, 0.05, ''],
    ['Grain size', CR.look, 'grainM', 0.003, 0.05, 0.001, 'm'],
    ['Wet sheen', CR.look, 'wetSheen', 0, 1.5, 0.05, ''],
    ['Shell shades', CR.look, 'shadeJitter', 0, 0.8, 0.05, ''],
    ['Silt in the seams', CR.look, 'seamShare', 0, 1.5, 0.05, ''],
    ['Rear-up', CR.motion.tell, 'rearDeg', 10, 70, 1, 'deg'],
    ['Forelegs lift', CR.motion.tell, 'foreLiftDeg', 0, 90, 1, 'deg'],
    ['Dig in when stuck', CR.motion.stuck, 'digDeg', 0, 40, 1, 'deg'],
    ['Breathing', CR.motion.breath, 'share', 0, 0.1, 0.005, ''],
    ['Step length', CR.motion.gait, 'strideM', 0.03, 0.2, 0.005, 'm'],
    ['Step lift', CR.motion.gait, 'liftM', 0, 0.08, 0.002, 'm'],
    ['Tail sway', CR.motion.tail, 'swayDeg', 0, 20, 0.5, 'deg'],
    ['Stalk look', CR.motion.stalks, 'lookDeg', 0, 80, 1, 'deg'],
  ],
});
function buildSliders() {
  $('sliders').innerHTML = '';
  for (const [label, obj, key, min, max, step, unit] of SLIDERS[kind]) {
    const row = document.createElement('div');
    row.className = 'slider';
    row.innerHTML = `<label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}" value="${obj[key]}"><output></output>`;
    const input = /** @type {HTMLInputElement} */ (row.querySelector('input')), out = /** @type {HTMLOutputElement} */ (row.querySelector('output'));
    const show = () => { out.textContent = `${obj[key]} ${unit}`.trim(); };
    input.addEventListener('input', () => { obj[key] = Number(input.value); show(); });
    show();
    $('sliders').append(row);
  }
}
const eyeMm = (model.eyes[0].radiusM * 2 * moteScale(model, M.sizeM) * 1000).toFixed(0), cm = crawler.model;
const FACTS = {
  mote: `<dt>Triangles</dt><dd>${model.triangles.toLocaleString()} (Matt's own decimation, as it is)</dd>`
    + `<dt>Across</dt><dd>${(M.sizeM * 100).toFixed(0)} cm</dd><dt>Eyes</dt><dd>about ${eyeMm} mm each, drawn by the shader on Matt's eye discs</dd>`,
  crawler: `<dt>Triangles</dt><dd>${cm.triangles.toLocaleString()} (Matt's meshes as they are: body ${cm.parts.body.toLocaleString()}, legs ${(cm.parts.forelegs + cm.parts.hindlegs).toLocaleString()}, tail ${cm.parts.tail})</dd>`
    + `<dt>Size</dt><dd>${(cm.widthM * 100).toFixed(0)} cm across the legs, ${(cm.lengthM * 100).toFixed(0)} cm long with the tail, at the mote's scale</dd>`
    + `<dt>Rig</dt><dd>16 bones: root, body, 2 eye stalks, a hip and a knee each leg, 4 tail bones</dd>`
    + `<dt>Surfaces</dt><dd>No textures (no UVs in the OBJs): silt, shells and the pale underside drawn by the shader</dd>`,
};
const NOTES = {
  drift: 'Drifting: a slow bob and turn, breathing.', tell: 'The tell: it bunches up, squashes and quivers, and squints.', nip: 'It winds up, darts at you (stretching along the way it goes), nips (a squash) and scatters back.', widen: 'The light is raised: its eyes open wide, then settle.', scatter: 'Scattering from the raised light, its trail of soot behind it.',
  rest: 'Resting: breathing, a stalk twitch now and then, its tail curling to a side.', shuffle: 'Shuffling: its feet stay planted and step in diagonal pairs, the plate bobbing.', rear: 'The tell (0.6 s): it rears up, forelegs lifted, its pale underside showing.',
  lunge: 'The tell, then the lunge: plate first, the forelegs reaching, the hind legs driving; stuck after, then it backs off.', stuck: 'Stuck for 1 s after the lunge: the plate dug into the silt, the back up and soft.',
  glance: 'A front hit glances off the plate: sparks, and the front rocks back a little.', back: 'A hit on its back lands: it flinches away, flashing pale.', break: 'Breaking: it slumps into grey sand, and motes of light rise.',
};
function setKind(/** @type {string} */ k) {
  kind = k;
  press('foe', /** @type {HTMLElement} */ ($('foe').querySelector(`[data-foe=${k}]`)));
  $('act').hidden = k !== 'mote'; $('crawler-act').hidden = k !== 'crawler';
  Object.assign(cam, VIEWS[/** @type {'mote' | 'crawler'} */ (k)].whole);
  $('facts').innerHTML = FACTS[/** @type {'mote' | 'crawler'} */ (k)];
  $('title').textContent = k === 'mote' ? 'Hollow foes: the soot mote' : 'Hollow foes: the silt crawler';
  buildSliders();
}
setKind(kind);

let last = performance.now(), clock = 0, paused = false;
const bones = new Float32Array(16), eyes = new Float32Array(20);
bones.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function frame(/** @type {number} */ now) {
  tick(paused ? 1e-6 : Math.min(0.05, (now - last) / 1000));
  last = now;
  requestAnimationFrame(frame);
}
/** The mote's loop, one step. @param {number} dt */
function moteTick(dt) {
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
  const m0 = swarm.motes[0];
  return [m0.x, m0.y, m0.z];
}
/** One step of dt seconds, drawn unless draw is false. @param {number} dt */
function tick(dt, draw = true) {
  clock += dt;
  let to;
  if (kind === 'mote') to = moteTick(dt);
  else {
    // The crawler stays put on the turntable; the view goes round it.
    if (spin && dt > 1e-5) cam.yaw += dt * 0.25;
    crawler.tick(dt, clock, eye);
    to = crawler.aim();
  }
  // The view follows the thing, eased, so a dart or a lunge still reads as one.
  const kf = 1 - Math.exp(-dt * 3);
  aim = aim.map((v, k) => v + (to[k] - v) * kf);
  const target = aim;
  eye = [target[0] + cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw), target[1] + cam.dist * Math.sin(cam.pitch), target[2] + cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw)];
  if (!draw) return;
  const drawn = kind === 'mote' ? pass : crawler.pass;
  stage.draw({ bones, eyes, place: [0, -10, 0, 0], weights: false, night: false, water: -9, follow: target, dt, camera: { eye, target }, hideFigure: true,
    extra: (p, u) => drawn.draw(p, u),
    ...(light === 'dark' ? { lamp: { at: [target[0] + Math.sin(cam.yaw + 0.5) * 1.6, target[1] + 0.6, target[2] + Math.cos(cam.yaw + 0.5) * 1.6], reachM: L.reachM, ambient: L.ambient, strength: L.strength } } : {}) });
  $('note').textContent = NOTES[/** @type {keyof typeof NOTES} */ (kind === 'mote' ? act : crawler.act)] ?? '';
}
requestAnimationFrame(frame);
/** For checking from the console. */
/** @type {any} */ (window).foes = { get swarm() { return swarm; }, foe, M, pass, crawler, cam,
  set(/** @type {string} */ a) { if (kind === 'mote') { act = a; actT = 0; } else crawler.set(a); },
  kind(/** @type {string} */ k) { setKind(k); }, light(/** @type {string} */ l) { light = l; },
  /** Hold time still (the view still draws), for stills. @param {boolean} on */
  pause(on) { paused = on; },
  /** Aim the view on the thing at once (a held still mid-lunge). */
  snap() { aim = kind === 'mote' ? [swarm.motes[0].x, swarm.motes[0].y, swarm.motes[0].z] : crawler.aim(); tick(1e-6); },
  /** Run on s seconds at once, then hold. @param {number} s */
  run(s) { paused = true; for (let n = Math.round(s * 60); n > 0; n--) tick(1 / 60, false); tick(1e-6); },
  /** Run until the loop reaches a step at least t seconds in, then hold (for stills). @param {string} step @param {number} t */
  holdAt(step, t) { paused = true; const f = kind === 'mote' ? foe : crawler.foe; for (let n = 0; n < 6000 && !(f.step === step && f.t >= t); n++) tick(1 / 60, false); tick(1e-6); } };
