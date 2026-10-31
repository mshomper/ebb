// @ts-check
// The shore birds lab (B3 R1): the small-bird rig carrying the turnstone, made in code
// (src/world/creatures/bird-model.js) from recipes/birds/turnstone.json, posed by the rig's code
// clips (bird-motion.js). Life strings the clips into one loop that ends where it began: a scurry,
// turning a stone, pecks, a run, preening, take-off, a lap in the air (a half turn, a straight
// back, a half turn) and a landing. Every clip plays on its own too, and Flock flies seven at once,
// each on its own beat. `?clip=<id>&hold=<s>` starts on a clip held that many seconds in (for
// screenshots); `?plumage=breeding`; `?view=<name>`.

import { run } from '../src/core/workers.js';
import { poseSkeleton, moveMatrix } from '../src/world/creatures/pose.js';
import { MAX_BONES, packMesh } from '../src/world/creatures/bodies.js';
import { bakeBody } from '../src/world/creatures/body-bake.js';
import { birdRig } from '../src/world/creatures/bird-rig.js';
import { poseBird, idlePose, gaitPose, peckPose, flipPose, preenPose, flyPose, takeoffPose, landPose, restPose } from '../src/world/creatures/bird-motion.js';
import { createStage } from './shore-birds-lab-stage.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const R = await (await fetch(new URL('../recipes/birds/turnstone.json', import.meta.url))).json();
const M = R.motion, k = R.displayScale;
const query = new URLSearchParams(location.search);
const HOLD = query.has('hold') ? Number(query.get('hold')) : null;

const made = await createStage(/** @type {HTMLCanvasElement} */ ($('view')));
if (!made.ok) { $('note').textContent = `This page needs WebGPU: ${made.reason}`; throw new Error(made.reason); }
const stage = made.stage;
const rig = birdRig(R.shape);

// --- the turnstone, baked in both plumages on the worker pool ---
const BAKE = { module: './world/creatures/bird-model.js', fn: 'bakeBird' };
let plumage = query.get('plumage') === 'breeding' ? 'breeding' : 'winter';
const baked = await Promise.all(['winter', 'breeding'].map((p) => run(BAKE, { shape: R.shape, plumage: R.plumage[p], wingPattern: R.wingPattern,
  cellM: R.bake.cellM, wingCellM: R.bake.wingCellM, blendM: R.bake.blendM }).then((/** @type {any} */ m) => { stage.setMesh(p, m); return m; })));

// --- a flat beach stone and a clump of wrack to turn, each one bone ---
const STONE = { len: 0.056, wide: 0.05, high: 0.016 };
/** Bake a prop and colour it: its top, and its wet, darker underside. @param {any[]} prims @param {number[]} top @param {number[]} under */
function prop(prims, top, under) {
  const m = bakeBody({ prims, albedo: { back: top } }, 0.0016);
  for (let v = 0; v < m.count; v++) m.vertices.set(m.vertices[v * 9 + 4] < -0.2 ? under : top, v * 9 + 6);
  return { data: packMesh(m), indices: m.indices };
}
stage.setMesh('stone', prop([{ type: 'ellipsoid', c: [0, STONE.high / 2, 0], r: [STONE.wide / 2, STONE.high / 2, STONE.len / 2], region: 'rock', k: 0 },
  { type: 'ellipsoid', c: [0.006, STONE.high * 0.45, -0.008], r: [STONE.wide * 0.4, STONE.high * 0.45, STONE.len * 0.38], region: 'rock', k: 0.01 }],
[0.26, 0.25, 0.23], [0.07, 0.08, 0.05]));
stage.setMesh('wrack', prop([0, 1, 2, 3].map((i) => ({ type: 'capsule', a: [-0.026 + i * 0.016, 0.004, -0.026 + (i % 2) * 0.01], b: [-0.018 + i * 0.012, 0.005 + (i % 2) * 0.003, 0.026 - (i % 3) * 0.008],
  r: [0.0055, 0.004], region: 'rock', k: 0.006 })), [0.07, 0.06, 0.022], [0.035, 0.03, 0.012]));

