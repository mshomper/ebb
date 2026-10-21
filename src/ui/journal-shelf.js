// @ts-check
// The journal's Shelf section (docs/future/12, piece K3): the keepsakes you kept, sixteen spaces,
// each an ink sketch traced from the keepsake's own shape on the paper ground of its rarity. Tap
// one to turn it in the hand and read where it was found; let it go back to the sea if you want.
// When the shelf is full and you keep something new, it shows the new one and asks which to let
// go. No counts: the empty spaces say how much room there is. A picture of the shelf can be saved.
// The meshes are rebuilt from the saved numbers and dropped once traced.

import { get } from '../core/store.js';
import { dispatch } from '../input/actions.js';
import { iconSvg } from './icons/icons.js';
import { keepsakeSvg, traceKeepsake } from './sketches/keepsake.js';
import { drawMesh, groundCss } from './keepsake-view.js';
import { keepsakeMesh, keepsakeView, keepsakeWords } from '../world/keepsakes/families/index.js';
import { bottleMessage } from '../world/keepsakes/families/bottle.js';
import { cleanShelf, SHELF_CAP } from '../world/keepsakes/shelf.js';
import { seasonOf } from '../core/clock.js';

const SEASON_NAMES = ['spring', 'summer', 'autumn', 'winter'];

/** @param {string} s */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/**
 * @param {{ K: any, messages: any, words: any }} o K: recipes/world/keepsakes.json; messages:
 *   recipes/world/bottle-messages.json; words: recipes/world/journal.json
 */
