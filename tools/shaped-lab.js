// @ts-check
// tools/shaped-lab.html (B3 S0): the starter island with the `?shape=` test grounds shaped into it
// (tools/shaped-world.js), measured by the real checks (src/world/ecology/shaped.js), drawn as a map
// with each ground outlined, its numbers beside it, and the example homes wave 2 will put in each
// species recipe scored against them. Under it, a year of an example seal's visits on this seed.

import { loadShapedRecipes, shapedIsland } from './shaped-world.js';
import { shapedReport, homeOf } from '../src/world/ecology/shaped.js';
import { rememberPonds, noteStep, quietAt } from '../src/world/ecology/shaped-live.js';
import { visitsBetween } from '../src/world/ecology/visits.js';
import { openBox } from '../src/world/ecology/fields.js';
import { HABITAT_ORIGIN } from '../src/world/growth/habitat.js';

/** Example homes (wave 2 writes the real ones as ecology.visit.home in each species recipe). */
const HOMES = {
  seals: { name: 'Grey seals', home: { check: 'bar', need: { areaM2: 18, lengthM: 6, widthM: 3, quiet: true } } },
  sandpipers: { name: 'Purple sandpipers', home: { check: 'wall', need: { lengthM: 8 } } },
  eels: { name: 'Eels', home: { check: 'pond', need: { ageDays: 56 }, max: { seaM: 30 } } },
  teal: { name: 'Teal', home: { check: 'pond', need: { areaM2: 30, reeds: 0.6 } } },
  turnstones: { name: 'Turnstones', home: { check: 'wrack', need: { lyingM: 10, days: 3 } } },
};
/** The example seal visit block drawn on the year strip. */
const SEAL_VISIT = { seasons: [2, 3], everyDays: 4, chance: 0.7, hours: [9, 15] };
const COLORS = { bar: '#E0A030', wall: '#C2452D', pond: '#2E9BD6', old: '#9BA5A0' };

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const esc = (/** @type {any} */ s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
const kinds = () => [...document.querySelectorAll('#kinds button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => /** @type {HTMLElement} */ (b).dataset.kind ?? '');

for (const b of document.querySelectorAll('#kinds button')) b.addEventListener('click', () => { b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); run(); });
for (const id of ['wrackM', 'wrackD']) $(id).addEventListener('input', () => { $(`${id}v`).textContent = /** @type {HTMLInputElement} */ ($(id)).value; run(); });
for (const id of ['seed', 'age', 'walked', 'islet']) $(id).addEventListener('change', run);
$('run').addEventListener('click', run);

let busy = false;
async function run() {
  if (busy) return;
  busy = true;
  $('status').textContent = 'Building the island...';
  await new Promise((r) => setTimeout(r, 20));
  try {
    const R = await loadShapedRecipes(), S = R.shaped;
    const seed = Number(/** @type {HTMLInputElement} */ ($('seed')).value) || 0;
    const t0 = performance.now();
    const { model } = shapedIsland(R, kinds(), seed);
    const hab = model.habitat;
    const nowH = 1000, age = Number(/** @type {HTMLSelectElement} */ ($('age')).value);
    // Ages: remember the dug ponds as born `age` days ago.
    const first = shapedReport({ hab }, S);
    const mem = rememberPonds([], first.ponds, nowH - age * 24, S);
    const ponds = rememberPonds(mem.ponds, first.ponds, nowH, S);
    // A walker standing on the biggest bar this hour breaks its quiet.
    const bar = first.bars[0];
    const steps = /** @type {HTMLInputElement} */ ($('walked')).checked && bar ? noteStep([], bar.x, bar.z, nowH, S) : [];
    const islet = /** @type {HTMLInputElement} */ ($('islet')).checked ? { risen: true, day: 30, barM2: 60, bar: { x: 0, z: 40 } } : null;
    const report = shapedReport({ hab, ageOf: ponds.ageOf, quiet: (b) => quietAt(b, steps, nowH, S), islet,
      wrack: { lyingM: Number(/** @type {HTMLInputElement} */ ($('wrackM')).value), days: Number(/** @type {HTMLInputElement} */ ($('wrackD')).value) } }, S);
    drawMap(hab, report);
    showChecks(report);
    drawYear(seed, homeOf(report, HOMES.seals.home).met);
    $('status').textContent = `Shaped and measured in ${Math.round(performance.now() - t0)} ms. Grounds: ${kinds().join(', ') || 'none (the island as it begins)'}.`;
  } catch (err) {
    console.error(err);
    $('status').textContent = `Something failed: ${err instanceof Error ? err.message : err}`;
  } finally { busy = false; }
}

/** @param {any} hab @param {any} report */
function drawMap(hab, report) {
  const cv = /** @type {HTMLCanvasElement} */ ($('map')), g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  // The island and its tide band, with a margin of sea round it, square.
  const n = hab.n, o = openBox(hab);
  let i0 = n, j0 = n, i1 = 0, j1 = 0;
  for (let j = o.j0; j <= o.j1; j++) for (let i = o.i0; i <= o.i1; i++) {
    const k = j * n + i;
    if (!hab.open[k] || (hab.sea[k] && !hab.band?.[k] && (hab.heightDm?.[k] ?? -99) < -8)) continue;
    i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
  }
  const side = Math.max(i1 - i0, j1 - j0) + 1 + 16;
  const b = { i0: Math.round((i0 + i1 - side) / 2), j0: Math.round((j0 + j1 - side) / 2) };
  const px = cv.width / side;
  const img = g.createImageData(side, side);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const i = b.i0 + x, j = b.j0 + y, o = (y * side + x) * 4;
    let c = [47, 110, 134];
    if (i >= 0 && j >= 0 && i < n && j < n && hab.open[j * n + i]) {
      const k = j * n + i, hd = hab.heightDm?.[k] ?? 0;
      if (hab.sea[k]) c = hab.band?.[k] ? [120, 170, 180] : [47 + Math.max(-40, hd) , 110 + Math.max(-40, hd), 134 + Math.max(-30, hd)];
      else if (hab.depthCm[k] > 0) c = [80, 140, 170];
      else if (hab.band?.[k]) c = [242, 228, 184];
      else {
        const rock = hab.rock[k] / 255, sand = hab.sand[k] / 255, lift = Math.min(1, Math.max(0, hd / 60));
        c = [118 + 60 * sand + 40 * rock + 30 * lift, 150 + 50 * sand - 10 * rock + 20 * lift, 96 + 70 * sand + 40 * rock + 20 * lift];
      }
    }
    img.data.set([c[0], c[1], c[2], 255], o);
  }
  const tmp = document.createElement('canvas');
  tmp.width = side; tmp.height = side;
  /** @type {CanvasRenderingContext2D} */ (tmp.getContext('2d')).putImageData(img, 0, 0);
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, cv.width, cv.height);
  g.drawImage(tmp, 0, 0, cv.width, cv.height);
  /** Outline a patch's squares. @param {number[]} cells @param {string} color */
  const outline = (cells, color) => {
    const set = new Set(cells);
    g.strokeStyle = '#1E2624'; g.lineWidth = Math.max(5, px * 0.7); g.lineCap = 'round';
    const path = () => {
      g.beginPath();
      for (const k of cells) {
        const x = ((k % n) - b.i0) * px, y = (Math.floor(k / n) - b.j0) * px;
        if (!set.has(k - n)) { g.moveTo(x, y); g.lineTo(x + px, y); }
        if (!set.has(k + n)) { g.moveTo(x, y + px); g.lineTo(x + px, y + px); }
        if (!set.has(k - 1)) { g.moveTo(x, y); g.lineTo(x, y + px); }
        if (!set.has(k + 1)) { g.moveTo(x + px, y); g.lineTo(x + px, y + px); }
      }
    };
    // A dark edge under the colour, so each outline reads on sand and sea alike.
    path(); g.stroke();
    g.strokeStyle = color; g.lineWidth = Math.max(3, px * 0.4);
    path(); g.stroke();
  };
  /** A label at a world point. @param {number} wx @param {number} wz @param {string} text @param {string} color */
  const label = (wx, wz, text, color) => {
    const x = (wx - HABITAT_ORIGIN - b.i0) * px, y = (wz - HABITAT_ORIGIN - b.j0) * px;
    g.font = '800 22px Nunito, system-ui, sans-serif';
    const tw = g.measureText(text).width;
    const lx = Math.min(cv.width - tw - 14, Math.max(6, x - tw / 2 - 6)), ly = Math.min(cv.height - 34, Math.max(6, y - 34 - px * 5));
    g.fillStyle = 'rgba(251,247,240,0.94)'; g.strokeStyle = color; g.lineWidth = 3;
    g.beginPath(); g.roundRect(lx, ly, tw + 12, 30, 8); g.fill(); g.stroke();
    g.fillStyle = '#1E2624'; g.fillText(text, lx + 6, ly + 22);
  };
  report._cells.ponds.forEach((/** @type {number[]} */ c, /** @type {number} */ i) => outline(c, report.ponds[i].dug ? COLORS.pond : COLORS.old));
  report._cells.bars.forEach((/** @type {number[]} */ c) => outline(c, COLORS.bar));
  report._cells.walls.forEach((/** @type {number[]} */ c) => outline(c, COLORS.wall));
  for (const p of report.ponds.filter((/** @type {any} */ q) => q.dug)) label(p.x, p.z, `pond ${p.areaM2} m², ${p.ageDays} days, sea ${p.seaM} m`, COLORS.pond);
  for (const bb of report.bars.filter((/** @type {any} */ q) => !q.islet)) label(bb.x, bb.z, `bar ${bb.lengthM} x ${bb.widthM} m`, COLORS.bar);
  for (const wl of report.walls.slice(0, 1)) label(wl.x, wl.z, `wall ${wl.lengthM} m`, COLORS.wall);
}

