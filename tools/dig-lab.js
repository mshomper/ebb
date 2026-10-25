// @ts-check
// The dig lab (docs/future/13 10.10.9, P2c): the island as the game builds it (src/world/island-model.js),
// classed square by square by src/world/dig/layers.js; a hovered square's layers and this season's
// chances from finds.js; a simulated year of a keeper digging, through rest.js and finds.js, against
// the island's budget; one hole's stages from holes.js; the spade's sounds; and a slider for every
// number in recipes/world/dig.json, with the year run again at once and a copy button.

import { buildIslandModel } from '../src/world/island-model.js';
import { campOf } from '../src/world/terrain/landform.js';
import { groundClass, stackOf, bottomOf, nextLayer, cellCenter } from '../src/world/dig/layers.js';
import { rested, thinning, budgetLeft, budgetOf, addEvent, seasonEvents } from '../src/world/dig/rest.js';
import { digFinds, digRarityWeights } from '../src/world/dig/finds.js';
import { holeNow } from '../src/world/dig/holes.js';
import { subSeed, hash32 } from '../src/core/rng.js';
import { HABITAT_CELLS } from '../src/world/growth/habitat.js';

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const get = (/** @type {string} */ p) => fetch(`../recipes/${p}.json`).then((r) => r.json());
const [terrain, water, growth, K, dig0, sound] = await Promise.all([get('world/terrain'), get('world/water'), get('world/growth'), get('world/keepsakes'), get('world/dig'), get('audio/dig')]);
/** The recipe as tuned (a copy). */
const R = structuredClone(dig0);
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const TIERS = ['common', 'uncommon', 'rare', 'very rare', 'once in a lifetime'];
const COLORS = { soil: '#8B6A4E', bank: '#4E5E66', sand: '#E2CFA4', flats: '#C9D5D8', rock: '#9A9A94', water: '#A9C9D8', camp: '#4A3A2E', piece: '#8B6A4E', outside: '#F4EEE4' };
const NAMES = { soil: 'soil (dig)', bank: 'damp bank (dig, clay below)', sand: 'dry sand (dig, Scoop sand)', flats: 'wet flats (rake, later)', rock: 'rock', water: 'water', camp: 'camp ground' };
$('legend').innerHTML = Object.entries(NAMES).map(([k, v]) => `<span><i style="background:${COLORS[/** @type {keyof typeof COLORS} */ (k)]}"></i>${v}</span>`).join('');

/** @type {any} */ let island = null;
/** @type {{ cls: string | null, why?: string }[]} */ let classes = [];

async function build() {
  $('status').textContent = 'Building the island...';
  const seed = Math.max(0, Number($('seed').value) | 0), land = await get(`land/${$('land').value}`);
  await new Promise((ok) => setTimeout(ok, 20));
  island = buildIslandModel({ seed, terrain, land, water, growth });
  // The camp pad, where the land recipe places it (landform.js campOf, world meters).
  const c = campOf(land);
  island.pad = c ? { x: c.x, z: c.z, r: c.r } : null;
  island.seed = seed;
  classify();
  $('status').textContent = `Seed ${seed}, ${$('land').selectedOptions[0].text}. ${counts()}`;
  runYear();
}

function classify() {
  const h = island.habitat, N = HABITAT_CELLS;
  classes = new Array(N * N);
  let i0 = N, j0 = N, i1 = 0, j1 = 0;
  for (let k = 0; k < N * N; k++) {
    const [x, z] = cellCenter(k);
    const g = groundClass(x, z, { hab: h, pad: island.pad }, R);
    classes[k] = g.cls ? { cls: g.cls } : { cls: null, why: g.why };
    if (g.cls || (g.why !== 'outside' && g.why !== 'water')) { const i = k % N, j = Math.floor(k / N); i0 = Math.min(i0, i); j0 = Math.min(j0, j); i1 = Math.max(i1, i); j1 = Math.max(j1, j); }
  }
  // Drawn square, cropped to the land with a margin of sea.
  const side = Math.min(N, Math.max(i1 - i0, j1 - j0) + 12), ci = Math.round((i0 + i1) / 2), cj = Math.round((j0 + j1) / 2);
  view = { i0: Math.max(0, Math.min(N - side, ci - (side >> 1))), j0: Math.max(0, Math.min(N - side, cj - (side >> 1))), side };
  const cv = $('map'); cv.width = cv.height = side;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(side, side);
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) {
    const c = classes[(view.j0 + j) * N + view.i0 + i];
    const hex = COLORS[/** @type {keyof typeof COLORS} */ (c.cls ?? c.why ?? 'outside')] ?? COLORS.outside;
    const n = parseInt(hex.slice(1), 16);
    img.data.set([(n >> 16) & 255, (n >> 8) & 255, n & 255, 255], (j * side + i) * 4);
  }
  ctx.putImageData(img, 0, 0);
}
/** The squares drawn on the map. */
let view = { i0: 0, j0: 0, side: HABITAT_CELLS };
const counts = () => {
  const n = { soil: 0, bank: 0, sand: 0 };
  for (const c of classes) if (c.cls) n[/** @type {'soil'} */ (c.cls)]++;
  return `Diggable: ${n.soil} m² of soil, ${n.bank} m² of damp bank, ${n.sand} m² of dry sand.`;
};

