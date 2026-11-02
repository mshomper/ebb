// @ts-check
// The seal lab (B3 wave 3): Matt's seal, rigged in code (src/world/seals/model.js), playing each of
// its clips (src/world/seals/motion.js) as the game poses it, skinned on the CPU and drawn into a
// 2D canvas, back faces first. No WebGPU, so it opens anywhere. The coat is a quick sketch by
// which way the skin faces at rest; the game's shader paints the real one.

import { buildSeal } from '../src/world/seals/model.js';
import { lieMoves, humpMoves, swimMoves, bottleMoves, bottleBob } from '../src/world/seals/motion.js';
import { poseSkeleton } from '../src/world/creatures/pose.js';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
const note = /** @type {HTMLElement} */ (document.getElementById('note'));
const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
const R = await fetch(new URL('../recipes/species/seal.json', import.meta.url)).then((r) => r.json());
const text = (/** @type {string} */ p) => fetch(new URL(`../${p}`, import.meta.url)).then((r) => r.text());
const [body, eyes, jaw] = await Promise.all([text(R.body.model.body), text(R.body.model.eyes), text(R.body.model.jaw)]);
const seal = buildSeal({ body, eyes, jaw }, R);
const M = R.motion, L = R.life, pupK = R.body.pup.lengthM / R.body.lengthM;
const F = new Float32Array(seal.data), U = new Uint8Array(seal.data), N = seal.count, I = seal.indices;
note.textContent = `${seal.tris} triangles, ${seal.skeleton.length} bones, ${R.body.lengthM} m nose to tail`;

/** Each vertex's sketch colour (linear 0..1): back, belly, eyes. @param {boolean} pup */
function coat(pup) {
  const c = new Float32Array(N * 3), C = R.body.coat;
  for (let v = 0; v < N; v++) {
    const up = F[v * 11 + 4], part = F[v * 11 + 6];
    let col = C.grey.slice();
    const back = Math.max(0, Math.min(1, (up - 0.15) / 0.7)), belly = Math.max(0, Math.min(1, (-up - 0.1) / 0.65));
    col = col.map((x, i) => x + (C.back[i] - x) * back);
    col = col.map((x, i) => x + (C.belly[i] - x) * belly);
    if (pup) col = R.body.pup.white.slice();
    if (part > 0.5 && part < 1.5) col = C.eye.slice();
    c.set(col, v * 3);
  }
  return c;
}
const COAT = coat(false), PUP = coat(true);

let clip = 'lie', yaw = 0.9, pitch = 0.32, dist = 4.2, t0 = performance.now(), walkZ = 0, walkPhase = 0, last = 0;
for (const b of document.querySelectorAll('button[data-clip]')) b.addEventListener('click', () => {
  clip = /** @type {string} */ (/** @type {HTMLElement} */ (b).dataset.clip);
  for (const o of document.querySelectorAll('button[data-clip]')) o.setAttribute('aria-pressed', String(o === b));
  walkZ = 0; walkPhase = 0;
});
let drag = /** @type {{ x: number, y: number } | null} */ (null);
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => { if (!drag) return; yaw -= (e.clientX - drag.x) * 0.01; pitch = Math.max(-0.2, Math.min(1.4, pitch + (e.clientY - drag.y) * 0.01)); drag = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); dist = Math.max(1.2, Math.min(12, dist * (1 + e.deltaY * 0.001))); }, { passive: false });

/**
 * What to draw now: one or two seals, each its moves, place and size, and the water line if any.
 * @param {number} t @param {number} dt
 */
