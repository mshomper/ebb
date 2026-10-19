// @ts-check
// ebb creature studio (the S6 creature studio plan, Matt's tool): the frog on a paused stage, built
// by the game's own bake (src/world/creatures/bodies.js, on the worker pool) and posed by its own
// bones, with sliders for the look half of recipes/species/frog.json: proportions, colors and pattern,
// eyes, variety and the idle motion. Edits show at once (a coarse bake while you drag, the full one
// when you let go) and are kept in this browser until you save. Save to repo writes
// recipes/species/frog.json in your ebb folder, changing only the numbers you moved
// (tools/recipe-text.js); Download saves the same file to your downloads. The life half (needs,
// arrival, presence, trust) is not here: it changes how the game plays, so it stays in the file.

import { run } from '../src/core/workers.js';
import { poseSkeleton, idleMoves } from '../src/world/creatures/pose.js';
import { MAX_BONES } from '../src/world/creatures/bodies.js';
import { createStage, VIEWS } from './creature-studio-stage.js';
import { changedPaths, patchText, at } from './recipe-text.js';

const BAKE = { module: './world/creatures/bodies.js', fn: 'bakeVariant' };
const STORE = 'ebb.creatureStudio.frog';
const FILE = '../recipes/species/frog.json';
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @typedef {{ path: string, label: string, min?: number, max?: number, step?: number, unit?: (v: number) => string, color?: boolean, rebake?: boolean }} Row */

const x = (/** @type {number} */ v) => `${v.toFixed(2)}x`;
/** The sliders, by group. Paths into the recipe; body paths rebake, motion paths only animate. @type {{ title: string, note: string, rows: Row[] }[]} */
const GROUPS = [
  { title: 'Shape', note: 'Proportions of the body. 1 is the recipe body; each frog then varies a little around it.', rows: [
    { path: 'body.shape.torsoLen', label: 'Torso length', min: 0.65, max: 1.4, step: 0.01, unit: x },
    { path: 'body.shape.torsoWid', label: 'Torso width', min: 0.55, max: 1.5, step: 0.01, unit: x },
    { path: 'body.shape.torsoHgt', label: 'Torso height', min: 0.55, max: 1.7, step: 0.01, unit: x },
    { path: 'body.shape.headSize', label: 'Head size', min: 0.7, max: 1.4, step: 0.01, unit: x },
    { path: 'body.shape.eyeSize', label: 'Eye size', min: 0.6, max: 1.45, step: 0.01, unit: x },
    { path: 'body.shape.sacSize', label: 'Throat sac size', min: 0.6, max: 1.6, step: 0.01, unit: x },
    { path: 'body.shape.hindThick', label: 'Hind leg thickness', min: 0.6, max: 1.6, step: 0.01, unit: x },
  ] },
  { title: 'Color and pattern', note: 'Physical colors (albedo). In the game the palette still paints last, so the island may look warmer or cooler than here.', rows: [
    { path: 'body.albedo.back', label: 'Back', color: true },
    { path: 'body.albedo.belly', label: 'Belly', color: true },
    { path: 'body.albedo.blotch', label: 'Blotches', color: true },
    { path: 'body.blotch.amount', label: 'Blotch cover', min: 0, max: 1, step: 0.01, unit: (v) => v.toFixed(2) },
    { path: 'body.blotch.scale', label: 'Blotch fineness', min: 60, max: 320, step: 5, unit: (v) => `${v} per m` },
  ] },
  { title: 'Eyes', note: 'A dark pupil in a flecked gold iris, hooded by the lids.', rows: [
    { path: 'body.albedo.eyeRing', label: 'Iris', color: true },
    { path: 'body.albedo.fleck', label: 'Iris flecks', color: true },
    { path: 'body.eyeLook.pupil.0', label: 'Pupil width', min: 0.3, max: 0.95, step: 0.01, unit: (v) => v.toFixed(2) },
    { path: 'body.eyeLook.pupil.1', label: 'Pupil height', min: 0.2, max: 0.8, step: 0.01, unit: (v) => v.toFixed(2) },
    { path: 'body.eyeLook.fleckShare', label: 'Fewer flecks', min: 0, max: 0.9, step: 0.01, unit: (v) => v.toFixed(2) },
    { path: 'body.eyeGlint.strength', label: 'Wet glint (game only)', min: 0, max: 2, step: 0.05, unit: (v) => v.toFixed(2), rebake: false },
  ] },
  { title: 'Variety and size', note: 'How much frogs differ from each other, and how large they are drawn in the game.', rows: [
    { path: 'body.variation', label: 'Variation between frogs', min: 0, max: 0.12, step: 0.005, unit: (v) => `${Math.round(v * 100)}%` },
    { path: 'body.sizeJitter', label: 'Size difference', min: 0, max: 0.2, step: 0.01, unit: (v) => `${Math.round(v * 100)}%`, rebake: false },
    { path: 'body.displayScale', label: 'Drawn size in the game', min: 1, max: 4, step: 0.1, unit: x, rebake: false },
  ] },
  { title: 'Idle motion', note: 'Breathing, blinking and the call, as the frogs do them.', rows: [
    { path: 'motion.breath.hz', label: 'Breaths a second', min: 0.3, max: 3, step: 0.05, unit: (v) => v.toFixed(2) },
    { path: 'motion.breath.sac', label: 'Throat swell when breathing', min: 0, max: 0.3, step: 0.01, unit: (v) => v.toFixed(2) },
    { path: 'motion.blink.retractM', label: 'How far the eyes sink in a blink', min: 0, max: 0.007, step: 0.0005, unit: (v) => `${(v * 1000).toFixed(1)} mm` },
    { path: 'motion.call.inflate', label: 'Sac size when calling', min: 0.5, max: 3, step: 0.05, unit: x },
  ] },
];
const rowOf = new Map(GROUPS.flatMap((g) => g.rows.map((r) => [r.path, r])));

