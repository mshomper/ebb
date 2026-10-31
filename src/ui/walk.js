// @ts-check
// The walker's buttons (doc 23 and docs/15, "Two views"; W2 to W4).
//   Go down / Go up: at the edge of the screen, half way up, where no other button sits. Above, it
//     puts you on foot (back on your figure when it is in view, else where you are looking);
//     below, it takes you back up. G on a keyboard does the same.
//   I'm stuck: under it while you are below; always takes you to ground that joins the island.
//   The ground bar (W4): along the bottom while you are below, in the tool bar's place, its buttons
//     drawn icons with the word on hover only, as on cards (F17, Matt, October 23, 2026). Sit and
//     Kneel lower you where you stand (a second press stands you up); Feed kneels and puts food
//     down in front of you; Photo opens photo mode (B2 P1, src/render/photo-mode.js). There is no Look button: one click
//     walks and uses (Matt, October 22, 2026; src/world/walk/click.js).
//   Planting on foot (D1a, Matt, October 24, 2026; src/world/sowing): the seed tin and the gift spot,
//     each one drawn icon that opens its own small menu above it (the tin's seeds; the gifts waiting
//     to be placed, with how many on hover). Picking one puts it in hand; the item again puts it
//     away. Net (once the beachcomber's trail gives it) is picked the same way: a click on the
//     water then walks you out to set it.
// While you are below, the body has the class ebb-below (walk.css puts the shaping tools away);
// while you sit, ebb-sitting (the buttons fade).
//
// Reads the store slices `walk` { below, posture }, `unlocks` and `hand`; a press goes out as the
// action walk.down, walk.up, walk.stuck, walk.posture, walk.feed, hand.pick, hand.putAway or photo.open.
// Styles: walk.css.

import { get, subscribe } from '../core/store.js';
import { dispatch } from '../input/actions.js';
import { ensureIconSprite, iconSvg } from './icons/icons.js';
import { tinItems, giftItems, itemLabel, samePick } from '../world/sowing/model.js';
import { stoneWaiting } from '../world/camp/gifts.js';
import { itemPouchSvg, ensureItemSprite } from './icons/items.js';
import { itemIconFor } from './icons/item-registry.js';

/**
 * @param {HTMLElement} parent the HUD layer
 * @param {{ down: string, up: string, stuck: string, sit: string, kneel: string, feed: string, net: string, photo?: string }} words
 *   recipes/world/walker.json words
 * @param {any} sowing recipes/world/sowing.json (the seed tin and the gift spot)
 * @returns {() => void} dispose
 */
