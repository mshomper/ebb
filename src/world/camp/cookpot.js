// @ts-check
// The cooking pot, live, for the walker's meal (docs/future/15 slice 4): a click on the cooking pot on
// the hearth opens its workspace (the stations' card, src/ui/station.js) with two spots: an egg from
// the pack, and a pinch of salt if there is some. Cook wants the pot full of spring water on the
// hearth over a lit fire. Cook: the egg, the salt and the water are taken, the walker kneels to watch
// it boil (cook.json meal.cookS), then sits by the fire and eats (meal.eatS), and the meal's boon
// begins (boons.js; one at a time, as the teas'). The shells go into the pack (meal.gives) for the
// mortar's eggshell grit. The first meal is a camp-page first (cook made 'meal') and a journal line
// (`meal:eaten`). With salt it is the good breakfast; without, a plain boiled egg. Only the walker
// eats: nothing here is ever offered to a creature. Publishes `stationView` while its card is open.

import { emit, emitDeferred } from '../../core/events.js';
import { get, update, subscribe } from '../../core/store.js';
import { onAction } from '../../input/actions.js';
import { potOnHearth, pieceOf, setWater } from './pots.js';
import { inSlot } from './model.js';
import { fireAt } from './fire.js';
import { cleanCook, recordMade } from './making.js';
import { pileWord } from '../pack/piles.js';

/**
 * What a meal laid makes: its line's word, or null without an egg. Pure.
 * @param {string[]} laid the kinds on the spots @param {any} ML cook.json meal
 * @returns {{ salted: boolean } | null}
 */
export function mealOf(laid, ML) {
  if (!ML.parts.every((/** @type {string} */ p) => laid.includes(p))) return null;
  return { salted: laid.includes(ML.salt) };
}

/**
 * @param {import('./cards.js').CampKit & { o: any, cook: any, keeps: import('./keeps.js').Keeps, change: (fn: (c: import('./model.js').Camp) => import('./model.js').Camp) => void,
 *   frame: { steep: (on: boolean) => void }, boons: { drink: (id: string) => void } }} k
 */
