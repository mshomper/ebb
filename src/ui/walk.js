// @ts-check
// The Go down and Go up button (doc 23 and docs/15, "Two views"; W2): at the edge of the screen,
// half way up, where no other button sits. Above, it reads Go down and puts you on foot where you
// are looking; below, Go up. While you are below, the body has the class ebb-below, and walk.css
// puts the shaping tools away. G on a keyboard does the same.
//
// Reads the store slice `walk` { below }; a tap goes out as the action walk.down or walk.up.
// Styles: walk.css.

import { get, subscribe } from '../core/store.js';
import { dispatch } from '../input/actions.js';
import { ensureIconSprite, iconSvg } from './icons/icons.js';

/**
 * @param {HTMLElement} parent the HUD layer
 * @param {{ down: string, up: string }} words recipes/world/walker.json words
 * @returns {() => void} dispose
 */
export function mountWalk(parent, words) {
  ensureIconSprite();
  const root = document.createElement('div');
  root.className = 'ebb-walk';
  root.innerHTML = '<button type="button" class="ebb-walk__btn"><span class="ebb-walk__icon"></span><span class="ebb-walk__name"></span></button>';
  const btn = /** @type {HTMLButtonElement} */ (root.querySelector('button'));
  const icon = /** @type {HTMLElement} */ (root.querySelector('.ebb-walk__icon'));
  const name = /** @type {HTMLElement} */ (root.querySelector('.ebb-walk__name'));

  let shown = /** @type {boolean | null} */ (null);
  function render() {
    const below = !!get('walk')?.below;
    if (below === shown) return;
    shown = below;
    icon.innerHTML = iconSvg(below ? 'go-up' : 'go-down');
    name.textContent = below ? words.up : words.down;
    btn.setAttribute('aria-label', below ? words.up : words.down);
    document.body.classList.toggle('ebb-below', below);
  }
  const onClick = () => dispatch({ type: get('walk')?.below ? 'walk.up' : 'walk.down', source: 'button' });
  /** Keep pointer and wheel input on the button from reaching the island below. @param {Event} e */
  const stop = (e) => e.stopPropagation();
  btn.addEventListener('click', onClick);
  root.addEventListener('pointerdown', stop);
  root.addEventListener('pointerup', stop);
  root.addEventListener('pointermove', stop);
  root.addEventListener('wheel', stop, { passive: true });

  render();
  const unsub = subscribe('walk', render);
  parent.appendChild(root);
  return () => {
    unsub();
    btn.removeEventListener('click', onClick);
    document.body.classList.remove('ebb-below');
    root.remove();
  };
}
