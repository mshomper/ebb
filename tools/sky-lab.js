// @ts-check
// Sky lab: the real island with an hour and season preview (docs/06 "Tuning knobs": a time
// scrubber previews any hour and season without changing the world clock).
// Preview goes through clock.setDisplayOverride; weather preview writes the store slice `preview`.

import * as clock from '../src/core/clock.js';
import { get, update, subscribe } from '../src/core/store.js';
import { loadRecipe } from '../src/core/recipes.js';

const ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="#5F7F5B" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-6.5"/></svg>';
const ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="#B5654A" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5v.2"/></svg>';
const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
const MOON_WORDS = ['new moon', 'waxing crescent', 'first quarter', 'waxing gibbous',
  'full moon', 'waning gibbous', 'last quarter', 'waning crescent'];
const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
const DEG = 180 / Math.PI;
const DAYS_PER_YEAR = clock.DAYS_PER_SEASON * clock.SEASONS_PER_YEAR;

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const canvas = /** @type {HTMLCanvasElement} */ ($('view'));
const pathCanvas = /** @type {HTMLCanvasElement} */ ($('path'));
const hourIn = /** @type {HTMLInputElement} */ ($('hour'));
const dayIn = /** @type {HTMLInputElement} */ ($('day'));
const flowSel = /** @type {HTMLSelectElement} */ ($('flow'));
const weatherSel = /** @type {HTMLSelectElement} */ ($('weather'));
const followBtn = /** @type {HTMLButtonElement} */ ($('follow'));

/** @typedef {{ sunAlt: number, sunAz: number, moonAlt: number, moonPhase: number, moonIllum: number, dayLengthH: number }} SunMoonLite */
/** @type {((t: number, o: {latitudeDeg: number, tiltDeg: number}) => SunMoonLite) | null} */
let sunMoon = null;
const orbit = { latitudeDeg: 40, tiltDeg: 18 };

/** Preview time in game seconds, or null while following the world clock. @type {number|null} */
let preview = null;

// ---------- time helpers ----------

/** @param {number} t game seconds @returns {{ day: number, hour: number }} day of the year 0..27, hour 0..24 */
function splitTime(t) {
  const yearT = t - Math.floor(t / clock.SECONDS_PER_YEAR) * clock.SECONDS_PER_YEAR;
  const day = Math.floor(yearT / clock.SECONDS_PER_DAY);
  const hour = (yearT - day * clock.SECONDS_PER_DAY) / clock.SECONDS_PER_HOUR;
  return { day, hour };
}

