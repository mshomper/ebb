// @ts-check
// The station workspace (docs/future/13 section 3.12, the one combining pattern; S1): a click on a
// station (the workbench, the fire) opens this wider card instead of the small one. On top, the
// station's surface with its part spots: what is laid, drawn as its item glyph, and the missing
// parts of the make it points to as pencil outlines with no names; beside them, the station's one
// action, lit only when the parts are complete. Below (beside, from 1100 px wide), the pouches you
// carry and what the camp's piles hold. Click a pouch or a pile to lay a handful; click a laid part
// to take it back. Reads the store slices `stationView` (src/world/camp/stations.js) and `identify`
// (for the card's own actions: Light, Feed, the camp page); every press goes out as an action.
// Styles: station.css. Numbers: recipes/world/camp.json stations.ui.

import { get, subscribe } from '../core/store.js';
import { dispatch } from '../input/actions.js';
import { ensureIconSprite, iconSvg } from './icons/icons.js';
import { itemIconSvg, itemPouchSvg } from './icons/items.js';
import { itemIconFor, driedIconFor } from './icons/item-registry.js';
import { actionsFor, cardAction } from './card-actions.js';

/** @param {string} s */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** A kind's glyph, or the pencil's blank spot when it has none. @param {string} kind @param {string} [cls] */
function glyph(kind, cls = '') {
  const icon = itemIconFor(kind);
  return icon ? itemIconSvg(icon, cls) : '';
}

/**
 * @param {HTMLElement} parent
 * @param {any} words recipes/world/journal.json (the card actions' words)
 * @param {{ sideBySidePx?: number, targetPx?: number, maxWidthPx?: number }} [ui] camp.json stations.ui
 * @returns {() => void} dispose
 */
