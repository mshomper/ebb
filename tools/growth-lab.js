// @ts-check
// ebb growth lab: the real island, then 14 game days of the hourly tick run fast on a copy of its
// world (docs 10, 11): the plant count of every species and grass cover hour by hour, a second run
// from the same start to check both endings match (the determinism the offline catch-up depends
// on), and the habitat map with every species' plants on it. The species come from the growth
// recipe's list at runtime, so a new species shows up here without touching this page. The live
// world is never written.

import { startApp } from '../src/app.js';
import { runHour, hashWorldState } from '../src/sim/tick.js';
import { hourIndex } from '../src/core/clock.js';
import { HABITAT_CELLS, HABITAT_ORIGIN } from '../src/world/growth/habitat.js';
import { initialJournal, observe } from '../src/world/journal/observe.js';
import { loadRecipe } from '../src/core/recipes.js';

const DAYS = 14;
const HOURS = DAYS * 24;
const CHUNK_MS = 12;          // hours run per frame until this much time is spent
const MAP_SCALE = 3;          // map pixels per habitat cell

const ICON_CHECK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#7C9D72" stroke="#5F7F5B" stroke-width="2"/><path d="M8 12.5l2.8 2.8 5.2-5.6" fill="none" stroke="#FBF7F0" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="#B5654A" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5v.2"/></svg>';
const DOT_WAIT = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="#A9B3A6" stroke-width="2.4"/></svg>';
const DOT_OK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#7C9D72" stroke="#5F7F5B" stroke-width="2"/></svg>';

// One fixed color per known species; any other id gets the fallback so it still shows.
/** @type {Record<string, string>} */
const SPECIES_RGB = { reeds: '#3E6B3A', lilies: '#2E7D6B', iris: '#C9A227', thrift: '#C8628C', marigold: '#E0A800', campion: '#8E9AA6', willow: '#6F8A6A' };
const OTHER_RGB = '#6B6F80';
// Map colors (r, g, b). Up here so they exist before the first map is drawn during startup.
const SEA = [47, 110, 134];
const POND = [59, 127, 168];
const DRY = [169, 174, 132];
const WET = [111, 152, 184];
const SALTY = [230, 211, 163];
const GRASS_RGB = '#9DBA6A';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const canvas = /** @type {HTMLCanvasElement} */ ($('view'));
const bRun = /** @type {HTMLButtonElement} */ ($('b-run'));
const gPlants = /** @type {HTMLCanvasElement} */ ($('g-plants'));
const gGrass = /** @type {HTMLCanvasElement} */ ($('g-grass'));

