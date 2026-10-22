// @ts-check
// The pouch row (docs/future/13 section 4.1, K-01): drawn cloth pouches inside the ground bar,
// above its buttons, below only. Each pouch shows how full it is in four looks (src/ui/sketches/
// pouches.js), with no word and no number; its aria-label says "Sticks, half full". Pouches keep a
// fixed order by kind and empty ones lie flat at the end. From eight pouches the row becomes two
// even rows, so the bar never grows wider than its buttons and never scrolls sideways.
// A click on a pouch opens its card (pack.open). The pouch card's actions, Set down at camp and
// Empty, are card actions (src/ui/card-actions.js), registered here.
// Reads the store slice `packView` (src/world/pack/index.js). Styles: walk.css.

import { get, subscribe } from '../core/store.js';
import { dispatch } from '../input/actions.js';
import { pouchSvg, kindMarkSvg } from './sketches/pouches.js';
import { registerCardAction } from './card-actions.js';

/** The card's words for how full a pouch is, lower case, for aria-labels. */
const FULL_WORDS = ['empty', 'a few', 'half full', 'full'];

/**
 * @param {HTMLElement} row the ground bar's .ebb-ground__pouches
 * @param {any} words recipes/world/pack.json words
 * @param {(kind: string) => string} sketchOf a kind's sketch name (the pack's kinds)
 * @returns {() => void} dispose
 */
export function mountPack(row, words, sketchOf) {
  // Gather on a card (src/world/gather/index.js): one per thing there now, at most two, each with
  // a small mark of what it takes; the full card's Set down here (closing it leaves the thing be).
  for (const n of [0, 1]) {
    registerCardAction({ id: `gather${n}`, icon: 'gather', order: n, main: n === 0, label: (c) => c.gathers?.[n]?.name ?? '',
      mark: (c) => kindMarkSvg(sketchOf(c.gathers?.[n]?.kind ?? '')),
      when: (c) => !!c.gathers?.[n], action: () => ({ type: 'gather.take', n }) });
  }
  registerCardAction({ id: 'heaphere', icon: 'setdown', order: 0, main: true, label: words.setDownHere,
    when: (c) => !!c.full && c.full.g?.heap === undefined, action: () => ({ type: 'gather.heapHere' }) });
  // A pile at camp: Take up fills one pouch of its kind.
  registerCardAction({ id: 'takeup', icon: 'takeup', order: 10, main: true, label: words.takeUp,
    when: (c) => !!c.pile && !!c.piece && !c.full, action: (c) => ({ type: 'pile.takeUp', id: c.piece }) });
  registerCardAction({ id: 'setdown', icon: 'setdown', order: 10, main: true, label: words.setDown,
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
      cells.push(p
        ? `<button type="button" class="ebb-pouch" data-i="${i}" aria-label="${p.name}, ${FULL_WORDS[p.handfuls] ?? ''}">${pouchSvg(p.handfuls, p.sketch)}</button>`
        : `<span class="ebb-pouch is-empty" role="img" aria-label="An empty pouch">${pouchSvg(0)}</span>`);
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
  render();
  const off = subscribe('packView', render);
  return () => { off(); row.innerHTML = ''; };
}
