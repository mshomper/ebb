// @ts-check
// The walk lab (doc 23, the walker; W1): the island from above on the walk grid, coloured by where
// you can stand at the tide you pick, with the test sandbar and islet the game's ?sandbar link
// builds. Tap once to stand, then tap to walk (double tap to hurry); the way is drawn and the
// figure walks it at its real pace. CPU only: no WebGPU needed, so it runs on any phone.

import { buildIslandModel } from '../src/world/island-model.js';
import { createMirror, syncFloat, sampleHeight } from '../src/world/terrain/heightfield.js';
import { WORLD_CELLS, CHUNK_SIZE } from '../src/world/terrain/grid.js';
import { waterCellOf } from '../src/world/water/grid.js';
import { createWalkGrid } from '../src/world/walk/grid.js';
import { createWalker } from '../src/world/walk/walker.js';
import { crossingNote, depthAtLow } from '../src/world/walk/crossing.js';
import { sandbarLayout, barHeight } from '../src/world/walk/sandbar.js';

/** @param {string} p */
const recipe = async (p) => (await fetch(new URL(`../recipes/${p}.json`, import.meta.url))).json();

const params = new URLSearchParams(location.search);
const seed = Number.parseInt(params.get('seed') ?? '1', 10) >>> 0;
const [R, terrainR, waterR, growthR] = await Promise.all([recipe('world/walker'), recipe('world/terrain'), recipe('world/water'), recipe('world/growth')]);
const islandId = params.get('island') ?? terrainR.starter.land.slice(5);
const land = await recipe(`land/${islandId}`);

const model = buildIslandModel({ seed, terrain: terrainR, land, water: waterR, growth: growthR });
const mirror = createMirror();
mirror.heightQ.set(model.heightQ);
syncFloat(mirror, { x: 0, y: 0, w: WORLD_CELLS, h: WORLD_CELLS });
const plain = (/** @type {number} */ x, /** @type {number} */ z) => sampleHeight(mirror.heightF, x, z);
const layout = sandbarLayout(plain);
let barOn = !!layout;
const ground = (/** @type {number} */ x, /** @type {number} */ z) => (barOn && layout ? barHeight(plain(x, z), x, z, layout) : plain(x, z));

// The open land: the starter chunks.
const S = terrainR.starter, half = CHUNK_SIZE / 2;
const box = { minX: CHUNK_SIZE * S.chunkMin - half, minZ: CHUNK_SIZE * S.chunkMin - half, maxX: CHUNK_SIZE * S.chunkMax + half, maxZ: CHUNK_SIZE * S.chunkMax + half };
let grid = createWalkGrid({ ground, ...box, cellM: R.grid.cellM, maxSlopeDeg: R.grid.maxSlopeDeg });

// Water: the sea at the chosen level, ponds from the water summary (their standing depth).
const rect = model.summary.rect;
const pond = (/** @type {number} */ x, /** @type {number} */ z) => {
  const i = waterCellOf(x) - rect.x, j = waterCellOf(z) - rect.y;
  return i < 0 || j < 0 || i >= rect.w || j >= rect.h ? 0 : model.summary.targetMm[j * rect.w + i] * 0.001;
};
let level = -0.6;
const depth = (/** @type {number} */ k) => {
  const [x, z] = grid.center(k);
  return Math.max(0, level - grid.height[k], pond(x, z));
};
// A frog sitting at the shore end of the bar, when asked for.
let frogOn = false;
const frogAt = layout ? [layout.from[0] * 0.98, layout.from[1] * 0.98] : [0, 0];
const nearest = (/** @type {number} */ x, /** @type {number} */ z) => (frogOn ? Math.hypot(x - frogAt[0], z - frogAt[1]) : Infinity);
let walker = createWalker(R, { grid, depth, ground, nearest });

