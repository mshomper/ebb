// @ts-check
// The haul tray (docs/future/12, K6): what a lifted net brought up, laid out one to a row on a
// card over the island. Kelp and wrack are drawn along its top.
// Each living catch moves for a moment (src/ui/catch-motion.js) and has Let it go: it slips off
// the tray and back to the sea. A keepsake turns slowly on its rarity's paper with Keep it on the
// shelf and Back to the sea. Closing lets everything left go back. Reads the store slice `haul`
// (src/world/nets/index.js); dispatches the nets.* actions.
// The fishing line's catch uses the same tray (docs/future/17): mounted again on the store slice
// `catch` with act 'fishing' (src/world/fishing), its fish says its rarity, Sketched into your
// journal for a first of its species, and Redraw the page when it is finer than the one sketched.
// A net fish is a glimpse (F17): it swims a moment with its line and slips away by itself.

import { get, subscribe } from '../core/store.js';
import { dispatch } from '../input/actions.js';
import { seasonOf } from '../core/clock.js';
import { iconSvg } from './icons/icons.js';
import { drawMesh, groundCss } from './keepsake-view.js';
import { bendCatch, fitOf } from './catch-motion.js';
import { catchMesh, catchName, catchWords, catchLook, catchAlpha } from '../world/nets/living/index.js';
import { keepsakeMesh, keepsakeWords, keepsakeView } from '../world/keepsakes/families/index.js';

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
/** How long a catch takes to slip off the tray, ms. */
const GO_MS = 700;
/** How long a glimpse stays before it slips away by itself, ms. */
const GLIMPSE_MS = 2800;

/** @param {string} s */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/**
 * Kelp and wrack along the tray's top edge, drawn from the haul's weed seed.
 * @param {number} seed @returns {string}
 */
function weedSvg(seed) {
  let h = seed >>> 0;
  const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; h ^= h >>> 13; return (h >>> 8) / 16777216; };
  let paths = '';
  for (let k = 0; k < 3; k++) {
    let d = `M0 ${10 + rnd() * 14}`;
    for (let x = 60; x <= 600; x += 60) d += ` S${x - 30} ${4 + rnd() * 24}, ${x} ${8 + rnd() * 18}`;
    paths += `<path d="${d}" stroke="${k === 1 ? 'var(--haul-wrack)' : 'var(--haul-kelp)'}" stroke-width="${6 - k * 1.5}" fill="none" stroke-linecap="round"/>`;
  }
  return `<svg class="ebb-haul__weed" viewBox="0 0 600 36" preserveAspectRatio="none" aria-hidden="true" focusable="false">${paths}</svg>`;
}

/**
 * Mount the tray. @param {HTMLElement} parent
 * @param {{ NR: any, K: any, words: any, FR?: any, slice?: string, act?: string }} o NR: nets.json; K: keepsakes.json; words:
 *   journal.json (keepsake words); FR: fishing.json (gen 2 fish, the line's words); slice: the store slice it shows
 *   ('haul', or 'catch' for the line); act: the actions it sends ('nets' or 'fishing')
 */
