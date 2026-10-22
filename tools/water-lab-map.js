// @ts-check
// ebb water lab: the water summary map (docs/07, docs/14 overlays). Two views of the same summary,
// flow classes or water table height, with optional basin labels (each basin's source and how far
// it stands below its lip), and a day-of-year slider that rebuilds the summary on this page for
// any day so the late-summer drawdown can be seen without waiting for the calendar.

import { on } from '../src/core/events.js';
import { get as getStore } from '../src/core/store.js';
import { loadRecipe } from '../src/core/recipes.js';
import { buildSummary, BASIN_SOURCE } from '../src/world/water/summary.js';
import { waterCellOf } from '../src/world/water/grid.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** Summary class colors (sea, still, slow, running, damp; dry ground, dry tide band). */
const CLASS_RGB = /** @type {Record<number, number[]>} */ ({
  1: [47, 110, 134], 2: [59, 127, 168], 3: [127, 184, 214], 4: [232, 243, 248], 5: [140, 122, 91],
});
const DRY_RGB = [110, 145, 80];
const BAND_RGB = [159, 211, 224];
/** Water table ramp, low to high: pale sand, sage, deep teal. The sea stays a flat neutral. */
const TABLE_STOPS = [[241, 236, 214], [143, 191, 168], [47, 95, 107]];
const SEA_NEUTRAL = [207, 203, 194];
/** Basins smaller than this get no label (m²); a 0.5 m cell is 0.25 m². */
const LABEL_MIN_M2 = 3;
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const SOURCE_NAME = { [BASIN_SOURCE.none]: 'damp', [BASIN_SOURCE.spring]: 'spring', [BASIN_SOURCE.rain]: 'rain', [BASIN_SOURCE.table]: 'table' };
/** Label order when space runs out: water-holding basins first, damp hollows last. */
const SOURCE_RANK = { [BASIN_SOURCE.spring]: 0, [BASIN_SOURCE.rain]: 1, [BASIN_SOURCE.table]: 2, [BASIN_SOURCE.none]: 3 };

/** @param {number} v @param {number} [d] */
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '-');

/**
 * Wire up the map card. Call once the app has started.
 * @param {any} water the app's water (getSummary, springs)
 */