// ---- a square ----

$('map').addEventListener('mousemove', (/** @type {MouseEvent} */ e) => {
  if (!island) return;
  const r = $('map').getBoundingClientRect();
  const i = view.i0 + Math.floor(((e.clientX - r.left) / r.width) * view.side), j = view.j0 + Math.floor(((e.clientY - r.top) / r.height) * view.side);
  if (i < 0 || j < 0 || i >= HABITAT_CELLS || j >= HABITAT_CELLS) return;
  showCell(j * HABITAT_CELLS + i);
});

/** @param {number} k */
function showCell(k) {
  const c = classes[k], season = Number($('season').value), rain = $('rain').checked;
  const h = island.habitat;
  if (!c.cls) { $('cell').innerHTML = `<h2>A square</h2><p>${c.why === 'flats' ? 'The wet flats: the clam rake digs here, later.' : `Not dug here (${c.why}).`}</p>`; return; }
  const stack = stackOf(/** @type {any} */ (c.cls), R), W = dig0.words;
  // Chances this season, averaged over a few hundred days so they read as rates.
  const rows = stack.map((layer, i) => {
    let worm = 0, keep = 0;
    for (let d = 0; d < 400; d++) {
      const f = digFinds({ seed: 1, cell: k, day: d, layer, depth: i + 1, season, moisture: h.moisture[k] / 255, rainBefore: rain, frost: false, thin: 1, budgetLeft: 1 }, R, null);
      if (f.worm) worm++; if (f.rolled) keep++;
    }
    const w = digRarityWeights({ seed: 1, cell: k, day: 0, layer, depth: i + 1, season, moisture: 0, rainBefore: rain, frost: false, thin: 1, budgetLeft: 1 }, R);
    const tot = w.reduce((a, b) => a + b, 0) || 1;
    const clay = layer === 'clay' ? (R.clay.seasons.includes(season) ? 'every dig' : 'none in winter') : '';
    return `<tr><td>${i + 1}. ${W.names[layer]}</td><td>${(worm / 4).toFixed(0)}%</td><td>${clay}</td><td>${(keep / 4).toFixed(0)}%</td><td>${w.map((x, t) => (x > 0 ? `${TIERS[t]} ${Math.round((100 * x) / tot)}%` : '')).filter(Boolean).join(', ')}</td></tr>`;
  }).join('');
  const bands = stack.map((l, i) => `<div style="display:flex;gap:10px;align-items:center"><span style="display:inline-block;width:120px;height:34px;border-radius:4px;background:${rgb(R.look.walls[l])}"></span><span>${i + 1}. ${W.names[l]}</span></div>`).join('');
  $('cell').innerHTML = `<h2>${NAMES[/** @type {keyof typeof NAMES} */ (c.cls)]}</h2>
    <div style="display:grid;gap:4px;margin:6px 0">${bands}<span class="muted">Below: ${W[bottomOf(/** @type {any} */ (c.cls), R)]}</span></div>
    <table><tr><th>Layer</th><th>Worms</th><th>Clay</th><th>Keepsake</th><th>Rarity</th></tr>${rows}</table>
    <p class="muted">Moisture ${(h.moisture[k] / 2.55).toFixed(0)}%, salt ${(h.salt[k] / 2.55).toFixed(0)}%. In ${SEASONS[season]}${rain ? ', after rain' : ''}; keepsakes before the budget and thinning.</p>`;
}
/** A linear colour as CSS, lifted for the page. @param {number[]} c */
const rgb = (c) => `rgb(${c.map((v) => Math.round(255 * Math.min(1, Math.pow(v, 1 / 2.2)))).join(',')})`;

// ---- a year ----

