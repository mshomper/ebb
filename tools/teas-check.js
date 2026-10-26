// @ts-check
// tools/teas-check.html: the tea pot's card (the game's workspace card, src/ui/station.js) from sample
// views, and the boon on the HUD (src/ui/boon-badge.js) at three moments, so Matt can see both before
// playing to them. Reads only the recipes; the views are made here in the shape the game publishes.

import { update } from '../src/core/store.js';
import { mountStation } from '../src/ui/station.js';
import { mountBoonBadge } from '../src/ui/boon-badge.js';
import { pileWord } from '../src/world/pack/piles.js';

const cook = await (await fetch('../recipes/world/cook.json')).json();
const pack = await (await fetch('../recipes/world/pack.json')).json();
const camp = await (await fetch('../recipes/world/camp.json')).json();
const W = cook.words, T = W.teapot, Hb = cook.teas.herbs;
const names = Object.fromEntries(pack.kinds.map((/** @type {any} */ k) => [k.id, k.name]));
const nameOf = (/** @type {string} */ k) => (k.startsWith('dried:') ? `${names[k.slice(6)] ?? k}, ${T.dried}` : names[k] ?? k);
const pouches = [['watermint.leaves', 2], ['nettle.tops', 1], ['chamomile.flowers', 2]]
  .map(([kind, h]) => ({ kind: String(kind), name: nameOf(String(kind)), handfuls: Number(h), left: Number(h) }));
const rack = [{ kind: 'dried:chamomile.flowers', name: nameOf('dried:chamomile.flowers'), handfuls: 2, left: 2, word: T.dried },
  { kind: 'willow.bark', name: nameOf('willow.bark'), handfuls: 1, left: 1, word: pack.words.rack?.fresh ?? 'Fresh' }];
const store = [['gorse.flowers', 3], ['meadowsweet.flowers', 2]].map(([kind, h]) => ({ kind: String(kind), name: nameOf(String(kind)), handfuls: Number(h), left: Number(h), word: pileWord(Number(h), pack) }));

/**
 * The tea pot's card. @param {string[]} laid @param {{ ready?: boolean, line?: string | null, working?: boolean }} o
 */
const pot = (laid, o = {}) => ({
  id: 'teapot', name: T.name, spots: 2,
  laid: laid.map((kind) => ({ kind, name: nameOf(kind), used: true })), outlines: [],
  action: { icon: 'brew', label: T.brew, ready: o.ready ?? laid.length > 0, make: 'brew' }, line: o.line === undefined ? T.laid : o.line, working: !!o.working,
  pack: pouches, piles: rack, store, packName: W.pack, pilesName: T.rack, storeName: W.hamper,
});
const potText = `${W.pieceLines.hearth} ${W.potWater.fresh}`;

const VIEWS = [
  ['One herb laid', () => pot(['watermint.leaves']), potText],
  ['A blend you have found', () => pot(['watermint.leaves', 'nettle.tops'], { line: `${W.boonNames['watermint+nettle']}. ${W.boonLines['watermint+nettle']}` }), potText],
  ['Deep rest, one herb dried', () => pot(['willow.bark', 'dried:chamomile.flowers']), potText],
  ['Steeping', () => pot(['watermint.leaves', 'nettle.tops'], { line: T.steeping, working: true, ready: false }), potText],
  ['The pot is empty', () => pot([], { line: T.noWater, ready: false }), `${W.pieceLines.hearth} ${W.potWater.none}`],
  ['The fire is out', () => pot(['gorse.flowers'], { line: T.noFire, ready: false }), potText],
];

/** The boon at a moment. @param {string} id @param {number} share */
const boon = (id, share) => {
  const word = (cook.teas.left.find((/** @type {[number, string]} */ [s]) => share > s) ?? cook.teas.left.at(-1))[1];
  return { name: W.boonNames[id], line: W.boonLines[id], herbs: id.split('+').map((h) => Hb[h]), share, word: W.teaLeft[word] };
};
const BOONS = [['Boon: water mint, just drunk', () => boon('watermint', 0.92)], ['Boon: Old friends, half gone', () => boon('meadowsweet+chamomile', 0.45)],
  ['Boon: gorse, nearly gone', () => boon('gorse', 0.07)], ['No tea', () => null]];

mountStation(document.body, {}, camp.stations.ui);
const hud = /** @type {HTMLElement} */ (document.getElementById('ebb-hud'));
mountBoonBadge(hud);
const bar = /** @type {HTMLElement} */ (document.getElementById('bar'));
const cards = /** @type {HTMLButtonElement[]} */ ([]), boons = /** @type {HTMLButtonElement[]} */ ([]);
/** @param {number} i */
function show(i) {
  const [, view, text] = /** @type {[string, () => any, string]} */ (VIEWS[i]);
  const v = view();
  update('identify', () => ({ station: v.id, name: v.name, text, camp: 'station' }));
  update('stationView', () => v);
  document.querySelector('.ebb-boon')?.classList.remove('is-peek');
  cards.forEach((b, j) => b.classList.toggle('on', j === i));
  boons.forEach((b) => b.classList.remove('on'));
}
/** @param {number} i */
function showBoon(i) {
  // The card closed, so the boon's words show clear of it.
  update('identify', () => null);
  update('stationView', () => null);
  cards.forEach((b) => b.classList.remove('on'));
  update('boon', () => /** @type {any} */ (BOONS[i])[1]());
  // Its words shown, as a hover would.
  document.querySelector('.ebb-boon')?.classList.add('is-peek');
  boons.forEach((b, j) => b.classList.toggle('on', j === i));
}
/** @param {string} label @param {() => void} fn @param {HTMLButtonElement[]} list */
function button(label, fn, list) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', fn);
  bar.appendChild(b);
  list.push(b);
}
VIEWS.forEach(([label], i) => button(String(label), () => show(i), cards));
const br = document.createElement('b');
br.style.width = '100%';
bar.appendChild(br);
BOONS.forEach(([label], i) => button(String(label), () => showBoon(i), boons));
showBoon(1);
show(0);
