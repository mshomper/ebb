// @ts-check
// The movement arena (doc 23; WASD, October 26, 2026): a compact test ground with one of each thing
// movement meets (tools/arena/course.js), the real walker and figure, and the game's own controls and
// camera: W A S D, mouse look (click the view), Shift, the Space roll, and a click on what the dot rests
// on walks there by the walk grid. Sliders tune every movement and roll number live; the trace shows
// your speed; Copy gives the numbers as recipe blocks for recipes/world/walker.json. Nothing is saved.
//
// Built to grow (doc 23, the arena and the Hollow): courses are data (COURSES), stand-ins that react
// are actor kinds (tools/arena/actors.js KINDS), each camera is an entry in CAMERAS (the Hollow's
// camera is 'hollow': the walker camera with recipes/world/hollow.json numbers), and each move is an
// entry in MOVES keyed by its key (Space rolls; the Hollow's Q and E moves join there).
//
// The Hollow (H0, October 27, 2026; ?course=hollow): a dim chamber lit by the lantern, the staff in
// hand (?staff=a or b picks its look), left click swings, the right mouse held raises the lantern,
// Tab locks on, a dot on the floor shows where moves go, and three stand-ins fight back. Its wiring
// is tools/arena/hollow.js; the logic the game will reuse is in src/world/hollow/.

import { createStage } from './walker-figure-stage.js';
import { loadFigureModel, loadFigureClips, eyeUniforms } from '../src/world/figure/index.js';
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
import { createHeld } from './walker-held.js';
import { createHollow } from './arena/hollow.js';
import { createHollowPanel } from './arena/hollow-panel.js';
import { createMoveLayer } from './arena/moves.js';
import { createMovesPanel } from './arena/moves-panel.js';
import { loadMoteModel } from '../src/world/hollow/mote-model.js';
import { createMotePass } from './arena/mote-pass.js';
import { createCrowd } from '../src/world/hollow/crowd.js';
import { loadCrawlerModel } from '../src/world/hollow/crawler-model.js';
import { createCrawlerPass } from './arena/crawler-pass.js';

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
const params = new URLSearchParams(location.search);
const course = /** @type {import('./arena/course.js').Course} */ (COURSES[/** @type {keyof typeof COURSES} */ (params.get('course') ?? 'island')] ?? COURSES.island);
const half = course.sizeM / 2;
// The Hollow's numbers and the fighting clips, on the Hollow course only.
const HR = course.dark ? await recipe('world/hollow') : null;
const FC = course.dark ? await recipe('world/fight-clips') : null;
const MR = course.dark ? await recipe('world/hollow-moves') : null;
/** The Hollow's recipes as loaded, to show what the sliders changed. */
const HR0 = structuredClone(HR), MR0 = structuredClone(MR), FC0 = structuredClone(FC);
// The soot motes, Matt's model (H2), drawn in the stage's pass.
const moteModel = HR ? await loadMoteModel(new URL('../assets/models/hollow/mote.glb', import.meta.url)) : null;
const motePass = HR && moteModel ? await createMotePass(stage.gpu, moteModel, HR.foes.motes.mote) : null;
// The silt crawler, Matt's model rigged in code (H2), drawn in the stage's pass too.
const crawlerModel = HR ? await loadCrawlerModel(new URL('../assets/models/hollow/crawler.glb', import.meta.url)) : null;
const crawlerPass = HR && crawlerModel ? await createCrawlerPass(stage.gpu, crawlerModel, HR.foes.lunger.crawler) : null;
// The Hollow's crowd (H2): attack slots and bodies kept apart (src/world/hollow/crowd.js).
const crowd = HR ? createCrowd(HR.crowd, 1) : null;

