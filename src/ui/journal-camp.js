// @ts-check
// The camp page (docs/future/13 C-41, 6.5; S1): a drawn page of the camp as it is now, seen from
// above, and the firsts in the walker's hand: each thing the first time it was made or built, what it
// was made of (drawn as the parts' glyphs) and the date. Nothing lists what is still unfound. A row
// at the top of Notes leads to it once the ring is laid. Pure string building from the camp and
// cook sections (src/world/camp/model.js, making.js), the pad's slot list and recipes/world/cook.json.
// B1 C1: each gift laid on the gift stone, with the creature that left it and the date, and what
// grows in the herb bed (the store slice `campBed`, src/world/camp/gift-stone.js).

import { iconSvg } from './icons/icons.js';
import { itemIconSvg } from './icons/items.js';
import { itemIconFor } from './icons/item-registry.js';
import { dateOfHour } from '../world/journal/observe.js';
import { partKinds, buildKinds } from '../world/camp/making.js';
import { cleanTeaNotes } from '../world/camp/brew.js';
import { slotPlaced } from '../world/camp/layout.js';

/** @param {string} s */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/**
 * The firsts, oldest first: the ring from its slot, then every build and make from the cook section.
 * @param {any} C recipes/world/cook.json @param {any} camp the camp section @param {any} cook the cook section
 * @returns {{ id: string, hour: number, parts: string[] }[]}
 */
export function campFirsts(C, camp, cook) {
  const out = [];
  const ring = (camp?.slots ?? []).find((/** @type {any} */ s) => s.slot === 'ring');
  if (ring) out.push({ id: 'ring', hour: ring.placedHour ?? 0, parts: ['sticks', 'pebbles'] });
  for (const [id, hour] of Object.entries(cook?.made ?? {})) {
    const b = C.builds?.[id], m = C.makes?.[id];
    // The walker's meal (docs/future/15 slice 4) is no station make: its parts are the meal's own.
    const parts = b ? buildKinds(b) : m ? m.parts.map((/** @type {any} */ p) => partKinds(p)[0]) : id === 'meal' && C.meal ? C.meal.parts : [];
    out.push({ id, hour: Number(hour), parts });
  }
  return out.sort((a, b) => a.hour - b.hour);
}

/** Is there anything for the camp page yet? @param {any} camp @param {any} cook */
export const campPageHad = (camp, cook) => (camp?.slots ?? []).some((/** @type {any} */ s) => s.slot === 'ring') || Object.keys(cook?.made ?? {}).length > 0;

/** The row at the top of Notes that leads to the camp page, or '' before the ring. @param {any} C @param {any} camp @param {any} cook */
export function campEntry(C, camp, cook) {
  if (!C || !campPageHad(camp, cook)) return '';
  const P = C.words.page;
  return `<button type="button" class="ebb-nat-entry" data-view="camp">
    <span class="ebb-nat-entry__icon">${iconSvg('make')}</span>
    <span class="ebb-jlist__text"><b>${esc(P.entry)}</b><span class="ebb-journal__voice">${esc(P.entryLine)}</span></span>
    ${iconSvg('chevron', 'ebb-nat-entry__chev')}</button>`;
}

/**
 * The camp seen from above, as it is now: the pad, and each slot that holds something. Hovering a
 * piece (or tabbing to it) names it: a spot over the sketch for each, its label drawn above the
 * sketch so no other piece hides it.
 * @param {any} pad the live pad (layout.js) @param {any} camp the camp section
 * @param {Record<string, string>} [names] cook.json words.page.sketchNames, by slot id
 */