export function mountStation(parent, words, ui = {}) {
  ensureIconSprite();
  const root = document.createElement('div');
  root.className = 'ebb-station';
  root.setAttribute('role', 'dialog');
  root.inert = true;
  root.style.setProperty('--st-target', `${Math.max(48, ui.targetPx ?? 56)}px`);
  root.style.setProperty('--st-max', `${ui.maxWidthPx ?? 980}px`);
  const wide = window.matchMedia(`(min-width: ${ui.sideBySidePx ?? 1100}px)`);

  function render() {
    const v = get('stationView'), card = get('identify');
    root.classList.toggle('is-open', !!v);
    root.inert = !v;
    root.classList.toggle('is-wide', wide.matches);
    // Closing: it fades as it was, and is filled afresh when a station opens again.
    if (!v) return;
    root.setAttribute('aria-label', v.name);
    // The card's own actions (src/ui/card-actions.js): the fire's Light and Feed, the camp page.
    const acts = card?.station ? actionsFor(card, words) : [];
    const actRow = acts.map(({ a, label, main }) =>
      `<button type="button" class="ebb-idcard__act${main ? ' is-main' : ''}" data-cact="${esc(a.id)}" aria-label="${esc(label)}" data-label="${esc(label)}">${iconSvg(a.icon)}</button>`).join('');
    if (v.mode === 'store') { renderKeep(v, card, actRow); return; }
    // The surface: laid parts, then the pencil outlines, then empty spots.
    const spots = [];
    v.laid.forEach((/** @type {any} */ p, /** @type {number} */ i) => spots.push(
      `<button type="button" class="ebb-station__spot is-laid${p.used ? '' : ' is-extra'}" data-unlay="${i}" aria-label="${esc(p.name)}" data-label="${esc(p.name)}">${glyph(p.kind)}</button>`));
    for (const kinds of v.outlines) spots.push(`<span class="ebb-station__spot is-outline" aria-hidden="true">${glyph(kinds[0], 'is-pencil')}</span>`);
    while (spots.length < v.spots) spots.push('<span class="ebb-station__spot" aria-hidden="true"></span>');
    const A = v.action;
    const action = `<button type="button" class="ebb-idcard__act ebb-station__go${A.ready ? ' is-main' : ''}" data-go="1" ${A.ready ? '' : 'disabled'} aria-label="${esc(A.label)}" data-label="${esc(A.label)}">${iconSvg(A.icon)}</button>`;
    // The pouches as the bar draws them, less what is laid; a pouch with nothing left is dimmed.
    const leftOf = /** @type {Record<string, number>} */ ({});
    for (const p of v.pack) leftOf[p.kind] = p.left;
    const pouches = v.pack.map((/** @type {any} */ p) => {
      const show = Math.max(0, Math.min(p.handfuls, leftOf[p.kind]));
      leftOf[p.kind] -= show;
      const icon = itemIconFor(p.kind);
      return `<button type="button" class="ebb-station__pouch" data-lay="${esc(p.kind)}" ${show > 0 ? '' : 'disabled'} aria-label="${esc(p.name)}" data-label="${esc(p.name)}">${itemPouchSvg(icon, show)}</button>`;
    }).join('');
    const piles = v.piles.map((/** @type {any} */ p) =>
      `<button type="button" class="ebb-station__pile" data-lay="${esc(p.kind)}" ${p.left > 0 ? '' : 'disabled'} aria-label="${esc(p.name)}" data-label="${esc(p.name)}">${glyph(p.kind)}<span>${esc(p.word)}</span></button>`).join('');
    // What the hamper holds (P2j): laid from as the piles are, after them.
    const store = (v.store ?? []).map((/** @type {any} */ p) =>
      `<button type="button" class="ebb-station__pile" data-lay="${esc(p.kind)}" ${p.left > 0 ? '' : 'disabled'} aria-label="${esc(p.name)}" data-label="${esc(p.name)}">${glyph(p.kind)}<span>${esc(p.word)}</span></button>`).join('');
    root.innerHTML = `
      <div class="ebb-station__head"><span class="ebb-idcard__icon">${iconSvg(A.icon)}</span><b>${esc(v.name)}</b>
        <span class="ebb-station__acts">${actRow}</span>
        <button type="button" class="ebb-idcard__close" data-close="1" aria-label="Close" title="Close">${iconSvg('close')}</button></div>
      ${card?.text ? `<p class="ebb-station__text">${esc(card.text)}</p>` : ''}
      <div class="ebb-station__body">
        <section class="ebb-station__surface${v.working ? ' is-working' : ''}">
          <div class="ebb-station__spots">${spots.join('')}</div>
          ${action}
          ${v.line ? `<p class="ebb-station__line">${esc(v.line)}</p>` : ''}
        </section>
        <section class="ebb-station__stores">
          <h4>${esc(v.packName)}</h4>
          <div class="ebb-station__row">${pouches || '<span class="ebb-station__none"></span>'}</div>
          ${piles ? `<h4>${esc(v.pilesName)}</h4><div class="ebb-station__row">${piles}</div>` : ''}
          ${store ? `<h4>${esc(v.storeName)}</h4><div class="ebb-station__row">${store}</div>` : ''}
        </section>
      </div>`;
  }

  /**
   * The hamper's or the drying rack's card (P2j, S2): its slots (or bunches) as drawn icons with the
   * pile words, each a Take up; empty slots drawn plain; the pouches below to set down.
   * @param {any} v @param {any} card @param {string} actRow
   */
  function renderKeep(v, card, actRow) {
    const slots = v.slots.map((/** @type {any} */ s) => {
      const icon = v.id === 'rack' && s.dried ? driedIconFor(s.kind) : itemIconFor(s.kind);
      const label = `${v.takeLabel}: ${s.name}`;
      return `<button type="button" class="ebb-station__slot" data-take="${s.i}" aria-label="${esc(label)}" data-label="${esc(label)}">${icon ? itemIconSvg(icon) : ''}<span>${esc(s.word)}</span></button>`;
    });
    for (let i = v.slots.length; i < v.size; i++) slots.push(`<span class="ebb-station__slot is-empty" role="img" aria-label="${esc(v.emptyName)}"></span>`);
    const pouches = v.pack.map((/** @type {any} */ p) => {
      const icon = itemIconFor(p.kind);
      return `<button type="button" class="ebb-station__pouch" data-down="${esc(p.kind)}" aria-label="${esc(p.name)}" data-label="${esc(p.name)}">${itemPouchSvg(icon, p.handfuls)}</button>`;
    }).join('');
    root.innerHTML = `
      <div class="ebb-station__head"><span class="ebb-idcard__icon">${iconSvg(v.id === 'rack' ? 'dry' : 'takeup')}</span><b>${esc(v.name)}</b>
        <span class="ebb-station__acts">${actRow}</span>
        <button type="button" class="ebb-idcard__close" data-close="1" aria-label="Close" title="Close">${iconSvg('close')}</button></div>
      ${card?.text ? `<p class="ebb-station__text">${esc(card.text)}</p>` : ''}
      <div class="ebb-station__body">
        <section class="ebb-station__surface ebb-station__keep">
          <div class="ebb-station__slots">${slots.join('')}</div>
          ${v.line ? `<p class="ebb-station__line">${esc(v.line)}</p>` : ''}
        </section>
        <section class="ebb-station__stores">
          <h4>${esc(v.packName)}</h4>
          <div class="ebb-station__row">${pouches || '<span class="ebb-station__none"></span>'}</div>
        </section>
      </div>`;
  }

  root.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button'));
    if (!b || /** @type {HTMLButtonElement} */ (b).disabled) return;
    if (b.dataset.close) dispatch({ type: 'ui.identify' });
    else if (b.dataset.lay) dispatch({ type: 'station.lay', kind: b.dataset.lay });
    else if (b.dataset.unlay !== undefined) dispatch({ type: 'station.unlay', i: Number(b.dataset.unlay) });
    else if (b.dataset.go) dispatch({ type: 'station.act' });
    else if (b.dataset.take !== undefined) dispatch({ type: 'keep.takeUp', i: Number(b.dataset.take) });
    else if (b.dataset.down) dispatch({ type: 'pack.setDownKind', kind: b.dataset.down });
    else if (b.dataset.cact) {
      const ca = cardAction(b.dataset.cact), card = get('identify');
      const act = ca?.action && card ? ca.action(card) : null;
      if (act) dispatch(act);
    }
  });
  /** @param {Event} e */
  const stop = (e) => e.stopPropagation();
  root.addEventListener('pointerdown', stop);
  root.addEventListener('pointermove', stop);
  root.addEventListener('wheel', stop, { passive: true });
  wide.addEventListener('change', render);

  const unsubs = [subscribe('stationView', render), subscribe('identify', render)];
  render();
  parent.appendChild(root);
  return () => { for (const u of unsubs) u(); wide.removeEventListener('change', render); root.remove(); };
}
