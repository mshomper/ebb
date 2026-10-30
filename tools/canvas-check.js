// @ts-check
// tools/canvas-check.html: the real game at the camp (the test link ?camp=canvas), with the tent at
// several ages in a row beside yours, so canvas weathering (B1 C2, C-35) can be judged side by side:
// the fade, the patches and the silvered poles. Nothing here is saved.

import { startApp } from '../src/app.js';
import { get } from '../src/core/store.js';
import { canvasWear } from '../src/world/camp/canvas.js';

const params = new URLSearchParams(location.search);
if (params.get('camp') !== 'canvas') location.search = '?camp=canvas&hour=10';

const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (document.querySelector(s));
const r = await startApp(/** @type {HTMLCanvasElement} */ ($('#view')));
if (!r.ok) throw new Error(r.reason);
const app = /** @type {any} */ (r);
/** @type {any} */ (globalThis).canvasCheck = app;
const R = await (await fetch(new URL('../recipes/world/camp.json', import.meta.url))).json();

let row = [0, 1, 4], age = 0, sort = false, viewName = 'row';

/** Set the camp's tents now, and say what each one is. */
function apply() {
  app.camp.debug.canvasAge(age, row, sort);
  const word = (/** @type {number} */ s) => (s === 0 ? 'new' : s === 1 ? 'one season' : s === 4 ? 'a year' : s === 8 ? 'two years' : `${s} seasons`);
  const say = (/** @type {number} */ s) => { const w = canvasWear(s, R.canvas, R.poles); return `${word(s)}: faded ${Math.round(w.fade * 100)}%, poles silvered ${Math.round(w.silver * 100)}%, ${w.patches} patch${w.patches === 1 ? '' : 'es'}`; };
  $('#ages').textContent = `Nearest first: your tent (${say(age)}); then ${[...row].map(say).join('; ')}.`;
}

/** Where the tent stands, and its yaw. */
function tent() {
  const pad = get('campPad'), s = pad?.camp?.slots?.find((/** @type {any} */ q) => q.id === 'tent');
  return s ? app.camp.debug.canvasAge(age, row, sort) : null;
}

/** @param {string} name */
function view(name) {
  viewName = name;
  const t = tent();
  if (!t) return;
  // The walker out of the way at the flap, then a free camera.
  const f = app.camp.flap();
  if (f) app.walk.placeAt(f.x, f.z, f.yaw, 'stand');
  // The row runs behind your tent along its ridge; seen from its side, every slope shows.
  const gap = R.canvas.checkGapM;
  const along = name === 'close' ? row.length * gap : (row.length * gap) / 2;
  const x = t.x - Math.sin(t.yaw) * along, z = t.z - Math.cos(t.yaw) * along, y = app.terrain.sampleHeight(x, z) + 0.6;
  if (app.camera.below) app.camera.setGround(null, [x, y, z]);
  app.camera.setClose({ minDistance: 0.3, minEyeHeight: 0.05 });
  const V = { row: [1.2, 4 + row.length * 1.8], other: [-1.2, 4 + row.length * 1.8], close: [0.9, 4.4] }[name] ?? [1.2, 8];
  app.camera.setPose({ target: [x, y, z], yaw: t.yaw + V[0], distance: V[1], pitch: (14 * Math.PI) / 180 });
}

/** @param {string} attr */
const press = (attr, /** @type {Element} */ b) => { for (const q of document.querySelectorAll(`[${attr}]`)) q.setAttribute('aria-pressed', String(q === b)); };
for (const b of document.querySelectorAll('[data-row]')) b.addEventListener('click', () => { row = /** @type {HTMLElement} */ (b).dataset.row?.split(',').map(Number) ?? []; press('data-row', b); apply(); view(viewName); });
for (const b of document.querySelectorAll('[data-age]')) b.addEventListener('click', () => { age = Number(/** @type {HTMLElement} */ (b).dataset.age); press('data-age', b); apply(); });
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => view(/** @type {HTMLElement} */ (b).dataset.view ?? 'row'));
const sb = $('[data-sort]');
sb.addEventListener('click', () => { sort = !sort; sb.setAttribute('aria-pressed', String(sort)); apply(); });

// Once the camp stands (the test link sets it up after the growing), the row and the view.
const wait = setInterval(() => {
  if (!tent()) return;
  clearInterval(wait);
  apply();
  view('row');
}, 250);
