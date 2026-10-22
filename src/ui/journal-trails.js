// @ts-check
// The journal's Trails page (doc 13 "Trails"): three trails, each a line of inked stops down the
// paper. The naturalist's (what you notice: a stop for each kind of find, src/world/expansion.js),
// the beachcomber's (what you keep: families and rarities kept, marks seen) and the shaper's (what
// you make: the kinds of place; src/world/trails.js). A reward reached but not built yet sits in
// pencil where it falls; only the next one ahead shows, in pencil with its hint. On a wide window
// the three sit side by side (journal.js widens the panel); otherwise three tabs show one at a time.
// Kinds may be counted ("4 of 13 families kept"), totals never. Styles: journal-trails.css.

import { iconSvg } from './icons/icons.js';
import { dateOfHour } from '../world/journal/observe.js';

/** The three trails, in order, with the key each keeps in journalUi.trail. */
export const TRAILS = /** @type {const} */ (['naturalist', 'beach', 'shape']);

/** @param {string} s */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/**
 * The page. @param {{ live: any, words: any, R: any, B: any, S: any, which: string, wide: boolean }} o
 *   live: the live journal (describe, journal, progress); words: journal.json; R, B, S: naturalist.json,
 *   beachcomber.json, shaper.json; which: the trail shown when not wide; wide: all three side by side
 * @returns {string}
 */
export function trailsView(o) {
  const P = o.live.progress;
  if (!P) return '';
  const cols = [
    { key: 'naturalist', title: o.R.line.trail, html: naturalistTrail(o) },
    { key: 'beach', title: o.B.words.title, html: keptTrail(o, P.beachLine(), o.B, 'beach') },
    { key: 'shape', title: o.S.words.title, html: keptTrail(o, P.shapeLine(), o.S, 'shape') },
  ];
  if (o.wide) {
    return `<div class="ebb-trails is-wide">${cols.map((c) => `<section class="ebb-trails__col" data-tint="${c.key}">${c.html}</section>`).join('')}</div>`;
  }
  const shown = cols.find((c) => c.key === o.which) ?? cols[0];
  const tabs = cols.map((c) => `<button type="button" class="ebb-trails__tab" data-tint="${c.key}" data-trail="${c.key}" aria-pressed="${c === shown}">${esc(short(c.title))}</button>`).join('');
  return `<div class="ebb-trails"><div class="ebb-trails__tabs" role="group" aria-label="Trails">${tabs}</div>
    <section class="ebb-trails__col" data-tint="${shown.key}">${shown.html}</section></div>`;
}

/** "The beachcomber" on a tab is "Beachcomber". @param {string} t */
const short = (t) => { const s = t.replace(/^The /, ''); return s.charAt(0).toUpperCase() + s.slice(1); };

/**
 * A trail's head: its name, what it is about, its count of kinds (always on a line of its own, so
 * the three trails' heads match), and its intro. Side by side, journal-trails.css lines these rows
 * up across the trails. @param {string} title @param {string} sub @param {string} count @param {string} intro
 */
function head(title, sub, count, intro) {
  return `<h3 class="ebb-trail__title">${esc(title)}</h3>
    <p class="ebb-trails__sub ebb-journal__voice">${esc(sub)}</p>
    <p class="ebb-trails__count">${esc(count)}</p>
    <p class="ebb-journal__voice ebb-trail__intro">${esc(intro)}</p>`;
}

/** One stop on a line. @param {string} cls @param {string} inner @param {string} [attrs] a button's data attributes */
const stop = (cls, inner, attrs) => `<li class="ebb-trail__stop${cls}">${attrs
  ? `<button type="button" class="ebb-trail__row" ${attrs}>${inner}</button>` : `<span class="ebb-trail__row">${inner}</span>`}</li>`;

/**
 * The naturalist's trail: a stop for each kind of find, in the order found, each opening its page;
 * a reward after the mark that earned it; pencil gaps to the next reward. @param {any} o
 */