function campSketch(pad, camp, names = {}) {
  const slots = pad?.camp?.slots ?? [];
  const R = pad?.r ?? 4, S = 22, w = (2 * R) * S + 20;
  // u to the right (seaward), v up the page.
  const at = (/** @type {any} */ s) => [(s.u + R) * S + 10, (R - s.v) * S + 10];
  const has = (/** @type {string} */ id) => (camp?.slots ?? []).some((/** @type {any} */ q) => q.slot === id);
  const parts = [], spots = [];
  /** A hover spot over a piece, hw by hh half across (sketch units, never too small to find). */
  const spot = (/** @type {string} */ id, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ hw, /** @type {number} */ hh) => {
    const name = names[id];
    if (!name) return;
    const sw = Math.max(hw, 7), sh = Math.max(hh, 7), pc = (/** @type {number} */ n) => `${((n / w) * 100).toFixed(2)}%`;
    const side = x < w / 3 ? ' is-l' : x > (2 * w) / 3 ? ' is-r' : '';
    spots.push(`<span class="ebb-camppage__spot${side}" tabindex="0" aria-label="${esc(name)}" style="left:${pc(x - sw)};top:${pc(y - sh)};width:${pc(2 * sw)};height:${pc(2 * sh)}"><span class="ebb-camppage__tip">${esc(name)}</span></span>`);
  };
  for (const s0 of slots) {
    const s = slotPlaced(s0, (camp?.slots ?? []).find((/** @type {any} */ q) => q.slot === s0.id));
    const [x, y] = at(s);
    if (s.id === 'tent' && has('tent')) {
      parts.push(`<rect x="${x - (s.w / 2) * S}" y="${y - (s.d / 2) * S}" width="${s.w * S}" height="${s.d * S}" rx="4" class="cp-tent"/>`);
      spot(s.id, x, y, (s.w / 2) * S, (s.d / 2) * S);
    } else if (s.id === 'ring' && has('ring')) {
      parts.push(`<circle cx="${x}" cy="${y}" r="${s.r * S}" class="cp-ring"/>`);
      spot(s.id, x, y, s.r * S, s.r * S);
    } else if (s.faces && has(s.id)) {
      const f = slots.find((/** @type {any} */ q) => q.id === s.faces);
      const deg = f ? Math.atan2(-(f.v - s.v), f.u - s.u) * 180 / Math.PI + 90 : 0;
      parts.push(`<rect x="${x - (s.w / 2) * S}" y="${y - (s.d / 2) * S}" width="${s.w * S}" height="${s.d * S}" rx="3" class="cp-bench" transform="rotate(${deg.toFixed(1)} ${x} ${y})"/>`);
      spot(s.id, x, y, (s.w / 2) * S * 0.8, (s.w / 2) * S * 0.8);
    } else if (s.id === 'rack' && has('rack')) {
      parts.push(`<rect x="${x - (s.w / 2) * S}" y="${y - (s.d / 2) * S}" width="${s.w * S}" height="${s.d * S}" rx="3" class="cp-bench"/>`);
      spot(s.id, x, y, (s.w / 2) * S, (s.d / 2) * S);
    } else if (s.yaw === 'inward' && has(s.id)) {
      // The keepsake shelf (B2): turned to face the pad's middle, w across.
      const deg = Math.atan2(-s.v, s.u) * 180 / Math.PI + 90;
      parts.push(`<rect x="${x - (s.w / 2) * S}" y="${y - (s.d / 2) * S}" width="${s.w * S}" height="${s.d * S}" rx="2" class="cp-bench" transform="rotate(${deg.toFixed(1)} ${x} ${y})"/>`);
      spot(s.id, x, y, (s.w / 2) * S * 0.8, (s.w / 2) * S * 0.8);
    } else if (['sticks', 'stones', 'clay'].includes(s.id) || ((s.id === 'store' || s.id === 'gift' || s.id === 'nest') && has(s.id))) {
      parts.push(`<circle cx="${x}" cy="${y}" r="${(s.r ?? 0.4) * S}" class="cp-store"/>`);
      spot(s.id, x, y, (s.r ?? 0.4) * S, (s.r ?? 0.4) * S);
    }
  }
  return `<div class="ebb-camppage__map"><svg class="ebb-camppage__sketch" viewBox="0 0 ${w} ${w}" role="img" aria-label="The camp from above">
    <circle cx="${w / 2}" cy="${w / 2}" r="${R * S}" class="cp-pad"/>${parts.join('')}</svg>${spots.join('')}</div>`;
}

/**
 * The gifts laid on the gift stone, oldest first: what, from whom, and when (B1 C1). '' before the first.
 * @param {any} C @param {any} camp @param {any} words
 */
export function giftsView(C, camp, words) {
  const P = C.words.page, gifts = [...(camp?.gifts ?? [])].sort((a, b) => a.hour - b.hour);
  if (!gifts.length) return '';
  const rows = gifts.map((/** @type {any} */ g) => {
    const sp = g.from ? words?.species?.[g.from] : null;
    const who = sp ? ` ${(P.giftFrom ?? 'from the {species}').replace('{species}', String(sp.plural ?? sp.name ?? g.from).toLowerCase())}` : '';
    const line = `${C.words.giftNames?.[g.kind] ?? g.name ?? g.kind}${who}. ${dateOfHour(g.hour, words)}.`;
    return `<li class="ebb-camppage__first"><span class="ebb-camppage__line">${esc(line)}</span></li>`;
  }).join('');
  return `<h4 class="ebb-camppage__h">${esc(P.gifts)}</h4><ul class="ebb-camppage__list">${rows}</ul>`;
}