/**
 * The bird: where it is (drawn metres), heading, height, metres walked (real) and the beat.
 * @typedef {{ x: number, z: number, yaw: number, y: number, dist: number, beat: number, bank: number }} Actor
 */
/** @returns {Actor} */
const actor = () => ({ x: 0, z: 0, yaw: 0, y: 0, dist: 0, beat: 0, bank: 0 });
const fwd = (/** @type {Actor} */ a, /** @type {number} */ m) => { a.x += Math.sin(a.yaw) * m; a.z += Math.cos(a.yaw) * m; };

/** The prop being turned: which, where, its heading, how far over. @type {{ mesh: string, x: number, z: number, yaw: number, lever: number } | null} */
let propState = null;
/** Put a prop just ahead of the bird's bill. @param {Actor} a @param {string} mesh */
function placeProp(a, mesh) {
  const ahead = (M.flip.aheadM + STONE.len / 2) * k;
  propState = { mesh, x: a.x + Math.sin(a.yaw) * ahead, z: a.z + Math.cos(a.yaw) * ahead, yaw: a.yaw, lever: 0 };
}

/** The ground the landing covers (real m), measured once from the clip. */
const LAND_M = (() => { let d = 0; const n = 400; for (let i = 0; i < n; i++) d += landPose(0, (i + 0.5) / n, 0, M).v * (M.land.s / n); return d; })();
const FLY_MPS = M.takeoff.climbMps, TURN_R = 0.6;
const CRUISE_Y = 0.25;

/**
 * A segment of a loop: how long, and what it does each frame (the pose, moving the actor on).
 * @typedef {{ id: string, label: string, s: number, enter?: (a: Actor) => void, step: (a: Actor, u: number, t: number, dt: number) => import('../src/world/creatures/bird-motion.js').BirdPose }} Segment
 */

/** A walk or run of `s` seconds, easing in and out. @param {'walk' | 'run'} kind @param {number} s @returns {Segment} */
function gaitSeg(kind, s) {
  return { id: kind, label: kind === 'walk' ? 'scurrying along' : 'running', s, step: (a, u, t, dt) => {
    const e = Math.min(1, Math.min(u * s, (1 - u) * s) / 0.18);
    const v = M[kind].mps * e;
    a.dist += v * dt; fwd(a, v * k * dt);
    const P = gaitPose(t, a.dist / M[kind].strideM, M, kind);
    P.gait.w = e;
    return P;
  } };
}

/** A turn of a stone or wrack. @param {string} mesh @returns {Segment} */
function flipSeg(mesh) {
  return { id: `flip-${mesh}`, label: mesh === 'stone' ? 'turning a stone with its bill' : 'turning wrack with its bill', s: M.flip.s,
    enter: (a) => placeProp(a, mesh), step: (a, u, t) => {
      const r = flipPose(t, u, M);
      if (propState) propState.lever = r.lever;
      return r.pose;
    } };
}

/** @param {string} id @param {string} label @param {number} s @param {(t: number, u: number) => any} pose @returns {Segment} */
const still = (id, label, s, pose) => ({ id, label, s, step: (a, u, t) => pose(t, u) });

/** @returns {Segment} */
const takeoffSeg = () => ({ id: 'takeoff', label: 'a few quick steps, a spring, and up', s: M.takeoff.s, step: (a, u, t, dt) => {
  const r = takeoffPose(t, u, a.dist / M.run.strideM, M);
  a.dist += r.v * dt; fwd(a, r.v * k * dt); a.y = r.y * k;
  return r.pose;
} });

/** @returns {Segment} */
const landSeg = () => ({ id: 'land', label: 'gliding in, a flare, wings up, folded', s: M.land.s, step: (a, u, t, dt) => {
  const r = landPose(t, u, a.dist / M.run.strideM, M, CRUISE_Y);
  a.dist += r.v * dt; fwd(a, r.v * k * dt); a.y = r.y * k; a.bank *= 0.9;
  return r.pose;
} });

