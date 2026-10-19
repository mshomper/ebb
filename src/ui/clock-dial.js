// @ts-check
// The clock dial (docs/15 "The HUD", S8): top left. A drawn sun or moon travels an arc over the
// horizon (the sun from sunrise to sunset, the moon through the night), a four-part ring shows the
// season with a dot for how far through it is, and a small wave under the horizon sits high or low
// with the tide and a chevron for rising or falling. Hover, focus or tap shows one line:
// "Spring, day 3, early evening. Tide coming in."
//
// Reads display time from the app clock and the pure sun and tide math (the same functions the sky
// and the water draw from), a few times a second (recipes/world/hud.json dial.hz), never every
// frame, and rewrites the drawing only when something visible changed. Styles: hud.css.

import { display, seasonOf, dayFractionOf } from '../core/clock.js';
import { sunMoon } from '../world/sky/sun-moon.js';
import { state as tideState, tideParams } from '../world/tide.js';
import { loadRecipe } from '../core/recipes.js';

const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
const ACCENT = 'fill="currentColor" fill-opacity="0.2"';
/** The dial is drawn on a 48 unit grid: ring round the middle, horizon a little below it. */
const C = 24, RING = 21, ARC = 10, HORIZON = 27;

/**
 * Mount the clock dial.
 * @param {HTMLElement} [parent]
 * @returns {Promise<() => void>} dispose
 */
export async function mountClockDial(parent = document.body) {
  const [hud, sky, water] = await Promise.all([loadRecipe('world/hud'), loadRecipe('world/sky'), loadRecipe('world/water')]);
  const D = hud.dial;
  const sunOpts = { latitudeDeg: sky.orbit?.latitudeDeg, tiltDeg: sky.orbit?.tiltDeg };
  const tideP = tideParams(water.tide);

  const root = document.createElement('div');
  root.className = 'ebb-dial';
  root.innerHTML =
    `<button type="button" class="ebb-dial__btn"><svg class="ebb-dial__svg" viewBox="0 0 48 48" aria-hidden="true" focusable="false"></svg></button>` +
    `<p class="ebb-dial__card" role="status"></p>`;
  const btn = /** @type {HTMLButtonElement} */ (root.querySelector('button'));
  const svg = /** @type {SVGSVGElement} */ (root.querySelector('svg'));
  const card = /** @type {HTMLElement} */ (root.querySelector('.ebb-dial__card'));

  let drawn = '';
  let said = '';
  function tick() {
    const now = read(display(), sunOpts, tideP, D);
    if (now.key !== drawn) { drawn = now.key; svg.innerHTML = now.svg; }
    if (now.line !== said) {
      said = now.line;
      card.textContent = said;
      btn.setAttribute('aria-label', said);
    }
  }

  // A tap (or click) keeps the line open for a few seconds; hover and focus show it too (hud.css).
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let cardTimer;
  btn.addEventListener('click', () => {
    clearTimeout(cardTimer);
    const open = !root.classList.contains('is-open');
    root.classList.toggle('is-open', open);
    if (open) cardTimer = setTimeout(() => root.classList.remove('is-open'), D.cardS * 1000);
  });
  /** Keep pointer and wheel input on the dial from reaching the island. @param {Event} e */
  const stop = (e) => e.stopPropagation();
  root.addEventListener('pointerdown', stop);
  root.addEventListener('pointermove', stop);
  root.addEventListener('wheel', stop, { passive: true });
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  tick();
  const timer = setInterval(tick, 1000 / D.hz);
  parent.appendChild(root);
  return () => {
    clearInterval(timer);
    clearTimeout(cardTimer);
    root.remove();
  };
}

/**
 * Everything the dial shows at a game time: the drawing, a key that changes only when the drawing
 * would, and the spoken line.
 * @param {number} t game seconds (display time)
 * @param {{latitudeDeg?: number, tiltDeg?: number}} sunOpts
 * @param {import('../world/tide.js').TideParams} tideP
 * @param {any} D recipes/world/hud.json dial
 */
export function read(t, sunOpts, tideP, D) {
  const season = seasonOf(t);
  const hours = dayFractionOf(t) * 24;
  const sm = sunMoon(t, sunOpts);
  const sunrise = 12 - sm.dayLengthH / 2;
  const sunset = 12 + sm.dayLengthH / 2;
  const up = hours >= sunrise && hours < sunset;
  const f = up
    ? (hours - sunrise) / Math.max(sm.dayLengthH, 1e-6)
    : (((hours - sunset) % 24) + 24) % 24 / Math.max(24 - sm.dayLengthH, 1e-6);
  const tide = tideState(t / 3600, tideP);

  const line = `${D.seasons[season.index]}, day ${season.day + 1}, ${dayWord(hours, sunrise, sunset, D)}. ${tideWords(tide, tideP, D)}.`;

  // Drawn values, rounded so the picture only changes when the eye would see it.
  const a = Math.round(Math.min(1, Math.max(0, f)) * 60) / 60;
  const ring = Math.round((season.index + season.phase) * 48) / 48;
  const lift = Math.round((tide.amp > 0 ? tide.level / tide.amp : 0) * 4) / 4;
  const key = `${up ? 's' : 'm'}${a}|${ring}|${lift}|${tide.rising ? 1 : 0}`;
  return { key, line, svg: drawDial(up, a, season.index, ring, lift, tide.rising) };
}

