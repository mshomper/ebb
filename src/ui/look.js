// @ts-check
// The Look button (docs/05 palettes, docs/15 HUD top right): the drawn palette icon plus the
// name of the palette in use ("Dusk", "Meadow morning"). A tap cycles to the next palette.
// On narrow screens (under 420 px) only the icon shows; the name stays in aria-label and title.
//
// Reads the store slice `settings` (settings.palette); never writes the store. A tap goes out as
// the action { type: 'look.palette', id } through src/input/actions.js; the app bakes the new
// palette, crossfades to it and updates settings.palette. Styles: look.css.

import { get, subscribe } from '../core/store.js';
import { dispatch } from '../input/actions.js';
import { ensureIconSprite, iconSvg } from './icons/icons.js';

/** @typedef {{ id: string, name: string }} PaletteEntry */

/** @type {PaletteEntry[]} */
const DEFAULT_PALETTES = [
  { id: 'dusk', name: 'Dusk' },
  { id: 'meadow-morning', name: 'Meadow morning' },
  { id: 'clear-sight', name: 'Clear sight' },
];

/**
 * Mount the Look button.
 * @param {HTMLElement} [parent]
 * @param {PaletteEntry[]} [palettes]  the palettes to cycle through, in order
 * @returns {() => void} dispose: removes the DOM and unsubscribes
 */
export function mountLook(parent = document.body, palettes = DEFAULT_PALETTES) {
  ensureIconSprite();
  const list = Array.isArray(palettes) && palettes.length ? palettes.slice() : DEFAULT_PALETTES;

  const root = document.createElement('div');
  root.className = 'ebb-look';
  root.innerHTML =
    `<button type="button" class="ebb-look__btn">${iconSvg('look', 'ebb-look__icon')}` +
    `<span class="ebb-look__name"></span></button>`;
  const btn = /** @type {HTMLButtonElement} */ (root.querySelector('button'));
  const nameEl = /** @type {HTMLElement} */ (root.querySelector('.ebb-look__name'));

  /** Index of the palette in use, or -1 if it is not in the list. */
  function currentIndex() {
    const id = get('settings')?.palette;
    return list.findIndex((p) => p.id === id);
  }

  /** @param {number} i */
  function nameAt(i) {
    return i >= 0 ? list[i].name : (get('settings')?.palette ?? list[0].name);
  }

  /** @type {string | undefined} */
  let shown;
  function render() {
    const i = currentIndex();
    const name = nameAt(i);
    const next = list[(i + 1) % list.length];
    const key = `${name}|${next.id}`;
    if (key === shown) return;
    shown = key;
    nameEl.textContent = name;
    btn.setAttribute('aria-label', `Look: ${name}`);
    btn.title = list.length > 1 ? `Look: ${name}. Next: ${next.name}` : `Look: ${name}`;
  }

  function onClick() {
    if (list.length < 2 && currentIndex() >= 0) return;
    const next = list[(currentIndex() + 1) % list.length];
    dispatch({ type: 'look.palette', id: next.id });
  }
  /** Keep pointer and wheel input on the button from reaching anything below. @param {Event} e */
  const stop = (e) => e.stopPropagation();
  /** @param {Event} e */
  const noMenu = (e) => e.preventDefault();

  btn.addEventListener('click', onClick);
  root.addEventListener('pointerdown', stop);
  root.addEventListener('pointermove', stop);
  root.addEventListener('wheel', stop, { passive: true });
  root.addEventListener('contextmenu', noMenu);

  render();
  const unsub = subscribe('settings', render);
  parent.appendChild(root);

  return function dispose() {
    unsub();
    btn.removeEventListener('click', onClick);
    root.remove();
  };
}
