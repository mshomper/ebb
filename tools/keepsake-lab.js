// @ts-check
// The keepsake lab (docs/future/12, piece K1a): 48 seeds of the shell family side by side on their
// shelf grounds, one shell up close with sliders for its numbers, and how often each rarity, form and
// mark turns up under a chosen tide and season. Drawn with a small painter's renderer on 2D canvases,
// like tools/finds-models.html, so it runs anywhere.

import { rollShell, shellMesh, shellWords } from '../src/world/keepsakes/families/shell.js';
import { rarityWeights } from '../src/world/keepsakes/rarity.js';

const K = await (await fetch('../recipes/world/keepsakes.json')).json();
const SEED = 20261021;
const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));

/** @type {{ force: string | null, sel: any, base: any }} */
const state = { force: null, sel: null, base: null };
const cond = () => ({ spring: Number($('tide').value), season: $('season').value });

// ---- Drawing -----------------------------------------------------------------------------------

const toSrgb = (/** @type {number} */ c) => Math.round(255 * Math.min(1, c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));

/**
 * Paint a mesh into a canvas, fitted to it, with one soft light. @param {HTMLCanvasElement} cv
 * @param {{ vertices: Float32Array, count: number, indices: Uint32Array }} m @param {number} yaw @param {number} pitch
 */
function drawMesh(cv, m, yaw, pitch) {
  const W = (cv.width = Math.round(cv.clientWidth * devicePixelRatio)), H = (cv.height = W);
  const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  g.clearRect(0, 0, W, H);
  const V = m.vertices;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.count; i++) for (let r = 0; r < 3; r++) { lo[r] = Math.min(lo[r], V[i * 9 + r]); hi[r] = Math.max(hi[r], V[i * 9 + r]); }
  const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const ext = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const sc = (W * 0.62) / ext;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const P = new Float32Array(m.count * 3);
  for (let i = 0; i < m.count; i++) {
    const x = V[i * 9] - c[0], y = V[i * 9 + 1] - c[1], z = V[i * 9 + 2] - c[2];
    const x1 = cy * x + sy * z, z1 = -sy * x + cy * z;
    const y2 = cp * y - sp * z1, z2 = sp * y + cp * z1;
    P[i * 3] = W / 2 + x1 * sc; P[i * 3 + 1] = H / 2 - y2 * sc; P[i * 3 + 2] = z2;
  }
  const I = m.indices, nt = I.length / 3;
  const order = new Uint32Array(nt), depth = new Float32Array(nt);
  for (let t = 0; t < nt; t++) { order[t] = t; depth[t] = P[I[t * 3] * 3 + 2] + P[I[t * 3 + 1] * 3 + 2] + P[I[t * 3 + 2] * 3 + 2]; }
  order.sort((a, b) => depth[a] - depth[b]);
  // The light turns with the view so the shell is always lit from the upper left.
  const Lv = [-0.45, 0.75, 0.5];
  const L = [cy * Lv[0] - sy * (sp * Lv[1] + cp * Lv[2]), cp * Lv[1] - sp * Lv[2], sy * Lv[0] + cy * (sp * Lv[1] + cp * Lv[2])];
  g.lineJoin = 'round';
  g.lineWidth = 0.6;
  for (const t of order) {
    const a = I[t * 3], b = I[t * 3 + 1], d = I[t * 3 + 2];
    const n = [0, 1, 2].map((k) => V[a * 9 + 3 + k] + V[b * 9 + 3 + k] + V[d * 9 + 3 + k]);
    const nl = Math.hypot(n[0], n[1], n[2]) || 1;
    // Both sides are drawn (the aperture shows its inside), so light the side that faces the light.
    const lit = 0.38 + 0.62 * Math.abs((n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / nl);
    const col = [0, 1, 2].map((k) => toSrgb(((V[a * 9 + 6 + k] + V[b * 9 + 6 + k] + V[d * 9 + 6 + k]) / 3) * lit * 1.15));
    g.fillStyle = g.strokeStyle = `rgb(${col.join(',')})`;
    g.beginPath(); g.moveTo(P[a * 3], P[a * 3 + 1]); g.lineTo(P[b * 3], P[b * 3 + 1]); g.lineTo(P[d * 3], P[d * 3 + 1]); g.closePath(); g.fill(); g.stroke();
  }
}

/** Flat coils and ear shells read best from above, where their spiral shows. @param {any} n */
const viewPitch = (n) => (n.form === 'coil' || n.form === 'ear' ? 1.15 : 0.3);