/**
 * The time of day in words, from the sun: the last band (in time order) that has started.
 * @param {number} h hours since midnight @param {number} sunrise @param {number} sunset @param {any} D
 */
function dayWord(h, sunrise, sunset, D) {
  /** @type {Record<string, number>} */
  const at = { sunrise, noon: 12, sunset };
  const bands = D.dayWords.map((/** @type {any} */ b) => ({ start: at[b.from] + b.h, word: b.word }))
    .sort((/** @type {any} */ x, /** @type {any} */ y) => x.start - y.start);
  let word = D.nightWord;
  for (const b of bands) if (h >= b.start) word = b.word;
  return word;
}

/**
 * The tide in words: high or low near a turn, else coming in or going out.
 * @param {import('../world/tide.js').TideNow} tide @param {import('../world/tide.js').TideParams} p @param {any} D
 */
function tideWords(tide, p, D) {
  const W = D.tide;
  const sinceTurnH = (tide.rising ? tide.phase01 - 0.5 : tide.phase01) * p.periodH;
  if (tide.nextTurnH < W.turnH) return tide.rising ? W.high : W.low;
  if (sinceTurnH < W.turnH) return tide.rising ? W.low : W.high;
  return tide.rising ? W.rising : W.falling;
}

/**
 * The dial drawing (48 unit grid, stroke in the icon style).
 * @param {boolean} sunUp @param {number} f 0..1 along the arc @param {number} seasonIndex
 * @param {number} ring season position 0..4 @param {number} lift tide level, -1 low .. 1 high
 * @param {boolean} rising
 */
function drawDial(sunUp, f, seasonIndex, ring, lift, rising) {
  const parts = [];
  // Season ring: four quarters from the top, clockwise, spring first; this season's is drawn strong.
  for (let i = 0; i < 4; i++) {
    const a0 = -90 + i * 90 + 5, a1 = -90 + (i + 1) * 90 - 5;
    const on = i === seasonIndex;
    parts.push(`<path d="${arcPath(C, C, RING, a0, a1)}" stroke-width="${on ? 2.4 : 1.6}" opacity="${on ? 1 : 0.35}"/>`);
  }
  const ra = ((-90 + ring * 90) * Math.PI) / 180;
  parts.push(`<circle cx="${n(C + RING * Math.cos(ra))}" cy="${n(C + RING * Math.sin(ra))}" r="2.2" fill="currentColor" stroke="none"/>`);

  // The sky's arc over the horizon, faint and dotted, with a gap where the sun or moon sits, and
  // the horizon line. Along the arc, 0 is the left end (rise) and 1 the right end (set).
  const at = (/** @type {number} */ g) => `${n(C - ARC * Math.cos(Math.PI * g))} ${n(HORIZON - ARC * Math.sin(Math.PI * g))}`;
  const GAP = 0.15;
  for (const [g0, g1] of [[0, f - GAP], [f + GAP, 1]]) {
    if (g1 - g0 > 0.02) parts.push(`<path d="M${at(g0)}A${ARC} ${ARC} 0 0 1 ${at(g1)}" stroke-dasharray="0.01 3" opacity="0.6"/>`);
  }
  parts.push(`<path d="M${C - 13} ${HORIZON}H${C + 13}"/>`);

  // Sun or moon on the arc.
  const x = C - ARC * Math.cos(Math.PI * f);
  const y = HORIZON - ARC * Math.sin(Math.PI * f);
  if (sunUp) {
    parts.push(`<circle cx="${n(x)}" cy="${n(y)}" r="3.4" ${ACCENT}/><circle cx="${n(x)}" cy="${n(y)}" r="3.4"/>`);
  } else {
    const r = 3.4;
    const moon = `M${n(x)} ${n(y - r)}A${r} ${r} 0 1 0 ${n(x)} ${n(y + r)}A${n(r * 0.62)} ${r} 0 1 1 ${n(x)} ${n(y - r)}Z`;
    parts.push(`<path d="${moon}" ${ACCENT}/><path d="${moon}"/>`);
  }

  // The tide: a short wave that sits higher at high water, with a chevron for which way it goes.
  const wy = 35 - lift * 1.6;
  parts.push(`<path d="M15 ${n(wy)}c1.5-1.4 3-1.4 4.5 0s3 1.4 4.5 0 3-1.4 4.5 0"/>`);
  parts.push(rising
    ? `<path d="M30.5 37L33 34.5L35.5 37"/>`
    : `<path d="M30.5 34L33 36.5L35.5 34"/>`);
  return `<g ${STROKE}>${parts.join('')}</g>`;
}

/** An SVG arc path on a circle, angles in degrees clockwise from +x. @param {number} cx @param {number} cy @param {number} r @param {number} a0 @param {number} a1 */
function arcPath(cx, cy, r, a0, a1) {
  const p = (/** @type {number} */ a) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M${n(x0)} ${n(y0)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${n(x1)} ${n(y1)}`;
}

/** @param {number} v */
function n(v) {
  return Math.round(v * 100) / 100;
}
