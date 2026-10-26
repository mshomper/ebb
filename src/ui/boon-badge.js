// @ts-check
// The tea's boon on the HUD (docs/future/13 section 7; P2e): one round button under the clock dial,
// the herb (or the blend's two herbs) drawn in it, a ring around it that drains as the boon runs
// out. Words, never numbers: on hover or focus a card beside it gives the boon's name, its line and
// a word for how much is left. Gone when no tea is working. Reads the store slice `boon`
// ({ name, line, herbs, share, word } or null; src/world/camp/boons.js publishes it). Styles:
// boon-badge.css.

import { subscribe, get } from '../core/store.js';
import { itemIconSvg } from './icons/items.js';
import { itemIconFor } from './icons/item-registry.js';

/** @param {string} s */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** The ring's radius in the badge's 48-unit box, and its length. */
const RING_R = 21.5, RING_L = 2 * Math.PI * RING_R;

/**
 * @param {HTMLElement} parent the HUD layer
 * @returns {() => void} dispose
 */
export function mountBoonBadge(parent) {
  const root = document.createElement('div');
  root.className = 'ebb-boon';
  let key = '';

  function render() {
    const b = get('boon');
    root.classList.toggle('is-on', !!b);
    if (!b) { key = ''; root.innerHTML = ''; return; }
    // The ring alone moves each tick; the rest is drawn afresh only when the tea changes.
    const k = `${b.name}|${b.line}|${b.word}|${(b.herbs ?? []).join(',')}`;
    if (k !== key) {
      key = k;
      const herbs = (b.herbs ?? []).slice(0, 2).map((/** @type {string} */ h) => itemIconFor(h)).filter(Boolean);
      const glyphs = herbs.map((/** @type {string} */ ic, /** @type {number} */ i) => itemIconSvg(ic, `ebb-boon__herb is-${herbs.length > 1 ? (i ? 'b' : 'a') : 'one'}`)).join('');
      root.innerHTML = `
        <button type="button" class="ebb-boon__btn" aria-label="${esc(`${b.name}. ${b.line} ${b.word}`)}">
          <svg class="ebb-boon__ring" viewBox="0 0 48 48" aria-hidden="true">
            <circle class="ebb-boon__track" cx="24" cy="24" r="${RING_R}"/>
            <circle class="ebb-boon__left" cx="24" cy="24" r="${RING_R}" stroke-dasharray="${RING_L.toFixed(2)}" transform="rotate(-90 24 24)"/>
          </svg>
          <span class="ebb-boon__glyphs">${glyphs}</span>
        </button>
        <p class="ebb-boon__card" role="tooltip"><b>${esc(b.name)}</b><span>${esc(b.line)}</span><i>${esc(b.word)}</i></p>`;
    }
    const left = /** @type {SVGCircleElement | null} */ (root.querySelector('.ebb-boon__left'));
    // Drains clockwise from the top: the gap opens behind the hand as a dial's would.
    if (left) left.style.strokeDashoffset = (RING_L * (1 - Math.max(0, Math.min(1, b.share ?? 0)))).toFixed(2);
  }

  const unsub = subscribe('boon', render);
  render();
  parent.appendChild(root);
  return () => { unsub(); root.remove(); };
}
