// @ts-check
// ebb spring rigs lab (the creature rigging rule, m2-rigs-spring): the spring creatures at their
// drawn size, one looping view per motion, posed by the game's own code: froglets on the frog's rig
// (froglets.js, motion.js frogMoves), and the toad on the same rig with its own proportions\n// (toad-walk.js); the slow worm on its chain of bones (slowworm.js). Click a view to see it big. `?strip=<creature>` lays out one
// motion as a row of still frames instead (the frame strips Matt approves before a commit).

import { run } from '../src/core/workers.js';
import { poseSkeleton, axisAngle } from '../src/world/creatures/pose.js';
import { MAX_BONES, bodyFor } from '../src/world/creatures/bodies.js';
import { frogMoves, legsOf } from '../src/world/creatures/motion.js';
import { frogletHop, landSquash } from '../src/world/creatures/froglets.js';
import { toadMoves, toadPhase } from '../src/world/creatures/toad-walk.js';
import { slowwormBody, tongueBody, poseSlowworm, tongueOut } from '../src/world/creatures/slowworm.js';
import { createStage, VIEWS } from './turtle-lab-stage.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const BAKE = { module: './world/creatures/bodies.js', fn: 'bakeVariant' };
const load = (/** @type {string} */ id) => fetch(`../recipes/species/${id}.json`).then((r) => r.json());
const [FROG, SPAWN, TOAD, WORM] = await Promise.all([load('frog'), load('frogspawn'), load('toad'), load('slowworm')]);
const FL = SPAWN.body.froglet;
const params = new URLSearchParams(location.search);

/**
 * A pose this instant: the bone matrices, where the body is (x, y, z, yaw) and what it is doing.
 * @typedef {{ bones: Float32Array, place: number[], note: string }} Frame
 * @typedef {{ id: string, creature: string, title: string, mesh: string, scale: number, target: number[], dist: number,
 *   loopS: number, at: (t: number) => Frame | null, strip?: number[], stripDist?: number, meshes?: string[], stripFixed?: boolean }} Clip
 *   meshes: more meshes drawn on the same bones (the slow worm's tongue); stripFixed: a strip's camera stays put
 *   instead of following the body
 *   stripDist: the camera's distance in a strip (half dist when left out)
 */

// --- the meshes and rigs, baked by the game's own worker job ---
/** @type {Record<string, any>} */ const rigs = {};
/** @type {ReturnType<typeof legsOf> | null} */ let frogLegs = null;
/** @type {ReturnType<typeof legsOf> | null} */ let toadLegs = null;

// --- froglets ---
const FROGLET_SIZE = FL.frogletScale * FL.displayScale;
const HOP_EVERY_S = 1.6;   // the lab's pace: a hop every so often, in real seconds
const HOP_M = (FL.hopM[0] + FL.hopM[1]) / 2;
/** A froglet t seconds into the lab's loop of hops. @param {number} t @param {number} id */
function froglet(t, id) {
  if (!rigs.frog || !frogLegs) return null;
  const hop = frogletHop(t / HOP_EVERY_S, HOP_EVERY_S, FL);
  const along = (hop.n % 4 + Math.max(0, hop.hopT)) * HOP_M - HOP_M * 2;
  const y = hop.hopT >= 0 ? Math.sin(hop.hopT * Math.PI) * FL.hopHeightM : 0;
  const sq = hop.sitS >= 0 ? landSquash(hop.sitS, FROG.motion.squash) : 0;
  const bones = new Float32Array(MAX_BONES * 16);
  poseSkeleton(rigs.frog, frogMoves(rigs.frog, frogLegs, { id, hopT: hop.hopT, kick: -1, sq, sac: 0, swimming: false }, t, FROG.motion), bones, 0);
  const note = hop.hopT >= 0 ? (hop.hopT < 0.2 ? 'take-off: hind legs push out' : hop.hopT < 0.6 ? 'in the air, legs reaching' : 'legs folding in to land')
    : hop.sitS < 0.25 ? 'landing squash' : 'sitting: throat breathing, a blink now and then';
  return { bones, place: [0, y, along, 0], note };
}

