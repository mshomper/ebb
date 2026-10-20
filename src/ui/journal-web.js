// @ts-check
// The journal's Web section (J2a, redesigned 2026-10-20): what needs what, one thing at a time.
// A trail at the top keeps the last few things tapped; the focus card shows the chosen thing and its
// ties as chips in three short groups (Needs, Needed by, Shares a home with); a shelf at the bottom
// has a tab per kind (Ground, Plants, Small lives, Animals) with a square tile for each thing. The
// layout is all wrapping rows and a fixed-column grid, so a new node in the recipe needs no layout
// change and nothing ever widens the page. Inked ties are ones seen on the island; the rest are
// pencil. A thing not yet seen is a pencil question mark that hints without telling. Each kind
// wears a soft tint (journal.css, --jw-<kind>-*). Also the Ties strip on each journal page.
// Returns markup; journal.js owns the clicks (data-web-node, data-web-trail, data-web-shelf).

import { iconSvg } from './icons/icons.js';
import { tiesOf } from '../world/journal/web.js';

/** @param {string} s */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** Join names in words: "a", "a and b", "a, b and c". @param {string[]} xs */
const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] ?? '');

/**
 * A tie as a chip: the thing's icon and name, tinted by its kind; a pencil outline while the tie is
 * not yet seen; a pencil question mark while the thing itself is not.
 * @param {import('../world/journal/web.js').WebNode} n @param {boolean} inked @param {any} web
 */
function chip(n, inked, web) {
  if (!n.known) {
    return `<button type="button" class="ebb-jw-chip is-unknown" data-web-node="${esc(n.id)}" aria-label="${esc(web.unknown.line)}">` +
      `<span class="ebb-jw-q" aria-hidden="true">${esc(web.unknown.label)}</span></button>`;
  }
  return `<button type="button" class="ebb-jw-chip is-${esc(n.kind)}${inked ? '' : ' is-pencil'}" data-web-node="${esc(n.id)}">` +
    `${iconSvg(n.icon)}<span>${esc(n.label)}</span></button>`;
}

/**
 * The three groups of ties as chip rows (empty groups left out).
 * @param {import('../world/journal/web.js').WebView} d @param {any} web @param {string} id
 */
function groups(d, web, id) {
  const t = tiesOf(d, web, id);
  const row = (/** @type {string} */ key, /** @type {{ id: string, inked: boolean }[]} */ ties) => {
    // Known things first, then the pencil question marks.
    const shown = ties.filter((x) => d.byId[x.id]);
    const chips = [...shown.filter((x) => d.byId[x.id].known), ...shown.filter((x) => !d.byId[x.id].known)].map((x) => chip(d.byId[x.id], x.inked, web));
    return chips.length ? `<section class="ebb-jw-group"><h4>${esc(web.groups[key])}</h4><div class="ebb-jw-chips">${chips.join('')}</div></section>` : '';
  };
  return row('needs', t.needs) + row('neededBy', t.neededBy) + row('shares', t.shares);
}

/**
 * The Web section's markup.
 * @param {import('../world/journal/web.js').WebView} d describeWeb()
 * @param {any} web recipes/world/journal-web.json
 * @param {{ trail: string[], shelf: string | null }} view the trail of taps (the last is the focus)
 *   and the shelf tab open (null: the focus's kind)
 */