export function setupSummaryMap(water) {
  const cv = /** @type {HTMLCanvasElement} */ ($('g-map'));
  const wrap = $('map-wrap');
  const labelsEl = $('map-labels');
  const bFlow = /** @type {HTMLButtonElement} */ ($('mv-flow'));
  const bTable = /** @type {HTMLButtonElement} */ ($('mv-table'));
  const bLabels = /** @type {HTMLButtonElement} */ ($('mv-labels'));
  const bLive = /** @type {HTMLButtonElement} */ ($('map-live'));
  const day = /** @type {HTMLInputElement} */ ($('map-day'));

  const state = { view: 'flow', labels: false, day: -1 };
  /** @type {any} */ let recipe = null;
  /** @type {any} */ let preview = null;
  let rebuildTimer = 0;
  loadRecipe('world/water').then((r) => { recipe = r; redraw(); }).catch(() => {});

  const setPressed = () => {
    bFlow.setAttribute('aria-pressed', String(state.view === 'flow'));
    bTable.setAttribute('aria-pressed', String(state.view === 'table'));
    bLabels.setAttribute('aria-pressed', String(state.labels));
    bLabels.textContent = state.labels ? 'Basin labels: on' : 'Basin labels: off';
    bLive.disabled = state.day < 0;
    $('lg-flow').hidden = state.view !== 'flow';
    $('lg-table').hidden = state.view !== 'table';
  };
  bFlow.addEventListener('click', () => { state.view = 'flow'; redraw(); });
  bTable.addEventListener('click', () => { state.view = 'table'; redraw(); });
  bLabels.addEventListener('click', () => { state.labels = !state.labels; redraw(); });
  bLive.addEventListener('click', () => { state.day = -1; preview = null; redraw(); });
  day.addEventListener('input', () => {
    state.day = Number(day.value);
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuildPreview, 120);
    setDayText();
  });

  /** Build the summary for the slider's day here, from the same inputs the game uses. */
  function rebuildPreview() {
    const live = water.getSummary();
    const heightQ = getStore('terrainLive')?.mirror?.heightQ;
    if (state.day < 0 || !live || !heightQ || !recipe) { preview = null; redraw(); return; }
    const springs = water.springs().map((/** @type {any} */ s) => ({ cellX: waterCellOf(s.x), cellY: waterCellOf(s.z), rateLps: s.rateLps }));
    preview = buildSummary({
      heightQ, rect: live.rect, springs, params: { ...recipe.summary, manningN: recipe.sim.manningN },
      tide: recipe.tide, yearDay: state.day,
    });
    redraw();
  }

  function setDayText() {
    const s = state.day < 0 ? water.getSummary() : preview;
    const share = s ? ` Drawdown ${fmt(s.drawdown / 10, 0)}% of the late-summer low.` : '';
    $('map-day-text').textContent = state.day < 0
      ? `Showing the game's own summary, today.${share}`
      : `Showing day ${state.day + 1} of 56: ${SEASONS[Math.floor(state.day / 14)]}, day ${(state.day % 14) + 1}. A preview built on this page; the game is not changed.${share}`;
  }

  function redraw() {
    setPressed();
    setDayText();
    const s = state.day >= 0 && preview ? preview : water.getSummary();
    if (!s) return;
    drawPixels(s);
    placeLabels(s);
  }

  /** @param {any} s */
  function drawPixels(s) {
    const { w, h } = s.rect;
    cv.width = w; cv.height = h;
    const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
    const img = g.createImageData(w, h);
    let still = 0, running = 0, damp = 0, tMax = 0, tSum = 0, land = 0;
    for (let k = 0; k < w * h; k++) {
      const c = s.cls[k];
      if (c === 2) still++; else if (c === 3 || c === 4) running++; else if (c === 5) damp++;
      if (c !== 1) { land++; tSum += s.tableMm[k]; if (s.tableMm[k] > tMax) tMax = s.tableMm[k]; }
    }
    const scaleMm = tableScaleMm(tMax);
    for (let k = 0; k < w * h; k++) {
      const c = s.cls[k];
      const rgb = state.view === 'table'
        ? (c === 1 ? SEA_NEUTRAL : ramp(s.tableMm[k] / scaleMm))
        : CLASS_RGB[c] ?? (s.band[k] ? BAND_RGB : DRY_RGB);
      const o = k * 4;
      img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    g.fillStyle = '#185FA5';
    g.strokeStyle = '#FFFFFF';
    for (const sp of water.springs()) {
      const x = (sp.x + 80) / 0.5 - s.rect.x;
      const y = (sp.z + 80) / 0.5 - s.rect.y;
      g.beginPath(); g.arc(x, y, 2.5, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    $('lg-t0').textContent = '0 mm';
    $('lg-t1').textContent = `${Math.round(scaleMm / 2)} mm`;
    $('lg-t2').textContent = `${Math.round(scaleMm)} mm`;
    const hash = (s.hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
    $('map-stats').textContent = state.view === 'table'
      ? `Water table over the land: highest ${tMax} mm, mean ${land ? Math.round(tSum / land) : 0} mm above mean sea level. Summary hash ${hash}.`
      : `Pond ${fmt(still * 0.25, 0)} m², streams ${fmt(running * 0.25, 0)} m², damp hollows ${fmt(damp * 0.25, 0)} m². ` +
        `Springs: ${water.springs().length}. Summary hash ${hash}.`;
  }

  /** The ramp's top: the recipe's highest table, so lower days read as paler. @param {number} tMax */
  function tableScaleMm(tMax) {
    const r = recipe?.summary?.tableMaxM;
    return Math.max(1, r > 0 ? r * 1000 : tMax);
  }

  /** Basin labels at centroids, larger and wetter basins first, skipping any that would collide. @param {any} s */
  function placeLabels(s) {
    labelsEl.replaceChildren();
    $('map-label-note').textContent = '';
    if (!state.labels) return;
    const { w, h } = s.rect;
    /** @type {Map<number, { n: number, si: number, sj: number }>} */ const acc = new Map();
    for (let k = 0; k < w * h; k++) {
      const id = s.basin[k];
      if (!id) continue;
      const i = k % w, j = (k - i) / w;
      const a = acc.get(id);
      if (a) { a.n++; a.si += i; a.sj += j; } else acc.set(id, { n: 1, si: i, sj: j });
    }
    const minCells = LABEL_MIN_M2 / 0.25;
    const list = [...acc].filter(([, a]) => a.n >= minCells).map(([id, a]) => {
      const src = s.basinSource[id] ?? 0;
      const drawMm = s.basinDrawMm[id] ?? 0;
      let text = SOURCE_NAME[src] ?? 'damp';
      if (src && drawMm > 0) text += drawMm >= 10 ? `, ${Math.round(drawMm / 10)} cm low` : `, ${drawMm} mm low`;
      return { text, src, n: a.n, u: (a.si / a.n + 0.5) / w, v: (a.sj / a.n + 0.5) / h };
    });
    list.sort((p, q) => (SOURCE_RANK[p.src] - SOURCE_RANK[q.src]) || (q.n - p.n));
    const W = wrap.clientWidth, H = cv.clientHeight;
    /** @type {{ x: number, y: number, w: number, h: number }[]} */ const taken = [];
    let skipped = 0;
    for (const b of list) {
      const el = document.createElement('span');
      el.className = `blabel src-${SOURCE_NAME[b.src] ?? 'damp'}`;
      el.textContent = b.text;
      labelsEl.append(el);
      const lw = el.offsetWidth, lh = el.offsetHeight;
      const cx = b.u * W, cy = b.v * H;
      let placed = null;
      for (const dy of [0, -(lh + 2), lh + 2]) {
        const x = Math.min(Math.max(0, cx - lw / 2), Math.max(0, W - lw));
        const y = Math.min(Math.max(0, cy - lh / 2 + dy), Math.max(0, H - lh));
        const box = { x, y, w: lw, h: lh };
        if (!taken.some((t) => box.x < t.x + t.w + 2 && t.x < box.x + box.w + 2 && box.y < t.y + t.h + 2 && t.y < box.y + box.h + 2)) { placed = box; break; }
      }
      if (!placed) { el.remove(); skipped++; continue; }
      taken.push(placed);
      el.style.left = `${placed.x}px`;
      el.style.top = `${placed.y}px`;
    }
    $('map-label-note').textContent = list.length
      ? `${taken.length} basin${taken.length === 1 ? '' : 's'} labelled${skipped ? `, ${skipped} smaller one${skipped === 1 ? '' : 's'} left out where labels would overlap` : ''}. Basins under ${LABEL_MIN_M2} m² have no label.`
      : `No basins of ${LABEL_MIN_M2} m² or more.`;
  }

  on('water:summary-updated', () => { if (state.day >= 0) rebuildPreview(); else redraw(); });
  new ResizeObserver(() => { const s = state.day >= 0 && preview ? preview : water.getSummary(); if (s) placeLabels(s); }).observe(wrap);
  redraw();
}

/** Three-stop sequential ramp, t clamped to 0..1. @param {number} t */
function ramp(t) {
  const x = Math.min(1, Math.max(0, t)) * (TABLE_STOPS.length - 1);
  const i = Math.min(TABLE_STOPS.length - 2, Math.floor(x)), f = x - i;
  const a = TABLE_STOPS[i], b = TABLE_STOPS[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