/** @param {number} v @param {number} [d] */
const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '-');
/** @param {number} h */
const hex = (h) => (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
/** @param {string} icon @param {string} text */
const statusLine = (icon, text) => `<div class="status">${icon}<span>${text}</span></div>`;

/** @typedef {{ ids: string[], counts: number[][], grass: number[] }} Series counts[i] is ids[i] per hour */
/** @type {Series | null} */ let run1 = null;
/** @type {Series | null} */ let run2 = null;
/** The world's env, once the app is up: the species list and names are read from it. @type {any} */
let ENV = null;

/** @param {string} id */
const colorOf = (id) => SPECIES_RGB[id] ?? OTHER_RGB;
/** @param {string} id */
const nameOf = (id) => ENV?.recipes?.flora?.[id]?.name ?? id;

/**
 * The species to chart and map: the growth recipe's list, then any other id found on the plants
 * (so nothing is hidden if a plant of an unlisted species turns up).
 * @param {any[]} [plants]
 * @returns {string[]}
 */
function speciesIds(plants = []) {
  const list = ENV?.recipes?.growth?.species;
  const ids = Array.isArray(list) && list.length ? [...list] : ['reeds'];
  for (const p of plants) if (p?.sp && !ids.includes(p.sp)) ids.push(p.sp);
  return ids;
}

const result = await startApp(canvas);
if (!result.ok) {
  $('status').innerHTML = `${ICON_WARN}<span>WebGPU is not available here (${result.reason}). Open this page in current Chrome or Edge.</span>`;
} else {
  const world = result.world;
  ENV = world.env;
  buildSpeciesUi(speciesIds(world.state?.growth?.plants ?? []));
  drawCharts();
  addEventListener('resize', drawCharts);

  // Wait for the first water summary: until then there is no habitat and growth does nothing.
  const waitForHabitat = () => {
    const hab = world.env.habitat?.();
    if (!hab) {
      $('status').innerHTML = `${DOT_WAIT}<span>Waiting for the water summary</span>`;
      setTimeout(waitForHabitat, 400);
      return;
    }
    $('status').innerHTML = `${DOT_OK}<span>The island is ready. Press Run 14 days.</span>`;
    bRun.disabled = false;
    const plants = world.state?.growth?.plants ?? [];
    buildSpeciesUi(speciesIds(plants));
    drawMap(hab, plants);
    $('map-title').textContent = 'What the plants see now, one square per meter, north up. After a run it shows the island 14 days later.';
  };
  waitForHabitat();

  bRun.addEventListener('click', async () => {
    const hab = world.env.habitat?.();
    if (!hab) return;
    bRun.disabled = true;
    run1 = null; run2 = null;
    drawCharts();
    $('verdict').innerHTML = statusLine(DOT_WAIT, 'Running.');
    // Freeze the start: a copy of the live world, and this habitat for every hour of both runs,
    // so sculpting the live island meanwhile cannot change the runs.
    const start = structuredClone(world.state);
    const env = { ...world.env, habitat: () => hab };
    const h0 = hourIndex() + 1;
    const land = landMask(hab);
    const ids = speciesIds(start?.growth?.plants ?? []);
    const tiles = buildSpeciesUi(ids);
    // The journal starts having already seen the island as it is, so the list shows only what changes.
    const words = await loadRecipe('world/journal');
    const j0 = observe(initialJournal(h0 - 100), { state: start, events: [], hour: h0 - 1, habitat: hab, words }).journal;
    const look = { words, journal: j0 };
    const t0 = performance.now();

    const a = await runDays(structuredClone(start), h0, env, land, ids, 1, look);
    run1 = a.series;
    drawCharts();
    const b = await runDays(structuredClone(start), h0, env, land, ids, 2, look);
    run2 = b.series;
    const secs = (performance.now() - t0) / 1000;
    drawCharts();

    const hashA = hashWorldState(a.state);
    const hashB = hashWorldState(b.state);
    const same = hashA === hashB;
    $('verdict').innerHTML = same
      ? statusLine(ICON_CHECK, 'Both runs match') +
        `<p class="muted">The same start and the same ${HOURS} hours gave the same world twice: fingerprint ${hex(hashA)}.</p>`
      : statusLine(ICON_WARN, 'The runs differ') +
        `<p class="muted">First run ${hex(hashA)}, second run ${hex(hashB)}. Something in the hourly tick is not seeded; this is a bug to report.</p>`;

    // One tile per species: plants at the start, then after the 14 days.
    ids.forEach((id, i) => {
      const s = a.series.counts[i];
      tiles[i].innerHTML = `${fmt(s[0])}<small>to</small>${fmt(s[HOURS])}`;
    });
    const sameJournal = JSON.stringify(a.journal) === JSON.stringify(b.journal);
    $('journal-title').textContent = `${a.notes.length} notes in ${DAYS} days, oldest first. ` +
      (sameJournal ? 'Both runs wrote the same journal.' : 'The two runs wrote different journals: this is a bug to report.');
    $('journal-notes').innerHTML = a.notes.map((n) => `<li><span>${n.date}</span><span>${n.text}</span></li>`).join('');
    $('t-grass').textContent = `${fmt(a.series.grass[HOURS], 1)}%`;
    $('t-time').textContent = fmt(secs, 1);
    $('progress').textContent = `Ran game hours ${h0} to ${h0 + HOURS - 1} twice, in ${fmt(secs, 1)} s. The live island was not changed.`;
    const plants = a.state.growth?.plants ?? [];
    drawMap(hab, plants);
    $('map-title').textContent = `The island after the first run's ${DAYS} days, one square per meter, north up.`;
    bRun.disabled = false;
  });
}

/**
 * Rebuild the per-species parts of the page from the species list: one start-to-end tile each
 * (before the grass tile), one line in the chart legend, one dot in the map legend.
 * @param {string[]} ids
 * @returns {HTMLElement[]} the tiles' value elements, in the order of `ids`
 */
function buildSpeciesUi(ids) {
  const tiles = $('tiles');
  for (const el of [...tiles.querySelectorAll('.sp-tile')]) el.remove();
  const before = $('t-grass').parentElement;
  const chartLegend = $('legend-plants');
  const mapLegend = $('legend-map-plants');
  chartLegend.replaceChildren();
  mapLegend.replaceChildren();
  /** @type {HTMLElement[]} */ const values = [];
  for (const id of ids) {
    const card = el('div', 'card tile sp-tile');
    const value = el('b', '', '-');
    const label = el('span');
    label.append(swatch('dot', colorOf(id)), `${nameOf(id)}, plants at the start to day 14`);
    card.append(value, label);
    tiles.insertBefore(card, before);
    values.push(value);

    const line = el('span');
    line.append(swatch('', colorOf(id)), `${nameOf(id)}, first run`);
    chartLegend.append(line);
    const dot = el('span');
    dot.append(swatch('dot', colorOf(id)), nameOf(id));
    mapLegend.append(dot);
  }
  const dash = el('span');
  dash.append(swatch('dash', ''), 'second run, dashed (lies on top when they match)');
  chartLegend.append(dash);
  return values;
}

/** @param {string} tag @param {string} [cls] @param {string} [text] */
function el(tag, cls = '', text = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** A legend or tile color mark. @param {string} cls @param {string} color */
function swatch(cls, color) {
  const i = el('i', cls);
  if (color) i.style.background = color;
  return i;
}

/**
 * Run HOURS game hours from `state`, recording each species' plant count and grass cover each
 * hour (index 0 is the start), in chunks so the page stays responsive.
 * @param {any} state @param {number} h0 first hour index @param {any} env
 * @param {Uint8Array} land 1 for land cells @param {string[]} ids species to count @param {number} pass 1 or 2
 * @param {{ words: any, journal: any }} look the journal's words and its starting journal; it looks after every hour
 * @returns {Promise<{ state: any, series: Series, journal: any, notes: any[] }>}
 */
async function runDays(state, h0, env, land, ids, pass, look) {
  /** @type {Series} */ const series = { ids, counts: ids.map(() => []), grass: [] };
  let journal = look.journal;
  /** @type {any[]} */ const notes = [];
  const record = () => {
    const c = speciesCounts(state, ids);
    for (let i = 0; i < ids.length; i++) series.counts[i].push(c[i]);
    series.grass.push(grassCover(state, land));
  };
  record();
  let h = 0;
  while (h < HOURS) {
    const t = performance.now();
    do {
      const r = runHour(state, h0 + h, env);
      state = r.state;
      const o = observe(journal, { state, events: r.events, hour: h0 + h, habitat: env.habitat(), words: look.words });
      journal = o.journal;
      notes.push(...o.notes);
      h++;
      record();
    } while (h < HOURS && performance.now() - t < CHUNK_MS);
    $('progress').textContent = `Run ${pass} of 2: day ${Math.min(DAYS, Math.floor(h / 24) + 1)} of ${DAYS} (hour ${h} of ${HOURS}).`;
    if (pass === 1) { run1 = series; drawCharts(); }
    await new Promise(requestAnimationFrame);
  }
  return { state, series, journal, notes };
}

/** Plants of each species, in the order of `ids`. @param {any} state @param {string[]} ids */
function speciesCounts(state, ids) {
  const out = ids.map(() => 0);
  const plants = state?.growth?.plants;
  if (!plants) return out;
  for (const p of plants) {
    const i = ids.indexOf(p.sp);
    if (i >= 0) out[i]++;
  }
  return out;
}

/** Land cells: not the sea, not standing water. @param {any} hab */
function landMask(hab) {
  const m = new Uint8Array(hab.n * hab.n);
  for (let k = 0; k < m.length; k++) m[k] = !hab.open[k] || hab.sea[k] || hab.depthCm[k] > 0 ? 0 : 1;
  return m;
}

/** Mean grass cover over the land, percent (0 when there is no cover map yet). @param {any} state @param {Uint8Array} land */
function grassCover(state, land) {
  const g = state?.growth?.grass;
  if (!g) return 0;
  let sum = 0, n = 0;
  for (let k = 0; k < land.length; k++) if (land[k]) { sum += g[k]; n++; }
  return n ? (sum / n / 255) * 100 : 0;
}

function drawCharts() {
  const ids = run1?.ids ?? [];
  drawChart(gPlants, ids.map((id, i) => ({
    a: run1?.counts[i] ?? null, b: run2?.counts[i] ?? null, color: colorOf(id),
  })), 'plants of each species', '', 0);
  drawChart(gGrass, [{ a: run1?.grass ?? null, b: run2?.grass ?? null, color: GRASS_RGB }], 'grass cover', '%', 1);
}

/**
 * A line chart over the 14 days, one line per series: the first run solid in its color, the
 * second dashed on top.
 * @param {HTMLCanvasElement} cv
 * @param {{ a: number[] | null, b: number[] | null, color: string }[]} lines
 * @param {string} yLabel @param {string} unit @param {number} dec
 */
function drawChart(cv, lines, yLabel, unit, dec) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.font = '600 15px Nunito, system-ui, sans-serif';
  g.fillStyle = '#4A5551';
  g.textBaseline = 'alphabetic';
  const drawn = lines.filter((l) => l.a && l.a.length >= 2);
  if (!drawn.length) {
    g.fillText('Press Run 14 days to fill this chart', 4, h / 2);
    return;
  }

  const left = 72, right = w - 8, top = 26, bottom = h - 26;
  let lo = Infinity, hi = -Infinity;
  for (const l of drawn) {
    for (const s of [l.a, l.b]) {
      if (!s) continue;
      for (const v of s) { if (v < lo) lo = v; if (v > hi) hi = v; }
    }
  }
  lo = Math.min(0, lo);
  if (hi - lo < 1e-6) hi = lo + 1;
  hi += (hi - lo) * 0.08;
  if (unit === '%') hi = Math.min(hi, 100);
  // Whole counts: round the top up to an even number so all three labels are whole numbers.
  if (dec === 0) hi = Math.max(2, Math.ceil(hi / 2) * 2);
  const x = (/** @type {number} */ i) => left + (i / HOURS) * (right - left);
  const y = (/** @type {number} */ v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  const mid = (lo + hi) / 2;

  // Axes, day ticks, a faint line at the middle value, value labels.
  g.strokeStyle = '#E3D9C9';
  g.lineWidth = 1;
  g.beginPath();
  for (let d = 0; d <= DAYS; d++) { g.moveTo(x(d * 24), top); g.lineTo(x(d * 24), bottom); }
  g.moveTo(left, y(mid)); g.lineTo(right, y(mid));
  g.moveTo(left, top); g.lineTo(right, top);
  g.stroke();
  g.strokeStyle = '#A9B3A6';
  g.beginPath();
  g.moveTo(left, top); g.lineTo(left, bottom); g.lineTo(right, bottom);
  g.stroke();

  g.textAlign = 'right';
  g.fillText(`${hi.toFixed(dec)}${unit}`, left - 6, top + 5);
  g.fillText(`${mid.toFixed(dec)}${unit}`, left - 6, y(mid) + 5);
  g.fillText(`${lo.toFixed(dec)}${unit}`, left - 6, bottom + 5);
  g.textAlign = 'left';
  g.fillText(yLabel, left, 16);
  for (const d of [0, 7, 14]) {
    g.textAlign = d === 0 ? 'left' : d === DAYS ? 'right' : 'center';
    g.fillText(`day ${d}`, x(d * 24), h - 6);
  }
  g.textAlign = 'left';

  /** @param {number[]} s @param {string} c @param {number} lw @param {number[]} dash */
  const line = (s, c, lw, dash) => {
    g.strokeStyle = c;
    g.lineWidth = lw;
    g.setLineDash(dash);
    g.beginPath();
    s.forEach((v, i) => (i === 0 ? g.moveTo(x(i), y(v)) : g.lineTo(x(i), y(v))));
    g.stroke();
    g.setLineDash([]);
  };
  for (const l of drawn) line(/** @type {number[]} */ (l.a), l.color, 2.5, []);
  g.globalAlpha = 0.6;
  for (const l of drawn) if (l.b) line(l.b, '#1E2624', 1.5, [6, 4]);
  g.globalAlpha = 1;
}


/**
 * The habitat from above, north (-z) up: moisture tints dry ground blue, salt tints it sand; the
 * sea and standing water in their own blues; every plant as a dot in its species' color, sized by
 * the plant.
 * @param {any} hab @param {any[]} plants
 */
function drawMap(hab, plants) {
  const N = HABITAT_CELLS;
  const cv = /** @type {HTMLCanvasElement} */ ($('g-map'));
  const small = document.createElement('canvas');
  small.width = N; small.height = N;
  const sg = /** @type {CanvasRenderingContext2D} */ (small.getContext('2d'));
  const img = sg.createImageData(N, N);
  let wet = 0, salty = 0;
  for (let k = 0; k < N * N; k++) {
    let c;
    if (hab.sea[k] || !hab.open[k]) c = SEA;
    else if (hab.depthCm[k] > 0) c = POND;
    else {
      const m = hab.moisture[k] / 255, s = hab.salt[k] / 255;
      if (m > 0.5) wet++;
      if (s > 0.5) salty++;
      c = mix(mix(DRY, WET, m * 0.85), SALTY, s * 0.9);
    }
    const o = k * 4;
    img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
  }
  sg.putImageData(img, 0, 0);

  // Show just the opened area (where the water summary has data), so the island fills the map.
  let x0 = N, z0 = N, x1 = -1, z1 = -1;
  for (let k = 0; k < N * N; k++) {
    if (!hab.open[k]) continue;
    const i = k % N, j = Math.floor(k / N);
    if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < z0) z0 = j; if (j > z1) z1 = j;
  }
  if (x1 < 0) { x0 = 0; z0 = 0; x1 = N - 1; z1 = N - 1; }
  const cw = x1 - x0 + 1, ch = z1 - z0 + 1;
  const scale = Math.max(1, Math.floor((N * MAP_SCALE) / Math.max(cw, ch)));
  cv.width = cw * scale; cv.height = ch * scale;
  const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  g.imageSmoothingEnabled = false;
  g.drawImage(small, x0, z0, cw, ch, 0, 0, cv.width, cv.height);
  g.strokeStyle = '#FBF7F0';
  g.lineWidth = 1;
  const ids = speciesIds(plants);
  const counts = ids.map(() => 0);
  for (const p of plants) {
    const i = ids.indexOf(p.sp);
    if (i >= 0) counts[i]++;
    g.fillStyle = colorOf(p.sp);
    const px = (p.x - HABITAT_ORIGIN - x0) * scale;
    const py = (p.z - HABITAT_ORIGIN - z0) * scale;
    const r = 1.8 + 2.2 * Math.max(0, Math.min(1, p.size ?? 0));
    g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  const perSpecies = ids.map((id, i) => `${nameOf(id)} ${counts[i]}`).join(', ');
  $('map-stats').textContent =
    `Plants: ${perSpecies}. Wet ground ${wet} m², salty ground ${salty} m² (over half way on each scale). ` +
    `Habitat fingerprint ${hex(hab.hash ?? 0)}.`;
}

/** @param {number[]} a @param {number[]} b @param {number} t */
function mix(a, b, t) {
  const u = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}
