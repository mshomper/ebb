// @ts-check
// The pot's water, live (docs/future/13 section 4.1 K-26 and K-28; S5): any pot on the hearth can be
// taken up in both arms from its card. While it is held the pouch row dims, Gather says your arms are
// full, and Feed, Net and Dig are not offered (pack.holding 'pot'). Fill the pot on the here-bar at
// running or slow fresh water (the spring, its stream, a rill led past camp) or at the sea; still
// water only says so. Set down anywhere on the camp ground puts it back on the hearth stones, water
// and all; off the pad the pot's card offers only Pour out. Going up or resting puts it back too.
//
// Two lines teach the rill (K-28): a hint once the walker has carried a full pot from water far from
// the pad three times, and a line the first time the pot fills near the pad, each with its shown-once
// flag in journal.flags. The carries are counted in the camp section (`carries`). Rules: pots.js.

import { emit, emitDeferred, on } from '../../core/events.js';
import { get, update } from '../../core/store.js';
import { onAction } from '../../input/actions.js';
import { offerHere, withdrawHere } from '../../ui/ground-here.js';
import { registerCardAction } from '../../ui/card-actions.js';
import { onPad } from './layout.js';
import { potOnHearth, waterIn, setWater, waterHere } from './pots.js';
import { WATER_CLASS, BASIN_SOURCE } from '../water/summary.js';
import { waterCellOf, WATER_CELL } from '../water/grid.js';

/**
 * @param {import('./cards.js').CampKit & { o: any, change: (fn: (c: import('./model.js').Camp) => import('./model.js').Camp) => void }} k
 *   o.pack: the pack (holding, hold); o.water: the water (getSummary); o.pack.recipe: pack.json (pot, rill, words.pot)
 */