/** One simulated year: a keeper digs perDay spots a day near the camp, each to the bottom. @param {number} perDay */
function year(perDay) {
  const seed = subSeed(island.seed, 'dig'), h = island.habitat;
  const dig = classes.map((c, k) => (c.cls ? k : -1)).filter((k) => k >= 0);
  const home = island.pad ? [island.pad.x, island.pad.z] : [0, 0];
  const near = dig.filter((k) => { const [x, z] = cellCenter(k); return (x - home[0]) ** 2 + (z - home[1]) ** 2 < 40 * 40; });
  const pool = near.length ? near : dig;
  let ev = /** @type {any[]} */ ([]);
  const S = SEASONS.map(() => ({ keep: [0, 0, 0, 0, 0], fam: /** @type {Record<string, number>} */ ({}), worms: 0, clay: 0, thinned: 0, rested: 0, digs: 0 }));
  /** @type {Record<string, number>} */ const firstDay = {};
  const perDayKeep = [], perDayBudget = [];
  for (let day = 0; day < 56; day++) {
    const season = Math.floor(day / 14) % 4;
    const rainBefore = (hash32(seed, day, 0x5a1) >>> 8) / 16777216 < 0.25, frost = season === 3 && (hash32(seed, day, 0xf2) >>> 8) / 16777216 < 0.3;
    let kept = 0;
    for (let n = 0; n < perDay; n++) {
      const k = pool[hash32(seed, day, n) % pool.length], c = classes[k];
      for (let depth = 0; ; depth++) {
        const nl = nextLayer(/** @type {any} */ (c.cls), depth, R);
        if ('bottom' in nl) break;
        const sev = seasonEvents(ev, day);
        if (rested(sev, k, day, nl.depth)) { S[season].rested++; break; }
        const th = thinning(sev, k, R);
        if (th.share < 1) S[season].thinned++;
        const f = digFinds({ seed, cell: k, day, layer: nl.layer, depth: nl.depth, season, moisture: h.moisture[k] / 255, rainBefore, frost, thin: th.share, budgetLeft: budgetLeft(sev, seed, day, R) }, R, K);
        ev = addEvent(ev, { c: k, d: day, l: nl.depth, k: f.keepsake ? 1 : 0 }, R);
        S[season].digs++;
        if (firstDay[nl.layer] === undefined) firstDay[nl.layer] = day;
        if (f.worm) S[season].worms++;
        if (f.clay === 'yes') S[season].clay++;
        if (f.keepsake) {
          kept++;
          S[season].keep[['common', 'uncommon', 'rare', 'veryRare', 'lifetime'].indexOf(f.keepsake.rarity)]++;
          const fam = f.keepsake.form === 'belemnite' ? 'belemnite' : f.keepsake.family;
          S[season].fam[fam] = (S[season].fam[fam] ?? 0) + 1;
        }
      }
    }
    perDayKeep.push(kept); perDayBudget.push(budgetOf(seed, day, R));
  }
  return { S, firstDay, perDayKeep, perDayBudget, perDay };
}

/** @param {ReturnType<typeof year>} y @param {string} title */
function yearHtml(y, title) {
  const W = 560, H = 120, bw = W / 56;
  const bars = y.perDayKeep.map((v, d) => `<rect x="${d * bw + 1}" y="${H - 20 - y.perDayBudget[d] * 40}" width="${bw - 2}" height="${y.perDayBudget[d] * 40}" fill="#E3D9C9"/>` +
    `<rect x="${d * bw + 2}" y="${H - 20 - v * 40}" width="${bw - 4}" height="${v * 40}" fill="#C9835A"/>`).join('');
  const marks = [0, 1, 2, 3].map((s) => `<text x="${s * 14 * bw + 4}" y="${H - 4}">${SEASONS[s]}</text>`).join('');
  const rows = y.S.map((s, i) => `<tr><td>${SEASONS[i]}</td><td>${s.digs}</td><td>${s.keep.reduce((a, b) => a + b, 0)}<br><small>${s.keep.map((n, t) => (n ? `${n} ${TIERS[t]}` : '')).filter(Boolean).join(', ')}</small></td>` +
    `<td>${Object.entries(s.fam).map(([f, n]) => `${n} ${f}`).join(', ') || '-'}</td><td>${s.worms}</td><td>${s.clay}</td><td>${s.thinned} / ${s.rested}</td></tr>`).join('');
  const firsts = Object.entries(y.firstDay).map(([l, d]) => `${dig0.words.names[l]} day ${d + 1}`).join(', ');
  return `<h3>${title}: ${y.perDay} holes a day</h3>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Dug keepsakes a day against the budget">${bars}${marks}</svg>
    <p class="muted">Orange: keepsakes dug that day; beige: the day's budget.</p>
    <table><tr><th>Season</th><th>Digs</th><th>Keepsakes</th><th>Families</th><th>Worms</th><th>Clay</th><th>Thinned / rested</th></tr>${rows}</table>
    <p class="muted">First reached: ${firsts || 'nothing'}.</p>`;
}

