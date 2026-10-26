// @ts-check
// The movement arena (doc 23; WASD, October 26, 2026): a compact test ground with one of each thing
// movement meets (tools/arena/course.js), the real walker and figure, and the game's own controls and
// camera: W A S D, mouse look (click the view), Shift, the Space roll, and a click on what the dot rests
// on walks there by the walk grid. Sliders tune every movement and roll number live; the trace shows
// your speed; Copy gives the numbers as recipe blocks for recipes/world/walker.json. Nothing is saved.
//
// Built to grow (doc 23, the arena and the Hollow): courses are data (COURSES), stand-ins that react
// are actor kinds (tools/arena/actors.js KINDS), each camera is an entry in CAMERAS (the Hollow's fixed
// high camera joins as 'high'), and each move is an entry in MOVES keyed by its key (Space rolls; the
// Hollow's Q and E moves join there with their own recipe numbers).

import { createStage } from './walker-figure-stage.js';
import { loadFigureModel, eyeUniforms } from '../src/world/figure/index.js';
import { buildFigure } from '../src/world/figure/rig.js';
import { createFigureMotion } from '../src/world/figure/motion.js';
import { createWalkGrid } from '../src/world/walk/grid.js';
import { createWalker } from '../src/world/walk/walker.js';
import { createSolids } from '../src/world/walk/solids.js';
import { createOrbitCamera } from '../src/render/camera.js';
import { attachMoveKeys, worldWay } from '../src/input/move-keys.js';
import { attachMouseLook, pointerLocked } from '../src/input/mouse-look.js';
import { COURSES } from './arena/course.js';
import { KINDS } from './arena/actors.js';
import { pushBox, pushCylinder, pushRing } from './arena/props.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {string} p */
const recipe = async (p) => (await fetch(new URL(`../recipes/${p}.json`, import.meta.url))).json();

const view = /** @type {HTMLCanvasElement} */ ($('view'));
const note = $('note');
const made = await createStage(view);
if (!made.ok) { note.textContent = `This page needs WebGPU (${made.reason}).`; throw new Error(made.reason); }
const stage = made.stage;
const [R, FR, CR, frogR] = await Promise.all([recipe('world/walker'), recipe('world/figure'), recipe('world/camera'), recipe('species/frog')]);
/** The walker recipe as loaded, to show what changed. */
const R0 = structuredClone(R);
const course = COURSES[/** @type {keyof typeof COURSES} */ (new URLSearchParams(location.search).get('course') ?? 'island')] ?? COURSES.island;
const half = course.sizeM / 2;

// ---- the world: ground, water, walk grid, solids ----
const ground = course.ground;
stage.setGround(ground, course.sizeM, 300);
const grid = createWalkGrid({ ground, minX: -half, minZ: -half, maxX: half, maxZ: half, cellM: R.grid.cellM, maxSlopeDeg: R.grid.maxSlopeDeg });
const depth = (/** @type {number} */ k) => Math.max(0, course.waterY - grid.height[k]);
const depthAt = (/** @type {number} */ x, /** @type {number} */ z) => Math.max(0, course.waterY - ground(x, z));
let solids = createSolids(R.solids.bodyM);
const setSolids = () => { solids = createSolids(R.solids.bodyM); solids.set(course.solids); solids.mark(grid); };
setSolids();

// ---- the actors (stand-ins that react to you) ----
const actors = course.actors.map((a) => KINDS[a.kind](a, { frog: frogR }));
const nearest = (/** @type {number} */ x, /** @type {number} */ z) => actors.reduce((m, a) => Math.min(m, Math.hypot(a.x - x, a.z - z)), Infinity);

// ---- the walker and its figure ----
const walker = createWalker(R, { get grid() { return grid; }, depth, ground, nearest, get solids() { return solids; } });
const built = buildFigure(await loadFigureModel(FR), FR);
stage.setMesh(built);
const motion = createFigureMotion(FR, built.skeleton);
const headBone = built.skeleton.findIndex((b) => b.name === 'head');
const eyeBuf = new Float32Array(20);
const DS = FR.body.displayScale;
const H = R.presence.heightM;

// ---- cameras ----
const camera = createOrbitCamera(CR);
camera.setGroundProbe((x, z) => Math.max(ground(x, z), course.waterY));
camera.setWorldRadius(half);
/** Where the view aims on you (as src/world/walk/index.js head()). */
const head = () => [walker.x, walker.y + R.camera.lookHeightM - (H.stand - (H[walker.posture] ?? H.stand)), walker.z];
/**
 * The cameras, by name. follow: the game's low view behind you, turned by the mouse. The Hollow's
 * fixed high camera joins as 'high' (doc 16): it would aim from a set yaw and pitch, follow you room
 * by room, and turn nothing with the mouse; W stays up the screen.
 */
