// @ts-check
// The walk lab (doc 23, the walker; W1, and walking with the keys, October 26, 2026): the island on
// the walk grid, coloured by where you can stand at the tide you pick, with the test sandbar and islet
// the game's ?sandbar link builds. Click once to stand. Then W A S D (or the arrows) walk relative to
// the camera, Shift runs, Space rolls; in the follow view the mouse turns the camera (click the view to
// capture the pointer, Alt or Esc frees it). Clicking the map from above still walks there (double
// click hurries), and a key takes over from it. Sliders tune every pace live; the trace shows speed.
// CPU only: no WebGPU needed.

import { buildIslandModel } from '../src/world/island-model.js';
import { createMirror, syncFloat, sampleHeight } from '../src/world/terrain/heightfield.js';
import { WORLD_CELLS, CHUNK_SIZE } from '../src/world/terrain/grid.js';
import { waterCellOf } from '../src/world/water/grid.js';
import { createWalkGrid } from '../src/world/walk/grid.js';
import { createWalker } from '../src/world/walk/walker.js';
import { crossingNote, depthAtLow } from '../src/world/walk/crossing.js';
import { sandbarLayout, barHeight } from '../src/world/walk/sandbar.js';
import { attachMoveKeys, worldWay } from '../src/input/move-keys.js';

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
// A frog, for the creep: by the bar, or put down in front of you.
let frogOn = false;
let frogAt = layout ? [layout.from[0] * 0.98, layout.from[1] * 0.98] : [0, 0];
const nearest = (/** @type {number} */ x, /** @type {number} */ z) => (frogOn ? Math.hypot(x - frogAt[0], z - frogAt[1]) : Infinity);
let walker = createWalker(R, { grid, depth, ground, nearest });

// The camera: its yaw as in the game (the eye at +sin, +cos from you); the mouse turns it.
let camYaw = 0, camGoal = 0;
let follow = true;

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
const spanM = () => grid.w * grid.cellM;
/** Meters across the follow view. */
const FOLLOW_M = 16;
/** Set the canvas transform so world meters draw straight onto it; returns pixels a meter. */
function worldTransform() {
  if (follow && walker.placed) {
    const k = canvas.width / FOLLOW_M;
    // Turn the view so the camera's forward points up the screen.
    const [fx, fz] = worldWay(1, 0, camYaw);
    ctx.setTransform(1, 0, 0, 1, canvas.width / 2, canvas.height * 0.62);
    ctx.rotate(-Math.PI / 2 - Math.atan2(fz, fx));
    ctx.scale(k, k);
    ctx.translate(-walker.x, -walker.z);
    return k;
  }
  const k = canvas.width / spanM();
  ctx.setTransform(k, 0, 0, k, -grid.minX * k, -grid.minZ * k);
  return k;
}

