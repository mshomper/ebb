// @ts-check
// The artifact variants page (docs/future/12): the nine baked artifacts morphed by seeded numbers,
// 48 at a time as shelf sketches or models, one up close with its numbers on sliders, a mock shelf
// of 16, and how much variety (names, colours, shapes) turns up in 5,000 rolls. Mesh painter as in
// tools/keepsake-lab.js; sketches as the shelf draws them (src/ui/sketches/keepsake.js).

import { keepsakeMesh, keepsakeView, keepsakeWords, rollKeepsake } from '../src/world/keepsakes/families/index.js';
import { loadArtifactBases, redescribe } from '../src/world/keepsakes/families/artifact.js';
import { keepsakeSvg, traceKeepsake } from '../src/ui/sketches/keepsake.js';

const K = await (await fetch('../recipes/world/keepsakes.json')).json();
await loadArtifactBases(K);
const A = K.artifacts;
const SEED = 20261021;
const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
/** @type {{ force: string | null, base: string, view: string, sel: any, orig: any }} */
const state = { force: null, base: '', view: 'sketch', sel: null, orig: null };
const cond = () => ({ spring: Number($('tide').value), season: 'summer' });
const sketchOf = (/** @type {any} */ n, /** @type {any} */ mesh) => keepsakeSvg(traceKeepsake(mesh, n, keepsakeView(n)), n.name);

const toSrgb = (/** @type {number} */ c) => Math.round(255 * Math.min(1, c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));