const CAMERAS = {
  follow: {
    start() {
      camera.setGround(R.camera, head());
      // Behind you, looking the way you face (the eye sits at +sin, +cos of the camera's yaw).
      camera.twist(walker.yaw + Math.PI - camera.yaw);
    },
    update() { camera.follow(head()); },
    /** @param {number} dx @param {number} dy */
    look(dx, dy) { camera.look(dx, dy, R.steer.look.degPerPx, R.steer.look.halfLifeS); },
  },
};
const cam = CAMERAS.follow;

function reset() {
  walker.place(course.start.x, course.start.z, course.start.yaw);
  motion.place('stand');
  cam.start();
}

// ---- moves, by key: Space rolls; the Hollow's Q and E join here ----
/** @type {Record<string, (way: [number, number]) => boolean>} */
const MOVES = {
  roll: (way) => walker.roll(way[0], way[1]),
};
const keys = attachMoveKeys(window, {
  onPress(name) {
    if (name === 'move') { if (walker.pathing && !walker.retreating) walker.stop(); return true; }
    const a = keys.axes();
    MOVES.roll(worldWay(a.forward, a.right, camera.yaw));
    return true;
  },
});

/** The ground under a canvas point, marched along the camera's ray. @param {number} x @param {number} y */
function groundAt(x, y) {
  const r = camera.ray(x, y);
  for (let t = 0.2; t < 80; t += 0.05) {
    const p = [r.o[0] + r.d[0] * t, r.o[1] + r.d[1] * t, r.o[2] + r.d[2] * t];
    if (Math.abs(p[0]) > half || Math.abs(p[2]) > half) return null;
    if (p[1] <= Math.max(ground(p[0], p[2]), course.waterY)) return p;
  }
  return null;
}
const look = attachMouseLook(view, {
  wanted: () => true,
  look: (dx, dy) => cam.look(dx, dy),
  // A click on what the dot rests on: walk there by the walk grid (round solids, stopping at their edge).
  use: (x, y) => {
    const p = groundAt(x, y);
    if (!p) return;
    const r = walker.walkTo(p[0], p[2]);
    say(r.ok ? 'Walking there by the walk grid.' : "You can't get there on foot.");
  },
});
const say = (/** @type {string} */ s) => { note.textContent = s; };
document.addEventListener('pointerlockchange', () => {
  $('look-badge').hidden = !pointerLocked();
  $('free-badge').hidden = pointerLocked();
  say(pointerLocked() ? 'The mouse turns the view; a click walks to where the dot rests. Hold Alt or press Esc to free the pointer.' : 'Click the view to look round with the mouse.');
});

// ---- props: the solids, the stand-ins, the creep zone and the frog's ring ----
/** @type {number[]} */
const still = [];
for (const s of course.solids) {
  const y = ground(s.x, s.z);
  if (s.r !== undefined) pushCylinder(still, [s.x, y - 0.05, s.z], s.r, s.heightM + 0.05, s.color);
  else pushBox(still, [s.x, y + s.heightM / 2 - 0.05, s.z], [s.hw ?? 0, s.heightM / 2 + 0.05, s.hd ?? 0], s.yaw ?? 0, s.color);
}
function props() {
  const out = still.slice();
  const you = youNow();
  for (const a of actors) {
    for (const b of a.shapes(ground)) pushBox(out, [b[0], b[1], b[2]], [b[3], b[4], b[5]], b[6], [b[7], b[8], b[9]]);
    pushRing(out, a.x, a.z, R.pace.creepNearM, ground, [0.85, 0.8, 0.55]);
    pushRing(out, a.x, a.z, a.ring(you), ground, [0.75, 0.42, 0.3]);
  }
  return new Float32Array(out);
}
/** You, as the actors read you. @returns {import('./arena/actors.js').You} */
function youNow() {
  const e = camera.eye, t = camera.target, gx = t[0] - e[0], gz = t[2] - e[2], l = Math.hypot(gx, gz);
  return { x: walker.x, z: walker.z, speed: walker.speed, posture: walker.posture, gaze: l > 1e-6 ? [gx / l, gz / l] : null, rolling: walker.rolling >= 0 };
}

