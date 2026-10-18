// @ts-check
// The journal's web of what needs what (J2a, docs 13, 15): which ground, plants and animals are on
// it, which of them you know, and which links you have seen happen. A link inks once its trigger
// has happened on the island and stays inked (a journal flag `web:<a>><b>`); the first time, the
// journal writes its note. Pure; the layout is in recipes/world/journal-web.json ("web").

import { dateText } from './observe.js';

/** The flag that marks a link inked. @param {{ a: string, b: string }} link */
export const inkFlag = (link) => `web:${link.a}>${link.b}`;

/**
 * Has a link's trigger happened?
 * @param {string} ink the link's trigger @param {import('./observe.js').Journal} journal
 * @param {any} survey groundSurvey() (or null before the island is known)
 */
export function triggered(ink, journal, survey) {
  const [kind, x, y] = ink.split(':');
  if (kind === 'grows') return !!survey && (survey.by[x]?.plants?.[y] ?? 0) > 0 && !!journal.species[y]?.ever;
  if (kind === 'seen') return !!journal.species[x]?.ever;
  if (kind === 'mossOnRock') return !!survey && survey.mossOnRock > 0;
  if (kind === 'flag') return journal.flags.includes(ink.slice(5));
  return false;
}

/**
 * Ink every link whose trigger has now happened. Links already true while the journal is new (the
 * island as you found it) ink quietly; later ones write their note.
 * @param {import('./observe.js').Journal} journal @param {any} survey
 * @param {{ web: any, words: any, state: any, hour: number }} ctx
 * @returns {{ journal: import('./observe.js').Journal, notes: import('./observe.js').Note[] }}
 */
export function inkWeb(journal, survey, ctx) {
  const fresh = ctx.web.links.filter((/** @type {any} */ l) => !journal.flags.includes(inkFlag(l)) && triggered(l.ink, journal, survey));
  if (!fresh.length) return { journal, notes: [] };
  const quiet = ctx.hour - journal.born <= ctx.words.arrivedHours;
  const date = dateText(ctx.state?.seasons, ctx.words);
  /** @type {import('./observe.js').Note[]} */
  const notes = quiet ? [] : fresh.map((/** @type {any} */ l) => ({ hour: ctx.hour, date, text: l.note, sp: l.b }));
  const flags = [...journal.flags, ...fresh.map(inkFlag)];
  const kept = notes.length ? [...notes.slice().reverse(), ...journal.notes].slice(0, ctx.words.notesKept) : journal.notes;
  return { journal: { ...journal, flags, notes: kept }, notes };
}

/**
 * The web as the page draws it: bands of named nodes, known or in pencil, and links, inked or not.
 * @param {import('./observe.js').Journal} journal @param {any} survey @param {any} web
 */
export function describeWeb(journal, survey, web) {
  const links = web.links.map((/** @type {any} */ l) => ({ a: l.a, b: l.b, inked: journal.flags.includes(inkFlag(l)) }));
  /** @param {string} id */
  const known = (id) => {
    const n = web.nodes[id];
    if (links.some((l) => l.inked && (l.a === id || l.b === id))) return true;   // a link seen names both ends
    if (n.flag) return journal.flags.includes(n.flag);
    if (journal.species[n.page]?.ever) return true;
    return !!survey && (survey.by[n.page]?.cells ?? 0) > 0;   // a ground page is known once it is on the island
  };
  const rows = web.rows.map((/** @type {any} */ r) => ({
    band: r.band,
    nodes: r.ids.map((/** @type {string} */ id) => ({ id, label: web.nodes[id].label, page: web.nodes[id].page ?? null, known: known(id) })),
  }));
  return { rows, links };
}