/** @param {any} report */
function showChecks(report) {
  const fact = (/** @type {string} */ k, /** @type {any} */ v) => `<li><span>${esc(k)}</span><span>${esc(v)}</span></li>`;
  const home = (/** @type {keyof typeof HOMES} */ id) => {
    const H = HOMES[id], r = homeOf(report, H.home);
    const need = [...Object.entries(/** @type {Record<string, any>} */ (H.home.need ?? {})).map(([k, v]) => `${k} ${v === true ? 'yes' : `at least ${v}`}`), ...Object.entries(/** @type {any} */ (H.home).max ?? {}).map(([k, v]) => `${k} at most ${v}`)].join(', ');
    return `<p class="note"><b>${esc(H.name)}</b> want ${esc(need)}.</p><div class="bar-fit" aria-hidden="true"><span style="width:${Math.round(r.fit * 100)}%"></span></div>`;
  };
  const pill = (/** @type {boolean} */ ok) => `<span class="pill${ok ? ' yes' : ''}">${ok ? 'Home made' : 'Not yet'}</span>`;
  const bar = report.bars[0], wall = report.walls[0], ponds = report.ponds.filter((/** @type {any} */ p) => p.dug), pond = ponds[0];
  const S = report.shore;
  $('checks').innerHTML = `
    <div class="card check"><h2>Raised bar ${pill(homeOf(report, HOMES.seals.home).met)}</h2>
      <ul class="facts">${bar ? fact('Size', `${bar.lengthM} x ${bar.widthM} m (${bar.areaM2} m²)`) + fact('Sand', `${Math.round(bar.sand * 100)} percent`) + fact('Quiet', bar.quiet ? 'yes, nobody walked near today' : `no, a walker came within ${bar.nearM} m`) + fact('The islet', report.bars.some((/** @type {any} */ b) => b.islet) ? 'risen, its bar counts too' : 'not risen') : fact('Bars', 'none raised in the tide band')}</ul>${home('seals')}</div>
    <div class="card check"><h2>Sea wall ${pill(homeOf(report, HOMES.sandpipers.home).met)}</h2>
      <ul class="facts">${wall ? fact('Length', `${wall.lengthM} m of painted rock face at the waterline`) : fact('Walls', 'none (the rocky point is scenery)')}</ul>${home('sandpipers')}</div>
    <div class="card check"><h2>Dug pond ${pill(homeOf(report, HOMES.eels.home).met || homeOf(report, HOMES.teal.home).met)}</h2>
      <ul class="facts">${pond ? fact('Age', `${pond.ageDays} game days`) + fact('Area', `${pond.areaM2} m², ${pond.deepCm} cm at its deepest`) + fact('To the sea', `${pond.seaM} m`) + fact('Wet grass between', pond.wetGrass ? 'yes' : 'no') + fact('Reeds round it', `${Math.round(pond.reeds * 100)} percent of the margin`) : fact('Ponds', 'none dug (the starter pond is scenery)')}</ul>${home('eels')}${home('teal')}</div>
    <div class="card check"><h2>Wrack ${pill(homeOf(report, HOMES.turnstones.home).met)}</h2>
      <ul class="facts">${fact('Left lying', `${report.wrack.lyingM} m of strandline`)}${fact('For', `${report.wrack.days} days`)}</ul>${home('turnstones')}
      <p class="note">In the game this is the newest strandline's wrack nobody gathered (src/world/gather). Here the sliders stand in for it.</p></div>
    <div class="card check"><h2>The coast, shared out</h2>
      <ul class="facts">${fact('Waterline', `${S.coastM} m`)}${fact('Held by a wall', `${S.wallM} m`)}${fact('Held by a bar', `${S.barM} m`)}${fact('Sandy and free', `${S.sandM} m`)}${fact('Free in all', `${S.freeM} m`)}</ul>
      <p class="note">Homes compete: a wall takes coast a sandy beach or a bar would use. No rule says no; each species' needs read these numbers.</p></div>`;
}