/** Paint a mesh into a canvas, fitted, one soft light. @param {HTMLCanvasElement} cv @param {{ vertices: Float32Array, count: number, indices: Uint32Array }} m @param {number} yaw @param {number} pitch */
function drawMesh(cv, m, yaw, pitch) {
  const W = (cv.width = Math.max(1, Math.round(cv.clientWidth * devicePixelRatio))), H = (cv.height = W);
  const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  g.fillStyle = '#E9DFCE';
  g.fillRect(0, 0, W, H);
  const V = m.vertices;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.count; i++) for (let r = 0; r < 3; r++) { lo[r] = Math.min(lo[r], V[i * 9 + r]); hi[r] = Math.max(hi[r], V[i * 9 + r]); }
  const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const sc = (W * 0.62) / (Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const P = new Float32Array(m.count * 3);
  for (let i = 0; i < m.count; i++) {
    const x = V[i * 9] - c[0], y = V[i * 9 + 1] - c[1], z = V[i * 9 + 2] - c[2];
    const x1 = cy * x + sy * z, z1 = -sy * x + cy * z;
    P[i * 3] = W / 2 + x1 * sc; P[i * 3 + 1] = H / 2 - (cp * y - sp * z1) * sc; P[i * 3 + 2] = sp * y + cp * z1;
  }
  const I = m.indices, nt = I.length / 3;
  const order = Array.from({ length: nt }, (_, t) => t);
  const depth = (/** @type {number} */ t) => P[I[t * 3] * 3 + 2] + P[I[t * 3 + 1] * 3 + 2] + P[I[t * 3 + 2] * 3 + 2];
  order.sort((a, b) => depth(a) - depth(b));
  const Lv = [-0.45, 0.75, 0.5];
  const L = [cy * Lv[0] - sy * (sp * Lv[1] + cp * Lv[2]), cp * Lv[1] - sp * Lv[2], sy * Lv[0] + cy * (sp * Lv[1] + cp * Lv[2])];
  g.lineJoin = 'round';
  g.lineWidth = 0.6;
  for (const t of order) {
    const a = I[t * 3], b = I[t * 3 + 1], d = I[t * 3 + 2];
    const n = [0, 1, 2].map((k) => V[a * 9 + 3 + k] + V[b * 9 + 3 + k] + V[d * 9 + 3 + k]);
    const nl = Math.hypot(n[0], n[1], n[2]) || 1;
    const lit = 0.38 + 0.62 * Math.abs((n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / nl);
    const col = [0, 1, 2].map((k) => toSrgb(((V[a * 9 + 6 + k] + V[b * 9 + 6 + k] + V[d * 9 + 6 + k]) / 3) * lit * 1.15));
    g.fillStyle = g.strokeStyle = `rgb(${col.join(',')})`;
    g.beginPath(); g.moveTo(P[a * 3], P[a * 3 + 1]); g.lineTo(P[b * 3], P[b * 3 + 1]); g.lineTo(P[d * 3], P[d * 3 + 1]); g.closePath(); g.fill(); g.stroke();
  }
}

/** The shelf ground for a rarity, as CSS. @param {string} rarity */
function groundCss(rarity) {
  const G = K.shelf.grounds[rarity];
  let css = `background: linear-gradient(170deg, ${G.top}, ${G.bottom}); border: ${G.borderPx}px solid ${G.border};`;
  if (G.gilt) css += ` box-shadow: inset 0 0 0 2px ${G.gilt}, inset 0 0 0 3px ${G.border};`;
  return css;
}

// ---- Controls --------------------------------------------------------------------------------------

for (const b of [{ id: '', name: 'Any of the nine' }, ...A.artifacts]) $('base').append(new Option(b.name, b.id));
const chips = $('chips');
for (const [id, label] of [[null, 'As the sea leaves them'], ...K.rarity.order.map((/** @type {string} */ r) => [r, K.rarity.words[r][0].toUpperCase() + K.rarity.words[r].slice(1)])]) {
  const b = document.createElement('button');
  b.textContent = label;
  b.setAttribute('aria-pressed', String(id === state.force));
  b.addEventListener('click', () => { state.force = id; for (const x of chips.children) x.setAttribute('aria-pressed', String(x === b)); renderGrid(); });
  chips.append(b);
}
for (const b of $('views').children) b.addEventListener('click', () => { state.view = b.dataset.view; for (const x of $('views').children) x.setAttribute('aria-pressed', String(x === b)); renderGrid(); });
$('base').addEventListener('change', () => { state.base = $('base').value; state.sel = null; renderGrid(); });
for (const id of ['tide', 'from']) $(id).addEventListener('change', renderGrid);
$('next').addEventListener('click', () => { $('from').value = String(Math.max(0, Number($('from').value) || 0) + 48); renderGrid(); });

// ---- One up close ----------------------------------------------------------------------------------

/** @type {{ key: string, path: string[], label: string, min: number, max: number, step: number, deg?: boolean }[]} */
const SLIDERS = [
  { key: 'sizeM', path: [], label: 'Size, cm', min: 0.025, max: 0.14, step: 0.001 },
  { key: 'sx', path: ['morph'], label: 'Stretch across', min: 0.5, max: 1.8, step: 0.01 },
  { key: 'sy', path: ['morph'], label: 'Stretch up', min: 0.5, max: 1.8, step: 0.01 },
  { key: 'sz', path: ['morph'], label: 'Stretch deep', min: 0.5, max: 1.8, step: 0.01 },
  { key: 'taper', path: ['morph'], label: 'Taper', min: -0.6, max: 0.6, step: 0.01 },
  { key: 'swell', path: ['morph'], label: 'Barrel or waist', min: -0.4, max: 0.4, step: 0.01 },
  { key: 'shear', path: ['morph'], label: 'Lean', min: -0.35, max: 0.35, step: 0.01 },
  { key: 'ripAmp', path: ['morph'], label: 'Rings', min: 0, max: 0.14, step: 0.005 },
  { key: 'lobeAmp', path: ['morph'], label: 'Lobes', min: 0, max: 0.16, step: 0.005 },
  { key: 'twist', path: ['morph'], label: 'Twist', min: -1.5, max: 1.5, step: 0.01 },
  { key: 'bend', path: ['morph'], label: 'Bend', min: -0.7, max: 0.7, step: 0.01 },
  { key: 'lump', path: ['morph'], label: 'Dents and swellings', min: 0, max: 0.12, step: 0.002 },
  { key: 'smooth', path: ['morph'], label: 'Worn smooth', min: 0, max: 6, step: 1 },
  { key: 'hue', path: ['color'], label: 'Turn the hue, degrees', min: -180, max: 180, step: 1, deg: true },
  { key: 'chroma', path: ['color'], label: 'Colour strength', min: 0.4, max: 1.8, step: 0.01 },
  { key: 'lightMul', path: ['color'], label: 'Lightness', min: 0.6, max: 1.3, step: 0.01 },
  { key: 'tintHue', path: ['color'], label: 'Tint hue', min: 0, max: 6.283, step: 0.01 },
  { key: 'tintChroma', path: ['color'], label: 'Tint strength', min: 0, max: 0.14, step: 0.002 },
  { key: 'patina', path: ['color'], label: 'Crust or patina', min: 0, max: 1, step: 0.01 },
  { key: 'stain', path: ['color'], label: 'Stains', min: 0, max: 1, step: 0.01 },
  { key: 'bands', path: ['color'], label: 'Bands', min: 0, max: 5, step: 1 },
  { key: 'bandWidth', path: ['color'], label: 'Band width', min: 0.03, max: 0.2, step: 0.005 },
  { key: 'gilt', path: ['color'], label: 'Gilding', min: 0, max: 1, step: 0.01 },
  { key: 'depth', path: ['cut'], label: 'Cut away (0 is whole)', min: 0, max: 0.5, step: 0.01 },
];
const get = (/** @type {any} */ n, /** @type {any} */ s) => (s.path[0] ? n[s.path[0]]?.[s.key] ?? 0 : n[s.key]);
let yaw = 0.6, pitch = 0.3;

/** @param {any} n @param {string | null} mark the mark, and what it needs of the numbers */
function withMark(n, mark) {
  const M = A.marks;
  const out = { ...n, mark, twin: null, color: { ...n.color, gilt: 0 } };
  if (n.mark === 'broken' || n.mark === 'gilded' || n.mark === 'pair') out.cut = n.cut && n.mark !== 'broken' ? n.cut : null;
  if (mark === 'broken') out.cut = n.cut ?? { theta: 1.2, phi: 1.3, depth: 0 }, out.cut = { ...out.cut, depth: (M.broken.depth[0] + M.broken.depth[1]) / 2 };
  if (mark === 'pair') out.twin = n.twin ?? { scale: (M.pair.scale[0] + M.pair.scale[1]) / 2, yaw: 0.9 };
  if (mark === 'gilded') out.color.gilt = (M.gilded.strength[0] + M.gilded.strength[1]) / 2;
  return redescribe(out, K);
}

const markChips = $('marks');
for (const [id, label] of [[null, 'No mark'], ...Object.keys(A.marks).map((m) => [m, A.marks[m].word])]) {
  const b = document.createElement('button');
  b.textContent = label;
  b.dataset.mark = String(id);
  b.addEventListener('click', () => { if (state.sel) { state.sel = withMark(state.sel, id); renderOne(); } });
  markChips.append(b);
}
const sl = $('sliders');
for (const s of SLIDERS) {
  const lab = document.createElement('label');
  lab.innerHTML = `<span>${s.label}: <b id="o-${s.key}"></b></span>`;
  const r = document.createElement('input');
  r.type = 'range'; r.id = 's-' + s.key; r.min = String(s.min); r.max = String(s.max); r.step = String(s.step);
  r.addEventListener('input', () => {
    if (!state.sel) return;
    let v = Number(r.value);
    if (s.deg) v = (v * Math.PI) / 180;
    const n = JSON.parse(JSON.stringify(state.sel));
    if (s.path[0] === 'cut') {
      n.cut = v <= 0 ? null : { theta: n.cut?.theta ?? 1.2, phi: n.cut?.phi ?? 1.3, depth: v };
    } else if (s.path[0]) n[s.path[0]][s.key] = v;
    else n[s.key] = v;
    state.sel = redescribe(n, K);
    renderOne(true);
  });
  lab.append(r);
  sl.append(lab);
}
$('reset').addEventListener('click', () => { if (state.orig) { state.sel = JSON.parse(JSON.stringify(state.orig)); renderOne(); } });

/** @param {boolean} [keepSliders] leave the sliders where they are while one is being dragged */
function renderOne(keepSliders = false) {
  const n = state.sel;
  if (!n) return;
  const mesh = keepsakeMesh(n, K);
  drawMesh($('big'), mesh, yaw, pitch);
  $('name').textContent = n.name;
  $('words').textContent = keepsakeWords(n, K);
  $('bigSketch').style.cssText = groundCss(n.rarity);
  $('bigSketch').innerHTML = sketchOf(n, mesh);
  $('facts').textContent = `${K.rarity.words[n.rarity]} · ${n.mark ? A.marks[n.mark].word : 'no mark'} · ${(n.sizeM * 100).toFixed(1)} cm · ${mesh.indices.length / 3} triangles · from the ${A.artifacts.find((/** @type {any} */ a) => a.id === n.base).name.toLowerCase()}`;
  for (const b of markChips.children) b.setAttribute('aria-pressed', String((b.dataset.mark === 'null' ? null : b.dataset.mark) === (n.mark ?? null)));
  if (keepSliders) { for (const s of SLIDERS) { const v = get(n, s); $('o-' + s.key).textContent = fmt(s, v); } return; }
  for (const s of SLIDERS) {
    const v = get(n, s), el = $('s-' + s.key);
    el.value = String(s.deg ? (v * 180) / Math.PI : v);
    $('o-' + s.key).textContent = fmt(s, v);
  }
}
/** @param {any} s @param {number} v */
const fmt = (s, v) => (s.key === 'sizeM' ? (v * 100).toFixed(1) : s.deg ? Math.round((v * 180) / Math.PI) + '°' : s.step >= 1 ? String(Math.round(v)) : Number(v).toFixed(2));

let drag = /** @type {number[] | null} */ (null);
const big = $('big');
big.addEventListener('pointerdown', (/** @type {PointerEvent} */ e) => { drag = [e.clientX, e.clientY]; big.setPointerCapture(e.pointerId); });
big.addEventListener('pointermove', (/** @type {PointerEvent} */ e) => {
  if (!drag || !state.sel) return;
  yaw += (e.clientX - drag[0]) * 0.01;
  pitch = Math.max(-1.4, Math.min(1.4, pitch + (e.clientY - drag[1]) * 0.01));
  drag = [e.clientX, e.clientY];
  drawMesh(big, keepsakeMesh(state.sel, K), yaw, pitch);
});
big.addEventListener('pointerup', () => { drag = null; });

// ---- The grid of 48 --------------------------------------------------------------------------------

let gridToken = 0;
/** The next 48 artifacts of the chosen base from a slot on. @param {number} from */
function roll48(from) {
  /** @type {any[]} */ const out = [];
  for (let i = from; out.length < 48 && i < from + 6000; i++) {
    const n = rollKeepsake('artifact', SEED, i, K, cond(), /** @type {any} */ (state.force ?? undefined));
    if (!state.base || n.base === state.base) out.push(n);
  }
  return out;
}
function renderGrid() {
  const from = Math.max(0, Math.floor(Number($('from').value) || 0));
  const grid = $('grid'), shelf = $('shelf');
  grid.textContent = '';
  shelf.textContent = '';
  const token = ++gridToken;
  const list = roll48(from);
  /** @type {{ n: any, art: HTMLElement }[]} */ const items = [];
  list.forEach((n, i) => {
    const fig = document.createElement('figure');
    fig.className = 'slot';
    fig.style.cssText = groundCss(n.rarity);
    fig.tabIndex = 0;
    const art = document.createElement(state.view === 'model' ? 'canvas' : 'div');
    art.className = 'art';
    const cap = document.createElement('figcaption');
    cap.innerHTML = `<b>${n.name}</b>${K.rarity.words[n.rarity]}${n.mark ? ' · marked' : ''}`;
    fig.append(art, cap);
    const choose = () => { state.sel = JSON.parse(JSON.stringify(n)); state.orig = JSON.parse(JSON.stringify(n)); yaw = 0.6; pitch = 0.3; renderOne(); $('big').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    fig.addEventListener('click', choose);
    fig.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
    grid.append(fig);
    items.push({ n, art });
    if (i < 16) { const s = document.createElement('div'); s.style.cssText = groundCss(n.rarity); shelf.append(s); }
  });
  $('gridNote').textContent = `${list.length} ${state.base ? A.artifacts.find((/** @type {any} */ a) => a.id === state.base).name.toLowerCase() + 's' : 'artifacts'} from seed ${from}, ${state.force ? 'all made ' + K.rarity.words[state.force] : 'as the sea leaves them at a ' + $('tide').selectedOptions[0].textContent.toLowerCase() + ' tide'}.`;
  if (!state.sel && items[0]) { state.sel = JSON.parse(JSON.stringify(items[0].n)); state.orig = JSON.parse(JSON.stringify(items[0].n)); renderOne(); }
  let k = 0;
  const step = () => {
    if (token !== gridToken) return;
    for (const end = Math.min(items.length, k + 3); k < end; k++) {
      const { n, art } = items[k];
      const mesh = keepsakeMesh(n, K);
      const svg = state.view === 'sketch' || k < 16 ? sketchOf(n, mesh) : '';
      if (state.view === 'model') drawMesh(/** @type {HTMLCanvasElement} */ (art), mesh, 0.6, 0.35);
      else art.innerHTML = svg;
      if (k < 16) shelf.children[k].innerHTML = svg;
    }
    if (k < items.length) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  renderVariety();
}

// ---- How much variety ------------------------------------------------------------------------------

function renderVariety() {
  const N = 5000, c = cond();
  /** @type {Set<string>} */ const names = new Set(), colours = new Set(), nouns = new Set();
  /** @type {Record<string, number>} */ const tiers = {}, bases = {}, marks = {};
  for (let i = 0; i < N; i++) {
    const n = rollKeepsake('artifact', SEED + 7, i, K, c);
    names.add(n.name); colours.add(n.colorName); nouns.add(n.noun);
    tiers[n.rarity] = (tiers[n.rarity] ?? 0) + 1; bases[n.base] = (bases[n.base] ?? 0) + 1;
    if (n.mark) marks[n.mark] = (marks[n.mark] ?? 0) + 1;
  }
  const pct = (/** @type {number} */ x) => `${((100 * x) / N).toFixed(1)}%`;
  $('varietyNote').textContent = `${N.toLocaleString()} artifacts rolled as the sea would leave them: ${names.size.toLocaleString()} different names, ${colours.size} colour words and ${nouns.size} object words. The shapes and colours underneath do not repeat at all.`;
  $('odds').innerHTML = `<table><tr><th>Rarity</th><th></th></tr>${K.rarity.order.map((/** @type {string} */ r) => `<tr><td>${K.rarity.words[r]}</td><td class="n">${pct(tiers[r] ?? 0)}</td></tr>`).join('')}</table>
    <table><tr><th>Base</th><th></th></tr>${A.artifacts.map((/** @type {any} */ b) => `<tr><td>${b.name}</td><td class="n">${pct(bases[b.id] ?? 0)}</td></tr>`).join('')}</table>
    <table><tr><th>Mark</th><th></th></tr>${Object.entries(A.marks).map(([id, m]) => `<tr><td>${/** @type {any} */ (m).word}</td><td class="n">${marks[id] ?? 0} in ${N.toLocaleString()}</td></tr>`).join('')}</table>`;
}

addEventListener('resize', () => renderOne());
renderGrid();