export function mountWalk(parent, words, sowing) {
  ensureIconSprite();
  ensureItemSprite();
  // data-label: the word over an icon-only button on hover (the ground bar, F17; walk.css).
  const btn = (/** @type {string} */ cls, /** @type {string} */ icon, /** @type {string} */ label, /** @type {string} */ extra = '') =>
    `<button type="button" class="ebb-walk__btn ${cls}" aria-label="${label}" data-label="${label}"${extra}><span class="ebb-walk__icon">${icon ? iconSvg(icon) : ''}</span><span class="ebb-walk__name">${label}</span></button>`;
  const W = sowing.words;

  const root = document.createElement('div');
  root.className = 'ebb-walk';
  root.innerHTML = btn('ebb-walk__go', '', words.down) + btn('ebb-walk__stuck', 'stuck', words.stuck, ' hidden');
  const bar = document.createElement('div');
  bar.className = 'ebb-ground';
  bar.hidden = true;
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'On foot');
  // The pouch row sits above the buttons (src/ui/pack.js fills .ebb-ground__pouches); the tin's and
  // the gift spot's menus open above their buttons.
  bar.innerHTML = '<div class="ebb-ground__pouches"></div><div class="ebb-ground__btns">'
    + btn('', 'sit', words.sit, ' data-posture="sit" aria-pressed="false"') + btn('', 'kneel', words.kneel, ' data-posture="kneel" aria-pressed="false"')
    + btn('', 'feed', words.feed, ' data-feed')
    + btn('', 'seed-tin', W.tin, ' data-menu="tin" aria-pressed="false" aria-haspopup="true" aria-expanded="false"')
    + btn('', 'gift-spot', W.gifts, ' data-menu="gifts" aria-pressed="false" aria-haspopup="true" aria-expanded="false"')
    + btn('', 'net', words.net, ' data-pick-kind="net" data-pick-id="net" aria-pressed="false" hidden')
    + btn('', 'photo', words.photo ?? 'Photo', ' data-photo') + '</div>'
    + '<div class="ebb-ground__menu" role="menu" hidden></div>';

  const go = /** @type {HTMLButtonElement} */ (root.querySelector('.ebb-walk__go'));
  const stuckBtn = /** @type {HTMLButtonElement} */ (root.querySelector('.ebb-walk__stuck'));
  const goIcon = /** @type {HTMLElement} */ (go.querySelector('.ebb-walk__icon'));
  const goName = /** @type {HTMLElement} */ (go.querySelector('.ebb-walk__name'));
  const sitBtn = /** @type {HTMLButtonElement} */ (bar.querySelector('[data-posture="sit"]'));
  const kneelBtn = /** @type {HTMLButtonElement} */ (bar.querySelector('[data-posture="kneel"]'));
  const netBtn = /** @type {HTMLButtonElement} */ (bar.querySelector('[data-pick-kind="net"]'));
  const feedBtn = /** @type {HTMLButtonElement} */ (bar.querySelector('[data-feed]'));
  const tinBtn = /** @type {HTMLButtonElement} */ (bar.querySelector('[data-menu="tin"]'));
  const giftBtn = /** @type {HTMLButtonElement} */ (bar.querySelector('[data-menu="gifts"]'));
  const menu = /** @type {HTMLElement} */ (bar.querySelector('.ebb-ground__menu'));
  /** Which menu is open. @type {'tin' | 'gifts' | null} */ let open = null;

  /** The items a menu holds now. @param {'tin' | 'gifts'} which */
  const itemsOf = (which) => (which === 'tin' ? tinItems(sowing, get('packView')?.pouches ?? []) : giftItems(sowing, get('unlocks'), stoneWaiting(get('camp'), sowing)));
  /** A menu item's drawing: the tin's endless seeds their own icons; what the pack holds (P2g) its item glyph in a pouch as full as it is. @param {any} it */
  const drawItem = (it) => {
    const g = it.from ? itemIconFor(it.from) : null;
    return g ? itemPouchSvg(g, Math.max(1, Math.min(3, it.fill ?? 3))) : iconSvg(it.icon);
  };

  let shown = '';
  function render() {
    const w = get('walk') ?? {};
    const below = !!w.below;
    const hasNet = !!get('unlocks')?.nets?.general;
    const hand = get('hand') ?? null;
    const gifts = giftItems(sowing, get('unlocks'), stoneWaiting(get('camp'), sowing));
    // The pot in both arms (K-26): no Feed and no Net until it is set down.
    const arms = get('pack')?.holding === 'pot';
    if (!below) open = null;
    const tinKey = open === 'tin' ? itemsOf('tin').map((t) => `${t.id}${t.fill ?? ''}`).join(',') : '';
    const key = `${below}|${w.posture}|${hasNet}|${arms}|${hand?.kind}:${hand?.id}|${open}|${gifts.map((g) => `${g.id}${g.left}`).join(',')}|${tinKey}`;
    if (key === shown) return;
    shown = key;
    netBtn.hidden = !hasNet || arms;
    feedBtn.hidden = arms;
    netBtn.setAttribute('aria-pressed', String(hand?.kind === 'net'));
    tinBtn.setAttribute('aria-pressed', String(['seed', 'ball', 'clump', 'cutting'].includes(hand?.kind)));
    giftBtn.setAttribute('aria-pressed', String(hand?.kind === 'gift'));
    // An empty gift spot rests dimmed; its word says gifts come here.
    giftBtn.classList.toggle('is-empty', !gifts.length);
    const giftWord = gifts.length ? W.gifts : W.giftsEmpty;
    giftBtn.dataset.label = giftWord;
    giftBtn.setAttribute('aria-label', giftWord);
    tinBtn.setAttribute('aria-expanded', String(open === 'tin'));
    giftBtn.setAttribute('aria-expanded', String(open === 'gifts'));
    const list = open ? itemsOf(open) : [];
    if (open && !list.length) open = null;
    menu.hidden = !open;
    if (open) {
      menu.innerHTML = list.map((it) => {
        const label = itemLabel(sowing, it);
        return `<button type="button" class="ebb-walk__btn" role="menuitemradio" aria-checked="${samePick(hand, it)}" aria-pressed="${samePick(hand, it)}" aria-label="${label}" data-label="${label}" data-pick-kind="${it.kind}" data-pick-id="${it.id}"><span class="ebb-walk__icon">${drawItem(it)}</span><span class="ebb-walk__name">${label}</span></button>`;
      }).join('');
      // Over its own button, kept inside the bar's width: from seven items, two even rows (P2g).
      const b = (open === 'tin' ? tinBtn : giftBtn).getBoundingClientRect(), r = bar.getBoundingClientRect();
      const perRow = list.length >= 7 ? Math.ceil(list.length / 2) : list.length;
      menu.style.gridTemplateColumns = `repeat(${perRow}, 48px)`;
      const mw = perRow * 52 + 8;
      menu.style.left = `${Math.max(0, Math.min(r.width - mw, b.left - r.left + b.width / 2 - mw / 2))}px`;
    }
    goIcon.innerHTML = iconSvg(below ? 'go-up' : 'go-down');
    goName.textContent = below ? words.up : words.down;
    go.setAttribute('aria-label', below ? words.up : words.down);
    stuckBtn.hidden = !below;
    bar.hidden = !below;
    sitBtn.setAttribute('aria-pressed', String(below && w.posture === 'sit'));
    kneelBtn.setAttribute('aria-pressed', String(below && w.posture === 'kneel'));
    document.body.classList.toggle('ebb-below', below);
    document.body.classList.toggle('ebb-sitting', below && w.posture === 'sit');
    document.body.classList.toggle('ebb-in-hand', below && !!hand);
  }

  /** @param {Event} e */
  function onClick(e) {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button'));
    if (!b) return;
    if (b === go) dispatch({ type: get('walk')?.below ? 'walk.up' : 'walk.down', source: 'button' });
    else if (b === stuckBtn) dispatch({ type: 'walk.stuck', source: 'button' });
    else if (b.dataset.posture) dispatch({ type: 'walk.posture', posture: b.dataset.posture, source: 'button' });
    else if (b.dataset.feed !== undefined) dispatch({ type: 'walk.feed', source: 'button' });
    else if (b.dataset.photo !== undefined) dispatch({ type: 'photo.open', source: 'mouse' });
    else if (b.dataset.menu) {
      const which = /** @type {'tin' | 'gifts'} */ (b.dataset.menu);
      open = open === which || !itemsOf(which).length ? null : which;
      shown = '';
      render();
      return;
    } else if (b.dataset.pickKind) {
      dispatch(/** @type {any} */ ({ type: 'hand.pick', kind: b.dataset.pickKind, id: b.dataset.pickId, source: 'button' }));
    }
    if (open) { open = null; shown = ''; render(); }
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
  const unsubs = ['walk', 'unlocks', 'hand', 'pack', 'packView'].map((s) => subscribe(s, render));
  parent.appendChild(root);
  parent.appendChild(bar);
  return () => {
    for (const u of unsubs) u();
    document.body.classList.remove('ebb-below', 'ebb-sitting', 'ebb-in-hand');
    root.remove();
    bar.remove();
  };
}
