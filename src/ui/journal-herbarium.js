// @ts-check
// The herbarium (the forager's trail's first stop, P2k; recipes/world/forager.json): a journal page
// where a pressed sprig of each plant you have gathered lies flat, one to a row, in the order first
// gathered, with the parts of it you have gathered. Once the trail gives the almanac, a ring
// calendar follows: each part you have gathered as an arc over the part of the year it is ready
// (gather.json windows), spring at the top, going round clockwise; parts never gathered are not
// drawn or named. Reached from the forager's trail (its stops and plants), with a way back.
// Styles: journal-herbarium.css.

import { iconSvg, ICON_NAMES } from './icons/icons.js';
import { itemIconSvg } from './icons/items.js';
import { itemIconFor } from './icons/item-registry.js';
import { dateOfHour } from '../world/journal/observe.js';
import { sprigs, almanacArcs } from '../world/forager.js';

/** @param {string} s */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/**
 * The page. @param {{ earned: Record<string, any>, F: any, words: any, gather: any, partName: (k: string) => string }} o
 *   earned: the saved unlocks; F: forager.json; words: journal.json; gather: gather.json (the parts'
 *   windows); partName: a part's name ('watermint.leaves' -> 'Water mint')
 * @returns {string}
 */
export function herbariumView(o) {
  const H = o.F.herbarium;
  const list = sprigs(o.earned);
  const back = `<button type="button" class="ebb-herb__back" data-view="trails" data-trail="forage">${iconSvg('back')}<span>${esc(H.back)}</span></button>`;
  const rows = list.map((s) => {
    const sp = o.words?.species?.[s.sp];
    const icon = sp?.icon && ICON_NAMES.includes(sp.icon) ? sp.icon : 'plant';
    const parts = s.parts.map((k) => `<span class="ebb-herb__part">${itemIconSvg(itemIconFor(k) ?? 'seedhead')}<span>${esc(o.partName(k))}</span></span>`).join('');
    return `<li class="ebb-herb__sprig">
      <span class="ebb-herb__press">${iconSvg(icon, 'ebb-herb__plant')}</span>
      <span class="ebb-herb__text"><b>${esc(sp?.name ?? s.sp)}</b>
        ${s.hour >= 0 ? `<span class="ebb-journal__voice">${esc(H.first.replace('{date}', dateOfHour(s.hour, o.words)))}</span>` : ''}
        ${parts ? `<span class="ebb-herb__parts">${parts}</span>` : ''}</span></li>`;
  }).join('');
  const body = list.length ? `<ol class="ebb-herb__list">${rows}</ol>` : `<p class="ebb-journal__voice">${esc(H.none)}</p>`;
  const almanac = o.earned?.forage?.almanac ? almanacHtml(o) : '';
  return `<article class="ebb-herb">${back}<h3 class="ebb-herb__title">${esc(H.title)}</h3>
    <p class="ebb-journal__voice">${esc(H.intro)}</p>${body}${almanac}</article>`;
}

/**
 * When a window of the year is, in words: "early summer to late summer", or "all year".
 * @param {number[]} w [from, to) season positions @param {any} A forager.json almanac
 */
export function windowWords(w, A) {
  const len = (((w[1] - w[0]) % 4) + 4) % 4 || 4;
  if (len >= 4 - 1e-6) return A.all;
  const third = (/** @type {number} */ p) => A.when[((Math.floor(p * 3) % 12) + 12) % 12];
  const from = third(w[0]), to = third(w[0] + len - 1e-3);
  return from === to ? from : A.span.replace('{from}', from).replace('{to}', to);
}

/** A point on the ring: season position p (0 at the top, clockwise) at radius r. @param {number} c @param {number} r @param {number} p */
const at = (c, r, p) => { const a = (p / 4) * 2 * Math.PI; return [c + r * Math.sin(a), c - r * Math.cos(a)]; };

/** An arc path over a window at radius r. @param {number} c @param {number} r @param {number[]} w */
function arcPath(c, r, w) {
  const len = (((w[1] - w[0]) % 4) + 4) % 4 || 4;
  if (len >= 4 - 1e-6) return `M${c} ${c - r}A${r} ${r} 0 1 1 ${c - 0.01} ${c - r}`;
  const [x0, y0] = at(c, r, w[0]), [x1, y1] = at(c, r, w[0] + len);
  return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 ${len > 2 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}

/** The almanac: the ring, then a legend with one part a row. @param {{ earned: Record<string, any>, F: any, gather: any, partName: (k: string) => string }} o */
function almanacHtml(o) {
  const A = o.F.almanac, G = A.ring, S = A.ringPx, c = S / 2;
  const arcs = almanacArcs(o.earned, o.gather);
  const step = Math.min(G.stepMax, arcs.length > 1 ? (G.outerR - G.innerR) / (arcs.length - 1) : G.stepMax);
  const color = (/** @type {number} */ i) => A.colors[i % A.colors.length];
  const ticks = [0, 1, 2, 3].map((p) => { const [x0, y0] = at(c, G.innerR - 12, p), [x1, y1] = at(c, G.outerR + 10, p); return `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}"/>`; }).join('');
  const labels = A.seasons.map((/** @type {string} */ n, /** @type {number} */ i) => { const [x, y] = at(c, G.labelR, i + 0.5); return `<text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}">${esc(n)}</text>`; }).join('');
  const paths = arcs.map((a, i) => a.windows.map((w) => `<path d="${arcPath(c, G.outerR - i * step, w)}" stroke="${color(i)}"/>`).join('')).join('');
  const svg = `<svg class="ebb-herb__ring" viewBox="0 0 ${S} ${S}" style="max-width:${S}px" role="img" aria-label="${esc(A.title)}">
    <g class="ebb-herb__ticks">${ticks}</g><g class="ebb-herb__arcs" stroke-width="${G.width}">${paths}</g><g class="ebb-herb__labels">${labels}</g></svg>`;
  const legend = arcs.map((a, i) => `<li><span class="ebb-herb__swatch" style="background:${color(i)}"></span>${itemIconSvg(itemIconFor(a.id) ?? 'seedhead')}
    <span class="ebb-herb__text"><b>${esc(o.partName(a.id))}</b><span class="ebb-journal__voice">${esc(a.windows.map((w) => windowWords(w, A)).join(', and '))}</span></span></li>`).join('');
  return `<section class="ebb-herb__almanac"><h4>${esc(A.title)}</h4><p class="ebb-journal__voice">${esc(A.intro)}</p>${svg}<ol class="ebb-herb__legend">${legend}</ol></section>`;
}
