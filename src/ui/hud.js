// @ts-check
// The HUD frame (docs/15 "The HUD", S8): one layer that holds every corner button (the clock dial,
// Look, the journal button, undo and redo, the tool bar, time flow and the build badge) and owns
// how they show:
//   playing  everything at full strength;
//   dimmed   after dimAfterS without input, the layer fades to dimOpacity; any touch, mouse move,
//            wheel or key brings it back (off when settings.hudDim is false);
//   hidden   H (the `ui.hideHud` action) hides the layer and the island notes; H again, or on a
//            touch screen the faint drawn eye left in the corner, brings them back;
//   reveal   while the reveal on return plays the layer steps aside (reveal.js sets
//            body.ebb-revealing; this module makes the layer inert until `reveal:ended`).
// The layer is a full-screen fixed box that takes no pointer input itself; its children keep their
// own fixed places. Opacity on the layer fades them all at once without touching their own fades.
// Writes the store slice `hud` {hidden, dim}. Timings: recipes/world/hud.json. Styles: hud.css.

import { get, update, subscribe } from '../core/store.js';
import { on } from '../core/events.js';
import { loadRecipe } from '../core/recipes.js';
import { dispatch, onAction } from '../input/actions.js';
import { ensureIconSprite, iconSvg } from './icons/icons.js';

/**
 * Mount the HUD layer. Mount the corner buttons into `layer` afterwards.
 * @param {HTMLElement} [parent]
 * @returns {Promise<{ layer: HTMLElement, dispose: () => void }>}
 */
export async function mountHud(parent = document.body) {
  const R = await loadRecipe('world/hud');
  ensureIconSprite();
  const body = document.body;
  document.documentElement.style.setProperty('--hud-dim', String(R.dimOpacity));
  document.documentElement.style.setProperty('--hud-fade', `${R.fadeS}s`);

  const layer = document.createElement('div');
  layer.id = 'ebb-hud';

  // On a touch screen there is no H key, so hiding leaves this faint eye to bring the buttons back.
  const show = document.createElement('div');
  show.className = 'ebb-hud-show';
  show.innerHTML = `<button type="button" class="ebb-hud-show__btn" aria-label="Show the buttons" title="Show the buttons">${iconSvg('eye')}</button>`;
  show.inert = true;
  const showBtn = /** @type {HTMLButtonElement} */ (show.querySelector('button'));
  showBtn.addEventListener('click', () => dispatch({ type: 'ui.hideHud', hidden: false, source: 'touch' }));
  for (const type of ['pointerdown', 'pointermove']) show.addEventListener(type, (e) => e.stopPropagation());

  let hidden = false;
  let dim = false;
  let revealing = false;
  let lastInput = performance.now();

  function render() {
    body.classList.toggle('ebb-hud-hidden', hidden);
    body.classList.toggle('ebb-hud-dim', dim && !hidden);
    layer.inert = hidden || revealing;
    show.inert = !hidden || revealing;
    update('hud', () => ({ hidden, dim }));
  }

  /** Any input: the buttons come back from dimmed (never from hidden: that is H's job). */
  const wake = () => {
    lastInput = performance.now();
    if (dim) { dim = false; render(); }
  };
  const dimOn = () => get('settings')?.hudDim !== false;
  const timer = setInterval(() => {
    if (!dim && !hidden && !revealing && dimOn() && performance.now() - lastInput > R.dimAfterS * 1000) {
      dim = true;
      render();
    }
  }, 500);

  const opts = { capture: true, passive: true };
  for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown']) addEventListener(type, wake, opts);

  const unsubs = [
    onAction((a) => {
      if (a.type !== 'ui.hideHud') return;
      hidden = a.hidden ?? !hidden;
      dim = false;
      lastInput = performance.now();
      render();
    }),
    subscribe('settings', () => { if (!dimOn()) wake(); }),
    on('reveal:started', () => { revealing = true; render(); }),
    on('reveal:ended', () => { revealing = false; lastInput = performance.now(); render(); }),
  ];

  render();
  parent.appendChild(layer);
  parent.appendChild(show);

  return {
    layer,
    dispose() {
      clearInterval(timer);
      for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown']) removeEventListener(type, wake, opts);
      for (const u of unsubs) u?.();
      body.classList.remove('ebb-hud-hidden', 'ebb-hud-dim');
      layer.remove();
      show.remove();
    },
  };
}