// ---- tuning: sliders, the feel, copy as recipe blocks ----
const feelOf = () => R.steer.profiles[walker.feel];
/** [label, object, key, min, max, step, unit] */
const SLIDERS = /** @type {[string, () => any, string, number, number, number, string][]} */ ([
  ['Walk', () => R.pace, 'strollMps', 1, 4, 0.1, 'm/s'],
  ['Run (Shift)', () => R.pace, 'briskMps', 2, 7, 0.1, 'm/s'],
  ['Creep near a creature', () => R.pace, 'creepMps', 0.2, 1.5, 0.05, 'm/s'],
  ['Creep within', () => R.pace, 'creepNearM', 0.5, 5, 0.1, 'm'],
  ['Wading', () => R.pace, 'wadeMps', 0.4, 2, 0.05, 'm/s'],
  ['Up to full speed', feelOf, 'accelS', 0.03, 0.8, 0.01, 's'],
  ['To a stop', feelOf, 'stopS', 0.03, 0.5, 0.01, 's'],
  ['Turning', feelOf, 'turnDegPerS', 180, 1440, 10, 'deg/s'],
  ['Pace kept in a sharp turn', feelOf, 'turnSlowFloor', 0, 1, 0.05, ''],
  ['Roll distance', () => R.steer.roll, 'distM', 1, 4, 0.1, 'm'],
  ['Roll time', () => R.steer.roll, 'durS', 0.2, 0.8, 0.02, 's'],
  ['Wait between rolls', () => R.steer.roll, 'waitS', 0, 1, 0.05, 's'],
  ['Carry out of a roll', () => R.steer.roll, 'carryS', 0, 0.8, 0.05, 's'],
  ['Mouse look', () => R.steer.look, 'degPerPx', 0.03, 0.4, 0.01, 'deg/px'],
  ['Mouse look easing', () => R.steer.look, 'halfLifeS', 0, 0.2, 0.005, 's'],
  ['Clearance from solids', () => R.solids, 'bodyM', 0.05, 0.5, 0.01, 'm'],
]);
function buildSliders() {
  const box = $('sliders');
  box.innerHTML = '';
  SLIDERS.forEach(([label, obj, key, min, max, step, unit], i) => {
    const row = document.createElement('div');
    row.className = 'slider';
    row.innerHTML = `<label for="s${i}">${label}</label><input id="s${i}" type="range" min="${min}" max="${max}" step="${step}" value="${obj()[key]}"><output for="s${i}"></output>`;
    const input = /** @type {HTMLInputElement} */ (row.querySelector('input')), out = /** @type {HTMLOutputElement} */ (row.querySelector('output'));
    const show = () => { out.textContent = `${obj()[key]} ${unit}`.trim(); };
    input.addEventListener('input', () => {
      obj()[key] = Number(input.value);
      if (key === 'bodyM') setSolids();
      show();
    });
    // Keys on a slider are for the slider; give them back to walking afterwards.
    input.addEventListener('change', () => input.blur());
    show();
    box.append(row);
  });
}
buildSliders();
for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('#feel button'))) b.addEventListener('click', () => {
  walker.setFeel(/** @type {string} */ (b.dataset.feel));
  for (const o of document.querySelectorAll('#feel button')) o.setAttribute('aria-pressed', String(o === b));
  buildSliders();
  b.blur();
});
$('reset').addEventListener('click', (e) => { reset(); /** @type {HTMLElement} */ (e.currentTarget).blur(); });
$('copy').addEventListener('click', async (e) => {
  const text = recipeBlocks();
  /** @type {HTMLTextAreaElement} */ ($('blocks')).value = text;
  try { await navigator.clipboard.writeText(text); say('Copied: paste them over the same blocks in recipes/world/walker.json.'); } catch { say('Shown below; copy them from the box.'); }
  /** @type {HTMLElement} */ (e.currentTarget).blur();
});
/** The tuned numbers as walker.json blocks (pace, steer, solids), one line each. */
function recipeBlocks() {
  const line = (/** @type {string} */ k, /** @type {any} */ v) => `  "${k}": ${JSON.stringify(v)},`;
  const { note: _n, ...steer } = R.steer;
  const changed = [['pace', R.pace, R0.pace], ['steer', steer, (({ note: _m, ...s }) => s)(R0.steer)], ['solids', R.solids, R0.solids]]
    .map(([k, now, was]) => `${line(/** @type {string} */ (k), now)}${JSON.stringify(now) === JSON.stringify(was) ? '' : '   (changed)'}`);
  return changed.join('\n');
}