function naturalistTrail(o) {
  const P = o.live.progress, R = o.R, j = o.live.journal();
  const rewards = Object.fromEntries((R.rewards ?? []).map((/** @type {any} */ r) => [r.id, r]));
  const line = P.line();
  const found = line.filter((/** @type {any} */ e) => e.type === 'mark').length;
  const rows = line.map((/** @type {any} */ e, /** @type {number} */ i) => {
    const last = i === line.length - 1 ? ' is-last' : '';
    if (e.type === 'mark') {
      const d = o.live.describe(e.id), first = j.species[e.id]?.first ?? -1;
      // Some finds name where they were found (the life under a log, L3a).
      const where = R.line.where?.[e.id] ? `<small>${esc(R.line.where[e.id])}</small>` : '';
      return stop(last, `<span class="ebb-trail__dot">${iconSvg(d.icon)}</span>
        <span class="ebb-trail__text"><b>${esc(d.name)}</b>${first >= 0 ? `<span class="ebb-journal__voice">${esc(dateOfHour(first, o.words))}</span>` : ''}${where}</span>`, `data-page="${esc(e.id)}"`);
    }
    if (e.type === 'gap') return `<li class="ebb-trail__stop is-gap${last}"><span class="ebb-trail__dot"></span></li>`;
    const r = rewards[e.id] ?? {};
    const text = e.inked ? `<b>${esc(r.title ?? '')}</b><span class="ebb-journal__voice">${esc(r.line ?? '')}</span>`
      : `<span class="ebb-journal__voice">${esc(e.hint)}</span><small>${esc(last ? R.line.next : R.line.later)}</small>`;
    return stop(` is-station${e.inked ? '' : ' is-pencil'}${last}`, `<span class="ebb-trail__dot">${iconSvg(e.icon)}</span><span class="ebb-trail__text">${text}</span>`);
  }).join('');
  return head(R.line.trail, R.line.sub, R.line.count.replace('{n}', String(found)), R.line.intro) + `<ol class="ebb-trail__list">${rows}</ol>`;
}

/**
 * The beachcomber's or the shaper's trail (src/world/trails.js trailLine).
 * @param {any} o @param {import('../world/trails.js').TrailEntry[]} line @param {any} rec beachcomber.json or shaper.json
 * @param {'beach' | 'shape'} which
 */
function keptTrail(o, line, rec, which) {
  const W = rec.words;
  const firsts = line.filter((e) => e.type === 'first');
  const n = which === 'beach'
    ? new Set(firsts.map((e) => /** @type {any} */ (e).first).filter((f) => f.kind === 'family').map((f) => f.id)).size
    : firsts.length;
  const total = which === 'beach' ? W.familyTotal : rec.stops.length;
  const rows = line.map((e, i) => {
    const last = i === line.length - 1 ? ' is-last' : '';
    if (e.type === 'first') {
      const f = e.first;
      const name = which === 'shape' ? W.places[f.id] ?? f.id
        : (W[f.kind] ?? '{name}').replace('{name}', (f.kind === 'family' ? W.families : f.kind === 'rarity' ? W.rarities : W.marks)[f.id] ?? f.id);
      const icon = which === 'shape' ? W.placeIcons?.[f.id] ?? 'shore' : W.icons?.[f.kind] ?? 'shelf';
      const when = f.hour >= 0 ? `<span class="ebb-journal__voice">${esc(dateOfHour(f.hour, o.words))}</span>` : '';
      // A keepsake first opens the Shelf; a place has nowhere to open.
      return stop(last, `<span class="ebb-trail__dot">${iconSvg(icon)}</span><span class="ebb-trail__text"><b>${esc(name)}</b>${when}</span>`,
        which === 'beach' ? 'data-view="shelf"' : undefined);
    }
    const s = e.stop;
    if (e.type === 'station' && e.inked) {
      return stop(` is-station${last}`, `<span class="ebb-trail__dot">${iconSvg(s.icon)}</span>
        <span class="ebb-trail__text"><b>${esc(s.title ?? '')}</b><span class="ebb-journal__voice">${esc(s.line ?? '')}</span></span>`);
    }
    // Reached but not built yet: what it will be, one day. Ahead: only its hint.
    const text = e.type === 'station'
      ? `<b>${esc(s.title ?? '')}</b><small>${esc(W.later)}</small>`
      : `<span class="ebb-journal__voice">${esc(s.hint)}</span><small>${esc(W.next)}</small>`;
    return stop(` is-station is-pencil${last}`, `<span class="ebb-trail__dot">${iconSvg(s.icon)}</span><span class="ebb-trail__text">${text}</span>`);
  }).join('');
  return head(W.title, W.sub, W.count.replace('{n}', String(n)).replace('{total}', String(total)), W.intro) + `<ol class="ebb-trail__list">${rows}</ol>`;
}
