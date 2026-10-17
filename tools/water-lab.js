// @ts-check
// ebb water lab: the real island plus live health numbers for the shallow-water simulation
// (docs/07 Stability and Performance budget), and two scripted sculpting checks.

import { startApp } from '../src/app.js';
import { on } from '../src/core/events.js';

const HISTORY_S = 120;
const SAMPLE_MS = 250;
const SPEED_CAP = 4;
const FRAME_WINDOW = 300;
const STROKE_S = 3;
const WATCH_S = 10;

const DOT_OK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#7C9D72" stroke="#5F7F5B" stroke-width="2"/></svg>';
const DOT_AMBER = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#E2B15B" stroke="#B5843A" stroke-width="2"/></svg>';
const DOT_WAIT = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="#A9B3A6" stroke-width="2.4"/></svg>';
const ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="#B5654A" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5v.2"/></svg>';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const canvas = /** @type {HTMLCanvasElement} */ ($('view'));
const gVol = /** @type {HTMLCanvasElement} */ ($('g-vol'));
const gSpeed = /** @type {HTMLCanvasElement} */ ($('g-speed'));
const bHollow = /** @type {HTMLButtonElement} */ ($('b-hollow'));
const bMound = /** @type {HTMLButtonElement} */ ($('b-mound'));

/** @typedef {{ t: number, vol: number, speed: number, tide: number }} Sample */
/** @type {Sample[]} */ const samples = [];
/** @type {number[]} */ const simMs = [];
/** @type {number[]} */ const drawMs = [];
/** @type {{ t: number }[]} */ const marks = [];
/** @type {any} */ let last = null;
let timestamps = false;

/** @param {number[]} arr @param {number} v @param {number} n */
function push(arr, v, n) {
  arr.push(v);
  if (arr.length > n) arr.shift();
}
/** @param {number[]} arr @param {number} q */
function pct(arr, q) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}
/** @param {number} v @param {number} [d] */
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '-');

