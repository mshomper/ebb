// @ts-check
// ebb turtle lab (M2 turtle life, TL1; docs 11, 12): the European pond turtle at its drawn size
// (displayScale), one view per motion, side by side, each looping: the swim stroke, the periscope,
// the walk, the haul-out, basking (drying from wet to matte, with a yawn), the slide off with its
// plop, grazing, and peeking up then ducking under; and the common lizard (LZ): basking, darting when\n// you come close, running. Every pose comes from the game's own rig
// (src/world/creatures/rigs/turtle.js) and every number from recipes/species/turtle.json, so what
// moves here is what moves on the island.

import { run } from '../src/core/workers.js';
import { poseSkeleton, axisAngle } from '../src/world/creatures/pose.js';
import { MAX_BONES } from '../src/world/creatures/bodies.js';
import { poseState, poseTurtle, haulPath, haulPart, haulS, slidePath, noseY } from '../src/world/creatures/rigs/turtle.js';
import { poseLizard } from '../src/world/creatures/rigs/lizard.js';
import { createLizards } from '../src/world/creatures/lizard-live.js';
import { createStage, VIEWS } from './turtle-lab-stage.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const BAKE = { module: './world/creatures/bodies.js', fn: 'bakeVariant' };
const R = await fetch('../recipes/species/turtle.json').then((r) => r.json());
const M = R.motion, P = M.pose, S = R.body.displayScale;
const WS = R.body.wetSpecular;
const LOOK = [WS.wetDarken ?? 1, 1, (WS.dryStrength ?? WS.strength) / WS.strength];
const DEG = Math.PI / 180;
const smooth = (/** @type {number} */ x) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };
const lerp = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ k) => a + (b - a) * k;
/** Quaternion product p * q. @param {number[]} p @param {number[]} q */
const qmul = (p, q) => [
  p[3] * q[0] + p[0] * q[3] + p[1] * q[2] - p[2] * q[1], p[3] * q[1] - p[0] * q[2] + p[1] * q[3] + p[2] * q[0],
  p[3] * q[2] + p[0] * q[1] - p[1] * q[0] + p[2] * q[3], p[3] * q[3] - p[0] * q[0] - p[1] * q[1] - p[2] * q[2]];

// In the water views the surface is at 0; a swimmer's shell top sits just under it.
const SWIM_Y = -M.swim.surfaceM * S;
const LEDGE = { half: 0.32, from: 0, to: 0.55, top: 0.07 };

/**
 * @typedef {{ f: any, place: number[], dry?: number, ring?: number[], note: string, M?: any }} Frame
 * @typedef {{ id: string, title: string, loopS: number, water: number | null, floorY: number, ledge: number[] | null,
 *   target: number[], dist: number, at: (t: number, f: any) => Frame }} Clip
 */

/** A pose state for a clip (kept across frames, as a turtle's is). @param {number} id */
const fresh = (id) => poseState(id, 'swim');
const only = (/** @type {any} */ f, /** @type {Record<string, number>} */ w) => { for (const k of Object.keys(f.w)) f.w[k] = w[k] ?? 0; };

/** Nose at the surface: the body's height for a periscope. @param {any} f */
const periY = (f) => P.peri.noseM * S - noseY(R.body.bones, f, M) * S;