// --- the toad ---
const TS = TOAD.body.displayScale;
// Its walking pace in the game: walk.mPerH meters a game hour, an hour a real minute at 1x.
const TOAD_MPS = TOAD.walk.mPerH / 60;
const TOAD_STRIDE_S = (TOAD.motion.walk.strideM * TS) / TOAD_MPS;
/** A toad t seconds into its walk (or sitting). @param {number} t @param {boolean} walking */
function toad(t, walking) {
  if (!rigs.toad || !toadLegs) return null;
  const walked = walking ? t * TOAD_MPS : 0;
  const bones = new Float32Array(MAX_BONES * 16);
  const ph = toadPhase(walked, TOAD.motion, TS);
  poseSkeleton(rigs.toad, toadMoves(rigs.toad, toadLegs, { id: 2, ph, walking: walking ? 1 : 0 }, t, TOAD.motion), bones, 0);
  const s = ph % 1;
  const note = !walking ? 'sitting at the water: breathing, throat pulsing, blinking'
    : s < 0.5 ? 'front left and hind right push back; the others step forward'
      : 'front right and hind left push back; the others step forward';
  return { bones, place: [0, 0, (walked % (TOAD_MPS * TOAD_STRIDE_S * 3)) - 0.1, 0], note };
}

// --- the slow worm ---
const WS = WORM.body.displayScale, WM = WORM.motion;
/** A slow worm t seconds in, slid slidM along itself. @param {number} t @param {number} slidM @param {string} note */
function worm(t, slidM, note) {
  if (!rigs.slowworm) return null;
  const bones = new Float32Array(MAX_BONES * 16);
  poseSkeleton(rigs.slowworm, poseSlowworm(rigs.slowworm, { id: 4, t, slidM }, WORM.body, WM, axisAngle), bones, 0);
  const flick = tongueOut(t, 4, WM.tongue);
  return { bones, place: [0, 0, slidM, 0], note: flick > 0.05 ? 'a tongue flick, the head lifted a touch' : note };
}
// The lab's slide: along itself and back over slideS each way, a pause between (as the game's).
const WORM_LOOP_S = WM.slideS * 2 + 4;
const wormSlide = (/** @type {number} */ t) => { const k = (t % WORM_LOOP_S) / WM.slideS; return WM.slideM * 2 * Math.min(1, Math.max(0, k)) * (1 - Math.min(1, Math.max(0, k - 1))); };

