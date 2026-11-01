// @ts-check
// Morning hints (Matt, October 28, 2026): which line, if any, the keeper offers this morning. One a
// day after the first evening, each shown once ever, and none for what the player has already done.
// Everything is read from the journal (its flags, what each page has met and learned) and the cook
// record, so it rides with the island's save as it is. Pure; words and rules from
// recipes/world/morning-hints.json. The live part is morning-live.js.

/**
 * What a test reads.
 * @typedef {{ journal: any, cook?: any, kindOf?: (sp: string) => string | undefined, visits?: Record<string, { last: number, x: number | null, z: number | null }>, day?: number }} HintState
 *   kindOf: a journal species' kind (find, creature, school...), from recipes/world/journal.json;
 *   visits: each seasonal visitor's last visit (the save's `shaped` section, src/world/ecology/visits.js);
 *   day: today's game day (a visit hint waits for the morning after its visit)
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
  if (w.visited) return w.visited.some((/** @type {string} */ sp) => flags.includes(`${sp}:visited`));
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
 * Is a hint's thing done? Its done test, and for a visit hint (`visit: <sp>`, doc 13 "Shaped, not
 * found") also once the visitor's home is made (`<sp>:home`) or it has come to live here.
 * @param {any} R @param {any} h @param {HintState} s
 */
export function hintDone(R, h, s) {
  if (h.visit && (flagsOf(s).includes(`${h.visit}:home`) || !!s.journal?.species?.[h.visit]?.ever)) return true;
  return h.done ? testHolds(R, h.done, s) : false;
}

/**
 * Is a hint free to show: never shown yet, or a visit hint whose visitor came again since it last
 * showed, at least visitAgainDays after that, so it repeats now and then and never nags.
 * @param {any} R @param {any} h @param {HintState} s @param {Map<string, number>} shown
 */
function fresh(R, h, s, shown) {
  if (!shown.has(h.id)) return true;
  if (!h.visit) return false;
  const last = /** @type {number} */ (shown.get(h.id)), v = s.visits?.[h.visit];
  return !!v && v.last > last && (s.day ?? 0) - last >= (h.againDays ?? R.visitAgainDays ?? 6);
}

/**
 * Does a hint's trigger hold: its `when` test, and for a visit hint a visit before today (the
 * morning after it came).
 * @param {any} R @param {any} h @param {HintState} s
 */
function triggered(R, h, s) {
  if (h.visit) {
    const v = s.visits?.[h.visit];
    if (!v || v.last >= (s.day ?? 0)) return false;
  }
  return !h.when || testHolds(R, h.when, s);
}

/**
 * The hint to offer now, or null: of those free to show (fresh), not done, still within their days
 * and with their trigger holding (if they have one), the first with a trigger (it came early, because
 * something happened), else the first in order.
 * @param {any} R @param {HintState} s @param {number} ageDays the island's age in game days
 */
export function pickHint(R, s, ageDays) {
  const shown = shownOf(R, flagsOf(s));
  const open = (R.hints ?? []).filter((/** @type {any} */ h) => fresh(R, h, s, shown)
    && !(h.withinDays !== undefined && ageDays >= h.withinDays)
    && !hintDone(R, h, s)
    && triggered(R, h, s));
  return open.find((/** @type {any} */ h) => h.when || h.visit) ?? open[0] ?? null;
}

/**
 * Where a visit hint's Show me rings: the spot its visitor last showed itself, or null.
 * @param {any} hint @param {HintState} s @returns {{ x: number, z: number } | null}
 */
export function visitAt(hint, s) {
  const v = hint?.visit ? s.visits?.[hint.visit] : null;
  return v && typeof v.x === 'number' && typeof v.z === 'number' ? { x: v.x, z: v.z } : null;
}

/**
 * Which species a hint's Show me rings: the first of its list known on the island (met or grown
 * here, a sign of it, or a visit), else with showMeAlways the first of the list; null when it
 * offers none. A visit hint rings its visitor, where it showed itself (visitAt).
 * @param {any} hint @param {HintState} s @returns {string | null}
 */
export function showMeOf(hint, s) {
  if (hint?.visit && visitAt(hint, s)) return hint.visit;
  const list = /** @type {string[]} */ (hint?.showMe ?? []);
  const flags = flagsOf(s), species = s.journal?.species ?? {};
  const known = list.find((sp) => species[sp]?.ever || flags.includes(`${sp}:sign`) || flags.includes(`${sp}:seen`) || flags.includes(`${sp}:visited`));
  return known ?? (hint?.showMeAlways ? list[0] ?? null : null);
}