// ---- the world: ground, water, walk grid, solids ----
const ground = course.ground;
stage.setGround(ground, course.sizeM, 300);
const grid = createWalkGrid({ ground, minX: -half, minZ: -half, maxX: half, maxZ: half, cellM: R.grid.cellM, maxSlopeDeg: R.grid.maxSlopeDeg });
const depth = (/** @type {number} */ k) => Math.max(0, course.waterY - grid.height[k]);
const depthAt = (/** @type {number} */ x, /** @type {number} */ z) => Math.max(0, course.waterY - ground(x, z));
let solids = createSolids(R.solids.bodyM);
const setSolids = () => { solids = createSolids(R.solids.bodyM); solids.set(course.solids); solids.mark(grid); };
setSolids();

// ---- the actors (stand-ins that react to you); the Hollow's are seeded by their id ----
const kindRecipes = { frog: frogR, hollow: HR, seed: 1, moteAcrossM: moteModel?.acrossM, crawlerModel };
let nextId = 1, spawnAt = 0;
/** @param {{ kind: string, x: number, z: number }} a */
const makeActor = (a) => KINDS[a.kind]({ ...a, id: nextId++ }, kindRecipes);
/** @type {any[]} */
let actors = course.actors.map(makeActor);
const nearest = (/** @type {number} */ x, /** @type {number} */ z) => actors.reduce((m, a) => (a.broken ? m : Math.min(m, Math.hypot(a.x - x, a.z - z))), Infinity);

// ---- the walker and its figure ----
const walker = createWalker(R, { get grid() { return grid; }, depth, ground, nearest, get solids() { return solids; } });
// As the game draws it: Matt's clips and the baked texture.
const figureGlb = await loadFigureModel(FR);
const built = buildFigure(figureGlb, FR, { textured: true });
stage.setMesh(built);
await stage.setMaps(figureGlb);
const motion = createFigureMotion(FR, built.skeleton, await loadFigureClips(FR));
// The fighting clips (C1), in the Hollow.
if (FC) motion.addClips(await (await fetch(new URL(`../${FC.file}`, import.meta.url))).json());
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
const say = (/** @type {string} */ s) => { note.textContent = s; };

// ---- the Hollow (H0): lantern, staff, swing, lock-on, the floor dot ----
const hollow = HR ? createHollow({
  HR, FR: FC, walker, camera, grid, ground, course, motion, held: await createHeld(FR, built), built, DS,
  actors: () => actors, head, say, lookRates: () => R.steer.look,
}) : null;
const SR = hollow ? await recipe('world/staff') : null;
// The Q and E moves (H0b).
const moveLayer = hollow && MR ? createMoveLayer({ MR, hollow, walker, motion, FC, FR, R, ground, say }) : null;
/** The staff's look: ?staff=a (slim) or b (knotted). */
const staffLook = SR ? SR.looks[params.get('staff') === 'b' ? 1 : 0].id : '';

