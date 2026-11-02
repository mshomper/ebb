// @ts-check
// The teal lab (B3 wave 3, the flight fix of November 2, 2026): Matt's teal on the small-bird rig
// (src/world/teal/model.js), drawn with the hen lab's stage, every clip of its code motion on its
// own (src/world/teal/motion.js), and Flush: the game's live flock (src/world/teal/live.js) with
// one bird on a round test pond and a pretend walker beside it every FLUSH_S, so the rise, the lap
// round the pond (leaning into the turn) and the landing can be watched.
// `?clip=fly&hold=0.2` (for screenshots): start on a clip, held that many seconds in; `?view=<name>`.

import { createStage } from './hen-lab-stage.js';
import { readGlb } from '../src/render/gltf.js';
import { buildTeal } from '../src/world/teal/model.js';
import { createTealLife } from '../src/world/teal/live.js';
import { swimPose, dabblePose, upendPose, sleepPose, risePose, tealFlyPose, splashPose } from '../src/world/teal/motion.js';
import { poseBird, preenPose } from '../src/world/creatures/bird-motion.js';
import { poseSkeleton } from '../src/world/creatures/pose.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const json = (/** @type {string} */ p) => fetch(new URL(`../recipes/${p}.json`, import.meta.url)).then((r) => r.json());
const [R, B] = await Promise.all([json('species/teal'), json('birds/teal')]);
const L = R.life, M = B.motion, k = R.body.displayScale, DEG = Math.PI / 180;
const made = await createStage(/** @type {HTMLCanvasElement} */ ($('view')));
if (made.ok === false) { $('note').textContent = `This page needs WebGPU: ${made.reason}`; throw new Error(made.reason); }
const stage = made.stage;
const glb = readGlb(await (await fetch(new URL(`../${B.model.single}`, import.meta.url))).arrayBuffer());
const built = buildTeal(glb, B);
const rig = built.rig;
await stage.setHen(built, glb);
const bones = new Float32Array(rig.skeleton.length * 16);
const query = new URLSearchParams(location.search);
const HOLD = query.has('hold') ? Number(query.get('hold')) : null;
/** The test pond: round, POND_M from its middle to its edge; the flush comes every FLUSH_S. */
const POND_M = 7, FLUSH_S = 12;
const water = (/** @type {number} */ x, /** @type {number} */ z) => ({ surface: 0, depth: Math.hypot(x, z) < POND_M ? 0.4 : 0 });
/** How low a bird on the water rides (its feet under the surface). */
const sink = -L.floatM * k;
/** Fly a turn: the radius of the lap round the pond in the game. */
const turnR = POND_M + L.circleOutM;

/** @type {string} */ let mode = 'flush';
let slow = false, t = 0, beat = 0, flushIn = 3;
const newLife = () => createTealLife({ L, P: R.presence, M, k, seed: 7, water });
let life = newLife();
/** Where the pretend walker stands this frame, or null. @type {number[] | null} */ let scare = null;

/** A bird on the water at the middle, still. */
const floating = () => ({ P: swimPose(t, 0, 0, M), x: 0, y: sink, z: 0, yaw: 0 });

/** A clip on its own: its pose, place and height. @param {number} dt */
function clip(dt) {
  t = HOLD ?? t + dt;
  beat += dt * M.flap.hz;
  const cyc = (/** @type {number} */ s) => (t % s) / s;
  if (mode === 'fly') return { P: tealFlyPose(t, beat, M), x: 0, y: 1.2, z: 0, yaw: 0 };
  if (mode === 'turn') {
    // Round the lap at the game's speed, leaning as live.js leans (as fast as it turns, up to bankDeg).
    const a = (t * L.flyMps) / turnR, P = tealFlyPose(t, beat, M);
    P.bodyRoll = -Math.min(Math.atan((L.flyMps * L.flyMps) / turnR / 9.8), M.fly.bankDeg * DEG);
    return { P, x: Math.sin(a) * turnR, y: 1.2, z: Math.cos(a) * turnR, yaw: a + Math.PI / 2 };
  }
  if (mode === 'rise') {
    // A second floating, the rise (forward as live.js carries it), a second of flight, again.
    const T = 1 + L.riseS + 1, s = t % T, h = 2.5, D = h / Math.tan(M.rise.climbDeg * DEG);
    if (s < 1) return floating();
    if (s < 1 + L.riseS) { const u = (s - 1) / L.riseS, r = risePose(t, u, beat, M); return { P: r.pose, x: 0, y: sink + r.climb * h, z: D * u, yaw: 0 }; }
    return { P: tealFlyPose(t, beat, M), x: 0, y: sink + h, z: D + (s - 1 - L.riseS) * L.flyMps * 0.3, yaw: 0 };
  }
  if (mode === 'land') {
    // The glide in, touching down halfway (motion.js TOUCH), then a second on the water.
    const u = (cyc(L.landS + 1) * (L.landS + 1)) / L.landS;
    if (u > 1) return floating();
    const s = Math.min(1, u / 0.5), h = 2;
    return { P: splashPose(t, u, M), x: 0, y: u < 0.5 ? sink + h * Math.pow(1 - s, 1.6) : sink, z: -3 * Math.pow(1 - s, 2) + (u > 0.5 ? (u - 0.5) * 0.6 : 0), yaw: 0 };
  }
  if (mode === 'swim') return { P: swimPose(t, (t * L.swimMps) / k / M.swim.strideM, 1, M), x: 0, y: sink, z: 0, yaw: 0 };
  if (mode === 'dabble') return { P: dabblePose(t, cyc(M.dabble.s), M), x: 0, y: sink, z: 0, yaw: 0 };
  if (mode === 'upend') return { P: upendPose(t, cyc(M.upend.s), M), x: 0, y: sink, z: 0, yaw: 0 };
  if (mode === 'preen') return { P: preenPose(t, cyc(M.preen.s), M), x: 0, y: sink, z: 0, yaw: 0 };
  return { P: sleepPose(t, M), x: 0, y: sink, z: 0, yaw: 0 };
}

