// @ts-check
// The journal's web of what needs what (J2a, docs 13, 15): which ground, plants, small lives and
// animals are on it, which of them you know, and which links you have seen happen. A link inks once
// its trigger has happened on the island and stays inked (a journal flag `web:<a>><b>`); the first
// time, the journal writes its note. Pure; nodes and links are in recipes/world/journal-web.json
// ("web"), and the layout is the page's own (src/ui/journal-web.js), so a new species or ground
// feature is only a recipe entry.

import { dateText } from './observe.js';

/** The flag that marks a link inked. @param {{ a: string, b: string }} link */
export const inkFlag = (link) => `web:${link.a}>${link.b}`;

/**
 * How much of each thing the island holds now, by key: the Ground pages' squares (survey.by), the
 * shore zones and rock pools (survey.shore, from shore-presence.js; absent in catch-up), and the
 * strandline, which every tide band carries.
 * @param {any} survey groundSurvey(), maybe with `shore` @returns {Record<string, number>}
 */
export function presenceOf(survey) {
  /** @type {Record<string, number>} */ const p = {};
  if (!survey) return p;
  for (const [id, b] of Object.entries(survey.by ?? {})) p[id] = /** @type {any} */ (b).cells ?? 0;
  for (const [id, n] of Object.entries(survey.shore ?? {})) p[id] = /** @type {number} */ (n);
  p.strandline = p.shore ?? 0;
  return p;
}

/**
 * Has a link's trigger happened?
 * @param {string} ink the link's trigger @param {import('./observe.js').Journal} journal
 * @param {any} survey groundSurvey() (or null before the island is known)
 * @param {Record<string, number>} [present] presenceOf(survey)
 */
export function triggered(ink, journal, survey, present = presenceOf(survey)) {
  // Several triggers joined by & happen once all of them have.
  if (ink.includes('&')) return ink.split('&').every((part) => triggered(part, journal, survey, present));
  const [kind, x, y] = ink.split(':');
  if (kind === 'grows') return !!survey && (survey.by[x]?.plants?.[y] ?? 0) > 0 && !!journal.species[y]?.ever;
  if (kind === 'seen') return !!journal.species[x]?.ever;
  if (kind === 'seenOn') return !!journal.species[x]?.ever && (present[y] ?? 0) > 0;
  if (kind === 'here') return (present[x] ?? 0) > 0;
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
  const present = presenceOf(survey);
  const fresh = ctx.web.links.filter((/** @type {any} */ l) => !journal.flags.includes(inkFlag(l)) && triggered(l.ink, journal, survey, present));
  if (!fresh.length) return { journal, notes: [] };
  const quiet = ctx.hour - journal.born <= ctx.words.arrivedHours;
  const date = dateText(ctx.state?.seasons, ctx.words);
  /** @type {import('./observe.js').Note[]} */
  const notes = quiet ? [] : fresh.map((/** @type {any} */ l) => ({ hour: ctx.hour, date, text: l.note, sp: l.b, kind: 'web' }));
  const flags = [...journal.flags, ...fresh.map(inkFlag)];
  const kept = notes.length ? [...notes.slice().reverse(), ...journal.notes].slice(0, ctx.words.notesKept) : journal.notes;
  return { journal: { ...journal, flags, notes: kept }, notes };
}

/**
 * @typedef {{ id: string, label: string, kind: string, icon: string, page: string | null, known: boolean, here: boolean, found: boolean }} WebNode
 * @typedef {{ a: string, b: string, inked: boolean, note: string }} WebLink
 * @typedef {{ nodes: WebNode[], byId: Record<string, WebNode>, links: WebLink[] }} WebView
 */

/**
 * The web as the page draws it: every node, known or in pencil, and every link, inked or not.
 * @param {import('./observe.js').Journal} journal @param {any} survey @param {any} web
 * @returns {WebView}
 */
export function describeWeb(journal, survey, web) {
  const present = presenceOf(survey);
  const links = web.links.map((/** @type {any} */ l) => ({ a: l.a, b: l.b, inked: journal.flags.includes(inkFlag(l)), note: l.note }));
  /** Is it on the island now? @param {any} n */
  const here = (n) => [n.page, ...[n.on ?? []].flat()].some((k) => k && (present[k] ?? 0) > 0);
  /** @type {WebNode[]} */
  const nodes = Object.entries(web.nodes).map(([id, n]) => {
    const N = /** @type {any} */ (n);
    const found = !!(N.page && journal.species[N.page]?.ever) || (!!N.flag && journal.flags.includes(N.flag));
    const isHere = here(N);
    // A link seen names both ends.
    const known = !!N.always || found || isHere || links.some((/** @type {WebLink} */ l) => l.inked && (l.a === id || l.b === id));
    return { id, label: N.label, kind: N.kind, icon: N.icon, page: N.page ?? null, known, here: isHere, found };
  });
  return { nodes, byId: Object.fromEntries(nodes.map((n) => [n.id, n])), links };
}

/**
 * A node's ties in three groups: what it needs, what needs it, and what shares a home with it
 * (needs something it needs; always-known nodes such as you aside). Each tie says whether its link
 * is inked; a shared home is inked when both links to the home are.
 * @param {WebView} d @param {any} web @param {string} id
 * @returns {{ needs: { id: string, inked: boolean }[], neededBy: { id: string, inked: boolean }[], shares: { id: string, inked: boolean }[] }}
 */
export function tiesOf(d, web, id) {
  const needs = d.links.filter((l) => l.b === id).map((l) => ({ id: l.a, inked: l.inked }));
  const neededBy = d.links.filter((l) => l.a === id).map((l) => ({ id: l.b, inked: l.inked }));
  const near = new Set([id, ...needs.map((t) => t.id), ...neededBy.map((t) => t.id)]);
  /** @type {Map<string, boolean>} */ const shared = new Map();
  for (const n of needs) {
    if (web.nodes[n.id]?.always) continue;
    for (const l of d.links) {
      if (l.a !== n.id || near.has(l.b) || web.nodes[l.b]?.always) continue;
      shared.set(l.b, (shared.get(l.b) ?? false) || (n.inked && l.inked));
    }
  }
  const order = Object.keys(web.nodes);
  const shares = [...shared].map(([x, inked]) => ({ id: x, inked })).sort((p, q) => order.indexOf(p.id) - order.indexOf(q.id));
  return { needs, neededBy, shares };
}

/** The Web node that stands for a journal page, if any. @param {any} web @param {string | null | undefined} page */
export function nodeOfPage(web, page) {
  if (!page) return null;
  if (web.nodes[page]) return page;
  return Object.keys(web.nodes).find((id) => web.nodes[id].page === page) ?? null;
}