/** The shelf ground for a rarity, as CSS (recipe shelf.grounds). @param {string} rarity */
function groundCss(rarity) {
  const G = K.shelf.grounds[rarity];
  let css = `background: linear-gradient(170deg, ${G.top}, ${G.bottom}); border: ${G.borderPx}px solid ${G.border};`;
  if (G.gilt) css += ` box-shadow: inset 0 0 0 2px ${G.gilt}, inset 0 0 0 3px ${G.border};`;
  return css;
}

// ---- Rarity chips ------------------------------------------------------------------------------

const chips = $('chips');
for (const [id, label] of [[null, 'As the sea leaves them'], ...K.rarity.order.map((/** @type {string} */ r) => [r, K.rarity.words[r][0].toUpperCase() + K.rarity.words[r].slice(1)])]) {
  const b = document.createElement('button');
  b.textContent = label;
  b.setAttribute('aria-pressed', String(id === state.force));
  b.addEventListener('click', () => {
    state.force = id;
    for (const x of chips.children) x.setAttribute('aria-pressed', String(x === b));
    renderGrid();
  });
  chips.append(b);
}

// ---- One shell up close ------------------------------------------------------------------------

const SLIDERS = [
  { key: 'W', label: 'Whorl growth per turn (W)', min: 1.1, max: 30, step: 0.01, log: true },
  { key: 'D', label: 'Distance from the axis (D)', min: 0, max: 0.7, step: 0.01 },
  { key: 'T', label: 'Climb per turn (T)', min: 0, max: 7, step: 0.01 },
  { key: 'S', label: 'Aperture height to width (S)', min: 0.4, max: 2, step: 0.01 },
  { key: 'whorls', label: 'Turns', min: 1, max: 14, step: 0.1 },
  { key: 'ribAmp', label: 'Ribs', min: 0, max: 0.2, step: 0.005 },
  { key: 'ribCount', label: 'Ribs per turn', min: 3, max: 24, step: 1 },
  { key: 'spineLen', label: 'Spines', min: 0, max: 1.2, step: 0.01 },
  { key: 'spinePerWhorl', label: 'Spines per turn', min: 2, max: 10, step: 1 },
  { key: 'bandCount', label: 'Bands', min: 0, max: 10, step: 1 },
];
let yaw = 0.6, pitch = 0.3;
const big = $('big');

function renderOne() {
  const n = state.sel;
  if (!n) return;
  $('bigwrap').style.cssText = groundCss(n.rarity);
  const mesh = shellMesh(n, K.shells.mesh);
  drawMesh(big, mesh, yaw, pitch);
  $('words').textContent = shellWords(n, K);
  $('facts').textContent = `${K.rarity.words[n.rarity]} · ${n.form} · ${(n.sizeM * 100).toFixed(1)} cm · ${mesh.indices.length / 3} triangles`;
  $('leftBtn').setAttribute('aria-pressed', String(!!n.left));
  $('s-pattern').value = n.pattern;
  for (const s of SLIDERS) {
    const el = $('s-' + s.key), out = $('o-' + s.key);
    el.value = String(s.log ? Math.log(n[s.key]) : n[s.key]);
    out.textContent = Number(n[s.key]).toFixed(s.step >= 1 ? 0 : 2);
  }
}

const sl = $('sliders');
for (const s of SLIDERS) {
  const lab = document.createElement('label');
  lab.innerHTML = `<span>${s.label}: <b id="o-${s.key}"></b></span>`;
  const r = document.createElement('input');
  r.type = 'range';
  r.id = 's-' + s.key;
  r.min = String(s.log ? Math.log(s.min) : s.min);
  r.max = String(s.log ? Math.log(s.max) : s.max);
  r.step = String(s.log ? 0.005 : s.step);
  r.addEventListener('input', () => {
    if (!state.sel) return;
    const v = Number(r.value);
    state.sel = { ...state.sel, [s.key]: s.log ? Math.exp(v) : v };
    renderOne();
  });
  lab.append(r);
  sl.append(lab);
}
{
  // The band pattern, by hand.
  const lab = document.createElement('label');
  lab.innerHTML = '<span>Pattern</span>';
  const s = document.createElement('select');
  s.id = 's-pattern';
  for (const p of K.shells.patternOrder) s.append(new Option(K.shells.words.patterns[p], p));
  s.addEventListener('change', () => {
    if (!state.sel) return;
    state.sel = { ...state.sel, pattern: s.value, bandCount: state.sel.bandCount || 4 };
    renderOne();
  });
  lab.append(s);
  sl.append(lab);
}
$('leftBtn').addEventListener('click', () => {
  if (!state.sel) return;
  state.sel = { ...state.sel, left: state.sel.left ? 0 : 1, mark: state.sel.left ? null : 'leftCoiled' };
  renderOne();
});
$('reset').addEventListener('click', () => { if (state.base) { state.sel = { ...state.base }; renderOne(); } });