export function mountHaulTray(parent, o) {
  const { NR, K } = o, FR = o.FR ?? null, KW = o.words.keepsakes;
  const slice = o.slice ?? 'haul', act = o.act ?? 'nets', line = slice === 'catch';
  const W = line && FR ? { ...NR.words, title: FR.words.tray, letGo: FR.words.letGo, close: FR.words.close } : NR.words;
  /** @type {Set<string>} */ const glimpsing = new Set();
  const root = document.createElement('div');
  root.className = 'ebb-haul';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', W.title);
  root.hidden = true;
  parent.appendChild(root);
  /** @type {{ cv: HTMLCanvasElement, mesh: any, n: any, look: any, fit: any, out: Float32Array, spin: boolean }[]} */
  let pics = [];
  /** @type {any} */ let shown = null;
  let raf = 0;

  /** One caught again: "The same sand eel you let go on spring day 4." @param {any} c a living catch with `again` */
  function againLine(c) {
    const s = seasonOf(c.again.hour * 3600), name = catchName(c.n, NR);
    return W.again.replace('{name}', name.charAt(0).toLowerCase() + name.slice(1)).replace('{season}', SEASONS[s.index]).replace('{day}', String(s.day + 1));
  }

  /** The line a fish on the line says about its sketch: a first, finer, or redrawn. @param {any} c */
  function sketchHtml(c) {
    if (!line || !FR) return '';
    const w = c.first ? FR.words.first : c.redrawn ? FR.words.redrawn : c.finer ? FR.words.finer : '';
    return w ? `<p class="ebb-haul__again">${esc(w)}</p>` : '';
  }

  /** A fish's buttons: none for a glimpse; Redraw the page when finer; Let it go. @param {any} c */
  function buttonsHtml(c) {
    if (c.glimpse) return '';
    const redraw = line && FR && c.finer && !c.redrawn
      ? `<button type="button" class="ebb-haul__btn is-main" data-redraw="${esc(c.id)}">${iconSvg('sketchbook')}<span>${esc(FR.words.redraw)}</span></button>` : '';
    return `${redraw}<button type="button" class="ebb-haul__btn" data-go="${esc(c.id)}">${iconSvg('release')}<span>${esc(W.letGo)}</span></button>`;
  }

  /** Build the tray for a new haul. @param {any} h the store slice `haul` (or `catch`) */
  function build(h) {
    shown = h.haul;
    const s = seasonOf(h.hour * 3600);
    const after = line && FR
      ? FR.words.trayAfter.replace('{water}', (FR.words.waters[h.water] ?? '').toLowerCase()).replace('{season}', SEASONS[s.index]).replace('{day}', String(s.day + 1))
      : W.after.replace('{tide}', h.springTide ? W.springTide : W.highTide).replace('{season}', SEASONS[s.index]).replace('{day}', String(s.day + 1));
    const rows = h.haul.living.map((/** @type {any} */ c) => `
      <div class="ebb-haul__row" data-row="${esc(c.id)}">
        <div class="ebb-haul__pic"><canvas data-pic="${esc(c.id)}"></canvas></div>
        <div class="ebb-haul__txt">
          ${c.n.gen === 2 && FR ? `<span class="ebb-haul__rarity">${esc(FR.words.rarity[c.n.rarity] ?? '')}</span>` : ''}
          <b class="ebb-haul__name">${esc(catchName(c.n, NR, FR))}</b>
          ${c.again ? `<p class="ebb-haul__again">${esc(againLine(c))}</p>` : ''}
          ${sketchHtml(c)}
          <p class="ebb-haul__note">${esc(c.glimpse && FR ? FR.words.glimpse : catchWords(c.n, NR, FR))}</p>
        </div>
        <div class="ebb-haul__btns">${buttonsHtml(c)}</div>
      </div>`).join('');
    const ks = h.haul.keepsake;
    const ksRow = ks ? `
      <div class="ebb-haul__row" data-row="keepsake">
        <div class="ebb-haul__pic" style="${groundCss(K, ks.n.rarity)}"><canvas data-pic="keepsake"></canvas></div>
        <div class="ebb-haul__txt">
          <span class="ebb-haul__rarity">${esc(KW?.rarity?.[ks.n.rarity] ?? ks.n.rarity)}</span>
          <b class="ebb-haul__name">${esc(W.keepsake)}</b>
          <p class="ebb-haul__note">${esc(keepsakeWords(ks.n, K))}</p>
        </div>
        <div class="ebb-haul__btns" data-out="ks-btns">
          <button type="button" class="ebb-haul__btn is-main" data-act="keep">${iconSvg('shelf')}<span>${esc(KW?.keep ?? 'Keep it on the shelf')}</span></button>
          <button type="button" class="ebb-haul__btn" data-act="leave">${iconSvg('close')}<span>${esc(KW?.leave ?? 'Leave it to the sea')}</span></button>
        </div>
      </div>` : '';
    root.innerHTML = `
      <div class="ebb-haul__card">
        <div class="ebb-haul__head"><h2>${esc(W.title)}</h2><p>${esc(after)}</p></div>
        ${weedSvg(h.haul.weed)}
        <div class="ebb-haul__rows">${rows}${ksRow}${!rows && !ksRow ? `<p class="ebb-haul__empty">${esc(W.empty)}</p>` : ''}</div>
        <div class="ebb-haul__foot"><button type="button" class="ebb-haul__btn" data-act="close">${esc(W.close)}</button></div>
      </div>`;
    pics = [];
    for (const c of h.haul.living) {
      const mesh = catchMesh(c.n, NR, FR);
      pics.push({ cv: /** @type {HTMLCanvasElement} */ (root.querySelector(`[data-pic="${CSS.escape(c.id)}"]`)), mesh, n: c.n, look: catchLook(c.n),
        fit: { ...fitOf(mesh), alpha: catchAlpha(c.n, FR) }, out: new Float32Array(mesh.vertices.length), spin: false });
      // A glimpse swims a moment, then slips away by itself.
      if (c.glimpse && !glimpsing.has(c.id)) {
        glimpsing.add(c.id);
        setTimeout(() => dispatch(/** @type {any} */ ({ type: `${act}.release`, id: c.id })), GLIMPSE_MS);
      }
    }
    if (ks) {
      const mesh = keepsakeMesh(ks.n, K);
      const v = keepsakeView(ks.n);
      pics.push({ cv: /** @type {HTMLCanvasElement} */ (root.querySelector('[data-pic="keepsake"]')), mesh, n: ks.n, look: { view: v }, fit: fitOf(mesh), out: mesh.vertices, spin: true });
    }
    root.hidden = false;
    requestAnimationFrame(() => root.classList.add('is-open'));
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }

  function frame(/** @type {number} */ ms) {
    const t = ms / 1000;
    pics.forEach((p, i) => {
      if (!p.cv.isConnected || !p.cv.clientWidth) return;
      const yaw = (p.look.view[0] * Math.PI) / 180 + (p.spin ? t * 0.5 : 0), pitch = Math.min(1.35, (p.look.view[1] * Math.PI) / 180);
      const m = p.spin ? p.mesh : bendCatch(p.mesh, p.n, p.look.motion, t + i * 0.37, p.out);
      drawMesh(p.cv, m, yaw, pitch, 1.2, p.fit);
    });
    if (!root.hidden) raf = requestAnimationFrame(frame);
  }

  /** Follow the slice: a new haul builds the tray; released catches slip off; an answered keepsake settles; none closes it. */
  function render() {
    const h = get(slice);
    if (!h) {
      if (!root.hidden) { root.classList.remove('is-open'); setTimeout(() => { if (!get(slice)) { root.hidden = true; root.innerHTML = ''; pics = []; } }, 220); }
      shown = null;
      return;
    }
    if (h.haul !== shown) build(h);
    for (const id of h.ksGone ? [...h.released, 'keepsake'] : h.released) {
      const row = /** @type {HTMLElement | null} */ (root.querySelector(`[data-row="${CSS.escape(id)}"]`));
      if (row && !row.classList.contains('is-going')) {
        row.classList.add('is-going');
        setTimeout(() => { row.remove(); pics = pics.filter((p) => p.cv.isConnected); }, GO_MS);
      }
    }
    if (h.kept) {
      const btns = root.querySelector('[data-out="ks-btns"]');
      if (btns) btns.outerHTML = h.ksGone ? '' : `<p class="ebb-haul__done">${esc(W.kept)}</p>`;
    }
    // A redrawn page: the Redraw button goes, and the line says so.
    for (const c of h.haul.living) {
      const b = c.redrawn ? root.querySelector(`[data-redraw="${CSS.escape(c.id)}"]`) : null;
      if (!b) continue;
      b.remove();
      const said = root.querySelector(`[data-row="${CSS.escape(c.id)}"] .ebb-haul__again`);
      if (said && FR) said.textContent = FR.words.redrawn;
    }
  }

  root.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button'));
    if (!b) return;
    if (b.dataset.go) dispatch(/** @type {any} */ ({ type: `${act}.release`, id: b.dataset.go }));
    else if (b.dataset.redraw) dispatch(/** @type {any} */ ({ type: `${act}.redraw`, id: b.dataset.redraw }));
    else if (b.dataset.act === 'keep') dispatch(/** @type {any} */ ({ type: 'nets.keep' }));
    else if (b.dataset.act === 'leave') dispatch(/** @type {any} */ ({ type: 'nets.leave' }));
    else if (b.dataset.act === 'close') dispatch(/** @type {any} */ ({ type: `${act}.close` }));
  });
  // Pointer and wheel input on the tray never reach the island below.
  for (const ev of ['pointerdown', 'pointermove', 'wheel']) root.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });

  render();
  const off = subscribe(slice, render);
  return () => { off(); cancelAnimationFrame(raf); root.remove(); };
}
