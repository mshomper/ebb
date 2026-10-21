// @ts-check
// The Water tool's Net card (docs/future/12, K6): what to do, how the net stands (in, fishing and
// for how long, or full), Bring it in while it is out, and a calm line after a tap that cast it or
// could not (wrong water, too high, too deep). Reads the store slice `netsUi` (src/world/nets);
// src/ui/tools.js shows the card in the Net mode. Kept out of tools.js, which is long enough.

import { get, subscribe } from '../core/store.js';
import { dispatch } from '../input/actions.js';
import { iconSvg } from './icons/icons.js';

/** How long a tap's line stays before it fades, ms. */
const MESSAGE_MS = 3200;

/**
 * Mount the Net card inside the tool card, before its sliders. Its words come with the slice
 * (recipes/world/nets.json words). @param {HTMLElement} card the tool card
 * @returns {{ el: HTMLElement, dispose: () => void }}
 */
export function mountNetPanel(card) {
  const el = document.createElement('div');
  el.className = 'ebb-tools__plant ebb-tools__net';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Net');
  el.hidden = true;
  el.innerHTML = `
    <p class="ebb-tools__hint" data-out="net-hint"></p>
    <p class="ebb-tools__status" data-out="net-status" aria-live="polite"></p>
    <div class="ebb-tools__spring-row" data-out="net-row">
      <button type="button" class="ebb-tools__chip" data-net-lift="true">${iconSvg('net')}<span data-out="net-lift"></span></button>
      <button type="button" class="ebb-tools__chip ebb-tools__remove" data-net-in="true">${iconSvg('close')}<span data-out="net-in"></span></button>
    </div>
    <p class="ebb-tools__message" data-out="net-message" role="status" aria-live="polite"></p>`;
  card.insertBefore(el, card.querySelector('[data-slider]'));
  const hintEl = /** @type {HTMLElement} */ (el.querySelector('[data-out="net-hint"]'));
  const status = /** @type {HTMLElement} */ (el.querySelector('[data-out="net-status"]'));
  const row = /** @type {HTMLElement} */ (el.querySelector('[data-out="net-row"]'));
  const message = /** @type {HTMLElement} */ (el.querySelector('[data-out="net-message"]'));
  const liftBtn = /** @type {HTMLButtonElement} */ (el.querySelector('[data-net-lift]'));
  const liftText = /** @type {HTMLElement} */ (el.querySelector('[data-out="net-lift"]'));
  const inText = /** @type {HTMLElement} */ (el.querySelector('[data-out="net-in"]'));
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let timer;
  let shownAt = 0;

  function render() {
    const u = get('netsUi') ?? {};
    if (hintEl.textContent !== (u.hint ?? '')) hintEl.textContent = u.hint ?? '';
    if (status.textContent !== (u.status ?? '')) status.textContent = u.status ?? '';
    row.hidden = !u.out;
    liftBtn.hidden = !u.ready;
    liftText.textContent = u.liftLabel ?? '';
    inText.textContent = u.inLabel ?? '';
    if (u.message && u.at && u.at !== shownAt) {
      shownAt = u.at;
      clearTimeout(timer);
      message.textContent = u.message;
      message.classList.toggle('is-refused', !!u.refused);
      message.classList.remove('is-shown');
      void message.offsetWidth;
      message.classList.add('is-shown');
      timer = setTimeout(() => message.classList.remove('is-shown'), MESSAGE_MS);
    }
  }
  el.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button'));
    if (b?.dataset.netIn) dispatch(/** @type {any} */ ({ type: 'nets.bringIn' }));
    else if (b?.dataset.netLift) { const id = get('netsUi')?.id; if (id !== null && id !== undefined) dispatch(/** @type {any} */ ({ type: 'nets.lift', id })); }
  });
  render();
  const off = subscribe('netsUi', render);
  return { el, dispose: () => { off(); clearTimeout(timer); el.remove(); } };
}
