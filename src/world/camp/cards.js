// @ts-check
// The camp's cards, their action icons and the here-bar (docs/future/13 sections 3.3 and 3.5): the
// tent and the fire ring, or their ground before they are set up. One click walks you there and
// opens the card (src/ui/card-actions.js); the here-bar offers Light at the laid ring, Feed at a
// burning one and Rest on the camp ground after dark (src/ui/ground-here.js). Reads the camp through
// the kit index.js builds; the presses go out as camp.* actions, which index.js answers.

import { registerCardAction } from '../../ui/card-actions.js';
import { offerHere, withdrawHere } from '../../ui/ground-here.js';
import { onPad } from './layout.js';
import { pitched, ringLaid } from './model.js';
import { fireAt } from './fire.js';

/**
 * @typedef {Object} CampKit  what the cards read (built in index.js)
 * @property {any} R recipes/world/camp.json
 * @property {any} walk
 * @property {() => import('./model.js').Camp} camp
 * @property {import('./where.js').Where} where
 * @property {import('./player.js').ActPlayer} player
 * @property {() => number} hourNow
 * @property {(need: Record<string, number>) => boolean} holds
 * @property {() => Record<string, number>} ringNeed
 * @property {() => boolean} hasFuel
 * @property {() => boolean} nightNow
 * @property {() => boolean} restAllowed
 * @property {(beat: 'dusk' | 'rest') => boolean} beatAllows
 * @property {() => { rain: number }} weatherNow
 * @property {(p: { x: number, z: number } | null, m: number) => boolean} near
 */

/** The camp's card actions, registered once. @param {any} W camp.json words @returns {(() => void)[]} */
export function registerCampCards(W) {
  const C = (/** @type {any} */ c) => c?.camp;
  return [
    registerCardAction({ id: 'camppitch', icon: 'pitch', order: 5, main: true, label: W.pitch,
      when: (c) => C(c) === 'tentSlot', action: () => ({ type: 'camp.pitch' }) }),
    registerCardAction({ id: 'camplay', icon: 'lay', order: 5, main: true, label: W.lay,
      when: (c) => C(c) === 'ringSlot' && !!c.canLay, action: () => ({ type: 'camp.lay' }) }),
    registerCardAction({ id: 'camplight', icon: 'fire', order: 6, main: true, label: W.light,
      when: (c) => C(c) === 'ring' && !!c.canLight, action: () => ({ type: 'camp.light' }) }),
    registerCardAction({ id: 'campfeed', icon: 'fire', order: 6, main: true, label: W.feed,
      when: (c) => C(c) === 'ring' && !!c.canFeed, action: () => ({ type: 'camp.feed' }) }),
    registerCardAction({ id: 'camprest', icon: 'rest', order: 6, main: true, label: W.rest,
      when: (c) => C(c) === 'tent' && !!c.canRest, action: () => ({ type: 'camp.rest' }) }),
    // Every card ties into the journal: the tent's into the keeper's first page, the stations' and
    // the benches' into the camp page (S1, src/ui/journal-camp.js).
    registerCardAction({ id: 'camppage', icon: 'journal', order: 90, label: 'The first page',
      when: (c) => !!C(c) && !c.station && C(c) !== 'benchSlot', action: () => ({ type: 'ui.journal', open: true, view: 'keeper', keeper: 'first', page: null }) }),
    registerCardAction({ id: 'campmadepage', icon: 'journal', order: 90, label: 'The camp page',
      when: (c) => !!c?.station || C(c) === 'benchSlot', action: () => ({ type: 'ui.journal', open: true, view: 'camp', page: null }) }),
  ];
}

/**
 * The card a click at a ground point opens, if it lands on the camp's tent or ring (or their
 * glowing ground). The journal's cardAt asks this before the pieces.
 * @param {CampKit} k @param {number} x @param {number} z
 */
export function campCardAt(k, x, z) {
  const W = k.R.words, F = k.R.fire;
  const c = k.camp(), t = k.where.slotAt('tent'), r = k.where.slotAt('ring');
  const base = { noPage: true, stage: -1, sub: null, canCarry: false };
  if (t && k.where.inTent(x, z, 0.25)) {
    const rest = k.nightNow() && k.restAllowed();
    if (pitched(c)) return { ...base, sp: 'camp:tent', camp: 'tent', name: W.tent.name, icon: 'rest', text: rest ? W.tent.line : W.restDay, wx: t.x, wz: t.z, r: 1.1, canRest: rest };
    if (c.kit.tent === 'pack') return { ...base, sp: 'camp:tent-slot', camp: 'tentSlot', name: W.tentSlot.name, icon: 'pitch', text: W.tentSlot.line, wx: t.x, wz: t.z, r: 1.0 };
  }
  if (r && pitched(c) && Math.hypot(x - r.x, z - r.z) < 0.8) {
    if (!ringLaid(c)) {
      const canLay = k.holds(k.ringNeed());
      return { ...base, sp: 'camp:ring-slot', camp: 'ringSlot', name: W.ringSlot.name, icon: 'lay', text: canLay ? W.ringSlot.line : W.ringNeeds, wx: r.x, wz: r.z, r: 0.5, canLay };
    }
    const at = fireAt(c.fire, k.hourNow(), F), word = at.word, rainy = k.weatherNow().rain > F.rainLow;
    const line = word === 'lit' ? (rainy ? W.ring.low : at.high ? W.ring.high : W.ring.lowFlames) : W.ring[word] ?? W.ring.laid;
    const fuel = k.hasFuel();
    // The laid ring is the fire station (S1): its card opens as a workspace (stations.js).
    return { ...base, sp: 'camp:ring', camp: 'ring', station: 'fire', name: W.ring.name, icon: 'fire', text: line, wx: r.x, wz: r.z, r: 0.5,
      canLight: (word === 'laid' || (word === 'cold' && fuel)) && k.beatAllows('dusk'), canFeed: (word === 'embers' || word === 'lit') && fuel };
  }
  return null;
}

/**
 * The here-bar: Light at the laid ring, Feed at a burning one, Rest at the flap after dark.
 * @param {CampKit} k @param {import('./model.js').Camp} c @param {import('./fire.js').FireWord} word
 */
export function campHere(k, c, word) {
  const R = k.R, W = R.words;
  const r = k.where.slotAt('ring'), f = k.where.flapAt();
  const idle = !k.player.playing();
  const atRing = ringLaid(c) && k.near(r, R.reach.ringM) && idle;
  const fuel = k.hasFuel();
  if (atRing && (word === 'laid' || (word === 'cold' && fuel)) && k.beatAllows('dusk')) offerHere({ id: 'camplight', icon: 'fire', label: W.light, order: 10, action: { type: 'camp.light' } });
  else withdrawHere('camplight');
  if (atRing && (word === 'embers' || word === 'lit') && fuel) offerHere({ id: 'campfeed', icon: 'fire', label: W.feed, order: 11, action: { type: 'camp.feed' } });
  else withdrawHere('campfeed');
  // Rest: anywhere on the camp ground after dark (pressing it walks you to the flap first).
  const you = k.walk.below ? k.walk.you() : null, padHere = k.where.padNow();
  const onCamp = !!you && !!padHere && (onPad(padHere, you[0], you[2]) || k.near(f, R.reach.flapM));
  if (pitched(c) && onCamp && idle && k.nightNow() && k.restAllowed()) offerHere({ id: 'camprest', icon: 'rest', label: W.rest, order: 12, action: { type: 'camp.rest' } });
  else withdrawHere('camprest');
}
