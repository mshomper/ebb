// @ts-check
// tools/clay-lineup.html: the clay bowl and cup made in code beside Matt's mortar and clay pot, at
// real size, for scale and colour. Each web copy is read and placed as the asset lab does
// (asset-lab-model.js); a painted copy's colour map is read at each vertex into its vertex colours,
// so all four draw as one mesh in one view of the asset lab's stage.

import { createStage } from './asset-lab-stage.js';
import { readModel, decodeMap } from './asset-lab-model.js';

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const list = (await (await fetch('./assets/models.json', { cache: 'no-cache' })).json()).models;
const ROW = ['mortar', 'clay-pot', 'clay-bowl', 'clay-cup'];
const GAP = 0.06;

/** sRGB 0..255 to linear. @param {number} c */
const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };

/** A web copy, placed, its colour map (if any) read into its vertex colours. @param {string} out */
async function piece(out) {
  const m = list.find((/** @type {any} */ q) => q.out === out);
  const buf = await (await fetch(`../assets/models/camp/${out}.glb`, { cache: 'no-cache' })).arrayBuffer();
  const p = readModel(buf, m);
  const bmp = await decodeMap(p.maps.baseColor);
  if (bmp) {
    const cv = new OffscreenCanvas(bmp.width, bmp.height), ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (cv.getContext('2d'));
    ctx.drawImage(bmp, 0, 0);
    const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
    for (let v = 0; v < p.positions.length / 3; v++) {
      const u = p.uvs[v * 2], w = p.uvs[v * 2 + 1];
      const x = Math.min(bmp.width - 1, Math.floor((u - Math.floor(u)) * bmp.width)), y = Math.min(bmp.height - 1, Math.floor((w - Math.floor(w)) * bmp.height));
      const k = (y * bmp.width + x) * 4;
      p.colors.set([lin(data[k]), lin(data[k + 1]), lin(data[k + 2]), 0], v * 4);
    }
  } else for (let v = 0; v < p.positions.length / 3; v++) p.colors[v * 4 + 3] = 0;
  return p;
}

const parts = await Promise.all(ROW.map(piece));
// In a row along x, a gap between each, centred on the origin.
let x = 0;
const shifts = parts.map((p) => { const s = x - p.bounds.min[0]; x += p.bounds.max[0] - p.bounds.min[0] + GAP; return s; });
const mid = (x - GAP) / 2;
const nv = parts.reduce((s, p) => s + p.positions.length / 3, 0), ni = parts.reduce((s, p) => s + p.indices.length, 0);
const positions = new Float32Array(nv * 3), normals = new Float32Array(nv * 3), uvs = new Float32Array(nv * 2), colors = new Float32Array(nv * 4), indices = new Uint32Array(ni);
let v0 = 0, i0 = 0;
parts.forEach((p, k) => {
  const n = p.positions.length / 3;
  for (let v = 0; v < n; v++) {
    positions.set([p.positions[v * 3] + shifts[k] - mid, p.positions[v * 3 + 1], p.positions[v * 3 + 2]], (v0 + v) * 3);
  }
  normals.set(p.normals, v0 * 3); uvs.set(p.uvs, v0 * 2); colors.set(p.colors, v0 * 4);
  for (let i = 0; i < p.indices.length; i++) indices[i0 + i] = p.indices[i] + v0;
  v0 += n; i0 += p.indices.length;
});
const top = Math.max(...parts.map((p) => p.bounds.max[1])), deep = Math.max(...parts.map((p) => p.bounds.max[2] - p.bounds.min[2])) / 2;
const bounds = { min: [-mid, 0, -deep], max: [mid, top, deep] };
$('sizes').textContent = ROW.map((id, k) => { const b = parts[k].bounds; return `${id} ${Math.round((b.max[0] - b.min[0]) * 100)} cm across, ${Math.round(b.max[1] * 100)} cm tall`; }).join(' · ');

const r = await createStage([$('view')]);
if (!r.ok) throw new Error(r.reason);
const stage = r.stage;
/** @type {any} */ (globalThis).clayLineup = { stage };
stage.frameOn(bounds);
stage.cam.pitch = 0.32;
await stage.setModel(0, { mesh: { positions, normals, uvs, colors, indices, triangles: ni / 3, bounds, maps: { baseColor: null, metallicRoughness: null, normal: null },
  factors: { base: [1, 1, 1, 1], metal: 0, rough: 0.85, normalScale: 1 } }, bitmaps: { baseColor: null, metallicRoughness: null, normal: null } });

let paused = false, last = performance.now();
/** @type {{ x: number } | null} */ let drag = null;
const setPaused = (/** @type {boolean} */ p) => { paused = p; $('pause').setAttribute('aria-pressed', String(p)); };
$('pause').addEventListener('click', () => setPaused(!paused));
$('front').addEventListener('click', () => { setPaused(true); stage.cam.yaw = 0; stage.cam.pitch = 0.32; });
for (const name of /** @type {const} */ (['day', 'dusk'])) $(name).addEventListener('click', () => { stage.setLight(name); $('day').setAttribute('aria-pressed', String(name === 'day')); $('dusk').setAttribute('aria-pressed', String(name === 'dusk')); });
const view = $('view');
view.addEventListener('pointerdown', (/** @type {PointerEvent} */ e) => { drag = { x: e.clientX }; view.setPointerCapture(e.pointerId); });
view.addEventListener('pointermove', (/** @type {PointerEvent} */ e) => { if (!drag) return; stage.cam.yaw -= (e.clientX - drag.x) * 0.01; drag.x = e.clientX; });
view.addEventListener('pointerup', () => { drag = null; });
view.addEventListener('wheel', (/** @type {WheelEvent} */ e) => { e.preventDefault(); stage.cam.zoom = Math.min(2, Math.max(0.35, stage.cam.zoom * (e.deltaY > 0 ? 1.1 : 0.9))); }, { passive: false });
function frame(/** @type {number} */ now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused && !drag) stage.cam.yaw += dt * 0.25;
  stage.draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