export function webView(d, web, view) {
  const trail = view.trail.filter((id) => d.byId[id]);
  const focusId = trail[trail.length - 1] ?? web.start;
  const node = d.byId[focusId];
  const shelf = view.shelf && web.kinds[view.shelf] ? view.shelf : node.kind;
  const name = (/** @type {import('../world/journal/web.js').WebNode} */ n) => (n.known ? n.label : web.unknown.line);

  // The trail: the last few things tapped, oldest first; tapping one goes back to it.
  const crumbs = trail.length > 1 ? `<nav class="ebb-jw-trail" aria-label="${esc(web.status.trail)}"><ol>${trail.map((id, i) => {
    const n = d.byId[id];
    const k = n.known ? ` is-${esc(n.kind)}` : ' is-unknown';
    return i === trail.length - 1
      ? `<li><span class="ebb-jw-crumb${k}" aria-current="true">${esc(name(n))}</span></li>`
      : `<li><button type="button" class="ebb-jw-crumb${k}" data-web-trail="${i}">${esc(name(n))}</button></li>`;
  }).join('')}</ol></nav>` : '';

  // The focus card.
  const kind = web.kinds[node.kind];
  let body;
  if (node.known) {
    const status = node.id === 'you' || web.nodes[node.id]?.always ? '' : node.found ? web.status.found : node.here ? web.status.seen : web.status.known;
    const ties = groups(d, web, node.id);
    const open = node.page ? `<button type="button" class="ebb-jw-open" data-page="${esc(node.page)}">${esc(web.status.page)}</button>` : '';
    body = `<div class="ebb-jw-card__head"><span class="ebb-jw-card__icon">${iconSvg(node.icon)}</span>
      <div class="ebb-jw-card__name"><h3>${esc(node.label)}</h3><p><span class="ebb-jw-kind">${esc(kind.label)}</span>${status ? `<span class="ebb-jw-status">${esc(status)}</span>` : ''}</p></div></div>
      ${ties || `<p class="ebb-jw-hint ebb-journal__voice">${esc(web.status.none)}</p>`}${open}`;
  } else {
    // Not yet seen: no name and no icon, only what known things it needs, and its pencil ties.
    const needs = tiesOf(d, web, node.id).needs.map((t) => d.byId[t.id]).filter((n) => n?.known && !web.nodes[n.id]?.always).map((n) => n.label.toLowerCase());
    const hint = needs.length ? web.unknown.hint.replace('{list}', list(needs)) : '';
    body = `<div class="ebb-jw-card__head"><span class="ebb-jw-card__icon is-unknown"><span class="ebb-jw-q" aria-hidden="true">${esc(web.unknown.label)}</span></span>
      <div class="ebb-jw-card__name"><h3>${esc(web.unknown.line)}</h3><p><span class="ebb-jw-kind">${esc(kind.label)}</span></p></div></div>
      ${hint ? `<p class="ebb-jw-hint ebb-journal__voice">${esc(hint)}</p>` : ''}${groups(d, web, node.id)}`;
  }
  const card = `<section class="ebb-jw-card ${node.known ? `is-${esc(node.kind)}` : 'is-unknown'}" aria-live="polite">${body}</section>`;

  // The shelf: a tab per kind, and a tile for each thing of the open kind.
  const tabs = Object.entries(web.kinds).map(([k, v]) => `<button type="button" class="ebb-jw-tab is-${esc(k)}" data-web-shelf="${esc(k)}" aria-pressed="${k === shelf}">` +
    `${iconSvg(/** @type {any} */ (v).icon)}<span>${esc(/** @type {any} */ (v).label)}</span></button>`).join('');
  const tiles = d.nodes.filter((n) => n.kind === shelf).map((n) => {
    const sel = n.id === node.id ? ' is-on' : '';
    return n.known
      ? `<button type="button" class="ebb-jw-tile is-${esc(n.kind)}${sel}" data-web-node="${esc(n.id)}" aria-label="${esc(n.label)}" title="${esc(n.label)}" aria-pressed="${!!sel}">${iconSvg(n.icon)}</button>`
      : `<button type="button" class="ebb-jw-tile is-unknown${sel}" data-web-node="${esc(n.id)}" aria-label="${esc(web.unknown.line)}" aria-pressed="${!!sel}"><span class="ebb-jw-q" aria-hidden="true">${esc(web.unknown.label)}</span></button>`;
  }).join('');
  const shelfHtml = `<div class="ebb-jw-shelf"><div class="ebb-jw-tabs" role="group" aria-label="Kinds">${tabs}</div>
    <div class="ebb-jw-tiles" style="--jw-cols: ${Number(web.shelfCols) || 6}">${tiles}</div></div>`;

  return `<div class="ebb-jw">${crumbs}${card}${shelfHtml}</div>`;
}

/**
 * The small Ties strip on a journal page: the same chips, which lead into the Web.
 * @param {import('../world/journal/web.js').WebView} d @param {any} web @param {string | null} id the page's Web node
 */
export function tiesStrip(d, web, id) {
  if (!id || !d.byId[id]) return '';
  const inner = groups(d, web, id);
  return `<section class="ebb-jw-ties"><h4>${esc(web.ties.title)}</h4>${inner || `<p class="ebb-jw-hint ebb-journal__voice">${esc(web.status.none)}</p>`}` +
    `<button type="button" class="ebb-jw-open" data-web-node="${esc(id)}">${iconSvg('web')}<span>${esc(web.ties.open)}</span></button></section>`;
}