function scene(t, dt) {
  const look0 = { yaw: 0, lift: 0 };
  const lie = (/** @type {any} */ o) => lieMoves(M, t, { banana: 0.45, side: 1, look: look0, scratch: -1, yawn: 0, pup: false, ...o });
  /** @param {number} k */
  const humpStep = (k) => {
    const v = (k < 1 ? L.pupHumpMps : L.humpMps) * dt;
    walkZ += v * Math.max(0, Math.sin(Math.PI * 2 * walkPhase)) * 2;
    walkPhase += v / (M.hump.strideM * (k < 1 ? 0.6 : 1));
    if (walkZ > 1.5) walkZ -= 3;
    return { moves: humpMoves(M, walkPhase, t), x: 0, y: 0, z: walkZ, yaw: 0, k };
  };
  const wave = (t % 4) / 4;
  switch (clip) {
    case 'banana': return { seals: [{ moves: lie({ banana: 1 }), x: 0, y: 0, z: 0, yaw: 0, k: 1 }] };
    case 'look': return { seals: [{ moves: lie({ look: { yaw: Math.sin(t * 0.6) * 1.1, lift: 0.3 * (0.5 + 0.5 * Math.sin(t * 0.3)) } }), x: 0, y: 0, z: 0, yaw: 0, k: 1 }] };
    case 'scratch': return { seals: [{ moves: lie({ scratch: (t % (M.scratch.s + 1)) / M.scratch.s > 1 ? -1 : (t % (M.scratch.s + 1)) / M.scratch.s }), x: 0, y: 0, z: 0, yaw: 0, k: 1 }] };
    case 'yawn': return { seals: [{ moves: lie({ yawn: Math.max(0, Math.sin(t * 1.2)) }), x: 0, y: 0, z: 0, yaw: 0, k: 1 }] };
    case 'hump': return { seals: [humpStep(1)] };
    case 'swim': return { water: 0, seals: [{ moves: swimMoves(M, t * M.swim.hz), x: 0, y: -L.swimBelowM, z: 0, yaw: 0, k: 1 }] };
    case 'bottle': return { water: 0, seals: [{ moves: bottleMoves(M, t, Math.sin(t * 0.3) * 0.8), x: 0, y: -L.bottleBelowM + bottleBob(M, t), z: 0, yaw: 0, k: 1 }] };
    case 'rest': return { seals: [{ moves: [], x: 0, y: 0, z: 0, yaw: 0, k: 1 }] };
    case 'pup-lie': return { seals: [{ moves: lie({ pup: true, banana: 0.6 }), x: 0, y: 0, z: 0, yaw: 0, k: pupK, pup: true }] };
    case 'pup-wave': return { seals: [{ moves: lie({ pup: true, banana: 0.6, wave }), x: 0, y: 0, z: 0, yaw: 0, k: pupK, pup: true }] };
    case 'pup-roll': return { seals: [{ moves: lie({ pup: true, banana: 0.6, rollOver: Math.max(0, Math.sin(t * 0.8)) }), x: 0, y: 0, z: 0, yaw: 0, k: pupK, pup: true }] };
    case 'pup-hump': return { seals: [{ ...humpStep(pupK), pup: true }] };
    case 'pup-nurse': return { seals: [
      { moves: lie({ banana: 0.7, side: 1 }), x: -0.2, y: 0, z: 0, yaw: 0, k: 1 },
      { moves: lie({ pup: true, banana: 0.2 }), x: 0.75, y: 0, z: 0.05, yaw: Math.PI * 0.5 + 0.3, k: pupK, pup: true }] };
    case 'pup-bottle': return { water: 0, seals: [
      { moves: bottleMoves(M, t, 0.4), x: -0.4, y: -L.bottleBelowM + bottleBob(M, t), z: 0, yaw: 0, k: 1 },
      { moves: bottleMoves(M, t + 1.3, -0.3), x: 0.5, y: -L.bottleBelowM * pupK + bottleBob(M, t + 1), z: 0.1, yaw: 0, k: pupK, pup: true }] };
    default: return { seals: [{ moves: lie({}), x: 0, y: 0, z: 0, yaw: 0, k: 1 }] };
  }
}

const bones = new Float32Array(seal.skeleton.length * 16);
/** The camera: eye, and a world point to the screen (x, y, depth). */
function camera() {
  const tgt = [0, 0.3, 0];
  const eye = [tgt[0] + Math.sin(yaw) * Math.cos(pitch) * dist, tgt[1] + Math.sin(pitch) * dist, tgt[2] + Math.cos(yaw) * Math.cos(pitch) * dist];
  const f = [tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]], fl = Math.hypot(...f);
  const fw = f.map((x) => x / fl);
  const r = [fw[2], 0, -fw[0]], rl = Math.hypot(...r), rt = r.map((x) => -x / rl);
  const up = [rt[1] * fw[2] - rt[2] * fw[1], rt[2] * fw[0] - rt[0] * fw[2], rt[0] * fw[1] - rt[1] * fw[0]];
  const W = canvas.width, H = canvas.height, foc = H * 1.3;
  return { eye, /** @param {number[]} p */ to: (p) => {
    const d = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
    const z = d[0] * fw[0] + d[1] * fw[1] + d[2] * fw[2];
    return [W / 2 + ((d[0] * rt[0] + d[1] * rt[1] + d[2] * rt[2]) / z) * foc, H / 2 - ((d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / z) * foc, z];
  } };
}

/** @param {number} x */
const srgb = (x) => Math.round(255 * Math.min(1, x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055));

