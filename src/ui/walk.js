// @ts-check
// The Go down and Go up button (doc 23 and docs/15, "Two views"; W2): at the edge of the screen,
// half way up, where no other button sits. Above, it reads Go down and puts you on foot (back on
// your figure when it is in view, else where you are looking); below, Go up. Below, I'm stuck sits
// under it and always takes you to ground that joins the rest of the island. While you are below,
// the body has the class ebb-below, and walk.css puts the shaping tools away. G on a keyboard does
// the same as the button.
//
// Reads the store slice `walk` { below }; a tap goes out as the action walk.down, walk.up or
// walk.stuck. Styles: walk.css.

import { get, subscribe } from '../core/store.js';
import { dispatch } from '../input/actions.js';
import { ensureIconSprite, iconSvg } from './icons/icons.js';

/**
 * @param {HTMLElement} parent the HUD layer
 * @param {{ down: string, up: string, stuck: string }} words recipes/world/walker.json words
 * @returns {() => void} dispose
 */
export function mountWalk(parent, words) {
  ensureIconSprite();
  const root = document.createElement('div');
  root.className = 'ebb-walk';
  root.innerHTML =
    '<button type="button" class="ebb-walk__btn ebb-walk__go"><span class="ebb-walk__icon"></span><span class="ebb-walk__name"></span></button>' +
    `<button type="button" class="ebb-walk__btn ebb-walk__stuck" aria-label="${words.stuck}" hidden>` +
    `<span class="ebb-walk__icon">${iconSvg('stuck')}</span><span class="ebb-walk__name">${words.stuck}</span></button>`;
  const btn = /** @type {HTMLButtonElement} */ (root.querySelector('.ebb-walk__go'));
  const stuckBtn = /** @type {HTMLButtonElement} */ (root.querySelector('.ebb-walk__stuck'));
  const icon = /** @type {HTMLElement} */ (btn.querySelector('.ebb-walk__icon'));
  const name = /** @type {HTMLElement} */ (btn.querySelector('.ebb-walk__name'));

  let shown = /** @type {boolean | null} */ (null);
  function render() {
    const below = !!get('walk')?.below;
    if (below === shown) return;
    shown = below;
    icon.innerHTML = iconSvg(below ? 'go-up' : 'go-down');
    name.textContent = below ? words.up : words.down;
    btn.setAttribute('aria-label', below ? words.up : words.down);
    stuckBtn.hidden = !below;
    document.body.classList.toggle('ebb-below', below);
  }
  const onClick = () => dispatch({ type: get('walk')?.below ? 'walk.up' : 'walk.down', source: 'button' });
  const onStuck = () => dispatch({ type: 'walk.stuck', source: 'button' });
  /** Keep pointer and wheel input on the buttons from reaching the island below. @param {Event} e */
  const stop = (e) => e.stopPropagation();
  btn.addEventListener('click', onClick);
  stuckBtn.addEventListener('click', onStuck);
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
    stuckBtn.removeEventListener('click', onStuck);
    document.body.classList.remove('ebb-below');
    root.remove();
  };
}
