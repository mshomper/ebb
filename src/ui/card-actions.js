// @ts-check
// Card actions as icons (Matt, October 22, 2026). Everything a tap card offers (Gather, Carry, Lift,
// Its page, Keep, Set down, Pitch ...) is a drawn icon in one row, 48 px each, its word shown only
// on hover or keyboard focus. Any module adds one the same way, and the card shows the ones that fit
// it now, sorted by `order`, at most six:
//
//   registerCardAction({ id: 'pitch', icon: 'pitch', label: 'Pitch the tent', order: 10, main: true,
//     when: (card) => card.slot === 'tent', action: (card) => ({ type: 'camp.pitch' }) });
//
// `card` is the store slice `identify` (what the journal's cardAt built, plus where it sits). A
// press dispatches `action(card)` through src/input/actions.js; an action may instead `open` part of
// the card itself (the frog's name field). `main` fills the one action the card is mostly for.
// An action that moves a pack kind (Gather, Take up, Set down) names it with `item`, and the button
// is that kind's item glyph with a `chip` in its corner saying where it goes (F7, October 23, 2026).
// The built-in actions are registered at the end of this file. The X on the card closes it, so
// there is no Leave button.

/**
 * @typedef {Object} CardAction
 * @property {string} id
 * @property {string} icon a name in src/ui/icons/icons.js
 * @property {string | ((card: any, words: any) => string)} label the hover word (and aria-label)
 * @property {number} order lower comes first
 * @property {boolean | ((card: any) => boolean)} [main] drawn filled: what the card is mostly for
 * @property {(card: any, words: any) => boolean} when shown on this card now
 * @property {(card: any) => any} [action] the action dispatched on a press
 * @property {string} [open] instead of an action: a part of the card it opens ('name')
 * @property {(card: any) => string} [mark] a small mark drawn in the icon's corner
 * @property {(card: any) => string | null} [item] the pack kind it moves (Gather, Take up, Set down):
 *   the button shows that kind's item glyph (src/ui/icons/item-registry.js) instead of `icon`
 * @property {'pack' | 'pile' | 'offer' | 'pot'} [chip] with an item: where it goes, as a round chip in
 *   the button's corner (src/ui/icons/items.js chipSvg)
 */

/** @type {Map<string, CardAction>} */
const ACTIONS = new Map();
/** The most a card shows in its one row. */
export const MAX_ACTIONS = 6;

/** Add (or replace) a card action. @param {CardAction} a @returns {() => void} remove it again */
export function registerCardAction(a) {
  ACTIONS.set(a.id, a);
  return () => { if (ACTIONS.get(a.id) === a) ACTIONS.delete(a.id); };
}

/**
 * The actions a card shows now, in order, at most MAX_ACTIONS.
 * @param {any} card @param {any} words recipes/world/journal.json
 * @returns {{ a: CardAction, label: string, main: boolean, mark: string, kind: string | null }[]}
 *   kind: the pack kind an item action moves (its glyph is drawn from it), else null
 */
export function actionsFor(card, words) {
  if (!card) return [];
  const out = [];
  for (const a of ACTIONS.values()) {
    let ok = false;
    try { ok = a.when(card, words); } catch { ok = false; }
    if (!ok) continue;
    out.push({ a, label: typeof a.label === 'function' ? a.label(card, words) : a.label,
      main: typeof a.main === 'function' ? a.main(card) : !!a.main, mark: a.mark?.(card) ?? '', kind: a.item?.(card) ?? null });
  }
  out.sort((p, q) => p.a.order - q.a.order || (p.a.id < q.a.id ? -1 : 1));
  return out.slice(0, MAX_ACTIONS);
}

/** A registered action by id. @param {string} id */
export const cardAction = (id) => ACTIONS.get(id) ?? null;

// --- the built-in actions (they were words on the card before October 22, 2026) ---
const C = (/** @type {any} */ w) => w?.pieces?.carry;
registerCardAction({ id: 'carry', icon: 'carry', order: 30, label: (c, w) => C(w)?.button ?? 'Carry',
  when: (c, w) => !!C(w) && !!c.canCarry && !c.carrying && !!c.piece, action: (c) => ({ type: 'pieces.carry', id: c.piece }) });
registerCardAction({ id: 'uncarry', icon: 'close', order: 30, label: (c, w) => C(w)?.cancel ?? 'Put it back',
  when: (c, w) => !!C(w) && !!c.canCarry && !!c.carrying, action: () => ({ type: 'pieces.carryCancel' }) });
registerCardAction({ id: 'liftpiece', icon: 'lift', order: 32, label: (c, w) => w?.pieces?.lift?.button ?? 'Lift',
  when: (c, w) => !!c.liftPiece && !!w?.pieces?.lift && !!c.piece, action: (c) => ({ type: 'pieces.lift', id: c.piece }) });
registerCardAction({ id: 'read', icon: 'notes', order: 20, label: (c, w) => w?.keepsakes?.read ?? 'Read',
  when: (c, w) => !!c.keepsake && !!c.letter && !!w?.keepsakes?.read, action: (c) => ({ type: 'keepsakes.read', shoreId: c.keepsake }) });
registerCardAction({ id: 'keep', icon: 'shelf', order: 21, main: true, label: (c, w) => w?.keepsakes?.keep ?? 'Keep it',
  when: (c, w) => !!c.keepsake && !!w?.keepsakes, action: (c) => ({ type: 'keepsakes.keep', id: c.keepsake }) });
registerCardAction({ id: 'leave', icon: 'release', order: 22, label: (c, w) => w?.keepsakes?.leave ?? 'Leave it',
  when: (c, w) => !!c.keepsake && !!w?.keepsakes, action: (c) => ({ type: 'keepsakes.leave', id: c.keepsake }) });
registerCardAction({ id: 'netlift', icon: 'net', order: 20, main: true, label: (c) => c.liftLabel ?? 'Lift the net',
  when: (c) => c.net !== undefined && !!c.canLift, action: (c) => ({ type: 'nets.lift', id: c.net }) });
registerCardAction({ id: 'netin', icon: 'net', order: 20, label: (c) => c.inLabel ?? 'Bring it in',
  when: (c) => c.net !== undefined && !c.canLift, action: (c) => ({ type: 'nets.bringIn', id: c.net }) });
registerCardAction({ id: 'name', icon: 'name-tag', order: 80, label: 'Give it a name', open: 'name',
  when: (c) => !!c.canName });
registerCardAction({ id: 'open', icon: 'journal', order: 90, label: 'Its page',
  when: (c) => !c.noPage && !!c.sp, action: (c) => ({ type: 'ui.journal', open: true, page: c.sp }) });
