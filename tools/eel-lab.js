// @ts-check
// The eel lab (tools/eel-lab.html): the eels' live motion (src/world/creatures/eel-swim.js) and
// their spine-chain pose (eel.js) drawn from above on a 2D canvas, in a pond with wet grass and the
// sea beside it, so the wave can be watched without the game. No GPU; the same code the game runs.

import { eelBody, poseEel } from '../src/world/creatures/eel.js';
import { createEelSwim } from '../src/world/creatures/eel-swim.js';
import { axisAngle } from '../src/world/creatures/pose.js';

const rec = await fetch(new URL('../recipes/species/eel.json', import.meta.url)).then((r) => r.json());
const body = eelBody(rec.body);
const size = rec.body.displayScale;
const M = { ...rec.motion, lengthM: rec.body.lengthM, radiusM: rec.body.radiusM };
const rig = body.bones;

// The scene in meters: a pond 3.2 m across at (0, 0); the sea beyond x = 8.
const POND = { x: 0, z: 0, r: 3.2 }, SEA = 8;
const water = (/** @type {number} */ x, /** @type {number} */ z) => {
  if (x > SEA) return { surface: 0, depth: Math.min(1.5, (x - SEA) * 0.5 + 0.2) };
  const r2 = ((x - POND.x) ** 2 + (z - POND.z) ** 2) / (POND.r * POND.r);
  return { surface: 0, depth: Math.max(0, 0.8 * (1 - r2)) };
};
const ground = (/** @type {number} */ x, /** @type {number} */ z) => (water(x, z).depth > 0 ? -water(x, z).depth : 0.04);
const env = { water, ground };

const eels = createEelSwim({ id: 1, seed: 11, count: 3, home: POND, deep: POND, size, M, env });
let visitor = /** @type {ReturnType<typeof createEelSwim> | null} */ (null);
eels.setMood('night');

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
const PX = 130, OX = 460, OZ = 600;
const toPx = (/** @type {number} */ x, /** @type {number} */ z) => [OX + x * PX, OZ + z * PX];
const status = /** @type {HTMLElement} */ (document.getElementById('status'));

/** The chain's joints from above for one eel: the snout first. @param {any} f */
function chain(f) {
  const q = [0, 0, 0, 1];
  const moves = poseEel(rig, f, M, q, axisAngle);
  const segs = rig.filter((/** @type {any} */ b) => b.name.startsWith('seg.'));
  const segL = ((segs[0].pivot[2] - segs[segs.length - 1].pivot[2]) / (segs.length - 1)) * size;
  // The snout half a body ahead of the middle, then each segment back along its own heading.
  const L = rec.body.lengthM * size;
  let a = f.yaw, x = f.x + Math.sin(f.yaw) * L / 2, z = f.z + Math.cos(f.yaw) * L / 2;
  const pts = [[x, z]];
  segs.forEach((/** @type {any} */ b, /** @type {number} */ i) => {
    const m = moves[rig.indexOf(b)];
    a += m ? 2 * Math.atan2(m.q[1], m.q[3]) : 0;
    x -= Math.sin(a) * segL; z -= Math.cos(a) * segL;
    pts.push([x, z]);
    void i;
  });
  return pts;
}

/** Draw one eel. @param {any} f */
function drawEel(f) {
  if (f.mode === 'wait' || f.mode === 'gone') return;
  const pts = chain(f), n = pts.length - 1, R = rec.body.radiusM * size;
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) / n, r = R * (s < 0.4 ? 1 : 1 - (1 - rec.body.tipShare) * ((s - 0.4) / 0.6));
    const [x0, y0] = toPx(pts[i][0], pts[i][1]), [x1, y1] = toPx(pts[i + 1][0], pts[i + 1][1]);
    g.strokeStyle = '#3b3620'; g.lineWidth = Math.max(3, r * 2 * PX); g.lineCap = 'round';
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }
  g.fillStyle = '#e8c25a';
  for (const [x, z] of pts) { const [px, py] = toPx(x, z); g.beginPath(); g.arc(px, py, 3, 0, Math.PI * 2); g.fill(); }
  const [hx, hy] = toPx(pts[0][0], pts[0][1]);
  g.fillStyle = '#111'; g.beginPath(); g.arc(hx, hy, 5, 0, Math.PI * 2); g.fill();
}

function draw() {
  g.fillStyle = '#8fae6f'; g.fillRect(0, 0, canvas.width, canvas.height);
  // Wet grass between the pond and the sea.
  g.fillStyle = '#7d9d5f'; g.fillRect(...toPx(POND.r - 0.5, -2.5), (SEA - POND.r + 0.5) * PX, 5 * PX);
  const [sx] = toPx(SEA, 0);
  g.fillStyle = '#3f7a8f'; g.fillRect(sx, 0, canvas.width - sx, canvas.height);
  const [px, py] = toPx(POND.x, POND.z);
  g.fillStyle = '#4f8796'; g.beginPath(); g.arc(px, py, POND.r * PX, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#1E2624'; g.font = '800 30px Nunito, sans-serif';
  g.fillText('pond', px - 34, py - POND.r * PX - 14);
  g.fillText('wet grass', ...toPx(4.2, -2.9));
  g.fillText('sea', sx + 30, 60);
  for (const f of eels.fish) drawEel(f);
  if (visitor) for (const f of visitor.fish) drawEel(f);
  const modes = eels.fish.map((f) => f.mode).join(', ');
  status.textContent = `${eels.fish.length} eels: ${modes}${visitor && !visitor.gone ? '; a visitor at the shore' : ''}`;
}

let last = performance.now(), acc = 0;
function frame(/** @type {number} */ now) {
  acc = Math.min(acc + (now - last) / 1000, 0.2); last = now;
  while (acc >= 1 / 30) { eels.step(1 / 30); visitor?.step(1 / 30); acc -= 1 / 30; }
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

const press = (/** @type {string} */ id) => { for (const b of ['night', 'day']) /** @type {HTMLElement} */ (document.getElementById(b)).setAttribute('aria-pressed', String(b === id)); };
/** @type {HTMLElement} */ (document.getElementById('night')).onclick = () => { eels.setMood('night'); press('night'); };
/** @type {HTMLElement} */ (document.getElementById('day')).onclick = () => { eels.setMood('day'); press('day'); };
/** @type {HTMLElement} */ (document.getElementById('cross')).onclick = () => { eels.resize(eels.fish.length + 2); eels.cross(2, { x: SEA - 0.4, z: 0.6 }); };
/** @type {HTMLElement} */ (document.getElementById('visit')).onclick = () => {
  visitor = createEelSwim({ id: -1, seed: Math.floor(performance.now()), count: 1, home: { x: SEA + 2, z: -1 }, deep: { x: SEA + 2, z: -1 }, size, M, env });
  visitor.visit({ x: SEA - 0.4, z: -1.2 }, { x: SEA + 1.6, z: -1.2 });
};
canvas.onclick = () => eels.startle();
