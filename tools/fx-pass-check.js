// @ts-check
// A quick look at the move effects' draw (tools/arena/fx-pass.js) and lights (setFxLights on the
// workbench stage), in the Hollow by lantern: three effect lights circling on the floor, a ring of
// sparks rising and streaking, threads from the lights to a stand-in, and twelve moths circling and
// flapping. The page clock drives it all; nothing here is game state.

import { createStage } from './walker-figure-stage.js';
import { createFxPass } from './arena/fx-pass.js';
import { pushBox, pushCylinder } from './arena/props.js';
import { LIGHT_FLOATS, SPARK_FLOATS, THREAD_FLOATS, MOTH_FLOATS } from '../src/world/hollow/fx-layout.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const view = /** @type {HTMLCanvasElement} */ ($('view'));
const made = await createStage(view);
if (!made.ok) { $('note').textContent = `This page needs WebGPU (${made.reason}).`; throw new Error(made.reason); }
const stage = made.stage;
const fx = await createFxPass(stage.gpu);
stage.setGround(() => 0, 14, 70);

// A stand-in for the walker in the middle, and a ring of pillars, to catch the lights.
/** @type {number[]} */ const tris = [];
pushBox(tris, [0, 0.8, 0], [0.22, 0.8, 0.16], 0.4, [0.62, 0.58, 0.52]);
for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.3; pushCylinder(tris, [Math.sin(a) * 3.6, 0, Math.cos(a) * 3.6], 0.35, 2.2, [0.45, 0.43, 0.4]); }
stage.setProps(new Float32Array(tris));
stage.view({ yaw: 0.6, pitch: 0.62, dist: 8 });

const N_SPARKS = 200, N_THREADS = 3, N_MOTHS = 12;
const lights = new Float32Array(3 * LIGHT_FLOATS);
const sparks = new Float32Array(N_SPARKS * SPARK_FLOATS);
const threads = new Float32Array(N_THREADS * THREAD_FLOATS);
const moths = new Float32Array(N_MOTHS * MOTH_FLOATS);
const COLOURS = [[1.6, 0.6, 0.15], [0.35, 1.3, 0.45], [1.05, 1.0, 0.9]];
const bones = new Float32Array(16), eyes = new Float32Array(20);
/** A stable 0..1 per index (the page's own; no game state). @param {number} i */
const hash = (i) => { const s = Math.sin(i * 12.9898) * 43758.5453; return s - Math.floor(s); };

let last = performance.now(), clock = 0;
function frame() {
  const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
  last = now; clock += dt;
  // The lights: circling low over the floor at different speeds.
  for (let i = 0; i < 3; i++) {
    const a = clock * (0.5 + i * 0.22) + (i * Math.PI * 2) / 3, r = 1.6 + i * 0.5;
    lights.set([Math.cos(a) * r, 0.35, Math.sin(a) * r, 3.2, ...COLOURS[i], 0], i * LIGHT_FLOATS);
  }
  stage.setFxLights(lights, 3);
  // The sparks: a ring rising, each on its own loop, embers then cooling.
  for (let i = 0; i < N_SPARKS; i++) {
    const life = 1.8, t = ((clock + hash(i) * life) % life) / life;
    const a = (i / N_SPARKS) * Math.PI * 2, r = 1.1 + t * 0.6, vy = 1.4 * (1 - t) + 0.2;
    const vx = Math.cos(a) * 0.4, vz = Math.sin(a) * 0.4;
    const cool = 1 - t;
    sparks.set([Math.cos(a) * r, 0.05 + t * 1.8, Math.sin(a) * r, 0.025 + 0.015 * hash(i + 7),
      2.4 * cool + 0.3, 0.9 * cool * cool + 0.1, 0.25 * cool * cool * cool, Math.min(1, cool * 2),
      vx, vy, vz, 0.06], i * SPARK_FLOATS);
  }
  // The threads: from each light to the stand-in's chest, flickering a little.
  for (let i = 0; i < N_THREADS; i++) {
    const o = i * LIGHT_FLOATS;
    threads.set([lights[o], lights[o + 1], lights[o + 2], 0.05, 0, 1.2, 0, 0.7 + 0.3 * Math.sin(clock * 9 + i),
      COLOURS[i][0] * 0.8, COLOURS[i][1] * 0.8, COLOURS[i][2] * 0.8, 0], i * THREAD_FLOATS);
  }
  // The moths: circling the stand-in at head height, flapping, banking into the turn, a faint glow.
  for (let i = 0; i < N_MOTHS; i++) {
    const w = 0.6 + 0.25 * hash(i + 3), a = clock * w + (i / N_MOTHS) * Math.PI * 2, r = 1.2 + 0.5 * hash(i + 11);
    const x = Math.cos(a) * r, z = Math.sin(a) * r, y = 1.3 + 0.35 * Math.sin(clock * 1.7 + i);
    const yaw = Math.atan2(-Math.sin(a), Math.cos(a));
    moths.set([x, y, z, yaw, clock * (22 + 6 * hash(i + 5)) + i, 0.14 + 0.05 * hash(i + 9), 0.35, -0.35], i * MOTH_FLOATS);
  }
  stage.draw({ bones, eyes, place: [0, -10, 0, 0], weights: false, night: false, water: -9, follow: [0, 0, 0], dt, hideFigure: true,
    lamp: { at: [2.2, 1.6, 2.6], reachM: 6, ambient: 0.035, strength: 1.2 },
    extra: (p, u) => fx.draw(p, u, { sparks, nSparks: N_SPARKS, threads, nThreads: N_THREADS, moths, nMoths: N_MOTHS }) });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
