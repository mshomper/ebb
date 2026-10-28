// @ts-check
// The hen lab (docs/future/15, slice 1): every clip of her code motion on its own, and her life on a
// flat test ground with a walker you place by clicking, so the wary ring can be watched.

import { createStage } from './hen-lab-stage.js';
import { loadHenModel } from '../src/world/hen/index.js';
import { buildHen } from '../src/world/hen/rig.js';
import { createHenPoser, stillPose } from '../src/world/hen/motion.js';
import { createHenLife } from '../src/world/hen/life.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const R = await (await fetch(new URL('../recipes/species/hen.json', import.meta.url))).json();
const made = await createStage(/** @type {HTMLCanvasElement} */ ($('view')));
if (!made.ok) {
  $('note').textContent = `This page needs WebGPU: ${made.reason}`;
  throw new Error(made.reason);
}
const stage = made.stage;
const glb = await loadHenModel(R);
const built = buildHen(glb, R);
await stage.setHen(built, glb);
const poser = createHenPoser(built.skeleton, R.motion, built.idle);
const bones = new Float32Array(built.skeleton.length * 16);
const k = R.body.displayScale;
const GROUND = 14;
// `?clip=peck&hold=0.1` (for screenshots): start on a clip, held at that many seconds into it.
const query = new URLSearchParams(location.search);
const HOLD = query.has('hold') ? Number(query.get('hold')) : null;

/** @type {string} */ let mode = 'life';
let slow = false;
/** The walker: where it stands, and where it walks to (null: standing). @type {{ x: number, z: number, to: { x: number, z: number } | null } | null} */
let walker = null;
const life = createHenLife({ R, seed: 0x5eed, ground: () => 0, wet: (x, z) => Math.max(Math.abs(x), Math.abs(z)) > GROUND * 0.9 });
life.setHome({ x: 0, z: 0 }, R.home.testRangeM, true);

// A puppet for the clips one at a time: round a circle for the walk and run.
const puppet = { x: 0, z: 0, yaw: 0, a: 0, t: 0, phase: 0, lockM: 0, snapTo: 0, snapping: false };
/** The head lock as life.js keeps it, for the puppet. @param {number} signed @param {number} dt @param {boolean} running */
function puppetLock(signed, dt, running) {
  const HL = R.motion.headLock;
  if (puppet.snapping) {
    const d = puppet.snapTo - puppet.lockM;
    puppet.lockM += Math.sign(d) * Math.min(Math.abs(d), ((HL.lockM + HL.leadM) / HL.snapS) * dt);
    if (Math.abs(puppet.snapTo - puppet.lockM) < 1e-4) puppet.snapping = false;
  } else if (running || !signed) puppet.lockM *= Math.max(0, 1 - dt * 8);
  else {
    puppet.lockM -= signed / k;
    if (Math.abs(puppet.lockM) > HL.lockM) { puppet.snapping = true; puppet.snapTo = puppet.lockM < 0 ? HL.leadM : -HL.leadM; }
  }
}

/** The clip being shown, as a pose and a place. @param {number} dt */
function clipPose(dt) {
  puppet.t = HOLD ?? puppet.t + dt;
  const p = stillPose();
  p.t = puppet.t;
  const L = R.life, M = R.motion;
  if (mode === 'walk' || mode === 'run') {
    const run = mode === 'run';
    const v = run ? R.wary.runMps : L.walkMps, r = run ? 3 : 1.5;
    const step = v * dt;
    puppet.a += step / r;
    puppet.x = Math.sin(puppet.a) * r; puppet.z = Math.cos(puppet.a) * r;
    puppet.yaw = puppet.a + Math.PI / 2;
    puppet.phase += step / (run ? M.runStrideM : M.strideM);
    puppetLock(step, dt, run);
    Object.assign(p, { phase: puppet.phase, walk: 1, run: run ? 1 : 0, lockM: puppet.lockM });
    return p;
  }
  puppet.lockM *= Math.max(0, 1 - dt * 8);
  const cyc = (/** @type {number} */ s) => (puppet.t % s) / s;
  if (mode === 'peck') { const u = cyc(1.1) * 1.1 / L.peckS; p.peck = u > 1 ? 0 : u < 0.35 ? u / 0.35 : 1 - (u - 0.35) / 0.65; }
  if (mode === 'look') { const u = cyc(3); const on = u > 0.15 && u < 0.75 ? 1 : 0; p.look = { yaw: 0, tilt: (u < 0.5 ? 1 : 1) * M.lookTiltRad * on, down: M.lookDownRad * on }; }
  if (mode === 'alert') p.alert = Math.min(1, Math.max(0, Math.sin(cyc(4) * Math.PI) * 1.6));
  if (mode === 'scratch') {
    // Kick, kick, a step back, a look, two pecks, then again.
    const seq = [['kick', L.kickS, 'l'], ['kick', L.kickS, 'r'], ['back', L.backS], ['look', 0.6], ['peck', L.peckS], ['peck', L.peckS], ['rest', 0.8]];
    const total = seq.reduce((s, e) => s + /** @type {number} */ (e[1]), 0);
    let t = puppet.t % total;
    for (const [a, s, side] of seq) {
      const len = /** @type {number} */ (s);
      if (t < len) {
        const u = t / len;
        if (a === 'kick') p.kick = { side: /** @type {'l'|'r'} */ (side), u };
        if (a === 'back') { p.walk = 1; p.phase = -u * L.backM / M.strideM; }
        if (a === 'look' || a === 'peck') p.look = { yaw: 0, tilt: M.lookTiltRad, down: M.lookDownRad };
        if (a === 'peck') p.peck = u < 0.35 ? u / 0.35 : 1 - (u - 0.35) / 0.65;
        break;
      }
      t -= len;
    }
  }
  if (mode !== 'walk' && mode !== 'run') { puppet.x = 0; puppet.z = 0; puppet.yaw = 0; }
  return p;
}