// ---- drawing ----
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('map'));
const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
const tile = document.createElement('canvas');
const COLORS = {
  dry: [126, 158, 110], high: [176, 196, 150], steep: [140, 140, 132], wade: [168, 206, 214], deep: [47, 110, 134], sand: [222, 205, 170],
};
function paintTiles() {
  tile.width = grid.w; tile.height = grid.h;
  const t = /** @type {CanvasRenderingContext2D} */ (tile.getContext('2d'));
  const img = t.createImageData(grid.w, grid.h);
  for (let k = 0; k < grid.w * grid.h; k++) {
    const d = depth(k), h = grid.height[k];
    let c;
    if (d >= R.grid.wadeM) c = COLORS.deep;
    else if (grid.steep[k]) c = COLORS.steep;
    else if (d > 0.02) c = COLORS.wade;
    else if (h < 0.6) c = COLORS.sand;
    else { const f = Math.min(1, (h - 0.6) / 3); c = COLORS.dry.map((v, i) => v + (COLORS.high[i] - v) * f); }
    img.data.set([c[0], c[1], c[2], 255], k * 4);
  }
  t.putImageData(img, 0, 0);
}
/** World to canvas pixels. @param {number} x @param {number} z */
const toPx = (x, z) => [((x - grid.minX) / (grid.w * grid.cellM)) * canvas.width, ((z - grid.minZ) / (grid.h * grid.cellM)) * canvas.height];