/** @type {Clip[]} */
const CLIPS = [
  { id: 'swim', title: 'Swimming stroke', loopS: P.swim.strokeS * 2, water: 0, floorY: -0.3, ledge: null, target: [0, -0.04, 0.02], dist: 0.62,
    at(t, f) {
      only(f, { swim: 1 }); f.mode = 'swim'; f.stroke = 1; f.ph = t / P.swim.strokeS; f.pitch = 3 * DEG;
      const p = f.ph % 1;
      const note = p < P.swim.power ? 'front left and hind right sweep' : p < P.swim.power + P.swim.pairGap ? 'then the other pair' : p < 1 - P.swim.recover ? 'glide, flippers laid back' : 'flippers come forward, edge-on';
      return { f, place: [0, SWIM_Y, 0, 0], note };
    } },
  { id: 'peri', title: 'Periscope', loopS: 10, water: 0, floorY: -0.35, ledge: null, target: [0, -0.04, 0.05], dist: 0.62,
    at(t, f) {
      only(f, { peri: 1 }); f.mode = 'peri'; f.pitch = P.peri.pitchDeg * DEG;
      // Hanging still, nose and eyes out, looking about; for a while it turns to face you.
      f.look = t < 6 ? 0.55 * Math.sin(t * 0.9) : lerp(0.55 * Math.sin(6 * 0.9), -1.1, smooth((t - 6) / 1.2));
      f.lookUp = 0;
      return { f, place: [0, periY(f), 0, 0], note: t < 6 ? 'nose and eyes out, looking about' : 'turned to face you' };
    } },
  { id: 'walk', title: 'Walking on land', loopS: P.walk.strideS * 2, water: null, floorY: 0, ledge: null, target: [0, 0.03, 0.02], dist: 0.58,
    at(t, f) {
      only(f, { walk: 1 }); f.mode = 'walk'; f.ph = t / P.walk.strideS; f.pitch = 0;
      f.look = 0.15 * Math.sin(t * 0.7);
      const s = f.ph % 0.5;
      return { f, place: [0, 0, 0, 0], dry: 0.7, note: s < 0.5 * P.walk.stance ? 'diagonal pair planted, pushing' : 'diagonal pair stepping' };
    } },
  { id: 'haul', title: 'Hauling out', loopS: 1.5 + haulS(P) + 3, water: 0, floorY: -0.25, ledge: [LEDGE.half, -LEDGE.to, -LEDGE.from, LEDGE.top], target: [0, 0.02, 0.0], dist: 0.85,
    at(t, f) {
      const from = { z: 0.16, y: SWIM_Y }, to = { z: -0.16, y: LEDGE.top };
      if (t < 1.5) {
        only(f, { swim: 1 }); f.mode = 'swim'; f.stroke = 1; f.ph = t / P.swim.strokeS; f.pitch = 3 * DEG;
        return { f, place: [0, from.y, lerp(0.45, from.z, smooth(t / 1.5)), Math.PI], note: 'swimming up to the stone' };
      }
      const k = Math.min(1, (t - 1.5) / haulS(P));
      const into = smooth((t - 1.5) / 0.4);
      f.haulK = k; f.mode = 'haul';
      const after = smooth((t - 1.5 - haulS(P)) / 1.2);
      only(f, { swim: 1 - into, haul: into * (1 - after), bask: after });
      const p = haulPath(k, P);
      f.pitch = p.pitch;
      const names = ['front claws reach over the edge', 'the shell tips up', 'hind legs heave it over', 'a pause, getting its breath'];
      return { f, place: [0, lerp(from.y, to.y, p.v), lerp(from.z, to.z, p.h), Math.PI], dry: 0, note: k >= 1 ? 'settling to bask' : names[haulPart(k, P).part] };
    } },
  { id: 'bask', title: 'Basking, drying in the sun', loopS: 26, water: null, floorY: 0, ledge: null, target: [0, 0.03, 0.03], dist: 0.58,
    at(t, f) {
      only(f, { bask: 1 }); f.mode = 'bask'; f.pitch = 0;
      f.look = 0.5 * Math.sin(t * 0.35) + 0.2 * Math.sin(t * 0.9);
      const dry = smooth(t / 20);
      // A yawn in every loop here (rare in the game: every one to three minutes).
      const yawning = (t % 13) < P.yawn.s;
      return { f, place: [0, 0, 0, 0], dry, note: yawning ? 'a yawn' : dry < 0.3 ? 'wet and glossy, breathing' : dry < 0.85 ? 'drying' : 'dry and matte, breathing',
        M: { ...M, pose: { ...P, yawn: { ...P.yawn, everyS: [13, 13] } } } };
    } },
  { id: 'slide', title: 'Slipping off, with a plop', loopS: 1.5 + P.slide.s + 3, water: 0, floorY: -0.25, ledge: [LEDGE.half, -LEDGE.to, -LEDGE.from, LEDGE.top], target: [0, 0.0, 0.05], dist: 0.85,
    at(t, f) {
      // Basking facing the water, as they do, so one push takes it in.
      const from = { z: -0.13, y: LEDGE.top }, to = { z: 0.26, y: SWIM_Y - 0.02 };
      if (t < 1.5) {
        only(f, { bask: 1 }); f.mode = 'bask'; f.pitch = 0;
        return { f, place: [0, from.y, from.z, 0], dry: 0.9, note: 'basking' };
      }
      const k = Math.min(1, (t - 1.5) / P.slide.s);
      if (k < 1) {
        f.slideK = k; f.mode = 'slide';
        const into = smooth(k * 4);
        only(f, { bask: 1 - into, slide: into });
        const p = slidePath(k, P);
        f.pitch = p.pitch;
        return { f, place: [0, lerp(from.y, to.y, p.v), lerp(from.z, to.z, p.h), 0], dry: 0.9, note: 'slipping off' };
      }
      const u = t - 1.5 - P.slide.s;
      only(f, { slide: 1 - smooth(u / 0.6), swim: smooth(u / 0.6), tuck: 0.5 * smooth(u / 0.6) });
      f.mode = 'hide'; f.stroke = 1; f.ph = u / P.swim.strokeS; f.pitch = -12 * DEG * (1 - smooth(u / 2));
      const ring = [0, 0.12, 0.04 + u * 0.18, Math.max(0, 1 - u / 1.6)];
      return { f, place: [0, to.y - u * 0.05, to.z + u * 0.06, 0], dry: 0, ring, note: u < 0.8 ? 'plop' : 'under, and away' };
    } },
  { id: 'graze', title: 'Grazing pondweed', loopS: P.graze.biteS * 3, water: 0, floorY: -0.3, ledge: null, target: [0, -0.07, 0.05], dist: 0.62,
    at(t, f) {
      only(f, { swim: 0.6, graze: 1 }); f.mode = 'graze'; f.stroke = 0; f.ph = t / P.swim.strokeS; f.pitch = -10 * DEG;
      return { f, place: [0, SWIM_Y - 0.03, 0, 0], note: 'head down, biting' };
    } },
  { id: 'peek', title: 'Peeking up, ducking under', loopS: 8, water: 0, floorY: -0.4, ledge: null, target: [0, -0.06, 0.05], dist: 0.7,
    at(t, f) {
      // Under and tucked, up to the periscope, a long look your way, then down again.
      const up = smooth((t - 1.2) / 1.0) * (1 - smooth((t - 6.2) / 0.7));
      only(f, { swim: 1 - up, tuck: 0.6 * (1 - up), peri: up }); f.mode = up > 0.5 ? 'peek' : 'hide';
      f.stroke = 0.3; f.ph = t / P.swim.strokeS;
      f.pitch = lerp(-6 * DEG, P.peri.pitchDeg * DEG, up);
      f.look = up * -0.9 * smooth((t - 2.4) / 1);
      const y = lerp(-0.16, periY(f), up);
      return { f, place: [0, y, 0, 0], note: t < 1.2 ? 'under, tucked' : t < 2.3 ? 'rising' : t < 6.2 ? 'a long look at you' : 'ducking under' };
    } },
];