/** The walker as presence would hand it to her. */
function sources() {
  if (!walker) return [];
  const speed = walker.to ? 0.9 : 0;
  return [/** @type {import('../src/world/creatures/presence.js').PresenceSource} */ ({ id: 'walker', kind: 'walker', pos: [walker.x, 0.9, walker.z], speed, editing: false, edits: [],
    stillS: speed ? 0 : 1, body: true, posture: 'stand', gaze: null, ringK: 1 })];
}

stage.onGroundClick((x, z) => {
  if (mode !== 'life') return;
  walker = { x, z, to: null };
  $('note').textContent = 'The walker stands where you clicked. Walk to her to see her freeze, then run.';
});

let last = performance.now();
function frame() {
  const now = performance.now();
  let dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (slow) dt *= 0.25;
  /** @type {{ x: number, z: number, yaw: number }} */ let at;
  if (mode === 'life') {
    if (walker?.to) {
      const h = life.hen, dx = h.x - walker.x, dz = h.z - walker.z, d = Math.hypot(dx, dz);
      if (d > 1) { walker.x += (dx / d) * 0.9 * dt; walker.z += (dz / d) * 0.9 * dt; }
    }
    life.step(dt, { night: false, sources: sources() });
    poser.pose(life.poseInput(), bones);
    at = life.hen;
    $('mode').textContent = life.hen.mode + (life.hen.act ? `: ${life.hen.act.a}` : '');
  } else {
    poser.pose(clipPose(dt), bones);
    at = puppet;
    $('mode').textContent = mode;
  }
  stage.draw(dt, { x: at.x, z: at.z, yaw: at.yaw, size: k, cut: R.body.alphaCut, bones, ringM: mode === 'life' ? R.wary.ringM : 0,
    walker: mode === 'life' ? walker : null, groundHalf: GROUND, follow: mode !== 'life' });
  requestAnimationFrame(frame);
}

for (const b of document.querySelectorAll('[data-mode]')) {
  b.addEventListener('click', () => {
    mode = /** @type {HTMLElement} */ (b).dataset.mode ?? 'life';
    puppet.t = 0; puppet.phase = 0;
    for (const o of document.querySelectorAll('[data-mode]')) o.setAttribute('aria-pressed', String(o === b));
    stage.setView(mode === 'life' ? 'wide' : mode === 'walk' || mode === 'run' ? 'three-quarter' : 'side');
    $('note').textContent = mode === 'life' ? 'Click the ground to put the walker down.' : '';
  });
}
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => stage.setView(/** @type {any} */ (/** @type {HTMLElement} */ (b).dataset.view)));
$('approach').addEventListener('click', () => {
  if (mode !== 'life') return;
  const h = life.hen;
  if (!walker) walker = { x: h.x + 12, z: h.z, to: null };
  walker.to = { x: h.x, z: h.z };
});
$('stop').addEventListener('click', () => { if (walker) walker.to = null; });
$('away').addEventListener('click', () => { walker = null; });
$('slow').addEventListener('click', () => { slow = !slow; $('slow').setAttribute('aria-pressed', String(slow)); });
$('stats').innerHTML = `<dt>Bones</dt><dd>${built.skeleton.length} (from 50 joints)</dd><dt>Triangles</dt><dd>${(built.indices.length / 3).toLocaleString()}</dd>`
  + `<dt>Drawn height</dt><dd>${(built.height * k).toFixed(2)} m (${k}x)</dd><dt>Wary ring</dt><dd>${R.wary.ringM} m</dd>`;
stage.setView('wide');
$('note').textContent = 'Click the ground to put the walker down.';
if (query.has('clip')) /** @type {HTMLElement | null} */ (document.querySelector(`[data-mode="${query.get('clip')}"]`))?.click();
if (query.has('view')) stage.setView(/** @type {any} */ (query.get('view')));
requestAnimationFrame(frame);