// ---- the speed trace ----
const trace = /** @type {HTMLCanvasElement} */ ($('trace'));
const tctx = /** @type {CanvasRenderingContext2D} */ (trace.getContext('2d'));
const TRACE_S = 6;
/** @type {{ t: number, v: number, roll: boolean }[]} */ let samples = [];
function drawTrace(/** @type {number} */ now) {
  const r = trace.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (trace.width !== w || trace.height !== h) { trace.width = w; trace.height = h; }
  tctx.fillStyle = '#FBF7F0'; tctx.fillRect(0, 0, w, h);
  const top = Math.max(7, (R.steer.roll.distM / R.steer.roll.durS) * 1.05);
  const y = (/** @type {number} */ v) => h - 6 * dpr - (v / top) * (h - 12 * dpr);
  tctx.font = `600 ${15 * dpr}px Nunito, system-ui, sans-serif`;
  tctx.lineWidth = dpr;
  for (const [v, name] of /** @type {[number, string][]} */ ([[R.pace.creepMps, 'creep'], [R.pace.strollMps, 'walk'], [R.pace.briskMps, 'run']])) {
    tctx.strokeStyle = '#E3D9C9'; tctx.beginPath(); tctx.moveTo(0, y(v)); tctx.lineTo(w, y(v)); tctx.stroke();
    tctx.fillStyle = '#4A5551'; tctx.fillText(`${name} ${v.toFixed(2)}`, 6 * dpr, y(v) - 4 * dpr);
  }
  tctx.fillStyle = 'rgba(224, 138, 91, 0.35)';
  for (const s of samples) if (s.roll) tctx.fillRect(w - ((now - s.t) / TRACE_S) * w, 0, 2 * dpr, h);
  tctx.lineWidth = 2.5 * dpr; tctx.strokeStyle = '#2E4A2C';
  tctx.beginPath();
  samples.forEach((s, i) => { const x = w - ((now - s.t) / TRACE_S) * w; if (i) tctx.lineTo(x, y(s.v)); else tctx.moveTo(x, y(s.v)); });
  tctx.stroke();
}

// ---- the legend ----
$('legend').innerHTML = course.labels.map(([t]) => `<li>${t}</li>`).join('');

// ---- running ----
reset();
let last = performance.now(), clockS = 0, statAcc = 0;
function frame(/** @type {number} */ now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  clockS += dt;
  camera.setViewport(view.clientWidth, view.clientHeight);
  look.update();
  const a = keys.axes(), way = worldWay(a.forward, a.right, camera.yaw);
  walker.steer(way[0], way[1], keys.run);
  walker.update(dt);
  const you = youNow();
  for (const act of actors) {
    act.update(dt, you);
    $('actor-note').textContent = `${act.note} Startled ${act.startles} times.`;
  }
  cam.update();
  camera.update(dt);
  const e = camera.eye, t = camera.target;
  const r = motion.update(dt, {
    x: walker.x, z: walker.z, y: walker.y, yaw: walker.yaw, speed: walker.speed, moving: walker.moving, retreating: walker.retreating,
    rolling: walker.rolling, airborne: walker.airborne, ground, depth: depthAt, posture: walker.posture, below: true, look: { yaw: Math.atan2(t[0] - e[0], t[2] - e[2]) },
  });
  stage.setProps(props());
  stage.draw({ bones: motion.bones, eyes: eyeUniforms(FR.eyes, headBone, r.eyes, eyeBuf), place: [walker.x, walker.y, walker.z, r.yaw],
    weights: false, night: false, water: course.waterY, follow: [walker.x, walker.y, walker.z], dt, camera: { eye: e, target: t }, scale: DS });
  samples.push({ t: clockS, v: walker.speed, roll: walker.rolling >= 0 });
  samples = samples.filter((s) => clockS - s.t <= TRACE_S);
  drawTrace(clockS);
  statAcc += dt;
  if (statAcc > 0.2) {
    statAcc = 0;
    const k = grid.cellAt(walker.x, walker.z);
    const pace = walker.rolling >= 0 ? 'rolling' : !walker.moving ? 'standing' : walker.speed > R.pace.strollMps + 0.1 ? 'running'
      : nearest(walker.x, walker.z) < R.pace.creepNearM && walker.speed <= R.pace.creepMps + 0.01 ? 'creeping' : 'walking';
    $('stats').innerHTML = `<dt>Pace</dt><dd>${pace}</dd><dt>Speed</dt><dd>${walker.speed.toFixed(2)} m/s</dd>`
      + `<dt>Water here</dt><dd>${k >= 0 ? `${depth(k).toFixed(2)} m` : 'none'}</dd><dt>Ground</dt><dd>${walker.y.toFixed(2)} m up</dd>`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
/** For checking from the console: the walker, the actors, the solids. */
/** @type {any} */ (window).arena = { walker, actors, get solids() { return solids; }, camera, grid, R };
say('Click the view to look round with the mouse, then walk with W A S D.');