// --- the page ---
const grid = $('grid');
/** @type {{ clip: Clip, canvas: HTMLCanvasElement, note: HTMLElement, f: any, view?: any }[]} */
const panels = CLIPS.map((clip, i) => {
  const card = document.createElement('section');
  card.className = 'card panel';
  card.innerHTML = `<h2>${clip.title}</h2><canvas aria-label="${clip.title}"></canvas><p class="note">-</p>`;
  grid.appendChild(card);
  // A click on a view makes it big (the whole row), another click puts it back; ?big=<id> opens one so.
  card.querySelector('canvas')?.addEventListener('click', () => card.classList.toggle('big'));
  if (new URLSearchParams(location.search).get('big') === clip.id) card.classList.add('big');
  return { clip, canvas: /** @type {HTMLCanvasElement} */ (card.querySelector('canvas')), note: /** @type {HTMLElement} */ (card.querySelector('.note')), f: fresh(i + 1) };
});

const made = await createStage(panels[0].canvas, R.body);
if (!made.ok) {
  $('status').textContent = `WebGPU is not available here (${made.reason}). Open this page in current Chrome or Edge.`;
  throw new Error('no WebGPU');
}
const stage = made.stage;
for (const p of panels) p.view = stage.view(p.canvas);

/** @type {{ name: string, parent: number, pivot: number[] }[]} */ let rig = [];
$('status').textContent = 'Baking the turtle (a few seconds)';
run(BAKE, { id: 'turtle', body: R.body, variant: 0, cellM: 0.005 }).then((r) => { if (!rig.length) { stage.setMesh(r); rig = r.bones; } });
run(BAKE, { id: 'turtle', body: R.body, variant: 0, cellM: R.bake.lods[0].cellM }).then((r) => {
  stage.setMesh(r); rig = r.bones;
  $('status').textContent = `${r.count.toLocaleString()} vertices, ${rig.length} bones, drawn at ${S}x real size (${(0.184 * S * 100).toFixed(0)} cm long). Every view loops.`;
});

