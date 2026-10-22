// @ts-check
// The hover tag (Matt, October 22, 2026; one click walks and uses): below, over something a click
// can use, the pointer becomes a drawn hand and a small cream tag names it beside the pointer.
// Over plain walking ground there is no tag. Reads the store slice `hover` { name, x, y } that the
// app keeps from the pointer (src/app.js); the cursor itself is set by the class ebb-can-use on the
// canvas (hover-tag.css). Never takes a pointer event.

import { get, subscribe } from '../core/store.js';
import { ensureIconSprite, iconSvg } from './icons/icons.js';

/** @returns {() => void} dispose */
export function mountHoverTag() {
  ensureIconSprite();
  const el = document.createElement('div');
  el.className = 'ebb-hovertag';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<span class="ebb-hovertag__hand">${iconSvg('hand')}</span><span class="ebb-hovertag__name"></span>`;
  const name = /** @type {HTMLElement} */ (el.querySelector('.ebb-hovertag__name'));
  document.body.appendChild(el);

  function render() {
    const h = get('hover');
    el.classList.toggle('is-shown', !!h);
    if (!h) return;
    name.textContent = h.name;
    // Beside the pointer, kept inside the window.
    const w = el.offsetWidth, x = Math.min(h.x + 14, innerWidth - w - 8), y = Math.max(8, h.y - 44);
    el.style.transform = `translate(${x}px, ${y}px)`;
  }
  render();
  const off = subscribe('hover', render);
  return () => { off(); el.remove(); };
}