/** @param {number} seed @param {boolean} homeMade */
function drawYear(seed, homeMade) {
  const svg = $('year'), W = 1000, days = 56, x = (/** @type {number} */ d) => 10 + (d / days) * (W - 20);
  const seasons = ['Spring', 'Summer', 'Autumn', 'Winter'], fills = ['#DDE8D2', '#EFE6C4', '#EBD7BE', '#D9E1E6'];
  let s = '';
  for (let q = 0; q < 4; q++) s += `<rect x="${x(q * 14)}" y="10" width="${x(14) - x(0)}" height="70" fill="${fills[q]}"/><text x="${x(q * 14) + 8}" y="32" font-size="18" font-weight="800" fill="#4A5551" font-family="Nunito, system-ui">${seasons[q]}</text>`;
  const visits = homeMade ? [] : visitsBetween(seed, 'seals', SEAL_VISIT, 0, days * 24);
  let lastShown = -99;
  for (const v of visits) {
    const cx = x(v.hour / 24);
    s += `<circle cx="${cx}" cy="58" r="8" fill="#2E5E6E"/>`;
    // The hint the next morning: again only 6 days after it last showed.
    if (v.day + 1 - lastShown >= 6) { lastShown = v.day + 1; s += `<rect x="${x(v.day + 1) - 3}" y="88" width="6" height="22" rx="3" fill="#C27A2D"/>`; }
  }
  s += `<text x="10" y="126" font-size="16" fill="#4A5551" font-family="Nunito, system-ui">Dots: visits. Orange marks under them: the morning hint.</text>`;
  svg.innerHTML = s;
  $('yearNote').textContent = homeMade ? 'The seals\' home is made on this island (the raised bar, quiet), so no visits come.' : `${visits.length} visits this year on seed ${seed}.`;
}

run();