/** @type {Clip[]} */
const CLIPS = [
  { id: 'froglet-hop', creature: 'froglet', title: 'Froglet: hopping away', mesh: 'frog', scale: FROGLET_SIZE, target: [0, 0.02, 0], dist: 0.42, loopS: HOP_EVERY_S * 4,
    at: (t) => froglet(t, 7),
    // A strip through one hop: just before, take-off, mid-air, folding, landing and the squash ringing down.
    strip: [HOP_EVERY_S * 2 - 0.05, HOP_EVERY_S * 2 + 0.03, HOP_EVERY_S * 2 + 0.09, HOP_EVERY_S * 2 + 0.15, HOP_EVERY_S * 2 + 0.22, HOP_EVERY_S * 2 + 0.29,
      HOP_EVERY_S * 2 + 0.33, HOP_EVERY_S * 2 + 0.38, HOP_EVERY_S * 2 + 0.48, HOP_EVERY_S * 2 + 0.9] },
  { id: 'froglet-sit', creature: 'froglet', title: 'Froglet: sitting, breathing', mesh: 'frog', scale: FROGLET_SIZE, target: [0, 0.015, 0.012], dist: 0.2, loopS: 12,
    at: (t) => { const f = froglet(HOP_EVERY_S * 0.9, 3); if (!f) return null; const bones = new Float32Array(MAX_BONES * 16);
      poseSkeleton(rigs.frog, frogMoves(rigs.frog, /** @type {any} */ (frogLegs), { id: 3, hopT: -1, kick: -1, sq: 0, sac: 0, swimming: false }, t, FROG.motion), bones, 0);
      return { bones, place: [0, 0, 0, 0], note: 'throat pulsing, body breathing, a blink every few seconds' }; } },
  { id: 'toad-walk', creature: 'toad', title: 'Toad: its slow walk', mesh: 'toad', scale: TS, target: [0, 0.04, 0.05], dist: 0.75, loopS: TOAD_STRIDE_S * 3,
    at: (t) => toad(t, true),
    // A strip through one whole stride, both diagonal pairs.
    strip: Array.from({ length: 9 }, (_, i) => TOAD_STRIDE_S * (1 + i / 9)), stripDist: 0.5 },
  { id: 'toad-sit', creature: 'toad', title: 'Toad: sitting at the water', mesh: 'toad', scale: TS, target: [0, 0.04, 0.04], dist: 0.5, loopS: 12,
    at: (t) => toad(t, false) },
  { id: 'worm-slide', creature: 'slowworm', title: 'Slow worm: slithering along', mesh: 'slowworm', meshes: ['slowworm-tongue'], scale: WS, target: [0, 0.01, 0.03], dist: 0.95, loopS: WORM_LOOP_S,
    at: (t) => worm(t, wormSlide(t), wormSlide(t) > 0 && (t % WORM_LOOP_S) < WM.slideS * 2 ? 'sliding along itself; the S stays put on the ground' : 'resting in its S, breathing'),
    // A strip through a slide: the body moves through its S, which keeps its place.
    strip: Array.from({ length: 9 }, (_, i) => 0.05 + i * (WM.slideS / 8)), stripDist: 1.15, stripFixed: true },
  { id: 'worm-tongue', creature: 'slowworm', title: 'Slow worm: tongue flicks', mesh: 'slowworm', meshes: ['slowworm-tongue'], scale: WS, target: [0, 0.012, 0.25], dist: 0.22, loopS: 20,
    at: (t) => worm(t, 0, 'resting, breathing; a tongue flick every few seconds') },
];

// --- the page ---
const strip = params.get('strip');
const shown = strip ? CLIPS.filter((c) => c.creature === strip && c.strip).slice(0, 1) : CLIPS;
const grid = $('grid');
if (strip) grid.classList.add('strip');
/** @type {{ clip: Clip, t: number | null, canvas: HTMLCanvasElement, note: HTMLElement, view?: any }[]} */
const panels = [];
for (const clip of shown) {
  for (const t of strip ? clip.strip ?? [] : [null]) {
    const card = document.createElement('section');
    card.className = 'card panel';
    card.innerHTML = `<h2>${t === null ? clip.title : `${(t - (clip.strip?.[0] ?? 0)).toFixed(2)} s`}</h2><canvas aria-label="${clip.title}"></canvas><p class="note">-</p>`;
    grid.appendChild(card);
    if (!strip) card.querySelector('canvas')?.addEventListener('click', () => card.classList.toggle('big'));
    if (params.get('big') === clip.id) card.classList.add('big');
    panels.push({ clip, t, canvas: /** @type {HTMLCanvasElement} */ (card.querySelector('canvas')), note: /** @type {HTMLElement} */ (card.querySelector('.note')) });
  }
}
if (strip) $('lead').textContent = `${shown[0]?.title ?? strip}: still frames through one motion, left to right, times from the first.`;