function draw() {
  const r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  const size = Math.round(r.width * dpr);
  if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tile, 0, 0, canvas.width, canvas.height);
  const u = canvas.width / 400;
  if (frogOn) {
    const [fx, fz] = toPx(frogAt[0], frogAt[1]);
    ctx.fillStyle = '#5F7F5B'; ctx.strokeStyle = '#1E2624'; ctx.lineWidth = 1.5 * u;
    ctx.beginPath(); ctx.ellipse(fx, fz, 5 * u, 3.5 * u, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const [rx] = toPx(frogAt[0] + R.pace.creepNearM, frogAt[1]);
    ctx.setLineDash([3 * u, 3 * u]); ctx.beginPath(); ctx.arc(fx, fz, rx - fx, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  if (!walker.placed) return;
  const path = walker.path();
  if (path.length) {
    ctx.strokeStyle = walker.retreating ? '#B4573E' : '#1E2624';
    ctx.lineWidth = 2.5 * u; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(...toPx(walker.x, walker.z));
    for (const p of path) ctx.lineTo(...toPx(p[0], p[1]));
    ctx.stroke();
  }
  const [px, pz] = toPx(walker.x, walker.z);
  ctx.fillStyle = '#FFDE95'; ctx.strokeStyle = '#1E2624'; ctx.lineWidth = 2 * u;
  ctx.beginPath(); ctx.arc(px, pz, 5 * u, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // Facing.
  ctx.beginPath(); ctx.moveTo(px, pz); ctx.lineTo(px + Math.sin(walker.yaw) * 10 * u, pz + Math.cos(walker.yaw) * 10 * u); ctx.stroke();
}

// ---- input ----
const note = /** @type {HTMLElement} */ (document.getElementById('note'));
const say = (/** @type {string} */ s) => { note.textContent = s; };
let lastTap = 0;
canvas.addEventListener('pointerup', (e) => {
  const r = canvas.getBoundingClientRect();
  const x = grid.minX + ((e.clientX - r.left) / r.width) * grid.w * grid.cellM;
  const z = grid.minZ + ((e.clientY - r.top) / r.height) * grid.h * grid.cellM;
  const now = performance.now(), double = now - lastTap < R.pace.doubleTapMs;
  lastTap = now;
  if (!walker.placed) {
    say(walker.place(x, z) ? 'You are standing here. Tap anywhere to walk there.' : R.words.noGround);
    draw();
    return;
  }
  const res = walker.walkTo(x, z, double);
  if (res.ok) say(double ? 'Hurrying.' : '');
  else {
    const lowDepth = depthAtLow(depth, (k) => grid.height[k], level, -0.65);
    say(crossingNote(grid, walker.rules, [walker.x, walker.z], [x, z], { reason: res.reason, lowDepth, hoursToLow: hoursToLowOf(level), words: R.words }));
  }
});
/** A rough hours-to-low for the lab's hand-set level: as if the tide were falling from high water. @param {number} lvl */
const hoursToLowOf = (lvl) => (1 - Math.acos(Math.max(-1, Math.min(1, lvl / 0.65))) / Math.PI) * 6;

const levelIn = /** @type {HTMLInputElement} */ (document.getElementById('level'));
const levelOut = /** @type {HTMLOutputElement} */ (document.getElementById('level-out'));
function setLevel(/** @type {number} */ v) {
  level = v;
  levelIn.value = String(v);
  levelOut.textContent = `${v >= 0 ? '+' : ''}${v.toFixed(2)} m`;
  paintTiles(); draw();
}
levelIn.addEventListener('input', () => setLevel(Number(levelIn.value)));
for (const b of document.querySelectorAll('#tides button')) b.addEventListener('click', () => setLevel(Number(/** @type {HTMLElement} */ (b).dataset.level)));
const barBtn = /** @type {HTMLButtonElement} */ (document.getElementById('bar'));
barBtn.disabled = !layout;
barBtn.addEventListener('click', () => {
  barOn = !barOn && !!layout;
  barBtn.setAttribute('aria-pressed', String(barOn));
  barBtn.textContent = barOn ? 'Test sandbar on' : 'Test sandbar off';
  grid = createWalkGrid({ ground, ...box, cellM: R.grid.cellM, maxSlopeDeg: R.grid.maxSlopeDeg });
  const was = walker.placed ? [walker.x, walker.z] : null;
  walker = createWalker(R, { grid, depth, ground, nearest });
  if (was) walker.place(was[0], was[1]);
  paintTiles(); draw();
});
const frogBtn = /** @type {HTMLButtonElement} */ (document.getElementById('frog'));
frogBtn.disabled = !layout;
frogBtn.addEventListener('click', () => {
  frogOn = !frogOn;
  frogBtn.setAttribute('aria-pressed', String(frogOn));
  draw();
});

// ---- legend and stats ----
const legend = /** @type {HTMLElement} */ (document.getElementById('legend'));
const rgb = (/** @type {number[]} */ c) => `rgb(${c.map(Math.round).join(',')})`;
legend.innerHTML = [
  [COLORS.dry, 'Ground to stand on'], [COLORS.sand, 'Sand and shore'], [COLORS.wade, 'Water to wade, under 0.4 m'],
  [COLORS.deep, 'Too deep'], [COLORS.steep, 'Too steep'], [[255, 222, 149], 'You'],
].map(([c, t]) => `<span><i style="background:${rgb(/** @type {number[]} */ (c))}"></i>${t}</span>`).join('');
const stats = /** @type {HTMLElement} */ (document.getElementById('stats'));
function renderStats() {
  const k = walker.placed ? grid.cellAt(walker.x, walker.z) : -1;
  const pace = !walker.moving ? 'standing' : walker.retreating ? 'wading back' : walker.brisk ? 'hurrying' : walker.speed < R.pace.creepMps + 0.05 ? 'creeping' : 'strolling';
  stats.innerHTML = `<dt>Pace</dt><dd>${pace}</dd><dt>Speed</dt><dd>${walker.speed.toFixed(2)} m/s</dd>`
    + `<dt>Water here</dt><dd>${k >= 0 ? `${depth(k).toFixed(2)} m` : 'none'}</dd>`
    + `<dt>Grid</dt><dd>${grid.w} x ${grid.h} cells of ${grid.cellM} m</dd>`;
}

// ---- running ----
paintTiles();
setLevel(level);
let last = performance.now(), statAcc = 0;
function frame(/** @type {number} */ now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const moving = walker.moving;
  walker.update(dt);
  if (moving || walker.moving) draw();
  statAcc += dt;
  if (statAcc > 0.2) { statAcc = 0; renderStats(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
addEventListener('resize', draw);
say(layout ? 'Tap the map to stand somewhere, then tap again to walk.' : 'Tap the map to stand somewhere. (No room for the test sandbar on this island.)');