/**
 * A lap in the air that ends where it must for the landing to finish at `home` (drawn z along the
 * heading): a half turn left, a straight back, a half turn left. @param {() => number} backM drawn metres to fly back
 * @returns {Segment}
 */
function lapSeg(backM) {
  /** @type {{ x: number, z: number, yaw: number, back: number, r: number }} */ let st = { x: 0, z: 0, yaw: 0, back: 0, r: 0 };
  const seg = { id: 'fly', label: 'flying a lap: beats with a glide now and then', s: 4, enter: (/** @type {Actor} */ a) => {
    st = { x: a.x, z: a.z, yaw: a.yaw, back: Math.max(0, backM()), r: TURN_R * k };
    seg.s = (2 * Math.PI * st.r + st.back) / (FLY_MPS * k);
  }, step: (/** @type {Actor} */ a, /** @type {number} */ u, /** @type {number} */ t, /** @type {number} */ dt) => {
    const len = 2 * Math.PI * st.r + st.back, s = u * len, half = Math.PI * st.r;
    const left = (/** @type {number} */ y) => [Math.cos(y), -Math.sin(y)];
    let x, z, yaw, bank = 0;
    if (s < half) {
      const th = s / st.r, l0 = left(st.yaw), c = [st.x + l0[0] * st.r, st.z + l0[1] * st.r], l = left(st.yaw + th);
      x = c[0] - l[0] * st.r; z = c[1] - l[1] * st.r; yaw = st.yaw + th; bank = -0.45;
    } else if (s < half + st.back) {
      const l0 = left(st.yaw), y = st.yaw + Math.PI;
      x = st.x + l0[0] * 2 * st.r + Math.sin(y) * (s - half); z = st.z + l0[1] * 2 * st.r + Math.cos(y) * (s - half); yaw = y;
    } else {
      const th = (s - half - st.back) / st.r, y0 = st.yaw + Math.PI, l0 = left(y0);
      const sx = st.x + left(st.yaw)[0] * 2 * st.r + Math.sin(y0) * st.back, sz = st.z + left(st.yaw)[1] * 2 * st.r + Math.cos(y0) * st.back;
      const c = [sx + l0[0] * st.r, sz + l0[1] * st.r], l = left(y0 + th);
      x = c[0] - l[0] * st.r; z = c[1] - l[1] * st.r; yaw = y0 + th; bank = -0.45;
    }
    // Ease the bank in and out of the turns.
    a.bank += (bank - a.bank) * Math.min(1, dt * 4);
    a.x = x; a.z = z; a.yaw = yaw; a.y = CRUISE_Y * k;
    a.beat += dt * M.flap.hz;
    const cyc = (t % 2.6) / 2.6;
    const glide = Math.max(Math.min(1, Math.max(0, (cyc - 0.68) * 8) * Math.max(0, (1 - cyc) * 8)), Math.min(1, Math.max(0, (u - 0.86) * 9)));
    return flyPose(t, a.beat, glide, M);
  } };
  return seg;
}

