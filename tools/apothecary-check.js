// @ts-check
// tools/apothecary-check.html: the camp's workspace card (src/ui/station.js) showing sample views of
// the apothecary bench (Dry and Grind ready), the hamper with 6 and 12 slots, and the drying rack, so
// Matt can see the cards before playing to them. Reads nothing from the game; the views are made here
// in the shape src/world/camp/stations.js publishes.

import { update } from '../src/core/store.js';
import { mountStation } from '../src/ui/station.js';
import { pileWord, rackWord } from '../src/world/pack/piles.js';

const cook = await (await fetch('../recipes/world/cook.json')).json();
const pack = await (await fetch('../recipes/world/pack.json')).json();
const camp = await (await fetch('../recipes/world/camp.json')).json();
const W = cook.words;
const names = Object.fromEntries(pack.kinds.map((/** @type {any} */ k) => [k.id, k.name]));
const nameOf = (/** @type {string} */ k) => names[k] ?? k;
const pouches = [['sticks', 2], ['pebbles', 1], ['rushes.stems', 3], ['watermint.leaves', 2], ['chamomile.flowers', 1], ['shells', 3]]
  .map(([kind, h]) => ({ kind: String(kind), name: nameOf(String(kind)), handfuls: Number(h), left: Number(h) }));

/** The bench with one part laid. @param {string} kind @param {string} act */
const bench = (kind, act) => ({
  id: 'apothecary', name: W.apothecary.name, spots: camp.stations.apothecary.spots,
  laid: [{ kind, name: nameOf(kind), used: true }], outlines: [],
  action: { icon: act, label: W.acts[act], ready: true, make: act }, line: W.laid, working: false,
  pack: pouches, piles: [{ kind: 'sticks', name: 'Sticks', handfuls: 5, left: 5, word: pileWord(5, pack) }],
  store: [{ kind: 'shells', name: nameOf('shells'), handfuls: 7, left: 7, word: pileWord(7, pack) }, { kind: 'rushes.stems', name: 'Rushes', handfuls: 3, left: 3, word: pileWord(3, pack) }],
  packName: W.pack, pilesName: W.piles, storeName: W.hamper,
});
/** The hamper's card. @param {number} size @param {[string, number][]} holds */
const hamper = (size, holds) => ({ id: 'store', mode: 'store', name: W.store.name, size, emptyName: W.emptySlot, takeLabel: W.takeUp, pack: pouches, packName: W.pack, line: W.setDownHere,
  slots: holds.map(([kind, h], i) => ({ i, kind, name: nameOf(kind), word: pileWord(h, pack) })) });
const rack = () => ({ id: 'rack', mode: 'store', name: W.rack.name, size: pack.piles.rackBunches, emptyName: W.emptySlot, takeLabel: W.takeUp, pack: pouches, packName: W.pack, line: W.setDownHere,
  slots: [['watermint.leaves', 0], ['chamomile.flowers', 0.5], ['nettle.tops', 1], ['meadowsweet.flowers', 1], ['watermint.leaves', 0.2]].map(([kind, dry], i) => ({
    i, kind: String(kind), name: nameOf(String(kind)), word: rackWord(Number(dry), pack.words.rack), dried: Number(dry) >= 1 })) });

const VIEWS = [
  ['Bench: Dry', () => bench('watermint.leaves', 'dry'), W.apothecary],
  ['Bench: Grind', () => bench('shells', 'grind'), W.apothecary],
  ['Hamper, 6 slots', () => hamper(6, [['rushes.stems', 3], ['shells', 7], ['kelp', 12], ['crushed-shell', 2]]), W.store],
  ['Hamper, 12 slots', () => hamper(12, [['rushes.stems', 3], ['shells', 7], ['kelp', 12], ['crushed-shell', 2], ['clay', 9], ['wrack', 5], ['willow.withies', 4], ['sand', 12], ['reeds.down', 1]]), W.store],
  ['Drying rack', rack, W.rack],
];

mountStation(document.body, {}, camp.stations.ui);
const bar = /** @type {HTMLElement} */ (document.getElementById('bar'));
/** @param {number} i */
function show(i) {
  const [, view, words] = /** @type {[string, () => any, any]} */ (VIEWS[i]);
  const v = view();
  update('identify', () => ({ station: v.id, name: v.name, text: words.line, camp: 'station' }));
  update('stationView', () => v);
  bar.querySelectorAll('button').forEach((b, j) => b.classList.toggle('on', j === i));
}
VIEWS.forEach(([label], i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = String(label);
  b.addEventListener('click', () => show(i));
  bar.appendChild(b);
});
show(0);
