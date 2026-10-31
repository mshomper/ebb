// @ts-check
// The walker's kit, live (the Walker page, K1 and K4). Keeps the store slice `kit` (the save's
// section) and `kitView` for the page (src/ui/walker-page.js): what is worn in each slot, what is
// owned, the tools on the belt and whether the Hollow is found (Q and E). Owned things come from the
// world: the made carriers from the pack (P2f), the walking stick once the forager's trail gives it.
// The belt reads the camp's tools (the shovel), the forager's knife, the sketchbook and the net.
// Answers kit.wear { slot, id }: a hat, coat, lantern or what is in hand at once; a carrier only at
// camp, through the camp's own Wear (camp.wear, src/world/camp/carriers.js), so carriers behave as
// they did. Emits kit:worn { slot, id }. A hat band given (the hen's feather, giveBand) is worn at
// once on whatever hat is worn, and kept: kit:band { id }.

import { get, update, subscribe } from '../../core/store.js';
import { emitDeferred } from '../../core/events.js';
import { onAction, dispatch } from '../../input/actions.js';
import { atCamp } from '../pack/camp.js';
import { hasForage } from '../forager.js';
import { cleanKit, own, wearKit, looksOf, addBand, ALL } from './model.js';

/**
 * @param {{ recipe: any, pack: any, you: () => number[] | null }} o
 *   recipe: recipes/world/kit.json; pack: the live pack (src/world/pack/index.js); you: where you
 *   stand below, or null above
 */
export function createKit(o) {
  const R = o.recipe, W = R.words;
  update('kit', (v) => cleanKit(v));
  /** @returns {import('./model.js').Kit} */
  const kit = () => get('kit');

  /** The pack's carriers into the kit (a carrier made or worn at camp), and gifts that are kit. */
  function sync() {
    let k = kit();
    const c = o.pack?.carriers?.() ?? { made: [], worn: null };
    for (const id of c.made) k = own(k, 'carrier', id);
    if (k.carrier !== c.worn) k = { ...k, carrier: c.worn };
    if (hasForage(get('unlocks')?.earned ?? {}, 'stick')) k = own(k, 'hand', 'stick');
    if (k !== kit()) update('kit', () => k);
    publish();
  }

  /** The tools on the belt now, in the recipe's order: each owned or a blank outline. */
  function belt() {
    const earned = get('unlocks')?.earned ?? {};
    const has = {
      shovel: (get('cook')?.tools ?? []).includes('shovel'),
      knife: hasForage(earned, 'knife'),
      steel: true,
      sketchbook: (get('sketchbook')?.made ?? 0) > 0,
      net: !!get('unlocks')?.nets?.general,
      line: (get('cook')?.tools ?? []).includes('line'),
      // The old keeper's pan, taken from beside the spring's pool (src/world/spring).
      pan: (get('cook')?.tools ?? []).includes('keepers-pan'),
    };
    return R.belt.map((/** @type {any} */ t) => ({ id: t.id, owned: !!(/** @type {any} */ (has))[t.id] }));
  }

  /** Has the Hollow been found (Q and E show)? A journal flag, set when the Hollow comes. */
  const hollow = () => (get('journal')?.flags ?? []).includes(R.hollow?.flag ?? 'hollow:found');

  let shown = '';
  function publish() {
    const k = kit();
    const you = o.you();
    const view = { kit: k, belt: belt(), hollow: hollow(), atCamp: !!you && atCamp(you[0], you[2]) };
    const key = JSON.stringify(view);
    if (key === shown) return;
    shown = key;
    update('kitView', () => view);
  }

  /** @param {{ slot: string, id: string | null }} a */
  function wear(a) {
    if (!ALL.includes(/** @type {any} */ (a.slot))) return;
    const slot = /** @type {import('./model.js').Slot} */ (a.slot);
    if (slot === 'carrier') {
      const you = o.you();
      if (!you || !atCamp(you[0], you[2])) { emitDeferred('island:notice', { text: W.campOnly, showS: 5 }); return; }
      // The camp's own Wear: the pack refuses with its line when what it holds would not fit.
      dispatch({ type: 'camp.wear', id: a.id ?? 'pack' });
      return;
    }
    const r = wearKit(kit(), slot, a.id);
    if (!r.ok || r.kit[slot] === kit()[slot]) return;
    update('kit', () => r.kit);
    publish();
    emitDeferred('kit:worn', { slot, id: a.id });
  }

  const offs = [
    onAction((/** @type {any} */ a) => { if (a.type === 'kit.wear') wear(a); }),
    subscribe('pack', sync),
    subscribe('unlocks', sync),
    subscribe('cook', publish),
    subscribe('sketchbook', publish),
    subscribe('journal', publish),
  ];
  sync();

  return {
    id: 'kit',
    /** A sim system: every half second, whether you stand at camp (the carrier's pop-out says so). */
    tick: (() => { let t = 0; return (/** @type {{ realDt: number }} */ f) => { if ((t -= f.realDt) > 0) return; t = 0.5; publish(); }; })(),
    /** The kit now. */
    kit,
    /** Is the hand lantern taken along (off the pad after dark), or left on the pole (K4)? */
    lanternTaken: () => kit().lantern === 'hand',
    /** The hat's and coat's looks on the figure (K4; Phase 4 dyes): tints, or null as made. */
    looks: () => looksOf(kit(), R),
    /** Wear something (tests; the page dispatches kit.wear). @param {string} slot @param {string | null} id */
    wear: (slot, id) => wear({ slot, id }),
    /** A hat band given (the hen's feather), worn from now on. @param {string} id */
    giveBand(id) {
      const k = addBand(kit(), id);
      if (k === kit()) return;
      update('kit', () => k);
      publish();
      emitDeferred('kit:band', { id });
    },
    belt,
    dispose() { for (const off of offs) off(); },
  };
}
