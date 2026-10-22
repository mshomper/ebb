// @ts-check
// Under-log lab: the woodlouse and the beetle (src/world/finds/under-log-meshes.js) side by side at
// real size on a slowly turning stage, their legs stepping through leg-rig.js. Walk steps them in
// place (slowed to a third so the gait reads), Still lets the legs and antennae idle, and Scuttle
// replays what happens when a Lift uncovers them (under-log-motion.js), at real speed. Drawn on a
// 2D canvas, sorted back to front, like tools/finds-models.html.

import { woodlouseMesh, beetleMesh } from '../src/world/finds/under-log-meshes.js';
import { legRig, legBones } from '../src/world/finds/leg-rig.js';
import { scuttle } from '../src/world/finds/under-log-motion.js';

const recipe = await (await fetch('../recipes/species/under-log.json')).json();

/** The log's footprint in scuttle mode (meters): it lies along x, its near edge at LOG_Z. */
const LOG_Z = 0.055, LOG_W = 0.05;

const kinds = [
  { name: 'Woodlouse', K: recipe.woodlice, mesh: woodlouseMesh(recipe.woodlice.shape), home: [-0.016, 0.004],
    e: { x: -0.03, z: -0.012, yaw: 2.2, r: 0.31, tx: -0.045, tz: LOG_Z - 0.003 } },
  { name: 'Violet ground beetle', K: recipe.beetle, mesh: beetleMesh(recipe.beetle.shape), home: [0.016, -0.004],
    e: { x: 0.022, z: 0.0, yaw: -0.8, r: 0.62, tx: 0.035, tz: LOG_Z - 0.004 } },
].map((k) => ({ ...k, rig: legRig(k.mesh, k.K.legs), posed: new Float32Array(k.mesh.vertices) }));

const cv = /** @type {HTMLCanvasElement} */ (document.getElementById('cv'));
const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
const keys = /** @type {HTMLElement} */ (document.getElementById('keys'));
const note = /** @type {HTMLElement} */ (document.getElementById('note'));
for (const k of kinds) {
  const d = document.createElement('div');
  const len = (k.K.shape.lengthM * 1000).toFixed(0);
  d.innerHTML = `<strong>${k.name}</strong><br><span class="muted">${len} mm long, ${k.rig.legs.length} legs, ${k.mesh.indices.length / 3} triangles; runs at ${(k.K.scuttle.speedMps * 100).toFixed(0)} cm a second, steps ${k.K.scuttle.stepHz} times a second</span>`;
  keys.append(d);
}

let mode = 'walk', t0 = performance.now(), stageYaw = 0.5, pitch = 0.55, view = 0.075, focusZ = 0, last = performance.now();
/** @param {string} m */
function setMode(m) {
  mode = m; t0 = performance.now();
  // Scuttle: the log across the back, seen from a little higher.
  if (m === 'scuttle') { stageYaw = Math.PI; pitch = 0.75; }
  for (const id of ['walk', 'still', 'scuttle']) document.getElementById(id)?.setAttribute('aria-pressed', String(id === m));
  note.textContent = m === 'walk' ? 'Stepping in place, slowed to a third.' : m === 'still' ? 'Resting: legs and antennae barely move.' : 'Just uncovered: a beat frozen, then a run for the log\'s edge. Press again to replay.';
}
for (const id of ['walk', 'still', 'scuttle']) document.getElementById(id)?.addEventListener('click', () => setMode(id));
setMode('walk');

let drag = /** @type {number[] | null} */ (null);
cv.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', (e) => {
  if (!drag) return;
  stageYaw += (e.clientX - drag[0]) * 0.01; pitch = Math.max(0.1, Math.min(1.4, pitch + (e.clientY - drag[1]) * 0.01));
  drag = [e.clientX, e.clientY];
});
cv.addEventListener('pointerup', () => { drag = null; });

/**
 * Skin a creature by its leg bones into k.posed (positions and normals).
 * @param {typeof kinds[number]} k @param {Float32Array} B
 */
function pose(k, B) {
  const V = k.mesh.vertices, O = k.posed, J = k.rig.joints, Wt = k.rig.weights;
  for (let i = 0; i < k.mesh.count; i++) {
    const w = Wt[i * 4 + 1] / 255, M = B.subarray(J[i * 4 + 1] * 16);
    const o = i * 9, x = V[o], y = V[o + 1], z = V[o + 2], nx = V[o + 3], ny = V[o + 4], nz = V[o + 5];
    for (let r = 0; r < 3; r++) {
      O[o + r] = V[o + r] * (1 - w) + w * (M[r] * x + M[4 + r] * y + M[8 + r] * z + M[12 + r]);
      O[o + 3 + r] = V[o + 3 + r] * (1 - w) + w * (M[r] * nx + M[4 + r] * ny + M[8 + r] * nz);
    }
  }
}

const toSrgb = (/** @type {number} */ c) => Math.round(255 * Math.min(1, c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));