/** @param {any} obj @param {string} path @param {any} v */
function setAt(obj, path, v) {
  const ks = path.split('.');
  const last = /** @type {string} */ (ks.pop());
  ks.reduce((o, k) => o[k], obj)[last] = v;
}
const clone = (/** @type {any} */ o) => JSON.parse(JSON.stringify(o));
const toHex = (/** @type {number[]} */ lin) => `#${lin.map((c) => Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (/** @type {string} */ h) => [1, 3, 5].map((i) => { const s = parseInt(h.slice(i, i + 2), 16) / 255; return Math.round((s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) * 1e4) / 1e4; });

// --- the recipe: as the file is, and as edited here ---
const fileText = await fetch(FILE).then((r) => r.text());
let base = JSON.parse(fileText), baseText = fileText;
let work = clone(base);
try {
  const kept = localStorage.getItem(STORE);
  if (kept) work = JSON.parse(kept);
} catch { /* storage blocked: edits last this visit */ }
const keep = () => { try { localStorage.setItem(STORE, JSON.stringify(work)); } catch { /* blocked */ } };
const forget = () => { try { localStorage.removeItem(STORE); } catch { /* blocked */ } };

// --- the stage ---
const made = await createStage(/** @type {HTMLCanvasElement} */ ($('stage')));
if (!made.ok) {
  $('status').textContent = `WebGPU is not available here (${made.reason}). Open this page in current Chrome or Edge.`;
  throw new Error('no WebGPU');
}
const stage = made.stage;
let variant = -1, gameSize = false, idle = true, calling = false;
/** @type {{ name: string, parent: number, pivot: number[] }[]} */ let bones = [];
const mats = new Float32Array(MAX_BONES * 16);

// --- baking: a coarse body at once, the full one when the sliders settle; a newer edit wins ---
let version = 0, fineTimer = 0;
/** @param {number} cellM @param {number} v */
async function bake(cellM, v) {
  const t0 = performance.now();
  const r = await run(BAKE, { id: 'frog', body: work.body, variant, cellM });
  if (v !== version) return;
  stage.setMesh(r);
  bones = r.bones;
  const f = new Float32Array(r.data);
  let min = [1, 1, 1], max = [-1, -1, -1];
  for (let i = 0; i < r.count; i++) for (let a = 0; a < 3; a++) { const p = f[i * 11 + a]; min[a] = Math.min(min[a], p); max[a] = Math.max(max[a], p); }
  $('info').textContent = `${(r.indices.length / 3).toLocaleString()} triangles at ${(cellM * 1000).toFixed(1)} mm, baked in ${Math.round(performance.now() - t0)} ms. `
    + `Real size ${((max[2] - min[2]) * 100).toFixed(1)} cm long, ${((max[1] - min[1]) * 100).toFixed(1)} cm tall; drawn ${work.body.displayScale}x in the game.`;
}
function rebake() {
  const v = ++version;
  bake(0.0033, v).catch((e) => { $('status').textContent = `The bake failed: ${e.message}`; });
  clearTimeout(fineTimer);
  fineTimer = window.setTimeout(() => { if (v === version) bake(0.0011, v).catch(() => {}); }, 450);
}

// --- the sliders ---
function render() {
  $('groups').innerHTML = GROUPS.map((g) => `<section class="card"><h2>${g.title}</h2><p class="muted">${g.note}</p>${g.rows.map((r) => {
    const v = at(work, r.path), was = at(base, r.path);
    const moved = JSON.stringify(v) !== JSON.stringify(was);
    if (r.color) {
      return `<label class="row${moved ? ' moved' : ''}"><span class="lbl"><span>${r.label}</span><span class="val">${toHex(v)}</span></span>
        <input type="color" data-path="${r.path}" value="${toHex(v)}"></label>`;
    }
    return `<label class="row${moved ? ' moved' : ''}"><span class="lbl"><span>${r.label}</span><span class="val">${r.unit ? r.unit(v) : v}</span></span>
      <input type="range" data-path="${r.path}" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}"></label>`;
  }).join('')}</section>`).join('');
  status();
}
function status() {
  const n = changedPaths(base, work).length;
  $('status').innerHTML = n
    ? `<span class="dot" aria-hidden="true"></span><span>${n} change${n === 1 ? '' : 's'} not yet saved to the recipe file. They are kept in this browser until you save or undo them.</span>`
    : '<span>The frog as the recipe file has it.</span>';
}
$('groups').addEventListener('input', (e) => {
  const el = /** @type {HTMLInputElement} */ (e.target);
  const path = el.dataset.path;
  if (!path) return;
  const r = /** @type {Row} */ (rowOf.get(path));
  const v = r.color ? fromHex(el.value) : Number(el.value);
  setAt(work, path, v);
  const label = el.closest('.row');
  const val = label?.querySelector('.val');
  if (val) val.textContent = r.color ? el.value : r.unit ? r.unit(/** @type {number} */ (v)) : String(v);
  label?.classList.toggle('moved', JSON.stringify(v) !== JSON.stringify(at(base, path)));
  keep();
  status();
  if (path.startsWith('body.') && r.rebake !== false) rebake();
  if (path === 'body.displayScale') stage.setScale(gameSize ? work.body.displayScale : 1);
});

// --- views, specimen, motion ---
$('views').addEventListener('click', (e) => {
  const b = /** @type {HTMLElement} */ (e.target).closest('button');
  if (!b?.dataset.view) return;
  for (const o of $('views').querySelectorAll('button')) o.setAttribute('aria-pressed', String(o === b));
  stage.view(/** @type {keyof typeof VIEWS} */ (b.dataset.view));
});
$('specimen').addEventListener('change', () => { variant = Number(/** @type {HTMLSelectElement} */ ($('specimen')).value); rebake(); });
$('game-size').addEventListener('click', () => {
  gameSize = !gameSize;
  $('game-size').setAttribute('aria-pressed', String(gameSize));
  stage.setScale(gameSize ? work.body.displayScale : 1);
});
$('idle').addEventListener('click', () => { idle = !idle; $('idle').setAttribute('aria-pressed', String(idle)); });
$('call').addEventListener('click', () => { calling = !calling; $('call').setAttribute('aria-pressed', String(calling)); });

// --- saving ---
const say = (/** @type {string} */ t) => { $('saved').textContent = t; };
$('undo').addEventListener('click', () => {
  work = clone(base);
  forget();
  render();
  rebake();
  say('Back to the recipe file.');
});
$('download').addEventListener('click', () => {
  const paths = changedPaths(base, work);
  const text = patchText(baseText, work, paths);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = 'frog.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  say(`Downloaded frog.json with ${paths.length} change${paths.length === 1 ? '' : 's'}. Put it in recipes/species to use it.`);
});
/** @type {any} */ let repo = null;
if (!('showDirectoryPicker' in window)) $('save').hidden = true;
$('save').addEventListener('click', async () => {
  try {
    repo ??= await /** @type {any} */ (window).showDirectoryPicker({ id: 'ebb-repo', mode: 'readwrite' });
    const species = await (await repo.getDirectoryHandle('recipes')).getDirectoryHandle('species');
    const fh = await species.getFileHandle('frog.json');
    const text = await (await fh.getFile()).text();
    const paths = changedPaths(JSON.parse(text), work);
    if (!paths.length) { say('The recipe file already has these numbers.'); return; }
    const out = patchText(text, work, paths);
    const w = await fh.createWritable();
    await w.write(out);
    await w.close();
    base = JSON.parse(out); baseText = out;
    forget();
    render();
    say(`Saved ${paths.length} change${paths.length === 1 ? '' : 's'} to recipes/species/frog.json. Commit it in GitHub Desktop.`);
  } catch (e) {
    const err = /** @type {Error} */ (e);
    repo = null;
    if (err.name !== 'AbortError') say(`Could not save: ${err.message}. Pick the ebb folder (the one with recipes in it).`);
  }
});

// --- the frame: pose and draw ---
const t0 = performance.now();
function frame() {
  const t = (performance.now() - t0) / 1000;
  if (bones.length) {
    const moves = idle ? idleMoves(bones, t, 1, work.motion) : bones.map(() => null);
    if (calling) {
      // A call every three seconds: the sac swells over pulseS and settles.
      const C = work.motion.call, p = (t % 3) / C.pulseS;
      const k = p < 1 ? Math.sin(Math.PI * p) * C.inflate : 0;
      const i = bones.findIndex((b) => b.name === 'throat');
      if (i >= 0 && k > 0) moves[i] = { s: [1 + 0.4 * k, 1 + k, 1 + 0.7 * k] };
    }
    poseSkeleton(bones, moves, mats, 0);
    stage.setBones(mats);
  }
  stage.draw();
  requestAnimationFrame(frame);
}
render();
rebake();
requestAnimationFrame(frame);
