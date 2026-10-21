// @ts-check
// ebb creature studio (the S6 creature studio plan, Matt's tool; any species since M2, doc 11
// "Tools that take any species"): one creature on a stage, built by the game's own bake
// (src/world/creatures/bodies.js, on the worker pool) and posed by its own bones and its own motion
// (the frog's idle moves, a minnow's tail beat, a dragonfly's wing beat), with sliders for the look
// half of its recipe. The species, their sliders and their motions are a table
// (creature-studio-species.js). Edits show at once (a coarse bake while you drag, the full one when
// you let go) and are kept in this browser, per species, until you save. Save to repo writes
// recipes/species/<id>.json in your ebb folder, changing only the numbers you moved
// (tools/recipe-text.js); Download saves the same file to your downloads. The life half (needs,
// arrival, presence, trust) is not here: it changes how the game plays, so it stays in the file.

import { run } from '../src/core/workers.js';
import { poseSkeleton } from '../src/world/creatures/pose.js';
import { MAX_BONES } from '../src/world/creatures/bodies.js';
import { createStage, VIEWS } from './creature-studio-stage.js';
import { changedPaths, patchText, at } from './recipe-text.js';
import { SPECIES, rowsOf, sizeOf, setSize } from './creature-studio-species.js';

/** @typedef {import('./creature-studio-species.js').Row} Row @typedef {import('./creature-studio-species.js').Species} Species */