function frame() {
  const now = performance.now(), t = (now - t0) / 1000, dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
  last = now;
  const w = canvas.clientWidth * devicePixelRatio, h = canvas.clientHeight * devicePixelRatio;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const cam = camera(), S = scene(t, dt);
  g.fillStyle = '#D9D0BC'; g.fillRect(0, 0, w, h);
  // The grid: 10 cm, darker every metre.
  for (let i = -30; i <= 30; i++) {
    g.strokeStyle = i % 10 === 0 ? 'rgba(80,70,50,0.45)' : 'rgba(80,70,50,0.13)';
    g.lineWidth = devicePixelRatio;
    for (const [a, b] of [[[i / 10, 0, -3], [i / 10, 0, 3]], [[-3, 0, i / 10], [3, 0, i / 10]]]) {
      const p = cam.to(a), q = cam.to(b);
      if (p[2] <= 0.05 || q[2] <= 0.05) continue;
      g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke();
    }
  }
  /** @type {{ z: number, pts: number[][], col: string }[]} */ const tris = [];
  const sun = [0.4, 0.8, 0.45], sl = Math.hypot(...sun);
  for (const s of S.seals) {
    poseSkeleton(seal.skeleton, s.moves, bones, 0);
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw), col = s.pup ? PUP : COAT;
    const P = new Float32Array(N * 3), Nn = new Float32Array(N * 3);
    for (let v = 0; v < N; v++) {
      const x = F[v * 11], y = F[v * 11 + 1], z = F[v * 11 + 2], nx = F[v * 11 + 3], ny = F[v * 11 + 4], nz = F[v * 11 + 5];
      let px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0;
      for (let k = 0; k < 4; k++) {
        const wt = U[v * 44 + 40 + k] / 255;
        if (!wt) continue;
        const m = U[v * 44 + 36 + k] * 16;
        px += wt * (bones[m] * x + bones[m + 4] * y + bones[m + 8] * z + bones[m + 12]);
        py += wt * (bones[m + 1] * x + bones[m + 5] * y + bones[m + 9] * z + bones[m + 13]);
        pz += wt * (bones[m + 2] * x + bones[m + 6] * y + bones[m + 10] * z + bones[m + 14]);
        qx += wt * (bones[m] * nx + bones[m + 4] * ny + bones[m + 8] * nz);
        qy += wt * (bones[m + 1] * nx + bones[m + 5] * ny + bones[m + 9] * nz);
        qz += wt * (bones[m + 2] * nx + bones[m + 6] * ny + bones[m + 10] * nz);
      }
      px *= s.k; py *= s.k; pz *= s.k;
      P[v * 3] = c * px + sn * pz + s.x; P[v * 3 + 1] = py + s.y; P[v * 3 + 2] = -sn * px + c * pz + s.z;
      const ql = Math.hypot(qx, qy, qz) || 1;
      Nn[v * 3] = (c * qx + sn * qz) / ql; Nn[v * 3 + 1] = qy / ql; Nn[v * 3 + 2] = (-sn * qx + c * qz) / ql;
    }
    for (let i = 0; i < I.length; i += 3) {
      const a = I[i], b = I[i + 1], d = I[i + 2];
      const pts = [a, b, d].map((v) => cam.to([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]));
      if (pts.some((p) => p[2] <= 0.05)) continue;
      // Back faces away.
      if ((pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1]) - (pts[2][0] - pts[0][0]) * (pts[1][1] - pts[0][1]) > 0) continue;
      const nx = (Nn[a * 3] + Nn[b * 3] + Nn[d * 3]) / 3, ny = (Nn[a * 3 + 1] + Nn[b * 3 + 1] + Nn[d * 3 + 1]) / 3, nz = (Nn[a * 3 + 2] + Nn[b * 3 + 2] + Nn[d * 3 + 2]) / 3;
      const lit = 0.35 + 0.9 * Math.max(0, (nx * sun[0] + ny * sun[1] + nz * sun[2]) / sl);
      const under = S.water !== undefined && (P[a * 3 + 1] + P[b * 3 + 1] + P[d * 3 + 1]) / 3 < S.water;
      const cc = [0, 1, 2].map((k) => (col[a * 3 + k] + col[b * 3 + k] + col[d * 3 + k]) / 3 * lit * (under ? 0.55 : 1) + (under ? [0.0, 0.03, 0.06][k] : 0));
      tris.push({ z: (pts[0][2] + pts[1][2] + pts[2][2]) / 3, pts, col: `rgb(${srgb(cc[0])},${srgb(cc[1])},${srgb(cc[2])})` });
    }
  }
  tris.sort((p, q) => q.z - p.z);
  for (const tr of tris) {
    g.fillStyle = tr.col; g.strokeStyle = tr.col; g.lineWidth = 0.6;
    g.beginPath(); g.moveTo(tr.pts[0][0], tr.pts[0][1]); g.lineTo(tr.pts[1][0], tr.pts[1][1]); g.lineTo(tr.pts[2][0], tr.pts[2][1]); g.closePath(); g.fill(); g.stroke();
  }
  // The water line, over everything below it.
  if (S.water !== undefined) {
    g.fillStyle = 'rgba(60,110,140,0.35)';
    const c4 = [[-3, -3], [3, -3], [3, 3], [-3, 3]].map(([x, z]) => cam.to([x, S.water, z]));
    if (c4.every((p) => p[2] > 0.05)) { g.beginPath(); c4.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fill(); }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