/**
 * What grows in the herb bed now (B1 C1), once its edging is drawn. '' before.
 * @param {any} C @param {any} camp @param {{ grows?: string[] } | null | undefined} bed the store slice `campBed` @param {any} words
 */
export function bedView(C, camp, bed, words) {
  const P = C.words.page, grows = bed?.grows ?? [];
  if (!grows.length && !Number.isFinite(camp?.bed?.edged)) return '';
  const names = grows.map((sp) => words?.species?.[sp]?.name ?? sp);
  return `<h4 class="ebb-camppage__h">${esc(P.bed)}</h4><p class="ebb-journal__voice">${esc(names.length ? `${P.bedGrows} ${names.join(', ')}.` : P.bedEmpty ?? '')}</p>`;
}

/**
 * The camp page. @param {any} C recipes/world/cook.json @param {any} camp @param {any} cook
 * @param {any} pad the live pad @param {any} words recipes/world/journal.json (season names)
 * @param {{ grows?: string[] } | null} [bed] the store slice `campBed` (what grows in the herb bed)
 * @param {boolean} [withBack] a way back to Notes (the Keeper book's Camp tab is its own tab and has none)
 */
export function campView(C, camp, cook, pad, words, bed = null, withBack = true) {
  const P = C.words.page, names = C.words.pageNames ?? {}, made = C.words.pageParts ?? {};
  const back = withBack ? `<button type="button" class="ebb-shelf__btn" data-view="notes">${iconSvg('back')}<span>${esc(P.back)}</span></button>` : '';
  const firsts = campFirsts(C, camp, cook);
  const rows = firsts.map((f) => {
    const glyphs = f.parts.map((k) => { const i = itemIconFor(k); return i ? itemIconSvg(i) : ''; }).join('');
    const line = `${names[f.id] ?? f.id}. ${made[f.id] ?? ''}${made[f.id] ? '. ' : ''}${dateOfHour(f.hour, words)}.`;
    return `<li class="ebb-camppage__first"><span class="ebb-camppage__parts" aria-hidden="true">${glyphs}</span><span class="ebb-camppage__line">${esc(line)}</span></li>`;
  }).join('');
  return `<section class="ebb-shelf ebb-camppage">${back}
    <h3 class="ebb-shelf__title">${esc(P.title)}</h3>
    <h4 class="ebb-camppage__h">${esc(P.now)}</h4>
    ${campSketch(pad, camp, P.sketchNames)}
    <h4 class="ebb-camppage__h">${esc(P.firsts)}</h4>
    ${rows ? `<ul class="ebb-camppage__list">${rows}</ul>` : `<p class="ebb-journal__voice">${esc(P.empty)}</p>`}
    ${giftsView(C, camp, words)}
    ${bedView(C, camp, bed, words)}
    ${teasView(C, cook, words)}</section>`;
}

/**
 * The teas found (P2e): each the first time it was drunk, its herbs drawn, its boon's name and words
 * and the date; then the pairs tried that came to nothing more, by their taste lines. Nothing lists
 * what is unfound. '' before the first cup. @param {any} C @param {any} cook @param {any} words
 */
export function teasView(C, cook, words) {
  const P = C.words.page, W = C.words, notes = cleanTeaNotes(cook?.teas);
  const found = Object.entries(notes.found).sort((a, b) => a[1] - b[1]);
  if (!found.length) return '';
  const rows = found.map(([id, hour]) => {
    const glyphs = id.split('+').map((h) => { const i = itemIconFor(C.teas?.herbs?.[h] ?? h); return i ? itemIconSvg(i) : ''; }).join('');
    const line = `${W.boonNames?.[id] ?? id}. ${W.boonLines?.[id] ?? ''} ${dateOfHour(hour, words)}.`;
    return `<li class="ebb-camppage__first"><span class="ebb-camppage__parts" aria-hidden="true">${glyphs}</span><span class="ebb-camppage__line">${esc(line)}</span></li>`;
  }).join('');
  const tastes = Object.entries(notes.tastes).sort((a, b) => (notes.tried[a[0]] ?? 0) - (notes.tried[b[0]] ?? 0))
    .map(([, line]) => `<li class="ebb-journal__voice">${esc(line)}</li>`).join('');
  return `<h4 class="ebb-camppage__h">${esc(P.teas)}</h4><ul class="ebb-camppage__list">${rows}</ul>
    ${tastes ? `<h4 class="ebb-camppage__h">${esc(P.tastes)}</h4><ul class="ebb-camppage__list ebb-camppage__tastes">${tastes}</ul>` : ''}`;
}