export function createCarry(k) {
  const o = k.o, P = o.pack?.recipe ?? {}, PW = P.words?.pot ?? {}, RILL = P.rill ?? { hintAfterCarries: 3, farM: 15, nearPadM: 6 };
  const CW = k.cookWords ?? {};
  const fillW = { cellOf: waterCellOf, cellM: WATER_CELL, fresh: (P.pot?.fillClasses ?? ['running', 'slow']).map((/** @type {string} */ n) => /** @type {any} */ (WATER_CLASS)[n]),
    sea: WATER_CLASS.sea, still: WATER_CLASS.still, spring: BASIN_SOURCE.spring, seaFill: P.pot?.seaFill !== false };
  const reachM = k.R.hearth.fillReachM ?? 1.2;

  const held = () => o.pack?.holding?.() === 'pot';
  const kind = () => potOnHearth(k.camp());
  /** Where the hearth is. */
  const hearthAt = () => k.where.slotAt('ring');
  /** The walker's feet, below. */
  const you = () => (k.walk.below ? k.walk.you() : null);
  /** How far a point lies outside the pad's edge (0 on it). @param {number} x @param {number} z */
  const fromPad = (x, z) => { const p = k.where.padNow(); return p ? Math.max(0, Math.hypot(x - p.x, z - p.z) - p.r) : Infinity; };
  const flags = () => /** @type {string[]} */ (get('journal')?.flags ?? []);
  /** A shown-once flag set. @param {string} f */
  const flag = (f) => update('journal', (j) => (j && !j.flags?.includes(f) ? { ...j, flags: [...(j.flags ?? []), f] } : j));
  /** Filled far from the pad (K-28 counts carries home from there); live only. */
  let farFill = false;

  /** The water here, below, for Fill. */
  function here() {
    const y = you(), s = o.water?.getSummary?.();
    return y && s ? waterHere(s, y[0], y[2], reachM, fillW) : null;
  }

  function takeUp() {
    const pot = kind(), r = hearthAt();
    if (!pot || !r || held()) return;
    k.walk.kneelToward(r.x, r.z, 1.2, 'takeUp');
    o.pack?.hold('pot');
    k.walk.hold?.(true);
    farFill = false;
    emitDeferred('pot:taken', { pot });
    if (get('identify')?.camp === 'pot') update('identify', () => null);
  }

  /** The pot back on the hearth stones as it is, water and all. @param {boolean} [counted] a carry home */
  function setDown(counted = false) {
    if (!held()) return;
    const pot = kind(), r = hearthAt();
    o.pack?.hold(null);
    k.walk.hold?.(false);
    if (r && k.walk.below) k.walk.gesture('setDown', r);
    // A full pot of spring water carried home from far off (K-28): after three, the rill hint, once.
    if (counted && pot && farFill && waterIn(k.camp(), pot) === 'fresh') {
      k.change((c) => ({ ...c, carries: (Number.isInteger(/** @type {any} */ (c).carries) ? /** @type {any} */ (c).carries : 0) + 1 }));
      const n = /** @type {any} */ (k.camp()).carries ?? 0;
      if (n >= RILL.hintAfterCarries && !flags().includes('hint:rill')) {
        flag('hint:rill');
        emit('intro:hint', { id: 'rill', text: P.words?.rillHint ?? '', skip: null });
        setTimeout(() => emit('intro:hint', { id: 'rill', text: null, skip: null }), (k.R.hearth.hintS ?? 14) * 1000);
      }
    }
    farFill = false;
    emitDeferred('pot:set-down', { pot });
  }

  function fill() {
    const pot = kind(), y = you(), w = here();
    if (!held() || !pot || !y || (w !== 'fresh' && w !== 'sea')) return;
    k.walk.gesture('gather');
    k.change((c) => setWater(c, pot, w));
    emit('camp:sound', { name: 'fill' });
    const d = fromPad(y[0], y[2]);
    farFill = d > RILL.farM;
    // The first fill from spring water beside the camp (K-28): its line, once.
    if (w === 'fresh' && d <= RILL.nearPadM && !flags().includes('camp:rill')) {
      flag('camp:rill');
      emit('island:notice', { text: P.words?.rillNote ?? '', showS: 8 });
    }
    emitDeferred('pot:filled', { pot, water: w });
  }

  function pour() {
    const pot = kind();
    if (!held() || !pot || !waterIn(k.camp(), pot)) return;
    k.walk.gesture('empty');
    k.change((c) => setWater(c, pot, null));
    emitDeferred('pot:poured', { pot });
  }

  /** The held pot's card (the pot tile at the start of the pouch row). */
  function card() {
    const pot = kind(), y = you();
    if (!held() || !pot) return null;
    const pad = k.where.padNow(), onIt = !!y && onPad(pad, y[0], y[2]), w = waterIn(k.camp(), pot);
    const line = [CW.potWater?.[w ?? 'none'] ?? '', onIt ? '' : PW.away ?? ''].filter(Boolean).join(' ');
    return { sp: 'camp:pot-held', camp: 'potHeld', pot, name: CW.pieceNames?.[pot] ?? pot, icon: 'takeup', text: line, noPage: true, stage: -1, r: 0,
      onPad: onIt, hasWater: !!w, campPage: true, at: performance.now() };
  }

  let stillSaid = false, hereT = 0, armsOn = false;
  const offs = [
    onAction((/** @type {any} */ a) => {
      if (a.type === 'pot.takeUp') takeUp();
      else if (a.type === 'pot.fill') fill();
      else if (a.type === 'pot.setDown') { const y = you(); if (y && onPad(k.where.padNow(), y[0], y[2])) setDown(true); }
      else if (a.type === 'pot.pour') pour();
      else if (a.type === 'pot.card') { const c = card(); if (c) update('identify', () => ({ ...c, x: a.x, y: a.y })); }
    }),
    // Going up, or resting, puts the pot back on the hearth as it is.
    on('walk:went-up', () => setDown()),
    on('rest:begin', () => setDown()),
    registerCardAction({ id: 'pottakeup', icon: 'takeup', order: 4, main: true, label: PW.takeUp ?? 'Take up',
      when: (c) => c?.camp === 'pot' && !!c.onHearth && !held(), action: () => ({ type: 'pot.takeUp' }) }),
    registerCardAction({ id: 'potsetdown', icon: 'setdown', order: 5, main: true, label: CW.potSetDown ?? 'Set down',
      when: (c) => c?.camp === 'potHeld' && !!c.onPad, action: () => ({ type: 'pot.setDown' }) }),
    registerCardAction({ id: 'potpour', icon: 'pour', order: 6, label: PW.pour ?? 'Pour out',
      when: (c) => c?.camp === 'potHeld' && !!c.hasWater, action: () => ({ type: 'pot.pour' }) }),
  ];

  /** Each frame: the here-bar's Fill and Set down while you hold the pot. @param {number} dt */
  function update_(dt) {
    if ((hereT -= dt) > 0) return;
    hereT = 0.25;
    // A save that opens with the pot in your arms (or a test page): the hands come to it.
    if (held() !== armsOn) { armsOn = held(); k.walk.hold?.(armsOn); }
    const y = you(), h = held() && !!y && !k.player.playing();
    const w = h ? here() : null;
    if (h && (w === 'fresh' || w === 'sea')) offerHere({ id: 'potfill', icon: 'water', label: PW.fill ?? 'Fill the pot', order: 9, action: { type: 'pot.fill' } });
    else withdrawHere('potfill');
    // Still water, and nothing fresh within reach: its line, once each time you come to it.
    if (h && w === 'still') { if (!stillSaid) { stillSaid = true; emit('island:notice', { text: PW.still ?? '', showS: 6 }); } } else stillSaid = false;
    if (h && y && onPad(k.where.padNow(), y[0], y[2])) offerHere({ id: 'potdown', icon: 'setdown', label: CW.potSetDown ?? 'Set down', order: 9, action: { type: 'pot.setDown' } });
    else withdrawHere('potdown');
    // The held pot's tile in the pouch row reads this.
    const pot = held() ? kind() : null, water = pot ? waterIn(k.camp(), pot) : null, key = `${pot}|${water}`;
    if (get('potHeld')?.key !== key) update('potHeld', () => (pot ? { key, pot, water } : { key, pot: null, water: null }));
  }

  return {
    update: update_,
    held,
    /** Tests and the test links. */
    debug: { takeUp, setDown, fill, pour, here, card },
    dispose() { for (const off of offs) off(); withdrawHere('potfill'); withdrawHere('potdown'); },
  };
}