/** @param {number} hour */
function hhmm(hour) {
  const m = Math.round(hour * 60);
  const h = Math.floor(m / 60) % 25;
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** @param {number} day day of the year 0..27 */
function seasonDay(day) {
  return `${SEASONS[Math.floor(day / clock.DAYS_PER_SEASON) % 4]}, day ${(day % clock.DAYS_PER_SEASON) + 1}`;
}

/** @param {number} t */
function describe(t) {
  const { day, hour } = splitTime(t);
  return `${seasonDay(day)}, ${hhmm(hour)}`;
}

function shownTime() {
  return preview ?? clock.display();
}

// ---------- preview control ----------

function applyPreview() {
  const t = (Number(dayIn.value) * 24 + Number(hourIn.value)) * clock.SECONDS_PER_HOUR;
  preview = t;
  clock.setDisplayOverride(t);
  followBtn.setAttribute('aria-pressed', 'false');
  refresh();
}

function follow() {
  preview = null;
  clock.setDisplayOverride(null);
  followBtn.setAttribute('aria-pressed', 'true');
  refresh();
}

hourIn.addEventListener('input', applyPreview);
dayIn.addEventListener('input', applyPreview);
followBtn.addEventListener('click', follow);

flowSel.value = String(clock.flow());
flowSel.addEventListener('change', () => {
  const f = /** @type {0|1|2|4} */ (Number(flowSel.value));
  clock.setFlow(f);
  update('meta', (m) => { m.flow = f; });
});
subscribe('meta', (m) => { if (m && String(m.flow) !== flowSel.value) flowSel.value = String(m.flow); });

weatherSel.addEventListener('change', () => {
  const w = weatherSel.value || null;
  update('preview', () => ({ weather: w }));
});

// ---------- readouts ----------

function refresh() {
  const t = shownTime();
  const { day, hour } = splitTime(t);
  if (preview === null) {
    // Following: the sliders track the world clock.
    hourIn.value = String(Math.round(hour * 10) / 10);
    dayIn.value = String(day);
  }
  $('hour-out').textContent = hhmm(Number(hourIn.value));
  $('day-out').textContent = `${seasonDay(Number(dayIn.value))} (${Number(dayIn.value) + 1} of ${DAYS_PER_YEAR})`;
  $('world-time').textContent = `World clock: ${describe(clock.worldT())}`;
  $('mode').textContent = preview === null
    ? 'Showing the world clock.'
    : `Previewing ${describe(preview)}. The world clock stays where it is.`;

  const ev = get('render')?.ev100;
  $('t-ev').textContent = Number.isFinite(ev) ? Number(ev).toFixed(1) : '-';

  if (!sunMoon) return;
  const s = sunMoon(t, orbit);
  $('t-alt').textContent = `${(s.sunAlt * DEG).toFixed(1)}°`;
  // sun-moon.js measures azimuth from south, west positive; show it as a bearing from north.
  const bearing = (((s.sunAz * DEG + 180) % 360) + 360) % 360;
  $('t-az').textContent = `${bearing.toFixed(0)}° ${COMPASS[Math.round(bearing / 45) % 8]}`;
  $('t-moon').textContent = `${Math.round(s.moonIllum * 100)}% lit`;
  $('t-moon-word').textContent = `moon: ${MOON_WORDS[Math.round(s.moonPhase * 8) % 8]}`;
  $('t-daylen').textContent = s.dayLengthH.toFixed(1);
  drawPath(day, hour);
}

// ---------- sun and moon chart ----------

/** @type {{ day: number, w: number, h: number, sun: number[], moon: number[] } | null} */
let pathCache = null;

/** @param {number} day @param {number} hour */
function drawPath(day, hour) {
  if (!sunMoon) return;
  const dpr = window.devicePixelRatio || 1;
  const w = pathCanvas.clientWidth;
  const h = pathCanvas.clientHeight;
  if (!w || !h) return;
  if (pathCanvas.width !== Math.round(w * dpr) || pathCanvas.height !== Math.round(h * dpr)) {
    pathCanvas.width = Math.round(w * dpr);
    pathCanvas.height = Math.round(h * dpr);
  }
  if (!pathCache || pathCache.day !== day) {
    const sun = [];
    const moon = [];
    for (let i = 0; i <= 96; i++) {
      const s = sunMoon((day * 24 + i / 4) * clock.SECONDS_PER_HOUR, orbit);
      sun.push(s.sunAlt * DEG);
      moon.push(s.moonAlt * DEG);
    }
    pathCache = { day, w, h, sun, moon };
  }
  const g = /** @type {CanvasRenderingContext2D} */ (pathCanvas.getContext('2d'));
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const top = 8;
  const bottom = h - 24;
  const x = (/** @type {number} */ hr) => (hr / 24) * w;
  const y = (/** @type {number} */ deg) => top + ((90 - deg) / 180) * (bottom - top);

  g.font = '600 15px Nunito, system-ui, sans-serif';
  g.fillStyle = '#4A5551';
  g.strokeStyle = '#E3D9C9';
  g.lineWidth = 1;
  for (const hr of [0, 6, 12, 18, 24]) {
    g.beginPath();
    g.moveTo(x(hr), top);
    g.lineTo(x(hr), bottom);
    g.stroke();
    const label = `${String(hr).padStart(2, '0')}:00`;
    const tw = g.measureText(label).width;
    g.fillText(label, Math.min(w - tw, Math.max(0, x(hr) - tw / 2)), h - 4);
  }
  g.strokeStyle = '#7B8B84';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, y(0));
  g.lineTo(w, y(0));
  g.stroke();

  /** @param {number[]} arr @param {string} color */
  const line = (arr, color) => {
    g.strokeStyle = color;
    g.lineWidth = 2.5;
    g.beginPath();
    arr.forEach((v, i) => (i ? g.lineTo(x(i / 4), y(v)) : g.moveTo(x(0), y(v))));
    g.stroke();
  };
  line(pathCache.moon, '#8F80B0');
  line(pathCache.sun, '#D99A4E');

  g.strokeStyle = '#1E2624';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x(hour), top);
  g.lineTo(x(hour), bottom);
  g.stroke();
}

/** @param {PointerEvent} e */
function pickHour(e) {
  const r = pathCanvas.getBoundingClientRect();
  const hr = Math.min(24, Math.max(0, ((e.clientX - r.left) / r.width) * 24));
  hourIn.value = String(Math.round(hr * 10) / 10);
  applyPreview();
}
pathCanvas.addEventListener('pointerdown', (e) => {
  pathCanvas.setPointerCapture(e.pointerId);
  pickHour(e);
});
pathCanvas.addEventListener('pointermove', (e) => { if (e.buttons) pickHour(e); });
window.addEventListener('resize', () => { pathCache = null; refresh(); });

// ---------- boot ----------

const status = $('status');
/** @param {string} icon @param {string} text */
const setStatus = (icon, text) => { status.innerHTML = `${icon}<span>${text}</span>`; };

refresh();
setInterval(refresh, 250);

try {
  const sky = await loadRecipe('world/sky');
  orbit.latitudeDeg = sky?.orbit?.latitudeDeg ?? 40;
  orbit.tiltDeg = sky?.orbit?.tiltDeg ?? 18;
} catch (err) {
  console.warn('[sky-lab] sky recipe not loaded, using latitude 40 and tilt 18', err);
}
try {
  sunMoon = /** @type {any} */ (await import('../src/world/sky/sun-moon.js')).sunMoon;
} catch (err) {
  console.warn('[sky-lab] sun-moon.js not available yet', err);
  $('t-moon-word').textContent = 'moon (sun and moon module not loaded)';
}
refresh();

// The island is loaded last and on its own, so a missing or broken module there leaves the
// controls and readouts working.
try {
  const { startApp } = await import('../src/app.js');
  const result = await startApp(canvas);
  if (!result.ok) {
    setStatus(ICON_WARN, `WebGPU is not available here (${result.reason}), so the island cannot be drawn. The controls and numbers below still work. Open this page in current Chrome or Edge to see the sky.`);
  } else {
    setStatus(ICON_OK, `The island is running (tier ${result.tier}). Orbit and zoom it while you move the sliders.`);
  }
} catch (err) {
  console.error(err);
  setStatus(ICON_WARN, `The island could not start here (${err instanceof Error ? err.message : String(err)}). The controls and numbers below still work.`);
}
