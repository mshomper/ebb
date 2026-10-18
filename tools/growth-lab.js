// @ts-check
// ebb growth lab: the real island, then 14 game days of the hourly tick run fast on a copy of its
// world (docs 10, 11): reed clumps and grass cover hour by hour, a second run from the same start
// to check both endings match (the determinism the offline catch-up depends on), and the habitat
// map with the clumps on it. The live world is never written.

import { startApp } from '../src/app.js';
import { runHour, hashWorldState } from '../src/sim/tick.js';
import { hourIndex } from '../src/core/clock.js';
import { HABITAT_CELLS, HABITAT_ORIGIN } from '../src/world/growth/habitat.js';

const DAYS = 14;
const HOURS = DAYS * 24;
const CHUNK_MS = 12;          // hours run per frame until this much time is spent
const MAP_SCALE = 3;          // map pixels per habitat cell

const ICON_CHECK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#7C9D72" stroke="#5F7F5B" stroke-width="2"/><path d="M8 12.5l2.8 2.8 5.2-5.6" fill="none" stroke="#FBF7F0" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="#B5654A" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5v.2"/></svg>';
const DOT_WAIT = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="#A9B3A6" stroke-width="2.4"/></svg>';
const DOT_OK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#7C9D72" stroke="#5F7F5B" stroke-width="2"/></svg>';

const REED_RGB = '#3E6B3A';
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
const gReeds = /** @type {HTMLCanvasElement} */ ($('g-reeds'));
const gGrass = /** @type {HTMLCanvasElement} */ ($('g-grass'));

