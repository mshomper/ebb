// @ts-check
// The Keeper book's routes (Matt, October 30, 2026; menus-plan option B). The journal keeps the island
// (Living things, Ground, Web, Almanac, Notes); the Keeper book (I, src/ui/keeper-book.js) keeps the
// keeper: Kit, Threads, Trails (with the herbarium), Shelf (with letters) and Camp. A `ui.keeper`
// action opens it on a tab; an older `ui.journal` action for a view that moved here is turned into
// one, so every link that opened those views still works. Pure.

/** The Keeper book's tabs, in order. */
export const KEEPER_TABS = /** @type {const} */ (['kit', 'threads', 'trails', 'shelf', 'camp', 'chart']);

/** @typedef {typeof KEEPER_TABS[number]} KeeperTab */

/**
 * The book's open state (store slice `keeperUi`): open, the tab shown, a page inside it (null for the
 * tab's own page; 'herbarium' under Trails; under Threads 'thread:<id>', or 'keeper:<id>' for a keeper
 * page, 'keeper:' for their list) and the trail Trails shows in a narrow window.
 * @typedef {{ open: boolean, tab: KeeperTab, page: string | null, trail: string }} KeeperUi
 */

/** @param {string} [tab] @returns {KeeperUi} */
export const keeperUi0 = (tab) => ({ open: false, tab: isTab(tab) ? /** @type {KeeperTab} */ (tab) : 'kit', page: null, trail: 'naturalist' });

/** @param {any} t @returns {boolean} */
export const isTab = (t) => KEEPER_TABS.includes(t);

/** The journal views that moved to the Keeper book, and the tab each opens. @type {Record<string, KeeperTab>} */
export const MOVED_VIEWS = { trails: 'trails', herbarium: 'trails', shelf: 'shelf', camp: 'camp', keeper: 'threads' };

/**
 * The `ui.keeper` action an older `ui.journal` action stands for, or null when its view stays in the
 * journal. @param {any} a a `ui.journal` action
 * @returns {{ type: 'ui.keeper', open?: boolean, toggle?: boolean, tab: KeeperTab, page?: string | null, trail?: string } | null}
 */
export function keeperOfJournal(a) {
  const tab = a?.view ? MOVED_VIEWS[a.view] : undefined;
  if (!tab) return null;
  /** @type {any} */ const out = { type: 'ui.keeper', tab };
  if (a.toggle) out.toggle = true; else out.open = a.open ?? true;
  out.page = a.view === 'herbarium' ? 'herbarium' : a.view === 'keeper' ? `keeper:${a.keeper ?? ''}` : null;
  if (a.trail) out.trail = a.trail;
  return out;
}

/**
 * The book's state after a `ui.keeper` action. A new tab starts on its own page unless the action
 * names one; I (toggle) shuts it or opens it where it was.
 * @param {KeeperUi} u @param {{ open?: boolean, toggle?: boolean, tab?: string, page?: string | null, trail?: string }} a
 * @returns {KeeperUi}
 */
export function nextKeeperUi(u, a) {
  const open = a.toggle ? !u.open : a.open ?? u.open;
  const tab = isTab(a.tab) ? /** @type {KeeperTab} */ (a.tab) : u.tab;
  const page = a.page !== undefined ? a.page : tab !== u.tab ? null : u.page;
  return { ...u, open, tab, page, trail: a.trail ?? u.trail };
}
