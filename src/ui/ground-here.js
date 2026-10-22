// @ts-check
// The "here" bar (Matt, October 22, 2026): a small cream bar just right of the ground bar, below
// only, holding what you can do right where you stand: Light at the laid ring, Rest at the tent flap
// after dark, later Dig or Rake. At most two at once, in order. It sits beside the ground bar, so the
// bar's own buttons never move. Any module offers or withdraws a button:
//
//   offerHere({ id: 'light', icon: 'fire', label: 'Light', order: 10, action: { type: 'camp.light' } });
//   withdrawHere('light');
//
// Offers live in the store slice `here` (id -> offer). Going up hides the bar; offers stay until
// withdrawn. A press dispatches the offer's action through src/input/actions.js. Styles: walk.css.

import { get, subscribe, update } from '../core/store.js';
import { dispatch } from '../input/actions.js';
import { ensureIconSprite, iconSvg } from './icons/icons.js';

/** @typedef {{ id: string, icon: string, label: string, order: number, action: any }} HereOffer */

/** The most the bar shows at once. */
export const MAX_HERE = 2;

/** Offer a button on the "here" bar (or change one already offered). @param {HereOffer} o */
export function offerHere(o) {
  const cur = get('here')?.[o.id];
  if (cur && cur.icon === o.icon && cur.label === o.label && cur.order === o.order && JSON.stringify(cur.action) === JSON.stringify(o.action)) return;
  update('here', (h) => ({ ...(h ?? {}), [o.id]: { ...o } }));
}

/** Take a button off the "here" bar. @param {string} id */
export function withdrawHere(id) {
  if (!get('here')?.[id]) return;
  update('here', (h) => { const n = { ...(h ?? {}) }; delete n[id]; return n; });
}

/** The offers shown now, in order, at most MAX_HERE. @param {Record<string, HereOffer> | undefined} here */
export function shownHere(here) {
  return Object.values(here ?? {}).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1)).slice(0, MAX_HERE);
}

/**
 * Mount the bar beside the ground bar.
 * @param {HTMLElement} parent the HUD layer @param {HTMLElement} ground the ground bar it sits beside
 * @returns {() => void} dispose
 */
export function mountGroundHere(parent, ground) {
  ensureIconSprite();
  const bar = document.createElement('div');
  bar.className = 'ebb-here';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Here');
  bar.hidden = true;

  let shown = '';
  function render() {
    const offers = get('walk')?.below ? shownHere(get('here')) : [];
    const key = offers.map((o) => `${o.id}|${o.icon}|${o.label}`).join(';');
    if (key !== shown) {
      shown = key;
      bar.innerHTML = offers.map((o) => `<button type="button" class="ebb-walk__btn ebb-here__btn" data-here="${o.id}" aria-label="${o.label}"><span class="ebb-walk__icon">${iconSvg(o.icon)}</span><span class="ebb-walk__name">${o.label}</span></button>`).join('');
      bar.hidden = !offers.length;
    }
    place();
  }
  /** Just right of the ground bar, its bottom on the same line. */
  function place() {
    if (bar.hidden || ground.hidden) return;
    const r = ground.getBoundingClientRect();
    bar.style.left = `${Math.round(r.right + 8)}px`;
  }
  bar.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button'));
    const o = b?.dataset.here ? get('here')?.[b.dataset.here] : null;
    if (o?.action) dispatch({ ...o.action, source: 'button' });
  });
  /** Keep pointer and wheel input on the bar from reaching the island below. @param {Event} e */
  const stop = (e) => e.stopPropagation();
  for (const t of ['pointerdown', 'pointerup', 'pointermove']) bar.addEventListener(t, stop);
  bar.addEventListener('wheel', stop, { passive: true });

  const ro = new ResizeObserver(place);
  ro.observe(ground);
  addEventListener('resize', place);
  render();
  const offs = [subscribe('here', render), subscribe('walk', render)];
  parent.appendChild(bar);
  return () => { for (const o of offs) o(); ro.disconnect(); removeEventListener('resize', place); bar.remove(); };
}