const BAKE = { module: './world/creatures/bodies.js', fn: 'bakeVariant' };
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const store = {
  get: (/** @type {string} */ k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (/** @type {string} */ k, /** @type {string} */ v) => { try { localStorage.setItem(k, v); } catch { /* blocked: edits last this visit */ } },
  drop: (/** @type {string} */ k) => { try { localStorage.removeItem(k); } catch { /* blocked */ } },
};
const keyFor = (/** @type {string} */ id) => `ebb.creatureStudio.${id}`;

/** @param {any} obj @param {string} path @param {any} v */
function setAt(obj, path, v) {
  const ks = path.split('.');
  const last = /** @type {string} */ (ks.pop());
  ks.reduce((o, k) => o[k], obj)[last] = v;
}
const clone = (/** @type {any} */ o) => JSON.parse(JSON.stringify(o));
const toHex = (/** @type {number[]} */ lin) => `#${lin.map((c) => Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (/** @type {string} */ h) => [1, 3, 5].map((i) => { const s = parseInt(h.slice(i, i + 2), 16) / 255; return Math.round((s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) * 1e4) / 1e4; });

// --- the stage ---
const made = await createStage(/** @type {HTMLCanvasElement} */ ($('stage')));
if (!made.ok) {
  $('status').textContent = `WebGPU is not available here (${made.reason}). Open this page in current Chrome or Edge.`;
  throw new Error('no WebGPU');
}
const stage = made.stage;

// --- the species on the stage, its recipe as the file is (base) and as edited here (work) ---
/** @type {Species} */ let S = SPECIES.frog;
/** @type {Map<string, Row>} */ let rows = new Map();
/** @type {any} */ let base = null, work = null;
let baseText = '';
let variant = -1, gameSize = false, playing = true, speed = 1, mode = 'idle';
let animT = 0;
const clock = { phase: 0 };
/** @type {{ name: string, parent: number, pivot: number[] }[]} */ let bones = [];
const mats = new Float32Array(MAX_BONES * 16);
const file = () => `${S.id}.json`;
const keep = () => store.set(keyFor(S.id), JSON.stringify(work));
const say = (/** @type {string} */ t) => { $('saved').textContent = t; };

/** A slider's value in a recipe (a size row: its stretch from the file). @param {Row} r @param {any} obj */
const valueOf = (r, obj) => (r.size ? sizeOf(r.size, base, obj) : at(obj, /** @type {string} */ (r.path)));
/** Whether a slider has moved from the file. @param {Row} r @param {any} v */
const movedFrom = (r, v) => (r.size ? Math.abs(v - 1) > 1e-4 : JSON.stringify(v) !== JSON.stringify(at(base, /** @type {string} */ (r.path))));

// --- baking: a coarse body at once, the full one when the sliders settle; a newer edit wins ---
let version = 0, fineTimer = 0;
/** @param {number} cellM @param {number} v */
async function bake(cellM, v) {
  const t0 = performance.now();
  const r = await run(BAKE, { id: S.id, body: work.body, variant, cellM });
  if (v !== version) return;
  stage.setMesh(r);
  bones = r.bones;
  const f = new Float32Array(r.data);
  let min = [1, 1, 1], max = [-1, -1, -1];
  for (let i = 0; i < r.count; i++) for (let a = 0; a < 3; a++) { const p = f[i * 11 + a]; min[a] = Math.min(min[a], p); max[a] = Math.max(max[a], p); }
  const cm = (/** @type {number} */ a) => ((max[a] - min[a]) * 100).toFixed(1);
  $('info').textContent = `${(r.indices.length / 3).toLocaleString()} triangles at ${(cellM * 1000).toFixed(1)} mm, baked in ${Math.round(performance.now() - t0)} ms. `
    + `Real size ${cm(2)} cm long, ${cm(0)} cm wide, ${cm(1)} cm tall; drawn ${work.body.displayScale}x in the game.`;
}
function rebake() {
  const v = ++version;
  // The species' own bake: its nearest level of detail when you let go, its middle one while you
  // drag (thin wings and fins hold at that, as they do in the game).
  const lods = base.bake?.lods ?? [];
  const fine = lods[0]?.cellM ?? base.bake?.cellM ?? 0.0011, coarse = lods[1]?.cellM ?? fine * 3;
  bake(coarse, v).catch((e) => { $('status').textContent = `The bake failed: ${e.message}`; });
  clearTimeout(fineTimer);
  fineTimer = window.setTimeout(() => { if (v === version) bake(fine, v).catch(() => {}); }, 450);
}

/** Put a species on the stage: its file, any edits kept for it, its sliders and motions. @param {string} id */
async function choose(id) {
  S = SPECIES[/** @type {keyof typeof SPECIES} */ (id)] ?? SPECIES.frog;
  rows = rowsOf(S);
  store.set('ebb.creatureStudio.species', S.id);
  for (const b of $('species').querySelectorAll('button')) b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.species === S.id));
  $('stage').setAttribute('aria-label', `The ${S.name.toLowerCase()} on the stage`);
  version++;
  bones = [];
  stage.clear();
  $('info').textContent = 'Baking.';
  baseText = await fetch(`../recipes/species/${file()}`, { cache: 'no-store' }).then((r) => r.text());
  base = JSON.parse(baseText);
  work = clone(base);
  const kept = store.get(keyFor(S.id));
  if (kept) { try { work = JSON.parse(kept); } catch { /* a broken copy: start from the file */ } }
  // The specimens: the plain recipe body, then each seeded variant the game bakes.
  const n = base.body.variants ?? 8;
  $('specimen').innerHTML = `<option value="-1">The recipe body</option>${Array.from({ length: n }, (_, i) => `<option value="${i}">Variant ${i + 1}</option>`).join('')}`;
  variant = -1;
  mode = S.defaultMode;
  $('modes').innerHTML = S.modes.map((m) => `<button type="button" data-mode="${m.id}" aria-pressed="${m.id === mode}">${m.label}</button>`).join('');
  stage.setFraming(S.frame);
  stage.setScale(gameSize ? work.body.displayScale : 1);
  $('save-note').textContent = `Save to repo asks once for your ebb folder (the one with recipes in it), then writes recipes/species/${file()}. Download saves the same file to your downloads.`;
  say('');
  render();
  rebake();
}

// --- the sliders ---
function render() {
  $('groups').innerHTML = S.groups.map((g, gi) => `<section class="card"><h2>${g.title}</h2><p class="muted">${g.note}</p>${g.rows.map((r, ri) => {
    const key = r.path ?? `size:${gi}.${ri}`;
    const v = valueOf(r, work);
    const moved = movedFrom(r, v) ? ' moved' : '';
    if (r.color) {
      return `<label class="row${moved}"><span class="lbl"><span>${r.label}</span><span class="val">${toHex(v)}</span></span>
        <input type="color" data-key="${key}" value="${toHex(v)}"></label>`;
    }
    return `<label class="row${moved}"><span class="lbl"><span>${r.label}</span><span class="val">${r.unit ? r.unit(v) : v}</span></span>
      <input type="range" data-key="${key}" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}"></label>`;
  }).join('')}</section>`).join('');
  status();
}
function status() {
  const n = changedPaths(base, work).length;
  const who = S.name.toLowerCase();
  $('status').innerHTML = n
    ? `<span class="dot" aria-hidden="true"></span><span>${n} change${n === 1 ? '' : 's'} to the ${who} not yet saved to ${file()}. They are kept in this browser until you save or undo them.</span>`
    : `<span>The ${who} as ${file()} has it.</span>`;
}
$('groups').addEventListener('input', (e) => {
  const el = /** @type {HTMLInputElement} */ (e.target);
  const key = el.dataset.key;
  const r = key ? rows.get(key) : null;
  if (!r) return;
  const v = r.color ? fromHex(el.value) : Number(el.value);
  if (r.size) setSize(r.size, /** @type {number} */ (v), base, work);
  else setAt(work, /** @type {string} */ (r.path), v);
  const label = el.closest('.row');
  const val = label?.querySelector('.val');
  if (val) val.textContent = r.color ? el.value : r.unit ? r.unit(/** @type {number} */ (v)) : String(v);
  label?.classList.toggle('moved', movedFrom(r, v));
  keep();
  status();
  if ((r.size || r.path?.startsWith('body.')) && r.rebake !== false) rebake();
  if (r.path === 'body.displayScale') stage.setScale(gameSize ? work.body.displayScale : 1);
});

// --- species, views, specimen, motion ---
$('species').addEventListener('click', (e) => {
  const id = /** @type {HTMLElement} */ (e.target).closest('button')?.dataset.species;
  if (id && id !== S.id) choose(id).catch((err) => { $('status').textContent = `Could not load ${id}.json: ${err.message}`; });
});
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
$('modes').addEventListener('click', (e) => {
  const b = /** @type {HTMLElement} */ (e.target).closest('button');
  if (!b?.dataset.mode) return;
  mode = b.dataset.mode;
  for (const o of $('modes').querySelectorAll('button')) o.setAttribute('aria-pressed', String(o === b));
});
$('play').addEventListener('click', () => {
  playing = !playing;
  $('play').textContent = playing ? 'Pause' : 'Play';
  $('play').setAttribute('aria-pressed', String(!playing));
});
$('speed').addEventListener('change', () => { speed = Number(/** @type {HTMLSelectElement} */ ($('speed')).value); });

// --- saving ---
$('undo').addEventListener('click', () => {
  work = clone(base);
  store.drop(keyFor(S.id));
  render();
  rebake();
  say(`Back to ${file()}.`);
});
$('download').addEventListener('click', () => {
  const paths = changedPaths(base, work);
  const text = patchText(baseText, work, paths);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = file();
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  say(`Downloaded ${file()} with ${paths.length} change${paths.length === 1 ? '' : 's'}. Put it in recipes/species to use it.`);
});
/** @type {any} */ let repo = null;
if (!('showDirectoryPicker' in window)) $('save').hidden = true;
$('save').addEventListener('click', async () => {
  try {
    repo ??= await /** @type {any} */ (window).showDirectoryPicker({ id: 'ebb-repo', mode: 'readwrite' });
    const species = await (await repo.getDirectoryHandle('recipes')).getDirectoryHandle('species');
    const fh = await species.getFileHandle(file());
    const text = await (await fh.getFile()).text();
    const paths = changedPaths(JSON.parse(text), work);
    if (!paths.length) { say(`${file()} already has these numbers.`); return; }
    const out = patchText(text, work, paths);
    const w = await fh.createWritable();
    await w.write(out);
    await w.close();
    base = JSON.parse(out); baseText = out;
    store.drop(keyFor(S.id));
    render();
    say(`Saved ${paths.length} change${paths.length === 1 ? '' : 's'} to recipes/species/${file()}. Commit it in GitHub Desktop.`);
  } catch (e) {
    const err = /** @type {Error} */ (e);
    repo = null;
    if (err.name !== 'AbortError') say(`Could not save: ${err.message}. Pick the ebb folder (the one with recipes in it).`);
  }
});

// --- the frame: pose by the species' own motion, and draw ---
let last = performance.now();
function frame() {
  const now = performance.now();
  // Slow motion and pause stretch the creature's own time; a long gap (a hidden tab) is not caught up.
  const dt = playing ? Math.min(0.1, (now - last) / 1000) * speed : 0;
  last = now;
  animT += dt;
  if (bones.length && work) {
    const moves = mode === 'rest' ? bones.map(() => null) : S.pose(bones, mode, animT, dt, work, clock);
    poseSkeleton(bones, moves, mats, 0);
    stage.setBones(mats);
  }
  stage.draw();
  requestAnimationFrame(frame);
}

// A link may name the species (creature-studio.html?species=minnow); else the last one you had.
const asked = new URLSearchParams(location.search).get('species') ?? store.get('ebb.creatureStudio.species') ?? 'frog';
await choose(asked);
requestAnimationFrame(frame);
