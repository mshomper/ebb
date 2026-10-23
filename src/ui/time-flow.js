// @ts-check
// The time-flow button (docs/15 HUD, docs/16 "Time flow"): bottom right, the drawn time icon plus
// one, two or three pips for 1x, 2x, 4x, or two rest bars for pause. A tap cycles
// 1x -> 2x -> 4x -> pause -> 1x.
//
// Reads the store slice `meta` (meta.flow); never writes the store. A tap goes out as the action
// { type: 'time.flow', flow } through src/input/actions.js; the app applies it. Styles: time-flow.css.

import { get, subscribe } from '../core/store.js';
import { on } from '../core/events.js';
import { loadRecipe } from '../core/recipes.js';
import { dispatch } from '../input/actions.js';
import { ensureIconSprite, iconSvg } from './icons/icons.js';

/** @typedef {0|1|2|4} Flow */

/** @type {Record<Flow, Flow>} */
const NEXT = { 1: 2, 2: 4, 4: 0, 0: 1 };
/** @type {Record<Flow, string>} */
const LABEL = {
  0: 'Time: paused',
  1: 'Time: normal speed',
  2: 'Time: 2 times speed',
  4: 'Time: 4 times speed',
};
/** @type {Record<Flow, string>} */
const SHORT = { 0: 'pause', 1: 'normal speed', 2: '2 times speed', 4: '4 times speed' };
/** @type {Record<Flow, string>} */
const STATE_ICON = { 0: 'flow-pause', 1: 'flow-1', 2: 'flow-2', 4: 'flow-4' };

/**
 * Mount the time-flow button.
 * @param {HTMLElement} [parent]
 * @returns {() => void} dispose: removes the DOM and unsubscribes
 */
export function mountTimeFlow(parent = document.body) {
  ensureIconSprite();

  const root = document.createElement('div');
  root.className = 'ebb-time';
  root.innerHTML =
    `<button type="button" class="ebb-time__btn">${iconSvg('time', 'ebb-time__icon')}` +
    `<span class="ebb-time__state"></span></button>`;
  const btn = /** @type {HTMLButtonElement} */ (root.querySelector('button'));
  const state = /** @type {HTMLElement} */ (root.querySelector('.ebb-time__state'));

  /** @returns {Flow} */
  function currentFlow() {
    const f = get('meta')?.flow;
    return f === 0 || f === 2 || f === 4 ? f : 1;
  }

  /** @type {Flow | undefined} */
  let shown;
  function render() {
    const flow = currentFlow();
    if (flow === shown) return;
    shown = flow;
    const label = LABEL[flow];
    btn.setAttribute('aria-label', label);
    btn.title = `${label}. Next: ${SHORT[NEXT[flow]]}`;
    btn.dataset.flow = String(flow);
    state.innerHTML = iconSvg(STATE_ICON[flow], 'ebb-time__pips');
  }

  /** On narrow screens the open brush card covers this corner, so the button steps aside then. */
  function renderTool() {
    const open = !!get('tools')?.tool;
    root.classList.toggle('has-tool', open);
  }

  function onClick() {
    dispatch(/** @type {any} */ ({ type: 'time.flow', flow: NEXT[currentFlow()] }));
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

  // Paused, and you walk, gather or shape (Phase 1 fix F12): one soft pulse and a quiet line beside
  // the button, at most once a minute, never over an open card or the journal (recipes/world/hud.json timeRest).
  const line = document.createElement('div');
  line.className = 'ebb-time__line';
  line.setAttribute('role', 'status');
  root.prepend(line);
  /** @type {any} */ let T = null;
  loadRecipe('world/hud').then((R) => { T = R.timeRest ?? null; }).catch(() => {});
  let lastNudge = -Infinity, hideTimer = 0;
  function nudge() {
    if (!T || currentFlow() !== 0 || get('identify') || get('journalUi')?.open) return;
    const now = performance.now();
    if (now - lastNudge < T.everyS * 1000) return;
    lastNudge = now;
    line.textContent = T.text;
    root.classList.remove('is-nudged');
    void root.offsetWidth;   // restart the pulse
    root.classList.add('is-nudged');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => root.classList.remove('is-nudged'), T.showS * 1000);
  }

  render();
  renderTool();
  const unsubs = [subscribe('meta', render), subscribe('tools', renderTool),
    ...['walk:arrived', 'gather:done', 'terrain:stroke-ended', 'water:pour-ended'].map((n) => on(n, nudge))];
  parent.appendChild(root);

  return function dispose() {
    clearTimeout(hideTimer);
    for (const u of unsubs) u();
    btn.removeEventListener('click', onClick);
    root.remove();
  };
}