/** @param {number} v @param {number} [d] */
const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '-');
/** @param {number} h */
const hex = (h) => (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
/** @param {string} icon @param {string} text */
const statusLine = (icon, text) => `<div class="status">${icon}<span>${text}</span></div>`;

/** @typedef {{ reeds: number[], grass: number[] }} Series */
/** @type {Series | null} */ let run1 = null;
/** @type {Series | null} */ let run2 = null;

const result = await startApp(canvas);
if (!result.ok) {
  $('status').innerHTML = `${ICON_WARN}<span>WebGPU is not available here (${result.reason}). Open this page in current Chrome or Edge.</span>`;
} else {
  const world = result.world;
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
    drawMap(hab, world.state?.growth?.plants ?? []);
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
    const t0 = performance.now();

    const a = await runDays(structuredClone(start), h0, env, land, 1);
    run1 = a.series;
    drawCharts();
    const b = await runDays(structuredClone(start), h0, env, land, 2);
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

    const r0 = a.series.reeds[0], r1 = a.series.reeds[HOURS];
    $('t-start').textContent = fmt(r0);
    $('t-end').textContent = fmt(r1);
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
 * Run HOURS game hours from `state`, recording reed clumps and grass cover each hour (index 0 is
 * the start), in chunks so the page stays responsive.
 * @param {any} state @param {number} h0 first hour index @param {any} env
 * @param {Uint8Array} land 1 for land cells @param {number} pass 1 or 2
 * @returns {Promise<{ state: any, series: Series }>}
 */
async function runDays(state, h0, env, land, pass) {
  /** @type {Series} */ const series = { reeds: [reedCount(state)], grass: [grassCover(state, land)] };
  let h = 0;
  while (h < HOURS) {
    const t = performance.now();
    do {
      state = runHour(state, h0 + h, env).state;
      h++;
      series.reeds.push(reedCount(state));
      series.grass.push(grassCover(state, land));
    } while (h < HOURS && performance.now() - t < CHUNK_MS);
    $('progress').textContent = `Run ${pass} of 2: day ${Math.min(DAYS, Math.floor(h / 24) + 1)} of ${DAYS} (hour ${h} of ${HOURS}).`;
    if (pass === 1) { run1 = series; drawCharts(); }
    await new Promise(requestAnimationFrame);
  }
  return { state, series };
}

/** @param {any} state */
function reedCount(state) {
  const plants = state?.growth?.plants;
  return plants ? plants.filter((/** @type {any} */ p) => p.sp === 'reeds').length : 0;
}

/** Land cells: not the sea, not standing water. @param {any} hab */
function landMask(hab) {
  const m = new Uint8Array(hab.n * hab.n);
  for (let k = 0; k < m.length; k++) m[k] = hab.sea[k] || hab.depthCm[k] > 0 ? 0 : 1;
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
  drawChart(gReeds, run1?.reeds ?? null, run2?.reeds ?? null, REED_RGB, 'reed clumps', '', 0);
  drawChart(gGrass, run1?.grass ?? null, run2?.grass ?? null, GRASS_RGB, 'grass cover', '%', 1);
}

/**
 * A line chart over the 14 days: the first run solid, the second dashed on top.
 * @param {HTMLCanvasElement} cv @param {number[] | null} a @param {number[] | null} b
 * @param {string} color @param {string} yLabel @param {string} unit @param {number} dec
 */
function drawChart(cv, a, b, color, yLabel, unit, dec) {
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
  if (!a || a.length < 2) {
    g.fillText('Press Run 14 days to fill this chart', 4, h / 2);
    return;
  }

  const left = 72, right = w - 8, top = 26, bottom = h - 26;
  const vals = b ? [...a, ...b] : a;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  lo = Math.min(0, lo);
  if (hi - lo < 1e-6) hi = lo + 1;
  hi += (hi - lo) * 0.08;
  if (unit === '%') hi = Math.min(hi, 100);
  const x = (/** @type {number} */ i) => left + (i / HOURS) * (right - left);
  const y = (/** @type {number} */ v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);

  // Axes, day ticks, value labels.
  g.strokeStyle = '#E3D9C9';
  g.lineWidth = 1;
  g.beginPath();
  for (let d = 0; d <= DAYS; d++) { g.moveTo(x(d * 24), top); g.lineTo(x(d * 24), bottom); }
  g.stroke();
  g.strokeStyle = '#A9B3A6';
  g.beginPath();
  g.moveTo(left, top); g.lineTo(left, bottom); g.lineTo(right, bottom);
  g.stroke();

  g.textAlign = 'right';
  g.fillText(`${hi.toFixed(dec)}${unit}`, left - 6, top + 5);
  g.fillText(`${((lo + hi) / 2).toFixed(dec)}${unit}`, left - 6, (top + bottom) / 2 + 5);
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
  line(a, color, 2.5, []);
  if (b) {
    g.globalAlpha = 0.6;
    line(b, '#1E2624', 1.5, [6, 4]);
    g.globalAlpha = 1;
  }
}


/**
 * The habitat from above, north (-z) up: moisture tints dry ground blue, salt tints it sand; the
 * sea and standing water in their own blues; reed clumps as dark green dots sized by the clump.
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
    if (hab.sea[k]) c = SEA;
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
    if (!(hab.sea[k] || hab.moisture[k] || hab.salt[k] || hab.grass[k] || hab.depthCm[k])) continue;
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
  g.fillStyle = '#24401F';
  g.strokeStyle = '#FBF7F0';
  g.lineWidth = 1;
  let reeds = 0;
  for (const p of plants) {
    if (p.sp !== 'reeds') continue;
    reeds++;
    const px = (p.x - HABITAT_ORIGIN - x0) * scale;
    const py = (p.z - HABITAT_ORIGIN - z0) * scale;
    const r = 1.8 + 2.2 * Math.max(0, Math.min(1, p.size ?? 0));
    g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  $('map-stats').textContent =
    `Reed clumps: ${reeds}. Wet ground ${wet} m², salty ground ${salty} m² (over half way on each scale). ` +
    `Habitat fingerprint ${hex(hab.hash ?? 0)}.`;
}

/** @param {number[]} a @param {number[]} b @param {number} t */
function mix(a, b, t) {
  const u = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}