export function createShelfView(o) {
  const { K, messages } = o;
  const W = o.words.keepsakes;
  const T = W.shelf;
  /** Sketches by a key of the numbers, traced once. @type {Map<string, string>} */ const sketches = new Map();
  /** The slot open in the hand, and whether letting it go is being asked. */
  let open = /** @type {number | null} */ (null), asking = false;
  let yaw = 0.6, pitch = 0.45;

  /** The sketch of one keepsake. @param {any} n */
  function sketchOf(n) {
    const key = JSON.stringify(n);
    let svg = sketches.get(key);
    if (!svg) {
      svg = keepsakeSvg(traceKeepsake(keepsakeMesh(n, K), n, keepsakeView(n)), keepsakeWords(n, K));
      sketches.set(key, svg);
      if (sketches.size > 64) sketches.delete(/** @type {string} */ (sketches.keys().next().value));
    }
    return svg;
  }

  /** Where and when, in words. @param {{ hour: number, spring: boolean }} e */
  function where(e) {
    const s = seasonOf(e.hour * 3600);
    return T.where.replace('{tide}', e.spring ? T.springTide : T.tide).replace('{season}', SEASON_NAMES[s.index])
      .replace('{day}', String(s.day + 1)).replace('{year}', String(s.year + 1));
  }

  /** One slot: a sketch on its ground, or an empty space. @param {any} e @param {string} attrs */
  function slot(e, attrs) {
    if (!e) return `<div class="ebb-shelf__slot is-empty" aria-hidden="true"></div>`;
    return `<button type="button" class="ebb-shelf__slot" style="${groundCss(K, e.n.rarity)}" ${attrs}
      aria-label="${esc(keepsakeWords(e.n, K))}">${sketchOf(e.n)}</button>`;
  }

  function html() {
    const s = cleanShelf(get('keepsakes'));
    const pending = get('shelfPending');
    if (pending) {
      return `<section class="ebb-shelf">
        <h3 class="ebb-shelf__title">${esc(T.title)}</h3>
        <p class="ebb-shelf__text">${esc(T.full)}</p>
        <div class="ebb-shelf__new"><div class="ebb-shelf__slot" style="${groundCss(K, pending.n.rarity)}">${sketchOf(pending.n)}</div>
          <p><b>${esc(T.newOne)}</b><br>${esc(keepsakeWords(pending.n, K))}<br><span class="ebb-shelf__rarity">${esc(W.rarity[pending.n.rarity] ?? '')}</span></p></div>
        <div class="ebb-shelf__grid">${s.shelf.map((e) => `<div class="ebb-shelf__cell">${slot(e, `data-shelf-swap="${e.id}"`)}
          <button type="button" class="ebb-shelf__btn" data-shelf-swap="${e.id}">${esc(T.swap)}</button></div>`).join('')}</div>
        <button type="button" class="ebb-shelf__btn is-wide" data-shelf-cancel>${esc(T.cancel)}</button>
      </section>`;
    }
    const e = open !== null ? s.shelf.find((x) => x.id === open) : null;
    if (e) {
      const msg = e.n.family === 'bottle' ? bottleMessage(e.n, messages) : null;
      return `<section class="ebb-shelf">
        <button type="button" class="ebb-shelf__btn" data-shelf-back>${iconSvg('back')}<span>${esc(T.back)}</span></button>
        <div class="ebb-shelf__hand" style="${groundCss(K, e.n.rarity)}"><canvas class="ebb-shelf__turn" data-shelf-turn aria-label="${esc(T.turn)}"></canvas></div>
        <p class="ebb-shelf__name">${esc(keepsakeWords(e.n, K))}</p>
        <p class="ebb-shelf__rarity">${esc(W.rarity[e.n.rarity] ?? '')}</p>
        <p class="ebb-shelf__text">${esc(where(e))}</p>
        ${msg ? `<p class="ebb-shelf__text">${esc(T.message)}</p><p class="ebb-shelf__message">${esc(msg)}</p>` : ''}
        ${asking
          ? `<p class="ebb-shelf__text">${esc(T.letGoSure)}</p><div class="ebb-shelf__row">
              <button type="button" class="ebb-shelf__btn" data-shelf-letgo-yes>${esc(T.yes)}</button>
              <button type="button" class="ebb-shelf__btn" data-shelf-letgo-no>${esc(T.no)}</button></div>`
          : `<button type="button" class="ebb-shelf__btn" data-shelf-letgo>${esc(T.letGo)}</button>`}
      </section>`;
    }
    open = null;
    const cells = Array.from({ length: SHELF_CAP }, (_, i) => s.shelf[i]);
    return `<section class="ebb-shelf">
      <h3 class="ebb-shelf__title">${esc(T.title)}</h3>
      ${s.shelf.length ? '' : `<p class="ebb-shelf__text">${esc(T.empty)}</p>`}
      <div class="ebb-shelf__grid">${cells.map((e) => slot(e, e ? `data-shelf-open="${e.id}"` : '')).join('')}</div>
      ${s.shelf.length ? `<button type="button" class="ebb-shelf__btn is-wide" data-shelf-photo>${iconSvg('picture')}<span>${esc(T.photo)}</span></button>` : ''}
    </section>`;
  }

  /** Draw what the html cannot: the keepsake turning in the hand. @param {HTMLElement} body */
  function after(body) {
    const cv = /** @type {HTMLCanvasElement | null} */ (body.querySelector('[data-shelf-turn]'));
    if (!cv || open === null) return;
    const e = cleanShelf(get('keepsakes')).shelf.find((x) => x.id === open);
    if (!e) return;
    const mesh = keepsakeMesh(e.n, K);
    const draw = () => drawMesh(cv, mesh, yaw, pitch);
    draw();
    let drag = /** @type {number[] | null} */ (null);
    cv.addEventListener('pointerdown', (ev) => { drag = [ev.clientX, ev.clientY]; cv.setPointerCapture(ev.pointerId); });
    cv.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      yaw += (ev.clientX - drag[0]) * 0.01;
      pitch = Math.max(-1.4, Math.min(1.4, pitch + (ev.clientY - drag[1]) * 0.01));
      drag = [ev.clientX, ev.clientY];
      draw();
    });
    cv.addEventListener('pointerup', () => { drag = null; });
  }

  /**
   * A click in the journal body: handled here if it is the shelf's. @param {HTMLElement} t
   * @param {() => void} rerender @returns {boolean}
   */
  function click(t, rerender) {
    const b = /** @type {HTMLElement | null} */ (t.closest('[data-shelf-open],[data-shelf-back],[data-shelf-letgo],[data-shelf-letgo-yes],[data-shelf-letgo-no],[data-shelf-swap],[data-shelf-cancel],[data-shelf-photo]'));
    if (!b) return false;
    const d = b.dataset;
    if (d.shelfOpen) { open = Number(d.shelfOpen); asking = false; yaw = 0.6; pitch = 0.45; }
    else if (d.shelfBack !== undefined) { open = null; asking = false; }
    else if (d.shelfLetgo !== undefined) asking = true;
    else if (d.shelfLetgoNo !== undefined) asking = false;
    else if (d.shelfLetgoYes !== undefined && open !== null) { dispatch({ type: 'keepsakes.letGo', id: open }); open = null; asking = false; }
    else if (d.shelfSwap) dispatch({ type: 'keepsakes.swap', out: Number(d.shelfSwap) });
    else if (d.shelfCancel !== undefined) dispatch({ type: 'keepsakes.cancelKeep' });
    else if (d.shelfPhoto !== undefined) savePicture();
    rerender();
    return true;
  }

  /** Save the shelf as a picture: the sixteen spaces on their grounds, sketches and all. */
  function savePicture() {
    const s = cleanShelf(get('keepsakes'));
    const cell = 220, gap = 18, pad = 36, n = 4;
    const size = pad * 2 + n * cell + (n - 1) * gap;
    let inner = `<rect width="${size}" height="${size}" fill="#E9DFCE"/>`;
    for (let i = 0; i < SHELF_CAP; i++) {
      const e = s.shelf[i];
      const x = pad + (i % n) * (cell + gap), y = pad + Math.floor(i / n) * (cell + gap);
      const G = K.shelf.grounds[e?.n.rarity ?? 'common'];
      inner += `<defs><linearGradient id="g${i}" x1="0" y1="0" x2="0.2" y2="1"><stop offset="0" stop-color="${G.top}"/><stop offset="1" stop-color="${G.bottom}"/></linearGradient></defs>`;
      inner += e
        ? `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="14" fill="url(#g${i})" stroke="${G.border}" stroke-width="${G.borderPx * 2}"/>`
          + (G.gilt ? `<rect x="${x + 5}" y="${y + 5}" width="${cell - 10}" height="${cell - 10}" rx="10" fill="none" stroke="${G.gilt}" stroke-width="3"/>` : '')
          + `<svg x="${x}" y="${y}" width="${cell}" height="${cell}" viewBox="0 0 200 200">${sketchOf(e.n).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</svg>`
        : `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="14" fill="none" stroke="#C9BDA6" stroke-width="2" stroke-dasharray="8 8"/>`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${inner}</svg>`;
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = size * 2; cv.height = size * 2;
      const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
      g.scale(2, 2);
      g.drawImage(img, 0, 0);
      cv.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'ebb-shelf.png';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }, 'image/png');
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  return { html, after, click };
}