const result = await startApp(canvas);
if (!result.ok) {
  $('summary').innerHTML = `<div class="status">${ICON_WARN}<span>WebGPU is not available here (${result.reason}). Open this page in current Chrome or Edge.</span></div>`;
} else {
  const r = result;
  const water = r.water;
  const terrain = r.terrain;
  timestamps = r.features.includes('timestamp-query');
  const simBudget = r.tier === 'low' ? 0.9 : 0.6;
  $('device').textContent =
    `Tier: ${r.tier}. Simulation budget on this tier: ${simBudget} ms. ` +
    `Spring at x ${fmt(water.spring.x, 1)}, z ${fmt(water.spring.z, 1)} m. ` +
    `Timestamps: ${timestamps ? 'available' : 'not available in this browser'}.`;
  water.setStats(true);

  on('render:timings', (/** @type {any} */ p) => {
    for (const { name, ms } of p.passes) if (name === 'water') push(drawMs, ms, FRAME_WINDOW);
  });

  setInterval(() => {
    const s = water.stats();
    if (!s) return;
    last = s;
    const t = performance.now() / 1000;
    samples.push({ t, vol: s.volumeM3, speed: s.maxSpeed, tide: s.tide });
    while (samples.length && samples[0].t < t - HISTORY_S) samples.shift();
    while (marks.length && marks[0].t < t - HISTORY_S) marks.shift();
    if (s.simMs > 0) push(simMs, s.simMs, 40);
    watchTick(s);
  }, SAMPLE_MS);
  setInterval(() => updateText(simBudget), 500);
  requestAnimationFrame(drawCharts);

  // The water summary map: redrawn whenever a new summary arrives.
  const drawMap = () => drawSummaryMap(water.getSummary(), water.springs());
  on('water:summary-updated', drawMap);
  setTimeout(drawMap, 0); // after the rest of this module has run (its constants are declared below)

  bHollow.disabled = false;
  bMound.disabled = false;
  bHollow.addEventListener('click', () => {
    const { x, z } = water.spring;
    const d = Math.hypot(x, z) || 1;
    const px = x - (x / d) * 3;
    const pz = z - (z / d) * 3;
    runCheck('Dig a hollow by the spring', { kind: 'lower', radius: 2, strength: 1 }, px, pz);
  });
  bMound.addEventListener('click', () => {
    const pond = findPond(water.spring.x, water.spring.z, last ? last.tide : 0);
    if (!pond) {
      $('check').innerHTML = `<div class="status">${DOT_AMBER}<span>Could not find the pond: walking downhill from the spring reached the sea. Try sculpting a pond first.</span></div>`;
      return;
    }
    runCheck('Raise a mound in the pond', { kind: 'raise', radius: 2.5, strength: 1 }, pond[0], pond[1]);
  });

  /**
   * The pond is where the spring's water pools: walk downhill from the spring on 1 m steps
   * until no neighbor is lower. Returns null if the walk ends at or below the tide (the sea).
   * @param {number} x @param {number} z @param {number} tide
   * @returns {[number, number] | null}
   */
  function findPond(x, z, tide) {
    let h = terrain.sampleHeight(x, z);
    for (let i = 0; i < 80; i++) {
      let best = h, bx = x, bz = z;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const nx = x + Math.cos(a), nz = z + Math.sin(a);
        const nh = terrain.sampleHeight(nx, nz);
        if (nh < best) { best = nh; bx = nx; bz = nz; }
      }
      if (best >= h) break;
      x = bx; z = bz; h = best;
    }
    if (h <= tide + 0.05) return null;
    return [x, z];
  }

  /** @type {null | { name: string, start: number, end: number, vol0: number, vol1: number, maxSpeed: number, maxNan: number, x: number, z: number }} */
  let watch = null;

  /**
   * @param {string} name
   * @param {{ kind: 'raise'|'lower'|'flatten'|'smooth'|'paint', radius: number, strength: number }} brush
   * @param {number} x @param {number} z
   */
  function runCheck(name, brush, x, z) {
    if (terrain.isBusy() || watch) {
      $('check').innerHTML = `<div class="status">${DOT_WAIT}<span>The ground is still busy with the last stroke. Try again in a moment.</span></div>`;
      return;
    }
    const y = terrain.sampleHeight(x, z);
    if (!terrain.beginStroke(brush, [x, y, z])) return;
    bHollow.disabled = true;
    bMound.disabled = true;
    terrain.setRing({ x, z, radius: brush.radius, visible: true });
    const now = performance.now() / 1000;
    marks.push({ t: now });
    watch = {
      name, start: now, end: now + WATCH_S, vol0: last ? last.volumeM3 : NaN, vol1: NaN,
      maxSpeed: 0, maxNan: 0, x, z,
    };
    $('check').innerHTML = `<div class="status">${DOT_WAIT}<span>${name}: sculpting at x ${fmt(x, 1)}, z ${fmt(z, 1)} m, then watching the water for ${WATCH_S} seconds.</span></div>`;
    const t0 = performance.now();
    const step = () => {
      if (performance.now() - t0 < STROKE_S * 1000) {
        terrain.strokeTo([x, 0, z]);
        requestAnimationFrame(step);
      } else {
        terrain.setRing({ visible: false });
        terrain.endStroke();
      }
    };
    requestAnimationFrame(step);
  }

  /** @param {any} s */
  function watchTick(s) {
    if (!watch) return;
    watch.maxSpeed = Math.max(watch.maxSpeed, s.maxSpeed);
    watch.maxNan = Math.max(watch.maxNan, s.nan);
    watch.vol1 = s.volumeM3;
    if (performance.now() / 1000 < watch.end) return;
    const w = watch;
    watch = null;
    bHollow.disabled = false;
    bMound.disabled = false;
    const ok = w.maxNan === 0 && w.maxSpeed < SPEED_CAP;
    const dv = w.vol1 - w.vol0;
    $('check').innerHTML =
      `<div class="status">${ok ? DOT_OK : DOT_AMBER}<span>${w.name}: ${ok ? 'the water stayed calm.' : 'the water misbehaved.'}</span></div>` +
      `<p class="muted">Fastest flow during the check: ${fmt(w.maxSpeed)} m/s (cap ${SPEED_CAP}). ` +
      `Broken cells: ${w.maxNan}. Volume went from ${fmt(w.vol0, 1)} to ${fmt(w.vol1, 1)} m³ (${dv >= 0 ? '+' : ''}${fmt(dv, 1)}), ` +
      `which should be a small, smooth change as water fills or leaves the reshaped ground.</p>`;
  }
}

