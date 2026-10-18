// @ts-check
// Notes on the island (docs/15 HUD): the journal's new notes appear at the bottom left in Fraunces
// italic, at most two at once, and fade after a few seconds; a click opens the journal at that
// species. The same file shows the card a tap opens on a living thing: its name, what it is doing
// and a way into its journal page.
//
// Listens for `note:posted`; reads the store slices `identify` and `tools`; every choice goes out
// as a `ui.journal` or `ui.identify` action. Timings come from recipes/world/journal.json.
// Styles: journal.css.

import { on } from '../core/events.js';
import { get, subscribe } from '../core/store.js';
import { dispatch } from '../input/actions.js';
import { ensureIconSprite, iconSvg } from './icons/icons.js';

/** Notes on screen at once. */
const AT_ONCE = 2;

/**
 * @param {HTMLElement} parent
 * @param {any} words recipes/world/journal.json
 * @returns {() => void} dispose
 */
export function mountIslandNotes(parent, words) {
  ensureIconSprite();
  const N = words.islandNote;

  const root = document.createElement('div');
  root.className = 'ebb-notes';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  const card = document.createElement('div');
  card.className = 'ebb-idcard';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'What grows here');

  /** @type {import('../world/journal/observe.js').Note[]} */ let waiting = [];
  let lastShown = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let pumpTimer;

  function pump() {
    clearTimeout(pumpTimer);
    if (!waiting.length) return;
    const now = performance.now();
    const showing = root.querySelectorAll('.ebb-notes__note:not(.is-leaving)').length;
    const wait = Math.max(0, lastShown + N.gapS * 1000 - now);
    if (showing >= AT_ONCE || wait > 0) { pumpTimer = setTimeout(pump, showing >= AT_ONCE ? 400 : wait); return; }
    const n = /** @type {import('../world/journal/observe.js').Note} */ (waiting.shift());
    lastShown = now;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ebb-notes__note';
    b.textContent = n.text;
    b.title = 'Open the journal';
    b.addEventListener('click', () => dispatch(n.sp && words.species[n.sp] ? { type: 'ui.journal', open: true, page: n.sp } : { type: 'ui.journal', open: true, view: 'notes' }));
    root.appendChild(b);
    requestAnimationFrame(() => b.classList.add('is-shown'));
    setTimeout(() => {
      b.classList.add('is-leaving');
      b.classList.remove('is-shown');
      setTimeout(() => b.remove(), 700);
      pump();
    }, N.showS * 1000);
    if (waiting.length) pumpTimer = setTimeout(pump, N.gapS * 1000);
  }

  const offNote = on('note:posted', (/** @type {import('../world/journal/observe.js').Note} */ n) => {
    waiting.push(n);
    if (waiting.length > N.queue) waiting = waiting.slice(waiting.length - N.queue);
    pump();
  });

  // --- the tap card ---
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let cardTimer;
  function renderCard() {
    const id = get('identify');
    clearTimeout(cardTimer);
    if (!id) { card.classList.remove('is-open'); card.inert = true; return; }
    card.innerHTML = `
      <div class="ebb-idcard__head"><span class="ebb-idcard__icon">${iconSvg(id.icon)}</span><b>${esc(id.name)}</b>
        <button type="button" class="ebb-idcard__close" data-act="close" aria-label="Close" title="Close">${iconSvg('close')}</button></div>
      <p class="ebb-idcard__text">${esc(id.text)}</p>
      <button type="button" class="ebb-idcard__open" data-act="open">${iconSvg('journal')}<span>Open its page</span></button>`;
    card.inert = false;
    card.classList.add('is-open');
    // Beside the tap, kept on screen.
    const w = card.offsetWidth, h = card.offsetHeight;
    const x = Math.min(window.innerWidth - w - 12, Math.max(12, id.x + 16));
    const y = Math.min(window.innerHeight - h - 12, Math.max(12, id.y - h - 16));
    card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    cardTimer = setTimeout(() => dispatch({ type: 'ui.identify' }), words.identify.showS * 1000);
  }
  card.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button'));
    if (!b) return;
    const id = get('identify');
    if (b.dataset.act === 'open' && id) dispatch({ type: 'ui.journal', open: true, page: id.sp });
    else if (b.dataset.act === 'close') dispatch({ type: 'ui.identify' });
  });
  /** @param {Event} e */
  const stop = (e) => e.stopPropagation();
  for (const r of [root, card]) {
    r.addEventListener('pointerdown', stop);
    r.addEventListener('pointermove', stop);
    r.addEventListener('wheel', stop, { passive: true });
  }

  /** Notes step aside while a tool's card is open on narrower screens (journal.css). */
  function renderTool() { root.classList.toggle('has-tool', !!get('tools')?.tool); }

  renderCard();
  renderTool();
  const unsubs = [subscribe('identify', renderCard), subscribe('tools', renderTool)];
  parent.appendChild(root);
  parent.appendChild(card);

  return function dispose() {
    offNote();
    for (const u of unsubs) u();
    clearTimeout(pumpTimer);
    clearTimeout(cardTimer);
    root.remove();
    card.remove();
  };
}

/** @param {string} s */
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}