let drag = /** @type {number[] | null} */ (null);
big.addEventListener('pointerdown', (/** @type {PointerEvent} */ e) => { drag = [e.clientX, e.clientY]; big.setPointerCapture(e.pointerId); });
big.addEventListener('pointermove', (/** @type {PointerEvent} */ e) => {
  if (!drag || !state.sel) return;
  yaw += (e.clientX - drag[0]) * 0.01;
  pitch = Math.max(-1.4, Math.min(1.4, pitch + (e.clientY - drag[1]) * 0.01));
  drag = [e.clientX, e.clientY];
  drawMesh(big, shellMesh(state.sel, K.shells.mesh), yaw, pitch);
});
big.addEventListener('pointerup', () => { drag = null; });

// ---- The grid of 48 ----------------------------------------------------------------------------

let gridToken = 0;
function renderGrid() {
  const from = Math.max(0, Math.floor(Number($('from').value) || 0));
  const grid = $('grid');
  grid.textContent = '';
  const token = ++gridToken;
  /** @type {{ n: any, cv: HTMLCanvasElement }[]} */ const items = [];
  for (let i = 0; i < 48; i++) {
    const n = rollShell(SEED, from + i, K, cond(), /** @type {any} */ (state.force ?? undefined));
    const fig = document.createElement('figure');
    fig.className = 'slot';
    fig.style.cssText = groundCss(n.rarity);
    fig.tabIndex = 0;
    const cv = document.createElement('canvas');
    const cap = document.createElement('figcaption');
    cap.innerHTML = `<b>${K.rarity.words[n.rarity]}</b>${n.left ? ' · left' : ''}<br>${shellWords(n, K)}`;
    fig.append(cv, cap);
    const choose = () => { state.sel = { ...n }; state.base = { ...n }; yaw = 0.6; pitch = viewPitch(n); renderOne(); $('bigwrap').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    fig.addEventListener('click', choose);
    fig.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
    grid.append(fig);
    items.push({ n, cv });
  }
  const c = cond();
  $('gridNote').textContent = state.force
    ? `Seeds ${from} to ${from + 47}, all made ${K.rarity.words[state.force]}.`
    : `Seeds ${from} to ${from + 47}, at a ${$('tide').selectedOptions[0].textContent.toLowerCase()} tide in ${c.season}.`;
  if (!state.sel) { state.sel = { ...items[0].n }; state.base = { ...items[0].n }; renderOne(); }
  // Draw a few a frame so the page stays responsive.
  let k = 0;
  const step = () => {
    if (token !== gridToken) return;
    const end = Math.min(items.length, k + 3);
    for (; k < end; k++) drawMesh(items[k].cv, shellMesh(items[k].n, K.shells.mesh), 0.6, viewPitch(items[k].n));
    if (k < items.length) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  renderOdds();
}

// ---- How often ---------------------------------------------------------------------------------

function renderOdds() {
  const c = cond(), N = 20000;
  /** @type {Record<string, number>} */ const tiers = {}, forms = {};
  let left = 0;
  for (let i = 0; i < N; i++) {
    const n = rollShell(SEED + 7, i, K, c);
    tiers[n.rarity] = (tiers[n.rarity] ?? 0) + 1;
    forms[n.form] = (forms[n.form] ?? 0) + 1;
    left += n.left;
  }
  const w = rarityWeights(K.rarity, c);
  const tot = w.reduce((a, b) => a + b, 0);
  const pct = (/** @type {number} */ x) => `${((100 * x) / N).toFixed(1)}%`;
  const rows1 = K.rarity.order.map((/** @type {string} */ r, /** @type {number} */ i) => `<tr><td>${K.rarity.words[r]}</td><td class="n">${pct(tiers[r] ?? 0)}</td><td class="n muted">${w[i] ? ((100 * w[i]) / tot).toFixed(1) + '% expected' : 'not at this tide'}</td></tr>`).join('');
  const rows2 = K.shells.forms.map((/** @type {any} */ f) => `<tr><td>${f.word}</td><td class="n">${pct(forms[f.id] ?? 0)}</td></tr>`).join('');
  $('odds').innerHTML = `<table><tr><th>Rarity</th><th></th><th></th></tr>${rows1}</table>
    <table><tr><th>Form</th><th></th></tr>${rows2}</table>
    <table><tr><th>Mark</th><th></th></tr><tr><td>${K.shells.marks.leftCoiled.word}</td><td class="n">${left} in ${N.toLocaleString()}</td></tr></table>`;
}

for (const id of ['tide', 'season', 'from']) $(id).addEventListener('change', renderGrid);
$('next').addEventListener('click', () => { $('from').value = String(Math.max(0, Number($('from').value) || 0) + 48); renderGrid(); });
addEventListener('resize', () => renderOne());
renderGrid();