export function createCookpot(k) {
  const C = k.cook, W = C.words ?? {}, T = W.cookpot ?? {}, ML = C.meal, R = k.R, F = R.fire;
  const o = k.o, P = o.pack?.recipe ?? {}, keeps = k.keeps;
  const spots = 2;
  /** The card open, and what is laid on it. @type {{ laid: string[], line: string | null } | null} */
  let open = null;
  /** The meal under way: boiling (its seconds), then eating. @type {{ phase: 'boil' | 'eat', t: number, salted: boolean } | null} */
  let cooking = null;

  const kinds = () => [...ML.parts, ML.salt];
  const usable = (/** @type {string} */ kind) => kinds().includes(kind);
  const nameOf = (/** @type {string} */ kind) => o.pack?.nameOf?.(kind) ?? kind;
  /** Where you kneel to cook: at the ring, as for the fire. */
  const at = () => { const r = k.where.slotAt('ring'); return r ? { x: r.x, z: r.z, stand: { x: r.x, z: r.z }, reachM: R.reach.ringM } : null; };
  const cookPotOn = () => { const c = k.camp(); return !!ML && !!inSlot(c, 'hearth') && potOnHearth(c) === 'cooking-pot'; };

  const packHas = () => {
    /** @type {Record<string, number>} */ const n = {};
    for (const [kind, h] of /** @type {[string, number][]} */ (get('pack')?.pouches ?? [])) if (usable(kind)) n[kind] = (n[kind] ?? 0) + h;
    return n;
  };
  /** Salt waits in the hamper too (the egg only in the pack). */
  const hamperHas = () => Object.fromEntries(Object.entries(keeps.hamper.holds()).filter(([kind]) => kind === ML.salt));
  /** Handfuls of a laid kind to hand, less what is laid. @param {string} kind */
  const left = (kind) => (packHas()[kind] ?? 0) + (hamperHas()[kind] ?? 0) - (open?.laid.filter((x) => x === kind).length ?? 0);
  /** Take one: the pack, then the hamper. @param {string} kind */
  const takeOne = (kind) => (o.pack?.take(kind, 1) ?? 0) > 0 || keeps.hamper.take(kind, 1) > 0;

  /** Why Cook cannot go now (its line), or null. */
  function why() {
    const c = k.camp(), water = pieceOf(c, 'cooking-pot')?.water ?? null;
    if (!open?.laid.some((x) => ML.parts.includes(x))) return T.noEgg ?? null;
    if (!water) return T.noWater ?? null;
    if (water !== 'fresh') return T.sea ?? null;
    if (fireAt(c.fire, k.hourNow(), F).word !== 'lit') return T.noFire ?? null;
    return null;
  }

  /** What the workspace draws now (the store slice `stationView`). */
  function view() {
    if (!open) return null;
    const stop = cooking ? null : why();
    const row = (/** @type {Record<string, number>} */ n, /** @type {(kind: string, h: number) => string} */ word) => Object.entries(n).map(([kind, h]) => ({ kind, name: nameOf(kind), handfuls: h, left: Math.max(0, Math.min(h, left(kind))), word: word(kind, h) }));
    const pack = packHas();
    return {
      id: 'cookpot', name: T.name ?? 'Cooking pot', spots,
      laid: open.laid.map((kind) => ({ kind, name: nameOf(kind), used: true })), outlines: [],
      action: { icon: 'cook', label: T.cook ?? 'Cook', ready: !cooking && !stop, make: 'cook' },
      line: cooking ? T.cooking ?? null : open.line ?? (open.laid.length ? stop : (pack[ML.parts[0]] ? T.laid : T.noEggs)) ?? null, working: !!cooking,
      pack: row(pack, () => ''), piles: [], store: row(hamperHas(), (_, h) => pileWord(h, P)), bench: [],
      packName: W.pack, pilesName: '', storeName: W.hamper, at: at(),
    };
  }
  let viewKey = '';
  function publish() {
    if (!open) return;
    const v = view(), key = JSON.stringify(v);
    if (key === viewKey) return;
    viewKey = key;
    update('stationView', () => v);
  }
  function close() {
    open = null;
    viewKey = '';
    update('stationView', () => null);
  }

  function lay(/** @type {string} */ kind) {
    if (!open || cooking || !usable(kind)) return;
    if (open.laid.length >= spots || open.laid.includes(kind)) { open.line = W.spotsFull ?? null; publish(); return; }
    if (left(kind) <= 0) return;
    open.laid = [...open.laid, kind];
    open.line = null;
    o.walk.gesture('setDown', at() ?? undefined);
    publish();
  }
  function unlay(/** @type {number} */ i) {
    if (!open || cooking || !open.laid[i]) return;
    open.laid = open.laid.filter((_, j) => j !== i);
    open.line = null;
    o.walk.gesture('takeUp', at() ?? undefined);
    publish();
  }

  /** Cook: the egg, the salt and the water taken; you kneel and watch it boil. */
  function act() {
    if (!open || cooking) return;
    const stop = why(), meal = mealOf(open.laid, ML);
    if (stop || !meal) { open.line = stop; publish(); return; }
    if (open.laid.some((kind) => left(kind) < 0)) { open.line = T.noEggs ?? null; publish(); return; }
    for (const kind of open.laid) takeOne(kind);
    k.change((c) => setWater(c, 'cooking-pot', null));
    const a = at();
    if (a) o.walk.kneelToward(a.x, a.z, ML.cookS, 'steep');
    k.frame.steep(true);
    cooking = { phase: 'boil', t: 0, salted: meal.salted };
    publish();
  }

  /** Boiled: the card closes, you sit by the fire and eat. */
  function serve() {
    if (!cooking) return;
    k.frame.steep(false);
    if (open) open.laid = [];
    if (get('identify')?.station === 'cookpot') update('identify', () => null);
    const a = at();
    if (a) { o.walk.faceToward?.(a.x, a.z); o.walk.posture?.('sit'); o.walk.gesture?.('sip'); }
    cooking = { ...cooking, phase: 'eat', t: 0 };
  }

  /** Eaten: the boon begins, the shells go in the pack, and its line said (the first meal written down). */
  function eaten() {
    if (!cooking) return;
    const salted = cooking.salted, hour = k.hourNow();
    cooking = null;
    // Up again from the sit.
    if (o.walk.presenceNow?.()?.posture === 'sit') o.walk.posture?.('sit');
    k.boons.drink(ML.boon);
    const first = cleanCook(get('cook')).made.meal === undefined;
    update('cook', (s) => recordMade(cleanCook(s), 'meal', hour));
    // Into the pack; with no room, a heap at your feet.
    const put = o.pack?.add?.(ML.gives, 1);
    if (put && !put.added) o.pack.heapHere?.(ML.gives, 1);
    emit('island:notice', { text: [salted ? T.salted : T.plain, T.shells].filter(Boolean).join(' '), showS: 7 });
    emitDeferred('meal:eaten', { salted, first, hour, text: T.first });
  }

  const offs = [
    // The cooking pot's card opens its workspace; any other card (or none) closes it.
    subscribe('identify', (/** @type {any} */ c) => {
      if (c?.station !== 'cookpot') { if (open) close(); return; }
      if (!open) open = { laid: [], line: null };
      viewKey = '';
      publish();
    }),
    subscribe('pack', () => publish()),
    subscribe('camp', () => publish()),
    onAction((/** @type {any} */ a) => {
      if (!open) return;
      if (a.type === 'station.lay') lay(a.kind);
      else if (a.type === 'station.unlay') unlay(a.i);
      else if (a.type === 'station.act') act();
    }),
  ];

  return {
    /** Is the cooking pot on the hearth (its card opens the workspace)? */
    cookPotOn,
    /** Each frame: the boil and the meal run on; walking away closes the card. @param {number} dt */
    update(dt) {
      if (cooking) {
        cooking.t += dt;
        if (cooking.phase === 'boil' && cooking.t >= ML.cookS) serve();
        else if (cooking.phase === 'eat' && cooking.t >= ML.eatS) eaten();
      }
      if (!open) return;
      if (!cookPotOn() && !cooking) { update('identify', () => null); return; }
      const a = at();
      if (a && !cooking && o.walk.distTo(a.stand.x, a.stand.z) > a.reachM + (R.stations?.awayM ?? 1.2) && !k.player.busy()) update('identify', () => null);
    },
    /** Eating by the fire. */
    eating: () => cooking?.phase === 'eat',
    view,
    /** Tests and the test links. */
    debug: { lay, unlay, act, serve, eaten, open: () => open, cooking: () => cooking },
    dispose() { for (const off of offs) off(); },
  };
}