function frame() {
  const t = (performance.now() - t0) / 1000;
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000), ease = 1 - Math.exp(-dt * 4);
  last = now;
  // The stage turns slowly, a full turn in about 25 s.
  if (!drag && mode !== 'scuttle') stageYaw += dt * 0.25;
  // Scuttle needs room to run: the view widens to 26 cm.
  view += ((mode === 'scuttle' ? 0.26 : 0.075) - view) * ease;
  focusZ += ((mode === 'scuttle' ? 0.008 : 0) - focusZ) * ease;
  const W = cv.width = Math.round(cv.clientWidth * devicePixelRatio), H = cv.height = Math.round(cv.clientHeight * devicePixelRatio);
  const sc = W / view, cy = Math.cos(stageYaw), sy = Math.sin(stageYaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  /** World to screen. @param {number} x @param {number} y @param {number} z */
  const proj = (x, y, z) => {
    z -= focusZ;
    const x1 = cy * x + sy * z, z1 = -sy * x + cy * z;
    return [W / 2 + x1 * sc, H * 0.55 - (cp * y - sp * z1) * sc, sp * y + cp * z1];
  };
  /** @param {number[][]} pts @param {string} fill */
  const poly = (pts, fill) => {
    g.fillStyle = fill; g.beginPath();
    pts.forEach((p, i) => { const q = proj(p[0], 0, p[1]); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); });
    g.closePath(); g.fill();
  };
  g.clearRect(0, 0, W, H);
  // The stage: a disc of soil; in scuttle mode, the log's footprint behind them.
  const R = view * 0.48;
  poly(Array.from({ length: 48 }, (_, i) => [Math.cos((i / 48) * 6.283) * R, Math.sin((i / 48) * 6.283) * R]), '#D2C2A4');
  if (mode === 'scuttle') {
    poly([[-0.09, LOG_Z], [0.09, LOG_Z], [0.09, LOG_Z + LOG_W], [-0.09, LOG_Z + LOG_W]], '#8A6A4A');
    poly([[-0.09, LOG_Z - 0.012], [0.09, LOG_Z - 0.012], [0.09, LOG_Z], [-0.09, LOG_Z]], '#B9A27F');
  }
  /** @type {{ p: number[][], c: string, d: number }[]} */ const tris = [];
  const L = [0.35, 0.85, 0.4], Ll = Math.hypot(...L);
  for (const k of kinds) {
    const G = k.K.legs, Sc = k.K.scuttle;
    let x = k.home[0], z = k.home[1], yaw = 0, phase = 0, running = true;
    if (mode === 'walk') phase = t * 2 * Math.PI * Sc.stepHz / 3;
    else if (mode === 'still') { phase = t * 2 * Math.PI * Sc.idleHz; running = false; }
    else {
      // Replay from the lift; once both are under the log they rest there.
      const s = scuttle(k.e, t, Sc);
      x = s.x; z = s.z; yaw = s.yaw; phase = s.step; running = s.running;
    }
    const gait = running ? G : { ...G, liftDeg: G.liftDeg * G.idleShare, sweepDeg: G.sweepDeg * G.idleShare };
    pose(k, legBones(k.rig, phase, gait));
    const O = k.posed, cyw = Math.cos(yaw), syw = Math.sin(yaw);
    const P = Array.from({ length: k.mesh.count }, (_, i) => {
      const lx = O[i * 9], ly = O[i * 9 + 1], lz = O[i * 9 + 2];
      return proj(x + cyw * lx + syw * lz, ly, z - syw * lx + cyw * lz);
    });
    const I = k.mesh.indices;
    for (let t3 = 0; t3 < I.length; t3 += 3) {
      const a = I[t3], b = I[t3 + 1], c = I[t3 + 2];
      const n = [0, 1, 2].map((r) => O[a * 9 + 3 + r] + O[b * 9 + 3 + r] + O[c * 9 + 3 + r]);
      // Normals turn with the creature.
      const nw = [cyw * n[0] + syw * n[2], n[1], -syw * n[0] + cyw * n[2]], nl = Math.hypot(...nw) || 1;
      const ndl = Math.max(0, (nw[0] * L[0] + nw[1] * L[1] + nw[2] * L[2]) / (nl * Ll));
      const lit = 0.3 + 0.7 * ndl + 0.25 * ndl ** 24;
      const col = [0, 1, 2].map((r) => toSrgb(((O[a * 9 + 6 + r] + O[b * 9 + 6 + r] + O[c * 9 + 6 + r]) / 3) * lit * 1.6));
      tris.push({ p: [P[a], P[b], P[c]], c: `rgb(${col.join(',')})`, d: P[a][2] + P[b][2] + P[c][2] });
    }
  }
  tris.sort((p, q) => p.d - q.d);
  g.lineWidth = 0.6;
  for (const T of tris) {
    g.fillStyle = g.strokeStyle = T.c;
    g.beginPath(); g.moveTo(T.p[0][0], T.p[0][1]); g.lineTo(T.p[1][0], T.p[1][1]); g.lineTo(T.p[2][0], T.p[2][1]); g.closePath(); g.fill(); g.stroke();
  }
  // A 1 cm scale bar.
  g.fillStyle = '#2F3A35';
  g.fillRect(24, H - 30, 0.01 * sc, 4 * devicePixelRatio);
  g.font = `${15 * devicePixelRatio}px Nunito, system-ui, sans-serif`;
  g.fillText('1 cm', 24, H - 38);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
