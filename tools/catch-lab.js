// @ts-check
// The catch lab (docs/future/12, K6): 24 seeds of a living catch side by side, moving as they do on
// the haul tray or as the ink sketch their journal page is traced from, and what 10,000 hauls hold
// under a chosen tide, season and depth, with their keepsakes' rarity against the beach's.

import { catchMesh, catchNumbers, catchWords, catchName, catchLook, catchAlpha } from '../src/world/nets/living/index.js';
import { haulOf } from '../src/world/nets/haul.js';
import { pickRarity } from '../src/world/keepsakes/rarity.js';
import { bendCatch, fitOf } from '../src/ui/catch-motion.js';
import { drawMesh } from '../src/ui/keepsake-view.js';
import { keepsakeSvg, traceKeepsake } from '../src/ui/sketches/keepsake.js';
import { hash32 } from '../src/core/rng.js';

const [NR, K] = await Promise.all([fetch('../recipes/world/nets.json').then((r) => r.json()), fetch('../recipes/world/keepsakes.json').then((r) => r.json())]);
const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const SEED = 20261021;
/** @type {{ kind: string, force: string | null, view: string }} */
const state = { kind: 'sandeel', force: null, view: 'model' };
/** @type {{ cv: HTMLCanvasElement, mesh: any, n: any, look: any, fit: any, out: Float32Array }[]} */
let moving = [];

for (const id of Object.keys(NR.catches.kinds)) {
  const o = document.createElement('option');
  o.value = id; o.textContent = NR.catches.kinds[id].name;
  $('kind').append(o);
}
$('kind').addEventListener('change', () => { state.kind = $('kind').value; render(); });
$('from').addEventListener('change', render);
$('next').addEventListener('click', () => { $('from').value = String(Number($('from').value) + 24); render(); });
for (const b of $('views').children) b.addEventListener('click', () => {
  state.view = b.dataset.view;
  for (const x of $('views').children) x.setAttribute('aria-pressed', String(x === b));
  render();
});
for (const [id, label] of [[null, 'As a net brings them'], ...K.rarity.order.map((/** @type {string} */ r) => [r, K.rarity.words[r][0].toUpperCase() + K.rarity.words[r].slice(1)])]) {
  const b = document.createElement('button');
  b.textContent = label;
  b.setAttribute('aria-pressed', String(id === state.force));
  b.addEventListener('click', () => {
    state.force = id;
    for (const x of $('chips').children) x.setAttribute('aria-pressed', String(x === b));
    render();
  });
  $('chips').append(b);
}

function render() {
  const grid = $('grid');
  grid.innerHTML = '';
  moving = [];
  const from = Number($('from').value) || 0;
  for (let i = 0; i < 24; i++) {
    const seed = hash32(SEED, from + i, 7);
    const rarity = state.force ?? pickRarity((hash32(seed, 1) >>> 8) / 16777216, K.rarity, { spring: 1 });
    const n = catchNumbers(hash32(seed, 2), state.kind, rarity, NR);
    const mesh = catchMesh(n, NR);
    const look = catchLook(n);
    const fig = document.createElement('figure');
    fig.className = 'slot';
    const words = `<figcaption><b>${catchName(n, NR)}</b> · ${K.rarity.words[rarity]}${n.morph ? ' · its rarer form' : ''}<br>${catchWords(n, NR)}<br><span class="muted">${mesh.count} vertices</span></figcaption>`;
    if (state.view === 'sketch') {
      fig.innerHTML = `<div class="art">${keepsakeSvg(traceKeepsake(mesh, {}, look.view), catchName(n, NR))}</div>${words}`;
    } else {
      const cv = document.createElement('canvas');
      fig.append(cv);
      fig.insertAdjacentHTML('beforeend', words);
      moving.push({ cv, mesh, n, look, fit: { ...fitOf(mesh), alpha: catchAlpha(n) }, out: new Float32Array(mesh.vertices.length) });
    }
    grid.append(fig);
  }
}

function frame(/** @type {number} */ ms) {
  for (const [i, m] of moving.entries()) {
    const bent = bendCatch(m.mesh, m.n, m.look.motion, ms / 1000 + i * 0.37, m.out);
    drawMesh(m.cv, bent, (m.look.view[0] * Math.PI) / 180, (m.look.view[1] * Math.PI) / 180, 1.2, m.fit);
  }
  requestAnimationFrame(frame);
}

function odds() {
  const p = { spring: Number($('tide').value), season: $('season').value, depthM: Number($('depth').value) };
  /** @type {Record<string, number>} */ const kinds = {};
  /** @type {Record<string, number>} */ const net = {}, beach = {};
  let living = 0, withKs = 0;
  const N = 10000;
  for (let i = 0; i < N; i++) {
    const h = haulOf({ seed: SEED, net: { id: 1, kind: 'general' }, tideId: i, cell: [5, 9], depthM: p.depthM, spring: p.spring, season: p.season }, NR, K);
    living += h.living.length;
    for (const c of h.living) kinds[c.n.kind] = (kinds[c.n.kind] ?? 0) + 1;
    if (h.keepsake) { withKs++; net[h.keepsake.n.rarity] = (net[h.keepsake.n.rarity] ?? 0) + 1; }
    const r = pickRarity((hash32(SEED, i, 99) >>> 8) / 16777216, K.rarity, p);
    beach[r] = (beach[r] ?? 0) + 1;
  }
  const pct = (/** @type {number} */ x, /** @type {number} */ of) => `${((100 * x) / Math.max(1, of)).toFixed(1)}%`;
  $('odds').innerHTML = `<table><tr><th>Living things a haul</th><td class="n">${(living / N).toFixed(2)}</td></tr>
    <tr><th>Hauls with a keepsake</th><td class="n">${pct(withKs, N)}</td></tr></table>
    <h3>Living kinds</h3><table>${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, c]) => `<tr><td>${NR.catches.kinds[k].name}</td><td class="n">${pct(c, living)}</td></tr>`).join('')}</table>
    <h3>Keepsake rarity: net against beach</h3><table><tr><th></th><th>Net</th><th>Beach</th></tr>${K.rarity.order.map((/** @type {string} */ r) => `<tr><td>${K.rarity.words[r]}</td><td class="n">${pct(net[r] ?? 0, withKs)}</td><td class="n">${pct(beach[r] ?? 0, N)}</td></tr>`).join('')}</table>`;
}
for (const id of ['tide', 'season', 'depth']) $(id).addEventListener('change', odds);

render();
odds();
requestAnimationFrame(frame);