const made = await createStage(panels[0].canvas, FROG.body);
if (!made.ok) { $('status').textContent = `WebGPU is not available here (${made.reason}).`; throw new Error('no WebGPU'); }
const stage = made.stage;
for (const p of panels) p.view = stage.view(p.canvas);
$('status').textContent = 'Baking (a few seconds)';
const frogLods = FROG.bake.lods ?? [{ cellM: FROG.bake.cellM }];
run(BAKE, { id: 'slowworm', body: slowwormBody(WORM.body), variant: 0, cellM: WORM.bake.cellM }).then((r) => { stage.setMesh(r, 'slowworm'); rigs.slowworm = r.bones; });
run(BAKE, { id: 'slowworm-tongue', body: tongueBody(WORM.body, WM.tongue), variant: 0, cellM: WM.tongue.radiusM / 1.5 }).then((r) => stage.setMesh(r, 'slowworm-tongue'));
run(BAKE, { id: 'toad', body: TOAD.body, variant: 0, cellM: TOAD.bake.cellM }).then((r) => {
  stage.setMesh(r, 'toad'); rigs.toad = r.bones;
  const prims = bodyFor('toad', TOAD.body, 0).prims;
  const tip = (/** @type {string} */ side) => prims.find((/** @type {any} */ q) => q.bone === `foot.${side}`).b;
  toadLegs = legsOf(r.bones, { l: tip('l'), r: tip('r') });
});
run(BAKE, { id: 'frog', body: FROG.body, variant: 0, cellM: frogLods[0].cellM }).then((r) => {
  stage.setMesh(r, 'frog'); rigs.frog = r.bones;
  const prims = bodyFor('frog', FROG.body, 0).prims;
  const tip = (/** @type {string} */ side) => prims.find((/** @type {any} */ q) => q.bone === `foot.${side}`).b;
  frogLegs = legsOf(r.bones, { l: tip('l'), r: tip('r') });
  $('status').textContent = 'Every view loops; the poses are the game\'s own.';
});

// --- controls ---
let speed = 1, playing = true, viewName = /** @type {keyof typeof VIEWS} */ (strip ? 'side' : 'three-quarter');
const cam = { ...VIEWS[viewName] };
$('speed').addEventListener('click', (e) => {
  const b = /** @type {HTMLElement} */ (e.target).closest('button');
  if (!b) return;
  if (b.id === 'play') { playing = !playing; b.textContent = playing ? 'Pause' : 'Play'; return; }
  speed = Number(b.dataset.speed);
  for (const x of $('speed').querySelectorAll('[data-speed]')) x.setAttribute('aria-pressed', String(x === b));
});
$('views').addEventListener('click', (e) => {
  const b = /** @type {HTMLElement} */ (e.target).closest('button');
  if (!b?.dataset.view) return;
  viewName = /** @type {keyof typeof VIEWS} */ (b.dataset.view);
  for (const x of $('views').querySelectorAll('[data-view]')) x.setAttribute('aria-pressed', String(x === b));
});

let clockT = 0, last = performance.now();
/** @type {any} */ (window).springLab = { panels, CLIPS, setT: (/** @type {number} */ t) => { clockT = t; } };
function frame() {
  const now = performance.now();
  if (playing) clockT += Math.min(0.1, (now - last) / 1000) * speed;
  last = now;
  const goal = VIEWS[viewName];
  let dy = goal.yaw - cam.yaw;
  dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI;
  cam.yaw += dy * 0.12; cam.pitch += (goal.pitch - cam.pitch) * 0.12;
  for (const p of panels) {
    const c = p.clip;
    const fr = c.at(p.t ?? clockT % c.loopS);
    if (!fr) continue;
    if (p.note.textContent !== fr.note) p.note.textContent = fr.note;
    // In a strip the camera follows the body along, so every frame is framed the same.
    const target = strip && !c.stripFixed ? [fr.place[0] + c.target[0], c.target[1], fr.place[2] + c.target[2]] : c.target;
    p.view.draw({ cam: { yaw: cam.yaw, pitch: cam.pitch, dist: (/** @type {any} */ (goal).close ? 0.5 : 1) * (strip ? c.stripDist ?? c.dist * 0.5 : c.dist), target }, place: fr.place, scale: c.scale, dry: 0,
      water: null, floorY: 0, ledge: null, ring: [0, 0, 0, 0], bones: fr.bones, look: [1, 1, 1], baked: true, mesh: [c.mesh, ...(c.meshes ?? [])] });
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