/** @param {number} simBudget */
function updateText(simBudget) {
  const s = last;
  const draw95 = pct(drawMs, 0.95);
  $('t-draw').textContent = fmt(draw95);
  if (!s) return;
  $('t-vol').textContent = fmt(s.volumeM3, 1);
  $('t-wet').textContent = fmt(s.wetCells * 0.25, 0);
  $('t-speed').textContent = fmt(s.maxSpeed);
  $('t-tide').textContent = `${s.tide >= 0 ? '+' : ''}${fmt(s.tide)}`;
  const sim95 = pct(simMs, 0.95);
  $('t-sim').textContent = simMs.length ? fmt(sim95) : timestamps ? 'under 0.1' : 'n/a';
  $('s-sim').textContent = `simulation GPU ms, p95 (${s.steps} step${s.steps === 1 ? '' : 's'} this frame)`;

  const nanBad = s.nan > 0;
  $('c-nan').classList.toggle('bad', nanBad);
  $('t-nan').innerHTML = nanBad ? `${ICON_WARN}<span style="font-size:26px;color:#B5654A">${s.nan}</span>` : '0';

  const speedOk = s.maxSpeed < SPEED_CAP;
  const simKnown = simMs.length > 0 || timestamps;
  const simOk = !simMs.length || sim95 < simBudget;
  const line = (/** @type {boolean} */ ok, /** @type {string} */ text, wait = false) =>
    `<div class="status">${wait ? DOT_WAIT : ok ? DOT_OK : DOT_AMBER}<span>${text}</span></div>`;
  $('summary').innerHTML =
    line(!nanBad, nanBad ? `${s.nan} broken cells right now. The guard should reset them; this is a bug to report.` : 'No broken cells.') +
    line(speedOk, speedOk ? `Fastest flow ${fmt(s.maxSpeed)} m/s, under the ${SPEED_CAP} m/s cap.` : `Some water is pinned at the ${SPEED_CAP} m/s cap, which means it is fighting the simulation.`) +
    line(simOk, !simKnown ? 'Simulation cost cannot be measured in this browser (no GPU timestamps).'
      : !simMs.length ? `Simulation cost is under 0.1 ms, well inside the ${simBudget} ms budget.`
      : simOk ? `Simulation costs ${fmt(sim95)} ms, inside the ${simBudget} ms budget.`
      : `Simulation costs ${fmt(sim95)} ms, over the ${simBudget} ms budget.`, !simKnown) +
    `<p class="muted" id="device">${$('device')?.textContent ?? ''}</p>`;
}

/** Summary class colors (sea, still, slow, running, damp; dry ground, dry tide band). */
const CLASS_RGB = /** @type {Record<number, number[]>} */ ({
  1: [47, 110, 134], 2: [59, 127, 168], 3: [127, 184, 214], 4: [232, 243, 248], 5: [140, 122, 91],
});
const DRY_RGB = [110, 145, 80];
const BAND_RGB = [159, 211, 224];

/**
 * Draw the water summary from above, one pixel per 0.5 m cell, north (-z) up.
 * @param {any} s  water.getSummary() @param {{ x: number, z: number }[]} springs
 */