function draw() {
  const r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  const size = Math.round(r.width * dpr);
  if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#2F6E86';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  const k = worldTransform();
  const u = 1 / k * Math.max(1, canvas.width / 400);
  ctx.drawImage(tile, grid.minX, grid.minZ, spanM(), grid.h * grid.cellM);
  if (frogOn) {
    ctx.fillStyle = '#5F7F5B'; ctx.strokeStyle = '#1E2624'; ctx.lineWidth = 1.5 * u;
    ctx.beginPath(); ctx.ellipse(frogAt[0], frogAt[1], 5 * u, 3.5 * u, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.setLineDash([3 * u, 3 * u]); ctx.beginPath(); ctx.arc(frogAt[0], frogAt[1], R.pace.creepNearM, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  if (!walker.placed) return;
  const path = walker.path();
  if (path.length) {
    ctx.strokeStyle = walker.retreating ? '#B4573E' : '#1E2624';
    ctx.lineWidth = 2.5 * u; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(walker.x, walker.z);
    for (const p of path) ctx.lineTo(p[0], p[1]);
    ctx.stroke();
  }
  // The camera behind you: a wedge from where it stands, looking your way.
  const [fx, fz] = worldWay(1, 0, camYaw);
  ctx.fillStyle = 'rgba(30, 38, 36, 0.18)';
  ctx.beginPath();
  ctx.moveTo(walker.x - fx * 3, walker.z - fz * 3);
  const a = Math.atan2(fz, fx);
  ctx.arc(walker.x - fx * 3, walker.z - fz * 3, 9, a - 0.45, a + 0.45);
  ctx.closePath(); ctx.fill();
  const rolling = walker.rolling >= 0;
  ctx.fillStyle = rolling ? '#E08A5B' : '#FFDE95'; ctx.strokeStyle = '#1E2624'; ctx.lineWidth = 2 * u;
  ctx.beginPath(); ctx.arc(walker.x, walker.z, Math.max(5 * u, 0.25), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // Facing.
  const fl = Math.max(10 * u, 0.6);
  ctx.beginPath(); ctx.moveTo(walker.x, walker.z); ctx.lineTo(walker.x + Math.sin(walker.yaw) * fl, walker.z + Math.cos(walker.yaw) * fl); ctx.stroke();
}

// ---- the speed trace ----
const trace = /** @type {HTMLCanvasElement} */ (document.getElementById('trace'));
const tctx = /** @type {CanvasRenderingContext2D} */ (trace.getContext('2d'));
const TRACE_S = 6;
/** @type {{ t: number, v: number, roll: boolean }[]} */ let samples = [];
let clockS = 0;
function drawTrace() {
  const r = trace.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (trace.width !== w || trace.height !== h) { trace.width = w; trace.height = h; }
  tctx.setTransform(1, 0, 0, 1, 0, 0);
  tctx.fillStyle = '#FBF7F0'; tctx.fillRect(0, 0, w, h);
  const top = Math.max(7, (R.steer.roll.distM / R.steer.roll.durS) * 1.05);
  const y = (/** @type {number} */ v) => h - 6 * dpr - (v / top) * (h - 12 * dpr);
  tctx.font = `600 ${15 * dpr}px Nunito, system-ui, sans-serif`;
  tctx.lineWidth = 1 * dpr;
  for (const [v, name] of /** @type {[number, string][]} */ ([[R.pace.creepMps, 'creep'], [R.pace.strollMps, 'walk'], [R.pace.briskMps, 'run']])) {
    tctx.strokeStyle = '#E3D9C9'; tctx.beginPath(); tctx.moveTo(0, y(v)); tctx.lineTo(w, y(v)); tctx.stroke();
    tctx.fillStyle = '#4A5551'; tctx.fillText(`${name} ${v.toFixed(1)}`, 6 * dpr, y(v) - 4 * dpr);
  }
  tctx.lineWidth = 2.5 * dpr; tctx.lineJoin = 'round';
  tctx.strokeStyle = '#2E4A2C';
  tctx.beginPath();
  samples.forEach((s, i) => {
    const x = w - ((clockS - s.t) / TRACE_S) * w;
    if (i) tctx.lineTo(x, y(s.v)); else tctx.moveTo(x, y(s.v));
  });
  tctx.stroke();
  // Rolls shaded.
  tctx.fillStyle = 'rgba(224, 138, 91, 0.35)';
  for (const s of samples) if (s.roll) tctx.fillRect(w - ((clockS - s.t) / TRACE_S) * w, 0, 2 * dpr, h);
}

// ---- input ----
const note = /** @type {HTMLElement} */ (document.getElementById('note'));
const say = (/** @type {string} */ s) => { note.textContent = s; };
const locked = () => document.pointerLockElement === canvas;
canvas.addEventListener('click', (e) => {
  if (!walker.placed) {
    // Not standing yet, the view is the whole map.
    const r = canvas.getBoundingClientRect();
    const x = grid.minX + ((e.clientX - r.left) / r.width) * spanM();
    const z = grid.minZ + ((e.clientY - r.top) / r.height) * grid.h * grid.cellM;
    say(walker.place(x, z) ? 'You are standing here. Walk with W A S D; click the view to turn it with the mouse.' : R.words.noGround);
    draw();
    return;
  }
  // The follow view: a click captures the pointer for mouse look, as in the game.
  if (follow) { if (!locked()) canvas.requestPointerLock(); return; }
  const r = canvas.getBoundingClientRect();
  const x = grid.minX + ((e.clientX - r.left) / r.width) * spanM();
  const z = grid.minZ + ((e.clientY - r.top) / r.height) * grid.h * grid.cellM;
  const double = e.detail >= 2;   // the second click of a double click hurries
  const res = walker.walkTo(x, z, double);
  if (res.ok) say(double ? 'Hurrying.' : '');
  else {
    const lowDepth = depthAtLow(depth, (k) => grid.height[k], level, -0.65);
    say(crossingNote(grid, walker.rules, [walker.x, walker.z], [x, z], { reason: res.reason, lowDepth, hoursToLow: hoursToLowOf(level), words: R.words }));
  }
});
canvas.addEventListener('mousemove', (e) => {
  if (!locked()) return;
  camGoal -= e.movementX * R.steer.look.degPerPx * Math.PI / 180;
});
document.addEventListener('pointerlockchange', () => {
  lookBadge.hidden = !locked();
  say(locked() ? 'The mouse turns the view. Hold Alt or press Esc to free the pointer.' : '');
});
// Hold Alt: the pointer is free (the browser's Alt menu is kept from taking focus); let go: back to look.
let altFreed = false;
addEventListener('keydown', (e) => {
  if (e.key !== 'Alt') return;
  e.preventDefault();
  if (locked()) { altFreed = true; document.exitPointerLock(); }
});
addEventListener('keyup', (e) => {
  if (e.key !== 'Alt') return;
  e.preventDefault();
  if (altFreed && follow) { altFreed = false; canvas.requestPointerLock()?.catch?.(() => {}); }
});
const lookBadge = /** @type {HTMLElement} */ (document.getElementById('look-badge'));

const keys = attachMoveKeys(window, {
  onPress(name) {
    if (!walker.placed) return false;
    // A key takes over from a click walk (never from wading back from the tide).
    if (name === 'move') { if (walker.pathing && !walker.retreating) walker.stop(); return true; }
    const a = keys.axes();
    const [x, z] = worldWay(a.forward, a.right, camYaw);
    walker.roll(x, z);
    return true;
  },
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
  const feel = walker.feel;
  walker = createWalker(R, { grid, depth, ground, nearest });
  walker.setFeel(feel);
  if (was) walker.place(was[0], was[1]);
  paintTiles(); draw();
});
const frogBtn = /** @type {HTMLButtonElement} */ (document.getElementById('frog'));
frogBtn.addEventListener('click', () => {
  frogOn = !frogOn;
  // In front of you when you stand somewhere, else by the bar.
  if (frogOn && walker.placed) frogAt = [walker.x + Math.sin(walker.yaw) * 5, walker.z + Math.cos(walker.yaw) * 5];
  frogBtn.setAttribute('aria-pressed', String(frogOn));
  draw();
});
const viewBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('#view button'));
for (const b of viewBtns) b.addEventListener('click', () => {
  follow = b.dataset.view === 'follow';
  for (const o of viewBtns) o.setAttribute('aria-pressed', String(o === b));
  if (!follow && locked()) document.exitPointerLock();
  draw();
});

// ---- the feel: two profiles and the sliders ----
const feelBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('#feel button'));
for (const b of feelBtns) b.addEventListener('click', () => {
  walker.setFeel(/** @type {string} */ (b.dataset.feel));
  for (const o of feelBtns) o.setAttribute('aria-pressed', String(o === b));
  buildSliders();
});
/** [label, object getter, key, min, max, step, unit] */
const SLIDERS = /** @type {[string, () => any, string, number, number, number, string][]} */ ([
  ['Walk', () => R.pace, 'strollMps', 1, 4, 0.1, 'm/s'],
  ['Run (Shift)', () => R.pace, 'briskMps', 2, 7, 0.1, 'm/s'],
  ['Creep near a creature', () => R.pace, 'creepMps', 0.2, 1.5, 0.05, 'm/s'],
  ['Wading', () => R.pace, 'wadeMps', 0.4, 2, 0.05, 'm/s'],
  ['Up to full speed', () => R.steer.profiles[walker.feel], 'accelS', 0.03, 0.8, 0.01, 's'],
  ['To a stop', () => R.steer.profiles[walker.feel], 'stopS', 0.03, 0.5, 0.01, 's'],
  ['Turning', () => R.steer.profiles[walker.feel], 'turnDegPerS', 180, 1440, 10, 'deg/s'],
  ['Pace kept in a sharp turn', () => R.steer.profiles[walker.feel], 'turnSlowFloor', 0, 1, 0.05, ''],
  ['Roll distance', () => R.steer.roll, 'distM', 1, 4, 0.1, 'm'],
  ['Roll time', () => R.steer.roll, 'durS', 0.2, 0.8, 0.02, 's'],
  ['Wait between rolls', () => R.steer.roll, 'waitS', 0, 1, 0.05, 's'],
  ['Mouse look', () => R.steer.look, 'degPerPx', 0.03, 0.4, 0.01, 'deg/px'],
]);
const sliders = /** @type {HTMLElement} */ (document.getElementById('sliders'));
const numbers = /** @type {HTMLElement} */ (document.getElementById('numbers'));
function showNumbers() {
  const f = R.steer.profiles[walker.feel];
  numbers.textContent = `walk ${R.pace.strollMps}, run ${R.pace.briskMps}, creep ${R.pace.creepMps}, wade ${R.pace.wadeMps} m/s; `
    + `${walker.feel}: up ${f.accelS} s, stop ${f.stopS} s, turn ${f.turnDegPerS} deg/s, sharp turn ${f.turnSlowFloor}; `
    + `roll ${R.steer.roll.distM} m in ${R.steer.roll.durS} s, wait ${R.steer.roll.waitS} s; mouse ${R.steer.look.degPerPx} deg/px`;
}
function buildSliders() {
  sliders.innerHTML = '';
  SLIDERS.forEach(([label, obj, key, min, max, step, unit], i) => {
    const row = document.createElement('div');
    row.className = 'slider';
    row.innerHTML = `<label for="s${i}">${label}</label><input id="s${i}" type="range" min="${min}" max="${max}" step="${step}" value="${obj()[key]}"><output for="s${i}"></output>`;
    const input = /** @type {HTMLInputElement} */ (row.querySelector('input')), out = /** @type {HTMLOutputElement} */ (row.querySelector('output'));
    const show = () => { out.textContent = `${obj()[key]} ${unit}`.trim(); };
    input.addEventListener('input', () => { obj()[key] = Number(input.value); show(); showNumbers(); });
    // Keys on a slider are for the slider; give the keys back to walking afterwards.
    input.addEventListener('change', () => input.blur());
    show();
    sliders.append(row);
  });
  showNumbers();
}
buildSliders();

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
  const pace = walker.rolling >= 0 ? 'rolling' : !walker.moving ? 'standing' : walker.retreating ? 'wading back'
    : walker.speed > R.pace.strollMps + 0.1 ? 'running' : walker.speed < R.pace.creepMps + 0.05 ? 'creeping' : 'walking';
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
  clockS += dt;
  // The mouse's turn eases in over look.halfLifeS, as in the game.
  camYaw += (camGoal - camYaw) * (1 - 2 ** (-dt / Math.max(1e-3, R.steer.look.halfLifeS)));
  if (walker.placed) {
    const a = keys.axes();
    const [x, z] = worldWay(a.forward, a.right, camYaw);
    walker.steer(x, z, keys.run);
  }
  walker.update(dt);
  samples.push({ t: clockS, v: walker.speed, roll: walker.rolling >= 0 });
  samples = samples.filter((s) => clockS - s.t <= TRACE_S);
  draw();
  drawTrace();
  statAcc += dt;
  if (statAcc > 0.2) { statAcc = 0; renderStats(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
addEventListener('resize', draw);
say('Click the map to stand somewhere. Then walk with W A S D.');
