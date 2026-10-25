// @ts-check
// The camp page (docs/future/13 C-41, 6.5; S1): a drawn page of the camp as it is now, seen from
// above, and the firsts in the walker's hand: each thing the first time it was made or built, what it
// was made of (drawn as the parts' glyphs) and the date. Nothing lists what is still unfound. A row
// at the top of Notes leads to it once the ring is laid. Pure string building from the camp and
// cook sections (src/world/camp/model.js, making.js), the pad's slot list and recipes/world/cook.json.

import { iconSvg } from './icons/icons.js';
import { itemIconSvg } from './icons/items.js';
import { itemIconFor } from './icons/item-registry.js';
import { dateOfHour } from '../world/journal/observe.js';
import { partKinds, buildKinds } from '../world/camp/making.js';

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
    const parts = b ? buildKinds(b) : m ? m.parts.map((/** @type {any} */ p) => partKinds(p)[0]) : [];
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
 * The camp seen from above, as it is now: the pad, and each slot that holds something.
 * @param {any} pad the live pad (layout.js) @param {any} camp the camp section
 */
function campSketch(pad, camp) {
  const slots = pad?.camp?.slots ?? [];
  const R = pad?.r ?? 4, S = 22;
  // u to the right (seaward), v up the page.
  const at = (/** @type {any} */ s) => [(s.u + R) * S + 10, (R - s.v) * S + 10];
  const has = (/** @type {string} */ id) => (camp?.slots ?? []).some((/** @type {any} */ q) => q.slot === id);
  const parts = [];
  for (const s of slots) {
    const [x, y] = at(s);
    if (s.id === 'tent' && has('tent')) parts.push(`<rect x="${x - (s.w / 2) * S}" y="${y - (s.d / 2) * S}" width="${s.w * S}" height="${s.d * S}" rx="4" class="cp-tent"/>`);
    else if (s.id === 'ring' && has('ring')) parts.push(`<circle cx="${x}" cy="${y}" r="${s.r * S}" class="cp-ring"/>`);
    else if (s.faces && has(s.id)) {
      const f = slots.find((/** @type {any} */ q) => q.id === s.faces);
      const deg = f ? Math.atan2(-(f.v - s.v), f.u - s.u) * 180 / Math.PI + 90 : 0;
      parts.push(`<rect x="${x - (s.w / 2) * S}" y="${y - (s.d / 2) * S}" width="${s.w * S}" height="${s.d * S}" rx="3" class="cp-bench" transform="rotate(${deg.toFixed(1)} ${x} ${y})"/>`);
    } else if (s.id === 'rack' && has('rack')) parts.push(`<rect x="${x - (s.w / 2) * S}" y="${y - (s.d / 2) * S}" width="${s.w * S}" height="${s.d * S}" rx="3" class="cp-bench"/>`);
    else if (['sticks', 'stones', 'clay'].includes(s.id) || (s.id === 'store' && has('store'))) parts.push(`<circle cx="${x}" cy="${y}" r="${(s.r ?? 0.4) * S}" class="cp-store"/>`);
  }
  const w = (2 * R) * S + 20;
  return `<svg class="ebb-camppage__sketch" viewBox="0 0 ${w} ${w}" role="img" aria-label="The camp from above">
    <circle cx="${w / 2}" cy="${w / 2}" r="${R * S}" class="cp-pad"/>${parts.join('')}</svg>`;
}

/**
 * The camp page. @param {any} C recipes/world/cook.json @param {any} camp @param {any} cook
 * @param {any} pad the live pad @param {any} words recipes/world/journal.json (season names)
 */
export function campView(C, camp, cook, pad, words) {
  const P = C.words.page, names = C.words.pageNames ?? {}, made = C.words.pageParts ?? {};
  const back = `<button type="button" class="ebb-shelf__btn" data-view="notes">${iconSvg('back')}<span>${esc(P.back)}</span></button>`;
  const firsts = campFirsts(C, camp, cook);
  const rows = firsts.map((f) => {
    const glyphs = f.parts.map((k) => { const i = itemIconFor(k); return i ? itemIconSvg(i) : ''; }).join('');
    const line = `${names[f.id] ?? f.id}. ${made[f.id] ?? ''}${made[f.id] ? '. ' : ''}${dateOfHour(f.hour, words)}.`;
    return `<li class="ebb-camppage__first"><span class="ebb-camppage__parts" aria-hidden="true">${glyphs}</span><span class="ebb-camppage__line">${esc(line)}</span></li>`;
  }).join('');
  return `<section class="ebb-shelf ebb-camppage">${back}
    <h3 class="ebb-shelf__title">${esc(P.title)}</h3>
    <h4 class="ebb-camppage__h">${esc(P.now)}</h4>
    ${campSketch(pad, camp)}
    <h4 class="ebb-camppage__h">${esc(P.firsts)}</h4>
    ${rows ? `<ul class="ebb-camppage__list">${rows}</ul>` : `<p class="ebb-journal__voice">${esc(P.empty)}</p>`}</section>`;
}