/**
 * The cameras, by name. follow: the game's low view behind you, turned by the mouse. hollow (doc 16,
 * The camera below): the same camera with the Hollow's numbers, higher and further back so the floor
 * reads; walls in the way fade instead of the camera pulling in, and a lock keeps you and the target
 * framed (tools/arena/hollow.js).
 * @type {Record<string, { start: () => void, update: (dt: number) => void, look: (dx: number, dy: number) => void }>}
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
  ...(hollow ? { hollow: hollow.cam } : {}),
};
const cam = CAMERAS[course.camera ?? 'follow'] ?? CAMERAS.follow;

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
/** The keys' way in the world: camera-relative, or round the locked target. */
const keyWay = () => {
  const a = keys.axes(), way = worldWay(a.forward, a.right, camera.yaw);
  return hollow ? hollow.steerWay(a.forward, a.right, way) : way;
};
const keys = attachMoveKeys(window, {
  onPress(name) {
    if (name === 'move') { if (walker.pathing && !walker.retreating) walker.stop(); return true; }
    // A roll breaks off a swing (never during a stagger).
    if (hollow?.reeling) return true;
    if (hollow?.swinging) hollow.cancelSwing();
    MOVES.roll(keyWay());
    return true;
  },
});
if (hollow) {
  window.addEventListener('keydown', (e) => { if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return; hollow.onKey(e); moveLayer?.onKey(e); });
  // Holding the right mouse button raises the lantern (doc 16: everyone's, never a peg).
  window.addEventListener('pointerdown', (e) => { if (e.button === 2 && (pointerLocked() || e.target === view)) { e.preventDefault(); hollow.lantern.raise(true); } }, { capture: true });
  window.addEventListener('pointerup', (e) => { if (e.button === 2) hollow.lantern.raise(false); }, { capture: true });
  view.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('blur', () => hollow.lantern.raise(false));
}

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
  // In the Hollow a click swings the staff.
  use: (x, y) => {
    // Ready, then click: a readied move fires instead.
    if (hollow) { if (!moveLayer?.click() && !moveLayer?.moves.playing) hollow.swingNow(); return; }
    const p = groundAt(x, y);
    if (!p) return;
    const r = walker.walkTo(p[0], p[2]);
    say(r.ok ? 'Walking there by the walk grid.' : "You can't get there on foot.");
  },
});
document.addEventListener('pointerlockchange', () => {
  $('look-badge').hidden = !pointerLocked();
  $('free-badge').hidden = pointerLocked();
  say(pointerLocked() ? hollow ? 'The mouse turns the view; a click swings the staff, Tab locks on. Hold Alt or press Esc to free the pointer.'
    : 'The mouse turns the view; a click walks to where the dot rests. Hold Alt or press Esc to free the pointer.' : 'Click the view to look round with the mouse.');
});

// ---- props: the solids, the stand-ins, the creep zone and the frog's ring ----
/** Each solid's triangles, so a wall in the way can be drawn faded on its own. */
const solidTris = course.solids.map((s) => {
  /** @type {number[]} */ const t = [];
  const y = ground(s.x, s.z);
  if (s.r !== undefined) pushCylinder(t, [s.x, y - 0.05, s.z], s.r, s.heightM + 0.05, s.color);
  else pushBox(t, [s.x, y + s.heightM / 2 - 0.05, s.z], [s.hw ?? 0, s.heightM / 2 + 0.05, s.hd ?? 0], s.yaw ?? 0, s.color);
  return new Float32Array(t);
});
/** @param {number[]} place [x, y, z, yaw] the figure, for what it holds */
function props(place) {
  /** @type {number[]} */ const out = [];
  const you = youNow();
  moveLayer?.draw(out);
  for (const a of actors) {
    for (const b of a.shapes(ground)) pushBox(out, [b[0], b[1], b[2]], [b[3], b[4], b[5]], b[6], [b[7], b[8], b[9]]);
    if (a.foe) continue;
    pushRing(out, a.x, a.z, R.pace.creepNearM, ground, [0.85, 0.8, 0.55]);
    pushRing(out, a.x, a.z, a.ring(you), ground, [0.75, 0.42, 0.3]);
  }
  const faded = hollow ? hollow.draw(out, course.solids) : new Set();
  const parts = [...solidTris.filter((_, i) => !faded.has(i)), new Float32Array(out), ...(hollow ? hollow.heldTris(place, staffLook) : [])];
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let k = 0;
  for (const p of parts) { all.set(p, k); k += p.length; }
  return { tris: all, faded: hollow ? hollow.fadedShapes(solidTris, course.solids, faded) : null };
}
/** You, as the actors read you (in the Hollow, with the lantern and the open ground). @returns {import('./arena/actors.js').You} */
function youNow() {
  const e = camera.eye, t = camera.target, gx = t[0] - e[0], gz = t[2] - e[2], l = Math.hypot(gx, gz);
  return { x: walker.x, z: walker.z, speed: walker.speed, posture: walker.posture, gaze: l > 1e-6 ? [gx / l, gz / l] : null, rolling: walker.rolling >= 0, ...(hollow ? hollow.youExtra() : {}) };
}

