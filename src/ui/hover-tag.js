// @ts-check
// The hover tag (Matt, October 22, 2026; one click walks and uses): below, over something a click
// can use, the pointer becomes a drawn hand, and once the pointer rests on the thing a small cream
// tag names it, fading in over the thing itself (F4, October 23, 2026: it never chases the pointer).
// Over plain walking ground there is no tag. Reads the store slice `hover` { key, name, wx, wz }
// that the app keeps from the pointer (src/app.js) and rides with the thing's spot on screen each
// frame (store slice `view`); the cursor itself is set by the class ebb-can-use on the canvas
// (hover-tag.css). Never takes a pointer event.

import { get, subscribe } from '../core/store.js';
import { ensureIconSprite, iconSvg } from './icons/icons.js';

/**
 * @param {{ hoverFadeS?: number }} [R] recipes/world/walker.json click
 * @returns {() => void} dispose
 */
export function mountHoverTag(R = {}) {
  ensureIconSprite();
  const el = document.createElement('div');
  el.className = 'ebb-hovertag';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<span class="ebb-hovertag__hand">${iconSvg('hand')}</span><span class="ebb-hovertag__name"></span>`;
  el.style.transitionDuration = `${Math.round((R.hoverFadeS ?? 0.18) * 1000)}ms`;
  const name = /** @type {HTMLElement} */ (el.querySelector('.ebb-hovertag__name'));
  document.body.appendChild(el);

  let raf = 0;
  /** Over the thing's spot, centred, kept inside the window; hidden when it leaves the view. */
  function ride() {
    const h = get('hover'), view = get('view');
    if (!h || !view) return;
    const p = view.project(h.wx, h.wz);
    const w = el.offsetWidth, x = Math.min(Math.max(8, p.x - w / 2), innerWidth - w - 8), y = Math.max(8, p.y - 52);
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    el.classList.toggle('is-shown', !p.behind);
    raf = requestAnimationFrame(ride);
  }
  function render() {
    const h = get('hover');
    cancelAnimationFrame(raf);
    if (!h) { el.classList.remove('is-shown'); return; }
    name.textContent = h.name;
    // Clear first, placed over its thing, then faded in (the transition in hover-tag.css).
    el.classList.remove('is-shown');
    raf = requestAnimationFrame(ride);
  }
  render();
  const off = subscribe('hover', render);
  return () => { off(); cancelAnimationFrame(raf); el.remove(); };
}
