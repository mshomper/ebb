// @ts-check
// The journal's Web section (J2a): ground at the top, plants in the middle, animals below, and you.
// Each band is one row of names in the recipe's order, packed and centered; links run in the clear
// space between rows (or side to side within a row), so none passes behind a name, and the recipe's
// order keeps them from crossing. Inked links are ones seen on the island; the rest are pencil.
// Tapping a name brings its links forward. Returns markup; journal.js owns the clicks.

const INK = '#2F3A35', PENCIL = '#A7A196', MOSS = '#5F7F5B', PAPER = '#F4EEE4', BAND = '#E9DFCE';
const CHIP_H = 32;

/** @type {CanvasRenderingContext2D | null} */ let measureCtx = null;
/** Label width in drawing units, measured in the journal's own type. @param {string} t @param {number} px */
function textWidth(t, px) {
  try {
    measureCtx ??= document.createElement('canvas').getContext('2d');
    if (measureCtx) {
      measureCtx.font = `600 ${px}px Nunito, system-ui, sans-serif`;
      return measureCtx.measureText(t).width;
    }
  } catch { /* no canvas: estimate */ }
  return t.length * px * 0.55;
}

/** @param {string} s */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/**
 * The Web section's markup.
 * @param {{ rows: { band: string, nodes: { id: string, label: string, page: string | null, known: boolean }[] }[], links: { a: string, b: string, inked: boolean }[] }} d
 *   describeWeb() @param {any} web recipes/world/journal-web.json @param {string | null} focus the tapped name
 */
export function webView(d, web, focus) {
  const px = web.textPx, gap = web.gapPx, pad = web.bandPad;
  // Tight chips keep the widest row near 350 units, so on a 343 px phone page the labels still
  // render above 16 px.
  const chipW = (/** @type {string} */ t) => Math.ceil(textWidth(t, px) + 18);
  // Neighbours linked to each other sit further apart, so the link between them reads as a line.
  const tied = (/** @type {string} */ a, /** @type {string} */ b) => d.links.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
  const gaps = d.rows.map((r) => r.nodes.slice(1).map((n, i) => (tied(r.nodes[i].id, n.id) ? web.linkGapPx : gap)));
  const rowW = d.rows.map((r, i) => r.nodes.reduce((s, n) => s + chipW(n.label), 0) + gaps[i].reduce((s, g) => s + g, 0));
  const W = Math.max(300, ...rowW) + pad * 2;
  /** @type {Record<string, { x: number, y: number, w: number }>} */ const at = {};
  let y = pad * 2 + CHIP_H / 2;
  /** @type {{ band: string, y0: number, y1: number }[]} */ const bands = [];
  d.rows.forEach((r, i) => {
    if (i && d.rows[i - 1].band !== r.band) y += pad;           // a little more room between bands
    let x = (W - rowW[i]) / 2;
    r.nodes.forEach((n, j) => { const w = chipW(n.label); at[n.id] = { x: x + w / 2, y, w }; x += w + (gaps[i][j] ?? 0); });
    const last = bands[bands.length - 1];
    if (last && last.band === r.band) last.y1 = y + CHIP_H / 2 + pad;
    else bands.push({ band: r.band, y0: y - CHIP_H / 2 - pad, y1: y + CHIP_H / 2 + pad });
    y += CHIP_H + web.rowGap;
  });
  const H = y - web.rowGap - CHIP_H / 2 + pad * 2;
  const linked = (/** @type {string} */ id) => !focus || id === focus || d.links.some((l) => (l.a === focus && l.b === id) || (l.b === focus && l.a === id));
  let svg = '';
  for (const b of bands) if (b.band !== 'you') svg += `<rect x="${pad / 2}" y="${b.y0}" width="${W - pad}" height="${b.y1 - b.y0}" rx="12" fill="${BAND}" opacity="0.7"/>`;
  for (const l of d.links) {
    const A = at[l.a], B = at[l.b];
    if (!A || !B) continue;
    const on = !focus || l.a === focus || l.b === focus;
    let path;
    if (A.y === B.y) {
      const dir = B.x > A.x ? 1 : -1;
      path = `M${A.x + dir * A.w / 2} ${A.y}L${B.x - dir * B.w / 2} ${B.y}`;
    } else {
      const [top, bot] = A.y < B.y ? [A, B] : [B, A];
      const y0 = top.y + CHIP_H / 2, y1 = bot.y - CHIP_H / 2, m = (y0 + y1) / 2;
      path = `M${top.x} ${y0}C${top.x} ${m} ${bot.x} ${m} ${bot.x} ${y1}`;
    }
    svg += `<path d="${path}" fill="none" stroke="${l.inked ? INK : PENCIL}" stroke-width="${l.inked ? 2 : 1.5}"${l.inked ? '' : ' stroke-dasharray="5 4"'} opacity="${on ? 1 : 0.15}"/>`;
  }
  for (const r of d.rows) {
    for (const n of r.nodes) {
      const p = at[n.id], sel = n.id === focus;
      svg += `<g class="ebb-jweb__node" data-web-node="${esc(n.id)}" opacity="${linked(n.id) ? 1 : 0.35}" role="button" tabindex="0" aria-label="${esc(n.label)}${n.known ? '' : ', not yet known'}">` +
        `<rect x="${p.x - p.w / 2}" y="${p.y - CHIP_H / 2}" width="${p.w}" height="${CHIP_H}" rx="${CHIP_H / 2}" fill="${sel ? MOSS : PAPER}" stroke="${n.known ? MOSS : PENCIL}" stroke-width="1.6"${n.known ? '' : ' stroke-dasharray="4 3"'}/>` +
        `<text x="${p.x}" y="${p.y + px * 0.35}" text-anchor="middle" font-family="Nunito, system-ui, sans-serif" font-weight="600" font-size="${px}" fill="${sel ? PAPER : n.known ? INK : '#8A8478'}">${esc(n.label)}</text></g>`;
    }
  }
  // Below the web: what the tapped name links to, and a way to its page.
  const node = focus ? d.rows.flatMap((r) => r.nodes).find((n) => n.id === focus) : null;
  let cap = '<p class="ebb-jweb__cap ebb-journal__voice">Ground at the top, plants in the middle, animals below. Inked links are ones you have seen happen; pencil ones you have not, yet. Tap a name to follow its links.</p>';
  if (node) {
    // The links seen, in the journal's own words, then how many are still in pencil (in words).
    const mine = d.links.filter((l) => l.a === node.id || l.b === node.id);
    const seen = mine.filter((l) => l.inked).map((l) => web.links.find((/** @type {any} */ w) => w.a === l.a && w.b === l.b)?.note).filter(Boolean);
    const left = mine.length - seen.length;
    const rest = !node.known ? 'Not yet known.' : !left ? 'Every link seen.' : seen.length ? (left === 1 ? 'One link still in pencil.' : 'More links still in pencil.') : 'No links seen yet.';
    const lines = [...seen, rest].map((t) => `<li class="ebb-journal__voice">${esc(t)}</li>`).join('');
    const open = node.known && node.page ? `<button type="button" class="ebb-jweb__open" data-page="${esc(node.page)}">Open its page</button>` : '';
    cap = `<div class="ebb-jweb__focus"><p><b>${esc(node.label)}</b></p><ul class="ebb-jweb__lines">${lines}</ul>${open}</div>`;
  }
  return `<div class="ebb-jweb"><svg class="ebb-jweb__svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="What needs what">${svg}</svg>${cap}</div>`;
}