// ---- the Hollow's panel: the flame, the swing, the stand-ins ----
const panel = hollow && HR ? createHollowPanel($('hollow-panel'), {
  hollow, HR, FC, actors: () => actors,
  spawn(kind) {
    const sp = course.spawns ?? [[0, 0]], [x, z] = sp[spawnAt++ % sp.length];
    actors.push(makeActor({ kind, x, z }));
  },
  clear() { actors = actors.filter((a) => !a.foe); hollow.lock.drop(); },
  reset() {
    actors = course.actors.map(makeActor); hollow.lock.drop(); spawnAt = 0;
    for (const k of Object.keys(hollow.tally)) hollow.tally[/** @type {keyof typeof hollow.tally} */ (k)] = 0;
  },
}) : null;
if (panel) { $('hollow-panel').hidden = false; $('hollow-keys').hidden = false; }
const movesPanel = moveLayer && HR && MR ? createMovesPanel($('moves-panel'), {
  layer: moveLayer, MR, HR, MR0, HR0, FC, FC0, say, blocks: /** @type {HTMLTextAreaElement} */ ($('blocks')),
}) : null;
if (movesPanel) $('moves-panel').hidden = false;

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
if (course.feel) {
  walker.setFeel(course.feel);
  for (const o of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#feel button'))) o.setAttribute('aria-pressed', String(o.dataset.feel === course.feel));
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
let last = performance.now(), clockS = 0, statAcc = 0, paused = false;
/** Frame time (ms): the time between frames, and the time one tick takes on the main thread, over the last frames. */
const frameMs = { gap: /** @type {number[]} */ ([]), work: /** @type {number[]} */ ([]) };
const mean = (/** @type {number[]} */ a) => a.reduce((n, v) => n + v, 0) / Math.max(1, a.length);
function frame(/** @type {number} */ now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  frameMs.gap.push(now - last); if (frameMs.gap.length > 120) frameMs.gap.shift();
  last = now;
  const t0 = performance.now();
  tick(paused ? 0 : dt);
  frameMs.work.push(performance.now() - t0); if (frameMs.work.length > 120) frameMs.work.shift();
  requestAnimationFrame(frame);
}
/** One step of everything, realDt seconds; draw false skips drawing (arena.run). @param {number} realDt */
function tick(realDt, draw = true) {
  // A hit-stop holds the world nearly still for a moment; the camera keeps real time.
  const dt = hollow ? hollow.simDt(realDt) : realDt;
  clockS += dt;
  camera.setViewport(view.clientWidth, view.clientHeight);
  look.update();
  const way = keyWay();
  // Anchored: swinging, staggered by a hit, or playing a move, the walker stands where it is.
  if (hollow?.reeling || hollow?.swinging || moveLayer?.holdsStill) walker.steer(0, 0); else walker.steer(way[0], way[1], keys.run);
  walker.update(dt);
  moveLayer?.afterWalker();
  const you = /** @type {any} */ (youNow());
  // The crowd (H2): who may come in to strike, and where the rest wait; then bodies pushed apart.
  const crowdFoes = crowd ? actors.filter((a) => a.foe).map((a) => a.foe) : [];
  if (crowd) { crowd.assign(crowdFoes, you, !!moveLayer?.moves.gentle); you.crowd = crowd; }
  for (const act of actors) {
    const ev = act.update(dt, you);
    if (ev?.length) hollow?.onEvents(ev);
  }
  if (crowd && you.open) crowd.spread(crowdFoes, { open: you.open }, dt);
  // Drawn after the crowd has spaced them, so a nudge plays as a step.
  for (const act of actors) {
    act.swarm?.update(dt, clockS, { ground, lamp: you.lamp, you });
    act.crawler?.update(dt, clockS, { ground, you });
  }
  if (!hollow) $('actor-note').textContent = actors.map((act) => `${act.note} Startled ${act.startles} times.`).join(' ');
  hollow?.update(dt);
  moveLayer?.update(dt);
  cam.update(realDt);
  camera.update(realDt);
  const e = camera.eye, t = camera.target;
  const r = motion.update(dt, {
    x: walker.x, z: walker.z, y: walker.y, yaw: walker.yaw, speed: walker.speed, moving: walker.moving, retreating: walker.retreating,
    rolling: moveLayer?.backStepping ? -1 : walker.rolling, airborne: walker.airborne, ground, depth: depthAt, posture: walker.posture, below: true, look: { yaw: Math.atan2(t[0] - e[0], t[2] - e[2]) },
  });
  samples.push({ t: clockS, v: walker.speed, roll: walker.rolling >= 0 });
  samples = samples.filter((s) => clockS - s.t <= TRACE_S);
  if (draw) {
    const place = [walker.x, walker.y, walker.z, r.yaw];
    const p = props(place);
    stage.setProps(p.tris, p.faded);
    motePass?.set(actors.filter((a) => a.swarm && !a.broken).map((a) => a.swarm), clockS);
    crawlerPass?.set(actors.filter((a) => a.crawler).map((a) => a.crawler));
    stage.draw({ extra: motePass || crawlerPass ? (pass, u) => { motePass?.draw(pass, u); crawlerPass?.draw(pass, u); } : undefined, bones: motion.bones, eyes: eyeUniforms(FR.eyes, headBone, r.eyes, eyeBuf), place,
      weights: false, night: false, water: course.waterY, follow: [walker.x, walker.y, walker.z], dt, camera: { eye: e, target: t }, scale: DS,
      ...(hollow && HR ? { lamp: hollow.lamp(), fade: [HR.camera.fade.fillAlpha, HR.camera.fade.outlineAlpha] } : {}) });
    drawTrace(clockS);
  }
  statAcc += dt;
  if (statAcc > 0.2) {
    statAcc = 0;
    const k = grid.cellAt(walker.x, walker.z);
    const pace = walker.rolling >= 0 ? 'rolling' : !walker.moving ? 'standing' : walker.speed > R.pace.strollMps + 0.1 ? 'running'
      : nearest(walker.x, walker.z) < R.pace.creepNearM && walker.speed <= R.pace.creepMps + 0.01 ? 'creeping' : 'walking';
    $('stats').innerHTML = `<dt>Pace</dt><dd>${pace}</dd><dt>Speed</dt><dd>${walker.speed.toFixed(2)} m/s</dd>`
      + `<dt>Frame</dt><dd>${mean(frameMs.gap).toFixed(1)} ms (${(1000 / Math.max(1e-3, mean(frameMs.gap))).toFixed(0)} a second), its work ${mean(frameMs.work).toFixed(1)} ms</dd>`
      + `<dt>Water here</dt><dd>${k >= 0 ? `${depth(k).toFixed(2)} m` : 'none'}</dd><dt>Ground</dt><dd>${walker.y.toFixed(2)} m up</dd>`
      + (hollow ? `<dt>Floor dot</dt><dd>${(() => { const d = hollow.dot(); return d.locked ? 'under the locked target' : `${d.m.toFixed(1)} m out`; })()}</dd>` : '');
    panel?.show();
    movesPanel?.show();
  }
}
requestAnimationFrame(frame);
/** For checking from the console: the walker, the actors, the solids. */
/** @type {any} */ (window).arena = { walker, crawlerPass, motePass, crowd, HR, get actors() { return actors; }, get solids() { return solids; }, camera, grid, R, hollow, motion, moveLayer,
  /** Run on s seconds at once in 60ths (checks from the console, and a hidden tab). @param {number} s */
  run(s) { const n = Math.round(s * 60); for (let i = 0; i < n; i++) tick(1 / 60, i === n - 1); last = performance.now(); },
  /** Hold time still (the view still draws), for checks and screenshots. @param {boolean} on */
  pause(on) { paused = on; },
  /** The mean frame gap and tick work (ms) over the last 120 frames. */
  get frameMs() { return { gap: mean(frameMs.gap), work: mean(frameMs.work), frames: frameMs.gap.length }; } };
say(hollow ? 'Click the view, then walk with W A S D. Left click swings the staff, the right mouse held raises the lantern, Tab locks on.'
  : 'Click the view to look round with the mouse, then walk with W A S D.');
