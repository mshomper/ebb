// @ts-check
// tools/hearth-check.html: the real game at the camp's fire (the test link ?camp=hearth&shaped), so
// the star fire, the hearth stones, the pots and the pale and fired clay pieces can be looked at in
// each of the fire's states from a few set views. Nothing here is saved.

import { startApp } from '../src/app.js';
import { get } from '../src/core/store.js';
import { starLogs } from '../src/world/camp/star.js';
import { starBefore, pierce, logPanel } from './star-profile.js';

const params = new URLSearchParams(location.search);
if (params.get('camp') !== 'hearth') location.search = '?camp=hearth&shaped&hour=16';

const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (document.querySelector(s));
const r = await startApp(/** @type {HTMLCanvasElement} */ ($('#view')));
if (!r.ok) throw new Error(r.reason);
const app = /** @type {any} */ (r);
/** @type {any} */ (globalThis).hearthCheck = app;

/** A slot's ground point (the land recipe's camp block on the live pad). @param {string} id */
function slot(id) {
  const pad = get('campPad'), s = pad?.camp?.slots?.find((/** @type {any} */ q) => q.id === id);
  if (!pad || !s) return null;
  return { x: pad.x + s.u * pad.fx + s.v * pad.fz, z: pad.z + s.u * pad.fz - s.v * pad.fx, pad };
}

/** The set views: where the camera looks, from which side, how far and how steeply. */
const VIEWS = /** @type {Record<string, { at: string, side: number, dist: number, pitch: number, up?: number }>} */ ({
  fire: { at: 'ring', side: 0.5, dist: 1.5, pitch: 26, up: 0.15 },
  above: { at: 'ring', side: 0.2, dist: 1.6, pitch: 62, up: 0.1 },
  bench: { at: 'workbench', side: 0.3, dist: 2.0, pitch: 45, up: 0.62 },
  side: { at: 'ring', side: 2.2, dist: 2.6, pitch: 30, up: 0.1 },
});

/** @param {string} name */
function view(name) {
  const V = VIEWS[name], s = slot(V.at);
  if (!s) return;
  // The walker out of the way, at the tent's flap; then a free camera, close in (as the frog size
  // preview has it), not the low view behind the walker.
  const f = app.camp.flap();
  if (f) app.walk.placeAt(f.x, f.z, f.yaw, 'stand');
  const y = app.terrain.sampleHeight(s.x, s.z) + (V.up ?? 0);
  if (app.camera.below) app.camera.setGround(null, [s.x, y, s.z]);
  app.camera.setClose({ minDistance: 0.3, minEyeHeight: 0.05 });
  // Seen from the pad's middle side, turned round by `side`.
  const yaw = Math.atan2(s.pad.x - s.x, s.pad.z - s.z) + V.side;
  app.camera.setPose({ target: [s.x, y, s.z], yaw, distance: V.dist, pitch: (V.pitch * Math.PI) / 180 });
}

for (const b of document.querySelectorAll('[data-fire]')) {
  b.addEventListener('click', () => {
    app.camp.debug.fireAs(/** @type {HTMLElement} */ (b).dataset.fire);
    for (const q of document.querySelectorAll('[data-fire]')) q.setAttribute('aria-pressed', String(q === b));
  });
}
const hb = $('[data-hearth]');
hb.addEventListener('click', () => {
  const on = hb.getAttribute('aria-pressed') !== 'true';
  if (on) app.camp.hearth.debug.setUp({ fired: ['cooking-pot', 'tea-pot', 'cup'] }); else app.camp.hearth.debug.clearHearth();
  hb.setAttribute('aria-pressed', String(on));
});
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => view(/** @type {HTMLElement} */ (b).dataset.view ?? 'fire'));

/** The pot taken up from the hearth and carried: the walker down on the pad, turned to face the view. */
async function carry() {
  const pad = get('campPad');
  if (!pad) return;
  app.camp.carry.debug.takeUp();
  const x = pad.x - pad.fx * 0.5 + pad.fz * 2, z = pad.z - pad.fz * 0.5 - pad.fx * 2, yaw = Math.atan2(pad.fx, pad.fz);
  app.walk.placeAt(x, z, yaw, 'stand');
  // A free camera in front of the walker, looking back at the pot in its arms.
  const y = app.terrain.sampleHeight(x, z) + 0.6;
  if (app.camera.below) app.camera.setGround(null, [x, y, z]);
  app.camera.setClose({ minDistance: 0.3, minEyeHeight: 0.05 });
  await new Promise((res) => setTimeout(res, 300));
  app.camera.setPose({ target: [x, y, z], yaw: yaw + 0.5, distance: 1.9, pitch: 0.18 });
}
$('[data-carry]').addEventListener('click', () => { carry(); });

// Logs on the stones: each log side on, before the fit and after, for the fire and hearth now.
const camp = await (await fetch(new URL('../recipes/world/camp.json', import.meta.url))).json();
let before = false;
function drawLogs() {
  const S = camp.star, F = camp.fire, word = document.querySelector('[data-fire][aria-pressed=true]')?.getAttribute('data-fire') ?? 'lit';
  const hearth = hb.getAttribute('aria-pressed') === 'true', seed = get('camp')?.slots?.find((/** @type {any} */ s) => s.slot === 'ring')?.seed ?? 1;
  // Lit an hour in, banked or cold after a long burn, as fireAs sets it.
  const fire = { sinceHour: 0, flameUntilHour: word === 'lit' ? 5 : 9 }, hour = word === 'lit' ? 1 : 30;
  const o = { seed, hearth }, at = { word, ash: 0 };
  const was = starBefore(at, fire, hour, F, S, o), now = starLogs(at, fire, hour, F, S, o);
  const bad = was.filter((g) => pierce(g, S, hearth) > 0.002).length, badNow = now.filter((g) => pierce(g, S, hearth) > 0.002).length;
  $('#tally').textContent = `Before: ${bad} of ${was.length} logs pass into a stone. After: ${badNow} of ${now.length}.`;
  $('#logs').innerHTML = now.map((g, i) => `<h3>Log ${i + 1}</h3>${logPanel(was[i], S, hearth, 'Before')}${logPanel(g, S, hearth, 'After')}`).join('');
}
const bb = $('[data-before]');
bb.addEventListener('click', () => {
  before = !before;
  bb.setAttribute('aria-pressed', String(before));
  app.camp.debug.starAs(before ? starBefore : null);
});
for (const b of document.querySelectorAll('[data-fire], [data-hearth]')) b.addEventListener('click', () => setTimeout(drawLogs, 0));

// `&fire=embers`, `&view=above` and `&bare` (no hearth stones) open on that state and view.
const fire0 = params.get('fire') ?? 'lit';
app.camp.debug.fireAs(fire0);
for (const q of document.querySelectorAll('[data-fire]')) q.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (q).dataset.fire === fire0));
if (params.has('bare')) { app.camp.hearth.debug.clearHearth(); hb.setAttribute('aria-pressed', 'false'); }
if (params.has('before')) bb.click();
drawLogs();
// Once the walker has settled below, so the view is not taken back.
setTimeout(() => view(params.get('view') ?? 'fire'), 2500);
