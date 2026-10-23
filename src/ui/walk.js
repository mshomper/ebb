// @ts-check
// The walker's buttons (doc 23 and docs/15, "Two views"; W2 to W4).
//   Go down / Go up: at the edge of the screen, half way up, where no other button sits. Above, it
//     puts you on foot (back on your figure when it is in view, else where you are looking);
//     below, it takes you back up. G on a keyboard does the same.
//   I'm stuck: under it while you are below; always takes you to ground that joins the island.
//   The ground bar (W4): along the bottom while you are below, in the tool bar's place, its buttons
//     drawn icons with the word on hover only, as on cards (F17, Matt, October 23, 2026). Sit and
//     Kneel lower you where you stand (a second press stands you up); Feed kneels and puts food
//     down in front of you; Net (once the beachcomber's trail gives it) sets your net in front of
//     you, or lifts it when you stand by it full. Photo joins when photo mode exists. There is no
//     Look button: one click walks and uses (Matt, October 22, 2026; src/world/walk/click.js).
// While you are below, the body has the class ebb-below (walk.css puts the shaping tools away);
// while you sit, ebb-sitting (the buttons fade).
//
// Reads the store slice `walk` { below, posture }; a press goes out as the action walk.down,
// walk.up, walk.stuck, walk.posture, walk.feed or walk.net (and `unlocks` for the net).
// Styles: walk.css.

import { get, subscribe } from '../core/store.js';
import { dispatch } from '../input/actions.js';
import { ensureIconSprite, iconSvg } from './icons/icons.js';

/**
 * @param {HTMLElement} parent the HUD layer
 * @param {{ down: string, up: string, stuck: string, sit: string, kneel: string, feed: string, net: string }} words
 *   recipes/world/walker.json words
 * @returns {() => void} dispose
 */
export function mountWalk(parent, words) {
  ensureIconSprite();
  // data-label: the word over an icon-only button on hover (the ground bar, F17; walk.css).
  const btn = (/** @type {string} */ cls, /** @type {string} */ icon, /** @type {string} */ label, /** @type {string} */ extra = '') =>
    `<button type="button" class="ebb-walk__btn ${cls}" aria-label="${label}" data-label="${label}"${extra}><span class="ebb-walk__icon">${icon ? iconSvg(icon) : ''}</span><span class="ebb-walk__name">${label}</span></button>`;

  const root = document.createElement('div');
  root.className = 'ebb-walk';
  root.innerHTML = btn('ebb-walk__go', '', words.down) + btn('ebb-walk__stuck', 'stuck', words.stuck, ' hidden');
  const bar = document.createElement('div');
  bar.className = 'ebb-ground';
  bar.hidden = true;
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'On foot');
  // The pouch row sits above the buttons (src/ui/pack.js fills .ebb-ground__pouches).
  bar.innerHTML = '<div class="ebb-ground__pouches"></div><div class="ebb-ground__btns">'
    + btn('', 'sit', words.sit, ' data-posture="sit" aria-pressed="false"') + btn('', 'kneel', words.kneel, ' data-posture="kneel" aria-pressed="false"')
    + btn('', 'feed', words.feed, ' data-feed') + btn('', 'net', words.net, ' data-net hidden') + '</div>';

  const go = /** @type {HTMLButtonElement} */ (root.querySelector('.ebb-walk__go'));
  const stuckBtn = /** @type {HTMLButtonElement} */ (root.querySelector('.ebb-walk__stuck'));
  const goIcon = /** @type {HTMLElement} */ (go.querySelector('.ebb-walk__icon'));
  const goName = /** @type {HTMLElement} */ (go.querySelector('.ebb-walk__name'));
  const sitBtn = /** @type {HTMLButtonElement} */ (bar.querySelector('[data-posture="sit"]'));
  const kneelBtn = /** @type {HTMLButtonElement} */ (bar.querySelector('[data-posture="kneel"]'));
  const netBtn = /** @type {HTMLButtonElement} */ (bar.querySelector('[data-net]'));

  let shown = '';
  function render() {
    const w = get('walk') ?? {};
    const below = !!w.below;
    const hasNet = !!get('unlocks')?.nets?.general;
    const key = `${below}|${w.posture}|${hasNet}`;
    if (key === shown) return;
    shown = key;
    netBtn.hidden = !hasNet;
    goIcon.innerHTML = iconSvg(below ? 'go-up' : 'go-down');
    goName.textContent = below ? words.up : words.down;
    go.setAttribute('aria-label', below ? words.up : words.down);
    stuckBtn.hidden = !below;
    bar.hidden = !below;
    sitBtn.setAttribute('aria-pressed', String(below && w.posture === 'sit'));
    kneelBtn.setAttribute('aria-pressed', String(below && w.posture === 'kneel'));
    document.body.classList.toggle('ebb-below', below);
    document.body.classList.toggle('ebb-sitting', below && w.posture === 'sit');
  }

  /** @param {Event} e */
  function onClick(e) {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button'));
    if (!b) return;
    if (b === go) dispatch({ type: get('walk')?.below ? 'walk.up' : 'walk.down', source: 'button' });
    else if (b === stuckBtn) dispatch({ type: 'walk.stuck', source: 'button' });
    else if (b.dataset.posture) dispatch({ type: 'walk.posture', posture: b.dataset.posture, source: 'button' });
    else if (b.dataset.feed !== undefined) dispatch({ type: 'walk.feed', source: 'button' });
    else if (b.dataset.net !== undefined) dispatch({ type: 'walk.net', source: 'button' });
  }
  /** Keep pointer and wheel input on the buttons from reaching the island below. @param {Event} e */
  const stop = (e) => e.stopPropagation();
  for (const el of [root, bar]) {
    el.addEventListener('click', onClick);
    el.addEventListener('pointerdown', stop);
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointermove', stop);
    el.addEventListener('wheel', stop, { passive: true });
  }

  render();
  const unsub = subscribe('walk', render);
  const unsubUnlocks = subscribe('unlocks', render);
  parent.appendChild(root);
  parent.appendChild(bar);
  return () => {
    unsub();
    unsubUnlocks();
    document.body.classList.remove('ebb-below', 'ebb-sitting');
    root.remove();
    bar.remove();
  };
}