let last = performance.now();
function frame() {
  const now = performance.now();
  let dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (slow) dt *= 0.25;
  /** @type {{ P: any, x: number, y: number, z: number, yaw: number }} */ let at;
  if (mode === 'flush') {
    // The pretend walker steps up beside the bird every FLUSH_S while it is on the water.
    const b0 = life.birds()[0];
    flushIn -= dt;
    scare = b0 && flushIn <= 0 && !life.flying(b0) && b0.mode !== 'land' ? [b0.x + 1.5, 0, b0.z] : null;
    /** @type {import('../src/world/creatures/presence.js').PresenceSource | null} */
    const w = scare ? { id: 'walker', kind: 'walker', pos: [scare[0], 0, scare[2]], speed: 1, editing: false, edits: [], stillS: 0, body: true } : null;
    const said = life.step(dt, { count: 1, pond: { x: 0, z: 0, r: POND_M * 0.9 }, night: false, walker: w, trust: 0, band: 0, placeNow: true });
    if (said.includes('flushed')) flushIn = FLUSH_S;
    const b = life.birds()[0];
    at = b ? { P: b.pose, x: b.x, y: sink + b.y, z: b.z, yaw: b.yaw } : floating();
    $('mode').textContent = b ? `${b.mode}${b.mode === 'fly' ? `, leaning ${Math.round(Math.abs(b.roll) / DEG)}°` : ''}` : '';
  } else {
    at = clip(dt);
    $('mode').textContent = mode;
  }
  poseSkeleton(rig.skeleton, poseBird(rig, at.P ?? swimPose(0, 0, 0, M), M), bones, 0);
  stage.draw(dt, { x: at.x, y: at.y, z: at.z, yaw: at.yaw, size: k, cut: 0.5, bones, ringM: 0,
    walker: mode === 'flush' && scare ? { x: scare[0], z: scare[2] } : null, groundHalf: 24, follow: true });
  requestAnimationFrame(frame);
}

for (const b of document.querySelectorAll('[data-mode]')) {
  b.addEventListener('click', () => {
    mode = /** @type {HTMLElement} */ (b).dataset.mode ?? 'flush';
    t = 0;
    if (mode === 'flush') { life = newLife(); flushIn = 3; }
    for (const o of document.querySelectorAll('[data-mode]')) o.setAttribute('aria-pressed', String(o === b));
    stage.setView(['flush', 'turn', 'rise', 'land'].includes(mode) ? 'three-quarter' : 'side');
    $('note').textContent = mode === 'flush' ? 'The walker steps up every 12 seconds.' : '';
  });
}
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => stage.setView(/** @type {any} */ (/** @type {HTMLElement} */ (b).dataset.view)));
$('slow').addEventListener('click', () => { slow = !slow; $('slow').setAttribute('aria-pressed', String(slow)); });
$('stats').innerHTML = `<dt>Drawn length</dt><dd>${(0.36 * k).toFixed(2)} m (${k} times real)</dd><dt>Triangles</dt><dd>${(built.indices.length / 3).toLocaleString()}</dd>`
  + `<dt>Flying</dt><dd>neck ${M.fly.neckDeg}° forward, body ${M.fly.bodyDeg}° down, leaning up to ${M.fly.bankDeg}°</dd><dt>Rise</dt><dd>${L.riseS} s, climbing at ${M.rise.climbDeg}°</dd>`;
stage.setView('three-quarter');
$('note').textContent = 'The walker steps up every 12 seconds.';
if (query.has('clip')) /** @type {HTMLElement | null} */ (document.querySelector(`[data-mode="${query.get('clip')}"]`))?.click();
if (query.has('view')) stage.setView(/** @type {any} */ (query.get('view')));
requestAnimationFrame(frame);
