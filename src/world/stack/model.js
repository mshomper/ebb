// @ts-check
// The stack's save section (`stack`, format 9's list, src/save/migrate-format9.js): the day the
// island counts the stack's days from, whether the land raised inside its ring was cleared, the
// causeway's risen state and where it leaves the land, whether the reveal was shown, the old lantern
// in the mouth (on the floor, lit, hung) and how far the rubble is dug. A save from before the stack
// has no section and reads as "not yet": the stack arrives on its next load. No heights are saved:
// the stack and the causeway rise from the recipe on every load. Pure.

/**
 * @typedef {Object} StackSave
 * @property {1} version
 * @property {number | null} startDay  the game day its days count from (null: not arrived yet)
 * @property {boolean} cleared          land raised inside the ring has been sunk back (once)
 * @property {boolean} risen            the causeway stands
 * @property {[number, number] | null} from  where the causeway leaves the land (m), set as it rises
 * @property {boolean} shown            its reveal has played
 * @property {'floor' | 'lit' | 'hung'} lantern  the old lantern in the mouth
 * @property {number} rubble            stretches of the rubble dug
 * @property {number | null} dugDay     the game day the last stretch was dug (one a day)
 */

/** @returns {StackSave} */
export const emptyStack = () => ({ version: 1, startDay: null, cleared: false, risen: false, from: null, shown: false, lantern: 'floor', rubble: 0, dugDay: null });

/** The section as saved, or empty when missing or unreadable. @param {any} v @returns {StackSave} */
export function cleanStack(v) {
  if (!v || typeof v !== 'object' || v.version !== 1) return emptyStack();
  const int = (/** @type {any} */ n) => (Number.isInteger(n) ? n : null);
  const from = Array.isArray(v.from) && v.from.length === 2 && v.from.every(Number.isFinite) ? /** @type {[number, number]} */ ([v.from[0], v.from[1]]) : null;
  return {
    version: 1, startDay: int(v.startDay), cleared: v.cleared === true, risen: v.risen === true && !!from, from, shown: v.shown === true,
    lantern: ['floor', 'lit', 'hung'].includes(v.lantern) ? v.lantern : 'floor',
    rubble: Number.isInteger(v.rubble) && v.rubble > 0 ? v.rubble : 0, dugDay: int(v.dugDay),
  };
}