function drawSummaryMap(s, springs) {
  const cv = /** @type {HTMLCanvasElement} */ ($('g-map'));
  if (!s) return;
  const { w, h } = s.rect;
  cv.width = w; cv.height = h;
  const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  const img = g.createImageData(w, h);
  let still = 0, running = 0, damp = 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const c = s.cls[k];
      const rgb = CLASS_RGB[c] ?? (s.band[k] ? BAND_RGB : DRY_RGB);
      if (c === 2) still++; else if (c === 3 || c === 4) running++; else if (c === 5) damp++;
      const o = k * 4;
      img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = '#185FA5';
  g.strokeStyle = '#FFFFFF';
  for (const sp of springs) {
    const x = (sp.x + 80) / 0.5 - s.rect.x;
    const y = (sp.z + 80) / 0.5 - s.rect.y;
    g.beginPath(); g.arc(x, y, 2.5, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  $('map-stats').textContent =
    `Pond ${fmt(still * 0.25, 0)} m², streams ${fmt(running * 0.25, 0)} m², damp hollows ${fmt(damp * 0.25, 0)} m². ` +
    `Springs: ${springs.length}. Summary hash ${(s.hash >>> 0).toString(16).toUpperCase().padStart(8, '0')}.`;
}

function drawCharts() {
  requestAnimationFrame(drawCharts);
  const now = performance.now() / 1000;
  drawChart(gVol, now, (s) => s.vol, '#5F8196', ' m³', (s) => s.tide, null);
  drawChart(gSpeed, now, (s) => s.speed, '#7C9D72', ' m/s', null, SPEED_CAP);
}

/**
 * @param {HTMLCanvasElement} cv @param {number} now
 * @param {(s: Sample) => number} get @param {string} color @param {string} unit
 * @param {((s: Sample) => number) | null} faint a second series drawn faintly on its own scale
 * @param {number | null} cap a dashed limit line that the scale always includes
 */
function drawChart(cv, now, get, color, unit, faint, cap) {
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
  const x = (/** @type {number} */ t) => ((t - (now - HISTORY_S)) / HISTORY_S) * w;
  const top = 20, bottom = h - 20;

  /** @param {number[]} vals @param {boolean} zero */
  const range = (vals, zero) => {
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (zero) lo = 0;
    if (hi - lo < 1e-6) { hi += 0.5; lo -= zero ? 0 : 0.5; }
    const pad = (hi - lo) * 0.08;
    return [zero ? lo : lo - pad, hi + pad];
  };
  /** @param {number} v @param {number[]} rg */
  const y = (v, rg) => bottom - ((v - rg[0]) / (rg[1] - rg[0])) * (bottom - top);

  for (const m of marks) {
    if (m.t < now - HISTORY_S) continue;
    g.strokeStyle = '#B8A9CC';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x(m.t), top);
    g.lineTo(x(m.t), bottom);
    g.stroke();
  }

  g.font = '600 15px Nunito, system-ui, sans-serif';
  g.fillStyle = '#4A5551';
  if (samples.length < 2) {
    g.fillText('Waiting for water readings', 4, h / 2);
    return;
  }

  /** @param {(s: Sample) => number} f @param {number[]} rg @param {string} c @param {number} lw */
  const line = (f, rg, c, lw) => {
    g.strokeStyle = c;
    g.lineWidth = lw;
    g.beginPath();
    samples.forEach((s, i) => {
      const v = f(s);
      if (i === 0) g.moveTo(x(s.t), y(v, rg));
      else g.lineTo(x(s.t), y(v, rg));
    });
    g.stroke();
  };

  if (faint) {
    const fr = range(samples.map(faint), false);
    line(faint, fr, '#C9BBA4', 3);
  }
  const vals = samples.map(get);
  if (cap != null) vals.push(cap);
  const rg = range(vals, cap != null);
  if (cap != null) {
    g.strokeStyle = '#B5654A';
    g.lineWidth = 2;
    g.setLineDash([6, 5]);
    g.beginPath();
    g.moveTo(0, y(cap, rg));
    g.lineTo(w, y(cap, rg));
    g.stroke();
    g.setLineDash([]);
  }
  line(get, rg, color, 2.5);
  g.fillStyle = '#4A5551';
  const dec = rg[1] - rg[0] < 10 ? 2 : 0;
  g.fillText(`${rg[1].toFixed(dec)}${unit}`, 4, 15);
  g.fillText(`${rg[0].toFixed(dec)}${unit}`, 4, h - 3);
  g.textAlign = 'right';
  g.fillText('now', w - 4, h - 3);
  g.textAlign = 'left';
}