/** @type {ReturnType<typeof year> | null} */ let last = null;
function runYear() {
  if (!island) return;
  last = year(Number($('perDay').value));
  $('run').innerHTML = yearHtml(last, 'This run');
  showHoles();
  $('json').value = JSON.stringify(R, null, 2);
}
$('perDay').addEventListener('input', () => { $('perDayV').textContent = $('perDay').value; runYear(); });
$('pin').addEventListener('click', () => { if (last) $('pinned').innerHTML = yearHtml(last, 'Kept run'); });

// ---- one hole ----

function showHoles() {
  const hole = { dugHour: 9, closedHour: -1, wetH: 0 };
  const rows = [['A dry week', 0], ['Rain 4 hours a day', 4]].map(([name, rainPerDay]) => {
    const cells = [];
    for (let d = 0; d <= 7; d++) {
      const t = 9 + d * 24, wet = /** @type {number} */ (rainPerDay) * d;
      const s = holeNow(hole, t, wet, R);
      const mouth = s.stage >= 3 ? 0 : Math.max(0, 1 - s.fill / 3);
      cells.push(`<g transform="translate(${10 + d * 66},0)"><ellipse cx="30" cy="34" rx="26" ry="12" fill="rgba(80,60,40,${(0.5 * s.dark).toFixed(2)})"/>` +
        `<ellipse cx="30" cy="34" rx="${(14 * mouth + 2).toFixed(1)}" ry="${(6 * mouth + 1).toFixed(1)}" fill="#2a1f17" opacity="${mouth > 0 ? 1 : 0}"/>` +
        `<text x="30" y="66" text-anchor="middle">${['open', 'slumped', 'settled', s.gone ? 'gone' : 'closed'][s.stage]}</text><text x="30" y="84" text-anchor="middle">day ${d}</text></g>`);
    }
    return `<h3>${name}</h3><svg viewBox="0 0 540 92" role="img" aria-label="${name}">${cells.join('')}</svg>`;
  }).join('');
  $('holes').innerHTML = rows;
}

// ---- the spade's sounds ----

for (const [name, s] of Object.entries(sound.sounds)) {
  const b = document.createElement('button');
  b.textContent = name;
  b.addEventListener('click', () => {
    const files = s.files ?? [s.file];
    const a = new Audio(`../${sound.root}${files[Math.floor(Math.random() * files.length)]}.ogg`);
    a.volume = Math.min(1, 10 ** ((s.db ?? 0) / 20) * 4);
    a.play();
  });
  $('sounds').append(b);
}

// ---- tuning ----

/** Every number in the recipe's tunable blocks, as [path, value]. */
function knobs() {
  /** @type {[string[], number][]} */ const out = [];
  const walk = (/** @type {any} */ v, /** @type {string[]} */ path) => {
    if (typeof v === 'number') out.push([path, v]);
    else if (v && typeof v === 'object') for (const [k, w] of Object.entries(v)) walk(w, [...path, k]);
  };
  for (const key of ['keepsake', 'rarity', 'budget', 'rest', 'worms', 'fill', 'ground', 'seep']) walk(R[key], [key]);
  return out;
}
for (const [path, v] of knobs()) {
  const max = v === 0 ? 1 : v <= 1 ? 1 : Math.max(10, Math.ceil(v * 3)), step = max <= 1 ? 0.01 : max <= 10 ? 0.1 : 1;
  const l = document.createElement('label');
  l.innerHTML = `<span>${path.join('.')}</span><b>${v}</b><input type="range" min="0" max="${max}" step="${step}" value="${v}">`;
  const input = l.querySelector('input'), out = l.querySelector('b');
  input.addEventListener('input', () => {
    let o = R;
    for (const p of path.slice(0, -1)) o = o[p];
    o[path[path.length - 1]] = Number(input.value);
    out.textContent = input.value;
    runYear();
  });
  $('knobs').append(l);
}
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(JSON.stringify(R, null, 2)); $('copied').textContent = 'Copied. Paste it over recipes/world/dig.json.'; }
  catch { $('json').select(); $('copied').textContent = 'Select all in the box below and copy.'; }
});

for (const id of ['season', 'rain']) $(id).addEventListener('change', () => { if (island) runYear(); });
$('build').addEventListener('click', build);
build();
