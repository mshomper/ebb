// @ts-check
// Morning hints (Matt, October 28, 2026): which line, if any, the keeper offers this morning. One a
// day after the first evening, each shown once ever, and none for what the player has already done.
// Everything is read from the journal (its flags, what each page has met and learned) and the cook
// record, so it rides with the island's save as it is. Pure; words and rules from
// recipes/world/morning-hints.json. The live part is morning-live.js.

/**
 * What a test reads.
 * @typedef {{ journal: any, cook?: any, kindOf?: (sp: string) => string | undefined }} HintState
 *   kindOf: a journal species' kind (find, creature, school...), from recipes/world/journal.json
 */

/** The journal's flags. @param {HintState} s @returns {string[]} */
const flagsOf = (s) => s.journal?.flags ?? [];

/**
 * Does one way of a test hold? @param {any} w @param {HintState} s
 */
export function wayHolds(w, s) {
  const flags = flagsOf(s);
  if (w.unless && flags.includes(w.unless)) return false;
  const species = /** @type {Record<string, any>} */ (s.journal?.species ?? {});
  if (w.flag) return flags.includes(w.flag);
  if (w.prefix) return flags.some((f) => f.startsWith(w.prefix));
  if (w.ever) return w.ever.some((/** @type {string} */ sp) => !!species[sp]?.ever);
  if (w.kinds) return Object.entries(species).some(([sp, k]) => !!k?.ever && w.kinds.includes(s.kindOf?.(sp)));
  if (w.learned) return Object.values(species).some((k) => (k?.learned ?? []).includes(w.learned));
  if (w.made) return w.made.some((/** @type {string} */ m) => s.cook?.made?.[m] !== undefined);
  return false;
}

/**
 * Does the named test hold (any one of its ways)? An unknown name never holds.
 * @param {any} R recipes/world/morning-hints.json @param {string | undefined} name @param {HintState} s
 */
export function testHolds(R, name, s) {
  const ways = name ? R.tests?.[name] : null;
  return Array.isArray(ways) && ways.some((w) => wayHolds(w, s));
}

/**
 * The hints shown so far, by id, with the game day each showed: flags `hint:<id>@<day>`.
 * @param {any} R @param {string[]} flags @returns {Map<string, number>}
 */
export function shownOf(R, flags) {
  const P = R.flagPrefix ?? 'hint:';
  /** @type {Map<string, number>} */ const out = new Map();
  for (const f of flags) {
    if (!f.startsWith(P)) continue;
    const at = f.lastIndexOf('@');
    if (at > P.length) out.set(f.slice(P.length, at), Number(f.slice(at + 1)));
  }
  return out;
}

/** The flag that says a hint showed on a game day. @param {any} R @param {string} id @param {number} day */
export const shownFlag = (R, id, day) => `${R.flagPrefix ?? 'hint:'}${id}@${day}`;

/**
 * Has today had its hint already? @param {any} R @param {string[]} flags @param {number} day
 */
export function shownToday(R, flags, day) {
  for (const d of shownOf(R, flags).values()) if (d >= day) return true;
  return false;
}

/**
 * The hint to offer now, or null: of those not shown yet, not done, still within their days and with
 * their trigger holding (if they have one), the first with a trigger (it came early, because something
 * happened), else the first in order.
 * @param {any} R @param {HintState} s @param {number} ageDays the island's age in game days
 */
export function pickHint(R, s, ageDays) {
  const shown = shownOf(R, flagsOf(s));
  const open = (R.hints ?? []).filter((/** @type {any} */ h) => !shown.has(h.id)
    && !(h.withinDays !== undefined && ageDays >= h.withinDays)
    && !testHolds(R, h.done, s)
    && (!h.when || testHolds(R, h.when, s)));
  return open.find((/** @type {any} */ h) => h.when) ?? open[0] ?? null;
}

/**
 * Which species a hint's Show me rings: the first of its list known on the island (met or grown
 * here, or a sign of it), else with showMeAlways the first of the list; null when it offers none.
 * @param {any} hint @param {HintState} s @returns {string | null}
 */
export function showMeOf(hint, s) {
  const list = /** @type {string[]} */ (hint?.showMe ?? []);
  const flags = flagsOf(s), species = s.journal?.species ?? {};
  const known = list.find((sp) => species[sp]?.ever || flags.includes(`${sp}:sign`) || flags.includes(`${sp}:seen`));
  return known ?? (hint?.showMeAlways ? list[0] ?? null : null);
}