/** Where the life loop began (drawn z), for the lap to fly home. */
let homeZ = 0;
/** @type {Record<string, () => Segment[]>} */
const LOOPS = {
  life: () => [
    still('idle', 'standing, breathing, looking about', 1.6, (t) => idlePose(t, M)),
    gaitSeg('walk', 2.2),
    flipSeg('stone'),
    still('idle', 'standing, breathing', 0.6, (t) => idlePose(t, M, 2)),
    still('peck', 'pecking', M.peck.s, (t, u) => peckPose(t, u, M)),
    still('peck', 'pecking', M.peck.s, (t, u) => peckPose(t, u, M)),
    gaitSeg('run', 1.4),
    flipSeg('wrack'),
    still('preen', 'preening', M.preen.s, (t, u) => preenPose(t, u, M)),
    takeoffSeg(),
    lapSeg(() => bird.z - homeZ + LAND_M * k),
    landSeg(),
  ],
  idle: () => [still('idle', 'standing, breathing, looking about', 8, (t) => idlePose(t, M))],
  walk: () => [gaitSeg('walk', 3.2)],
  run: () => [gaitSeg('run', 2.2)],
  peck: () => [still('peck', 'pecking', M.peck.s, (t, u) => peckPose(t, u, M)), still('idle', 'standing', 0.6, (t) => idlePose(t, M))],
  'flip-stone': () => [flipSeg('stone'), still('idle', 'standing', 0.8, (t) => idlePose(t, M))],
  'flip-wrack': () => [flipSeg('wrack'), still('idle', 'standing', 0.8, (t) => idlePose(t, M))],
  preen: () => [still('preen', 'preening, left then right', M.preen.s, (t, u) => preenPose(t, u, M))],
  takeoff: () => [still('idle', 'standing', 0.6, (t) => idlePose(t, M)), takeoffSeg(), { id: 'fly', label: 'climbing away', s: 1.2, step: (a, u, t, dt) => {
    fwd(a, FLY_MPS * k * dt); a.beat += dt * M.flap.hz; a.y = CRUISE_Y * k; return flyPose(t, a.beat, 0, M); } }],
  land: () => [{ id: 'fly', label: 'gliding in', s: 0.8, enter: (a) => { a.z = -(0.8 * FLY_MPS + LAND_M) * k; a.y = CRUISE_Y * k; }, step: (a, u, t, dt) => {
    fwd(a, FLY_MPS * k * dt); a.beat += dt * M.flap.hz; a.y = CRUISE_Y * k; return flyPose(t, a.beat, Math.min(1, u * 2), M); } }, landSeg(),
  still('idle', 'standing', 1.2, (t) => idlePose(t, M))],
  wings: () => [still('wings', 'the wing telescoping open and closed', 4, (t, u) => {
    const P = restPose(); P.t = t; const s = Math.min(1, Math.max(0, Math.sin(u * Math.PI) * 1.5));
    P.wing = { spread: s, up: 0.35 * s, sweep: 0, handUp: 0, handFold: 0 }; return P; })],
};

// --- the clip being shown ---
let clip = query.get('clip') ?? 'life';
/** @type {Segment[]} */ let segs = [];
let segI = 0, segT = 0, clockT = 0, speed = 1, playing = true;
let bird = actor();
const bones = new Float32Array(MAX_BONES * 16);
const propBones = new Float32Array(16);

function startClip() {
  bird = actor();
  homeZ = 0;
  propState = null;
  segs = (LOOPS[clip] ?? LOOPS.life)();
  segI = 0; segT = 0;
  segs[0].enter?.(bird);
}

/** Circle the walk and run clips so they stay on screen. @param {Actor} a */
function circleClip(a) {
  if (clip !== 'walk' && clip !== 'run') return;
  const r = 1.1, d = a.dist * k;
  a.x = r - Math.cos(d / r) * r; a.z = Math.sin(d / r) * r; a.yaw = d / r;
}