// --- controls ---
let speed = 1, playing = true, baked = false, viewName = /** @type {keyof typeof VIEWS} */ ('three-quarter');
const cam = { ...VIEWS[viewName] };
$('speed').addEventListener('click', (e) => {
  const b = /** @type {HTMLElement} */ (e.target).closest('button');
  if (!b) return;
  if (b.id === 'plates') { baked = !baked; b.setAttribute('aria-pressed', String(baked)); return; }
  if (b.id === 'play') { playing = !playing; b.textContent = playing ? 'Pause' : 'Play'; b.setAttribute('aria-pressed', String(!playing)); return; }
  speed = Number(b.dataset.speed);
  for (const x of $('speed').querySelectorAll('[data-speed]')) x.setAttribute('aria-pressed', String(x === b));
});
$('views').addEventListener('click', (e) => {
  const b = /** @type {HTMLElement} */ (e.target).closest('button');
  if (!b?.dataset.view) return;
  viewName = /** @type {keyof typeof VIEWS} */ (b.dataset.view);
  for (const x of $('views').querySelectorAll('[data-view]')) x.setAttribute('aria-pressed', String(x === b));
});

const mats = new Float32Array(MAX_BONES * 16);
// The lizard section below starts once its recipe is in.
let lizardsReady = false;
let clockT = 0, last = performance.now();
/** @type {any} */ (window).turtleLab = { panels, CLIPS, setT: (/** @type {number} */ t) => { clockT = t; } };
function frame() {
  const now = performance.now();
  if (playing) clockT += Math.min(0.1, (now - last) / 1000) * speed;
  last = now;
  const goal = VIEWS[viewName];
  let dy = goal.yaw - cam.yaw;
  dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI;
  cam.yaw += dy * 0.12; cam.pitch += (goal.pitch - cam.pitch) * 0.12;
  if (rig.length) {
    for (const p of panels) {
      const c = p.clip, t = clockT % c.loopS;
      p.f.t = clockT;
      p.f.look = 0; p.f.lookUp = 0; p.f.jaw = 0;
      const fr = c.at(t, p.f);
      const q = qmul(axisAngle([1, 0, 0], -fr.f.pitch), axisAngle([0, 0, 1], fr.f.roll));
      poseSkeleton(rig, poseTurtle(rig, fr.f, fr.M ?? M, q, axisAngle), mats, 0);
      if (p.note.textContent !== fr.note) p.note.textContent = fr.note;
      // Close on the head: follow it about (where the head is at rest, turned with the body).
      const close = /** @type {any} */ (goal).close;
      const [px, py, pz, yw] = fr.place;
      const target = close ? [px + Math.sin(yw) * 0.13 * S, py + 0.03 * S, pz + Math.cos(yw) * 0.13 * S] : c.target;
      p.view.draw({ cam: { yaw: cam.yaw + (close ? yw : 0), pitch: cam.pitch, dist: close ? 0.22 : c.dist, target }, place: fr.place, scale: S, dry: fr.dry ?? 0,
        water: c.water, floorY: c.floorY, ledge: c.ledge, ring: fr.ring ?? [0, 0, 0, 0], bones: mats, look: LOOK, baked });
    }
  }
  if (lizardsReady) drawLizards(0, goal);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- the common lizard (LZ): its own lives, stepped as the game steps them ---
const LR = await fetch('../recipes/species/lizard.json').then((r) => r.json());
const SL = LR.body.displayScale;
const STONE = { half: 0.1, top: 0.05 };
/** A lizard with no stone bounds: the ground is the floor, the stone a box at the middle. */
const lizardWorld = () => createLizards({ R: { ...LR, motion: { ...LR.motion, pushEveryS: [4, 8] } }, ground: () => 0 });
const HOME = { x: 0, y: STONE.top, z: 0, yaw: 0.5, r: STONE.half };
/**
 * @typedef {{ id: string, title: string, target: number[], dist: number, life: ReturnType<typeof createLizards> | null,
 *   cycleS: number, near?: (t: number) => any[], note: (L: any) => string }} LizardClip
 */
/** @type {LizardClip[]} */
const LCLIPS = [
  { id: 'lz-bask', title: 'Lizard: basking sprawl', target: [0, 0.06, 0], dist: 0.42, life: lizardWorld(), cycleS: 0,
    note: (L) => (L.push > 0.05 ? 'a push-up display' : 'sprawled, breathing, head in quick small jerks') },
  { id: 'lz-dart', title: 'Lizard: you come close', target: [0, 0.05, 0], dist: 0.9, life: lizardWorld(), cycleS: 40,
    // Someone walks up beside its stone for a moment each cycle.
    near: (t) => (t > 2 && t < 3 ? [{ body: true, pos: [0.7, 0.4, 0.4], speed: 1, edits: [], stillS: 0 }] : []),
    note: (L) => ({ bask: 'basking', dart: 'darting off the stone', hide: 'waiting low, watching', back: 'coming back in short bursts' })[/** @type {'bask'} */ (L.mode)] },
  { id: 'lz-run', title: 'Lizard: running gait', target: [0, 0.02, 0], dist: 0.42, life: null, cycleS: 0,
    note: () => 'diagonal pairs sweep out to the side; spine and tail wave' },
];
const lgrid = $('lizards');
const lpanels = LCLIPS.map((clip, i) => {
  const card = document.createElement('section');
  card.className = 'card panel';
  card.innerHTML = `<h2>${clip.title}</h2><canvas aria-label="${clip.title}"></canvas><p class="note">-</p>`;
  lgrid.appendChild(card);
  card.querySelector('canvas')?.addEventListener('click', () => card.classList.toggle('big'));
  if (new URLSearchParams(location.search).get('big') === clip.id) card.classList.add('big');
  const canvas = /** @type {HTMLCanvasElement} */ (card.querySelector('canvas'));
  clip.life?.get(clip.id, 0x5eed + i * 977, HOME);
  return { clip, canvas, note: /** @type {HTMLElement} */ (card.querySelector('.note')), view: stage.view(canvas), t: 0,
    run: { id: 9, t: 0, look: 0, lookUp: 0, push: 0, run: 1, ph: 0, curl: 1 } };
});
/** @type {any[]} */ let lrig = [];
run(BAKE, { id: 'lizard', body: LR.body, variant: 0, cellM: LR.bake.cellM }).then((r) => { stage.setMesh(r, 'lizard'); lrig = r.bones; });
const lmats = new Float32Array(MAX_BONES * 16);
let lastL = performance.now();
/** @param {number} _dt @param {any} goal */
function drawLizards(_dt, goal) {
  const now = performance.now(), dt = playing ? Math.min(0.1, (now - lastL) / 1000) * speed : 0;
  lastL = now;
  if (!lrig.length) return;
  for (const p of lpanels) {
    const c = p.clip;
    p.t += dt;
    let L;
    if (c.life) {
      const ct = c.cycleS ? p.t % c.cycleS : p.t;
      c.life.step(dt, new Set([c.id]), c.near ? c.near(ct) : []);
      L = c.life.all()[0];
    } else {
      L = p.run; L.t = p.t; L.ph = p.t / LR.motion.gait.runStrideS;
      L.x = 0; L.y = 0; L.z = 0; L.yaw = 0;
    }
    poseSkeleton(lrig, poseLizard(lrig, L, LR.motion, axisAngle), lmats, 0);
    const n = c.note(L);
    if (p.note.textContent !== n) p.note.textContent = n;
    const close = /** @type {any} */ (goal).close;
    const target = close ? [L.x + Math.sin(L.yaw) * 0.03 * SL, L.y + 0.008 * SL, L.z + Math.cos(L.yaw) * 0.03 * SL] : c.target;
    p.view.draw({ cam: { yaw: cam.yaw + (close ? L.yaw : 0), pitch: cam.pitch, dist: close ? 0.12 : c.dist, target }, place: [L.x, L.y, L.z, L.yaw], scale: SL, dry: 1,
      water: null, floorY: 0, ledge: c.life ? [STONE.half, -STONE.half, STONE.half, STONE.top] : null, ring: [0, 0, 0, 0], bones: lmats, look: [1, 1, 1], baked: true, mesh: 'lizard' });
  }
}
lizardsReady = true;
