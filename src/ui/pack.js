// @ts-check
// The pouch row (docs/future/13 section 4.1, K-01): drawn cloth pouches inside the ground bar,
// above its buttons, below only. Each pouch shows its kind's item glyph standing in its mouth over
// how full it is, in four looks (F7: src/ui/icons/items.js itemPouchSvg; a kind with no glyph keeps
// its sketch from src/ui/sketches/pouches.js), with no word and no number; its aria-label says
// "Sticks, half full". While a card's Gather, Take up or Set down is hovered, the pouch of that kind
// lights (store slice packLit, set by src/ui/island-notes.js). Pouches keep a
// fixed order by kind and empty ones lie flat at the end. From eight pouches the row becomes two
// even rows, so the bar never grows wider than its buttons and never scrolls sideways.
// A click on a pouch opens its card (pack.open). The pouch card's actions, Set down at camp and
// Empty, are card actions (src/ui/card-actions.js), registered here.
// Reads the store slice `packView` (src/world/pack/index.js). Styles: walk.css.

import { get, subscribe } from '../core/store.js';
import { dispatch } from '../input/actions.js';
import { pouchSvg } from './sketches/pouches.js';
import { registerCardAction } from './card-actions.js';
import { itemPouchSvg, ensureItemSprite, CHIP_FOR } from './icons/items.js';
import { itemIconFor } from './icons/item-registry.js';
import { heldKind } from '../world/pack/stores.js';

/** The card's words for how full a pouch is, lower case, for aria-labels. */
const FULL_WORDS = ['empty', 'a few', 'half full', 'full'];

/**
 * @param {HTMLElement} row the ground bar's .ebb-ground__pouches
 * @param {any} words recipes/world/pack.json words
 * @param {(kind: string) => string} sketchOf a kind's sketch name (the pack's kinds; the pouch card's fallback)
 * @returns {() => void} dispose
 */
export function mountPack(row, words, sketchOf) {
  ensureItemSprite();
  // Every action that moves a kind wears that kind's item glyph and a chip for where it goes (F7):
  // the pouch for Gather and Take up, a pile for Set down (src/ui/icons/items.js CHIP_FOR). A kind
  // with no glyph falls back to the action's own icon.
  // Gather on a card (src/world/gather/index.js): one per thing there now, at most two, each its own
  // item going into the pack; the full card's Set down here (closing it leaves the thing be).
  for (const n of [0, 1]) {
    registerCardAction({ id: `gather${n}`, icon: 'gather', order: n, main: n === 0, label: (c) => c.gathers?.[n]?.name ?? '',
      item: (c) => c.gathers?.[n]?.kind ?? null, chip: CHIP_FOR.gather,
      when: (c) => !!c.gathers?.[n], action: () => ({ type: 'gather.take', n }) });
  }
  registerCardAction({ id: 'heaphere', icon: 'setdown', order: 0, main: true, label: words.setDownHere,
    item: (c) => c.full?.kind ?? null, chip: CHIP_FOR.setdown,
    when: (c) => !!c.full && c.full.g?.heap === undefined, action: () => ({ type: 'gather.heapHere' }) });
  // A pile at camp: Take up fills one pouch of its kind.
  registerCardAction({ id: 'takeup', icon: 'takeup', order: 10, main: true, label: words.takeUp,
    item: (c) => c.pile?.holds ?? null, chip: CHIP_FOR.takeup,
    when: (c) => !!c.pile && !!c.piece && !c.full, action: (c) => ({ type: 'pile.takeUp', id: c.piece }) });
  // A pile's card also sets down onto it, when the pack holds that kind: one pouch a press (F8).
  registerCardAction({ id: 'pilesetdown', icon: 'setdown', order: 11, label: words.setDown,
    item: (c) => c.pile?.holds ?? null, chip: CHIP_FOR.setdown,
    when: (c) => !!c.pile && !!c.piece && !c.full && (get('pack')?.pouches ?? []).some((/** @type {any[]} */ p) => p[0] === c.pile.holds),
    action: (c) => ({ type: 'pack.setDownKind', kind: c.pile.holds }) });
  // An empty store's card (section 3.12): Set down one pouch of whichever of its kinds the pack holds.
  registerCardAction({ id: 'storesetdown', icon: 'setdown', order: 10, main: true, label: words.setDown,
    item: (c) => heldKind(c.storeKinds ?? [], get('pack')?.pouches ?? []), chip: CHIP_FOR.setdown,
    when: (c) => !!c.store && !c.pile && !!heldKind(c.storeKinds ?? [], get('pack')?.pouches ?? []),
    action: (c) => ({ type: 'pack.setDownKind', kind: heldKind(c.storeKinds ?? [], get('pack')?.pouches ?? []) }) });
  registerCardAction({ id: 'setdown', icon: 'setdown', order: 10, main: true, label: words.setDown,
    item: (c) => c.kindId ?? null, chip: CHIP_FOR.setdown,
    when: (c) => c.sp === 'pouch' && !!c.atCamp, action: (c) => ({ type: 'pack.setDown', i: c.pouch }) });
  registerCardAction({ id: 'empty', icon: 'tip', order: 12, label: words.empty,
    when: (c) => c.sp === 'pouch', action: (c) => ({ type: 'pack.empty', i: c.pouch }) });

  let shown = '';
  function render() {
    const v = get('packView');
    if (!v) { row.innerHTML = ''; shown = ''; return; }
    const key = JSON.stringify([v.size, v.pouches, v.holding]);
    if (key === shown) return;
    shown = key;
    const cells = [];
    for (let i = 0; i < Math.max(v.size, v.pouches.length); i++) {
      const p = v.pouches[i];
      // Its kind's item glyph standing in the mouth over the fullness look (F7); a kind with no glyph
      // keeps its sketch. An empty pouch lies flat and plain.
      const icon = p ? itemIconFor(p.kind) : null;
      cells.push(p
        ? `<button type="button" class="ebb-pouch" data-i="${i}" data-kind="${p.kind}" aria-label="${p.name}, ${FULL_WORDS[p.handfuls] ?? ''}">${icon ? itemPouchSvg(icon, p.handfuls) : pouchSvg(p.handfuls, p.sketch)}</button>`
        : `<span class="ebb-pouch is-empty" role="img" aria-label="An empty pouch">${itemPouchSvg(null, 0)}</span>`);
    }
    // Two even rows from eight pouches (4 and 4, 5 and 5, 6 and 6).
    const n = cells.length, rows = n >= 8 ? [cells.slice(0, Math.ceil(n / 2)), cells.slice(Math.ceil(n / 2))] : [cells];
    row.innerHTML = rows.map((r) => `<div class="ebb-pouches__row">${r.join('')}</div>`).join('');
    row.classList.toggle('is-holding', !!v.holding);
  }
  row.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button[data-i]'));
    if (!b) return;
    const r = b.getBoundingClientRect();
    dispatch({ type: 'pack.open', i: Number(b.dataset.i), x: r.left + r.width / 2, y: r.top, source: 'button' });
  });
  /** The pouch of the kind a card's action is about to move, lit while that action is hovered. */
  function light() {
    const k = get('packLit') ?? null;
    for (const b of row.querySelectorAll('.ebb-pouch[data-kind]')) b.classList.toggle('is-lit', /** @type {HTMLElement} */ (b).dataset.kind === k);
  }
  render();
  const off = subscribe('packView', () => { render(); light(); });
  const offLit = subscribe('packLit', light);
  return () => { off(); offLit(); row.innerHTML = ''; };
}