/** The flock: seven birds round a wide circle, each with its own place and beat. */
const FLOCK = Array.from({ length: 7 }, (_, i) => {
  const h = (/** @type {number} */ s) => { let x = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(s, 0x85ebca6b); x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
  return { back: i === 0 ? 0 : 0.3 + h(1) * 1.4, side: i === 0 ? 0 : (h(2) - 0.5) * 1.6, up: (h(3) - 0.5) * 0.4, beat: h(4), lag: h(5) * 0.25, rate: 0.96 + h(6) * 0.08 };
});

/** @type {{ yaw: number, pitch: number, dist: number, target: number[] }} */
const cam = { yaw: 0.9, pitch: 0.32, dist: 2.2, target: [0, 0.2, 0] };
const VIEWS = { side: { yaw: Math.PI / 2, pitch: 0.12, dist: 1.6 }, 'three-quarter': { yaw: 0.9, pitch: 0.32, dist: 1.9 }, front: { yaw: 0.08, pitch: 0.18, dist: 1.6 },
  above: { yaw: 0.6, pitch: 1.25, dist: 2.2 }, close: { yaw: 1.1, pitch: 0.2, dist: 0.95 }, wide: { yaw: 0.8, pitch: 0.42, dist: 4.4 } };
/** @type {{ yaw: number, pitch: number, dist: number }} */ let goal = { ...VIEWS['three-quarter'] };
/** @param {keyof typeof VIEWS} v */
const setView = (v) => { goal = { ...VIEWS[v] }; };
const autoView = () => setView(clip === 'life' || clip === 'flock' || clip === 'fly' || clip === 'glide' ? 'wide' : clip === 'takeoff' || clip === 'land' ? 'wide' : clip === 'preen' || clip === 'peck' || clip.startsWith('flip') ? 'side' : 'three-quarter');

/**
 * Move everything on by dt (animation seconds) and say what to draw; realDt eases the camera.
 * @param {number} dt @param {number} realDt @returns {any[]}
 */
function step(dt, realDt) {
  clockT += dt;
  /** @type {any[]} */ const things = [];
  if (clip === 'flock' || clip === 'glide') {
    // A wide circle at 0.9 m; a glide holds the wings open all the way round.
    const R0 = 2.6, w = (FLY_MPS * k) / R0, t = clockT;
    FLOCK.slice(0, clip === 'glide' ? 1 : FLOCK.length).forEach((f, i) => {
      const th = t * w - f.back / R0, rr = R0 + f.side;
      const cyc = ((t + f.lag) % 3.2) / 3.2;
      const glide = clip === 'glide' ? 1 : Math.min(1, Math.max(0, (cyc - 0.7) * 10) * Math.max(0, (1 - cyc) * 10));
      const P = flyPose(t, t * M.flap.hz * f.rate + f.beat, glide, M);
      poseSkeleton(rig.skeleton, poseBird(rig, P, M), bones, 0);
      things.push({ mesh: plumage, place: [Math.sin(th) * rr, 0.9 + f.up - (clip === 'glide' ? 0.1 * Math.sin(t * 0.7) : 0), Math.cos(th) * rr, th + Math.PI / 2], size: k, bank: -0.4, bones: bones.slice(), shadow: 0.2 });
      if (i === 0) { cam.target = [things[0].place[0], 0.6, things[0].place[2]]; }
    });
    $('doing').textContent = clip === 'glide' ? 'gliding on open wings' : 'a flock wheeling: each bird on its own beat, gliding together';
  } else {
    let seg = segs[segI];
    segT += dt;
    while (segT >= seg.s) {
      segT -= seg.s;
      segI++;
      if (segI >= segs.length) { if (clip === 'life') { segI = 0; homeZ = bird.z; } else { startClip(); } }
      seg = segs[segI];
      seg.enter?.(bird);
      if (!seg.id.startsWith('flip') && clip !== 'life' && segI === 0) propState = null;
    }
    const t = clockT, u = segT / seg.s;
    const P = seg.step(bird, u, t, dt);
    circleClip(bird);
    poseSkeleton(rig.skeleton, poseBird(rig, P, M), bones, 0);
    things.push({ mesh: plumage, place: [bird.x, bird.y, bird.z, bird.yaw], size: k, bank: bird.bank, bones, shadow: 0.2 });
    $('doing').textContent = seg.label;
    // The camera follows the bird, low over it on the ground.
    const tg = [bird.x, 0.18 + bird.y * 0.7, bird.z];
    for (let a = 0; a < 3; a++) cam.target[a] += (tg[a] - cam.target[a]) * Math.min(1, realDt * 4);
  }
  if (propState && clip !== 'flock' && clip !== 'glide') {
    // Over away from the bird about its far edge.
    const half = (STONE.len / 2);
    const turn = propState.mesh === 'stone' ? Math.PI : Math.PI * 0.8;
    propBones.set(moveMatrix([0, 0, half], { q: [Math.sin(propState.lever * turn / 2), 0, 0, Math.cos(propState.lever * turn / 2)] }));
    things.push({ mesh: propState.mesh, place: [propState.x, 0, propState.z, propState.yaw], size: k, bones: propBones, shadow: 0.1 });
  }
  return things;
}

let last = performance.now();
function frame() {
  const now = performance.now();
  const realDt = Math.min(0.05, (now - last) / 1000);
  last = now;
  // A held frame: played up to HOLD seconds in small steps once, then still.
  if (HOLD !== null && clockT === 0) while (clockT < HOLD - 1e-9) step(Math.min(1 / 60, HOLD - clockT), 1);
  const things = step(HOLD !== null ? 0 : playing ? realDt * speed : 0, HOLD !== null ? 1 : realDt);
  let dy = goal.yaw - cam.yaw;
  dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI;
  cam.yaw += dy * 0.08; cam.pitch += (goal.pitch - cam.pitch) * 0.08; cam.dist += (goal.dist - cam.dist) * 0.08;
  if (HOLD !== null) Object.assign(cam, goal);
  stage.draw({ cam, things });
  requestAnimationFrame(frame);
}

// --- controls ---
const press = (/** @type {string} */ group, /** @type {Element} */ b) => { for (const o of $(group).querySelectorAll('button[data-' + group.replace(/s$/, '') + ']')) o.setAttribute('aria-pressed', String(o === b)); };
$('clips').addEventListener('click', (e) => {
  const b = /** @type {HTMLElement} */ (e.target).closest('button');
  if (!b?.dataset.clip) return;
  clip = b.dataset.clip;
  for (const o of $('clips').querySelectorAll('button')) o.setAttribute('aria-pressed', String(o === b));
  startClip(); autoView();
});
$('plumage').addEventListener('click', (e) => {
  const b = /** @type {HTMLElement} */ (e.target).closest('button');
  if (!b?.dataset.plumage) return;
  plumage = b.dataset.plumage;
  press('plumage', b);
});
$('speed').addEventListener('click', (e) => {
  const b = /** @type {HTMLElement} */ (e.target).closest('button');
  if (!b) return;
  if (b.id === 'play') { playing = !playing; b.textContent = playing ? 'Pause' : 'Play'; b.setAttribute('aria-pressed', String(!playing)); return; }
  speed = Number(b.dataset.speed);
  press('speed', b);
});
$('views').addEventListener('click', (e) => {
  const b = /** @type {HTMLElement} */ (e.target).closest('button');
  if (b?.dataset.view) setView(/** @type {any} */ (b.dataset.view));
});
// Drag to turn, scroll to come closer.
const view = $('view');
/** @type {{ x: number, y: number } | null} */ let drag = null;
view.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; view.setPointerCapture(e.pointerId); });
view.addEventListener('pointermove', (e) => {
  if (!drag) return;
  goal.yaw -= (e.clientX - drag.x) * 0.008; goal.pitch = Math.max(0.03, Math.min(1.45, goal.pitch + (e.clientY - drag.y) * 0.006));
  drag = { x: e.clientX, y: e.clientY };
});
view.addEventListener('pointerup', () => { drag = null; });
view.addEventListener('wheel', (e) => { e.preventDefault(); goal.dist = Math.max(0.5, Math.min(9, goal.dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });

const tris = (baked[0].indices.length / 3).toLocaleString();
$('stats').innerHTML = `<dt>Bones</dt><dd>${rig.skeleton.length} roles (body, neck, head, tail, two-part wings, two-bone legs and toes)</dd>`
  + `<dt>Triangles</dt><dd>${tris}</dd><dt>Real length</dt><dd>${R.realLengthM} m</dd><dt>Drawn length</dt><dd>${(R.realLengthM * k).toFixed(2)} m (${k}x)</dd>`;
for (const b of $('clips').querySelectorAll('button')) b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.clip === clip));
for (const b of $('plumage').querySelectorAll('button')) b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.plumage === plumage));
startClip(); autoView();
if (query.has('view')) setView(/** @type {any} */ (query.get('view')));
$('note').textContent = 'Watch the feet against the grid: they stay put on the sand while the body passes over them.';
/** @type {any} */ (window).shoreLab = { rig, R, cam, bird: () => bird, seg: () => segs[segI]?.id, setClip: (/** @type {string} */ c) => { clip = c; startClip(); autoView(); } };
requestAnimationFrame(frame);
