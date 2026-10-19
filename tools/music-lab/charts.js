// @ts-check
// The music lab's two pictures: which recorded layers sound at each loudness (stacked bands, with
// a dot that follows a test as it plays), and each recorded note's tuning in cents against the
// target of the chosen policy. Plain SVG, scaled to the card's width, legible at phone width.

import { layerWeights, evenBounds, stretchCents, correctionCents } from '../../src/audio/music/sampler-math.js';
import { noteName } from './keyboard.js';

const LAYER_COLORS = ['#AFC6CF', '#8DAE80', '#C9A25E', '#C48A5A', '#B8A9CC'];
const NS = 'http://www.w3.org/2000/svg';

/** @param {string} tag @param {Record<string, any>} attrs @param {string} [text] */
function el(tag, attrs, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * @param {HTMLElement} host
 * @returns {{draw: (layers: number, bounds: number[], fadeWidth: number, law?: number) => void, cursor: (velocity: number|null) => void}}
 */
export function createLayerChart(host) {
  const W = 640, H = 170, L = 8, R = 8, T = 12, B = 34;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Loudness layers' });
  host.appendChild(svg);
  const x = (/** @type {number} */ v) => L + ((v - 1) / 126) * (W - L - R);
  /** @type {SVGCircleElement|null} */
  let dot = null;
  let cur = { layers: 3, bounds: [43, 85], fade: 12 };

  function draw(/** @type {number} */ layers, /** @type {number[]} */ bounds, /** @type {number} */ fadeWidth, law = 0.5) {
    cur = { layers, bounds: bounds.length === layers - 1 ? bounds : evenBounds(layers), fade: fadeWidth };
    svg.replaceChildren();
    const h = H - T - B;
    /** Each layer's share of the blend at a velocity, summing to 1. @param {number} v */
    const shares = (v) => {
      const ws = layerWeights(v, cur.bounds, fadeWidth, law);
      const sum = ws.reduce((n, w) => n + w.weight, 0) || 1;
      return ws.map((w) => ({ layer: w.layer, share: w.weight / sum }));
    };
    // One area per layer: its share of the blend, stacked.
    for (let li = 0; li < layers; li++) {
      let d = '';
      for (let v = 1; v <= 127; v++) {
        let below = 0, mine = 0;
        for (const w of shares(v)) {
          if (w.layer < li) below += w.share;
          if (w.layer === li) mine = w.share;
        }
        const y0 = T + h * (1 - below), y1 = T + h * (1 - below - mine);
        d += `${v === 1 ? 'M' : 'L'}${x(v).toFixed(1)},${y1.toFixed(1)}`;
        void y0;
      }
      for (let v = 127; v >= 1; v--) {
        let below = 0;
        for (const w of shares(v)) if (w.layer < li) below += w.share;
        d += `L${x(v).toFixed(1)},${(T + h * (1 - below)).toFixed(1)}`;
      }
      svg.appendChild(el('path', { d: `${d}Z`, fill: LAYER_COLORS[li % LAYER_COLORS.length], opacity: 0.85 }));
    }
    for (let li = 0; li < layers; li++) {
      const from = li === 0 ? 1 : cur.bounds[li - 1];
      const to = li === layers - 1 ? 127 : cur.bounds[li];
      svg.appendChild(el('text', { x: x((from + to) / 2), y: T + 20, 'text-anchor': 'middle', style: 'fill:#1E2624' }, `recording ${li + 1}`));
    }
    const marks = [[16, 'pp'], [33, 'p'], [49, 'mp'], [64, 'mf'], [80, 'f'], [96, 'ff']];
    for (const [v, n] of marks) svg.appendChild(el('text', { x: x(/** @type {number} */ (v)), y: H - 12, 'text-anchor': 'middle' }, String(n)));
    svg.appendChild(el('text', { x: L, y: H - 12 }, 'soft'));
    svg.appendChild(el('text', { x: W - R, y: H - 12, 'text-anchor': 'end' }, 'loud'));
    dot = /** @type {SVGCircleElement} */ (el('circle', { r: 8, cx: -20, cy: T + h / 2, fill: '#1E2624', stroke: '#FBF7F0', 'stroke-width': 3 }));
    svg.appendChild(dot);
  }

  return {
    draw,
    cursor(velocity) {
      if (!dot) return;
      dot.setAttribute('cx', velocity === null ? '-20' : x(velocity).toFixed(1));
    },
  };
}

/**
 * @param {HTMLElement} host
 * @param {(zone: any) => void} onPick tap a dot to hear that note
 */
export function createTuningChart(host, onPick) {
  const W = 640, H = 260, L = 44, R = 10, T = 14, B = 34;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Tuning of each recorded note' });
  host.appendChild(svg);

  /**
   * @param {any[]} zones recorded zones of one set (measuredCents, tuneConfidence, midi, note)
   * @param {'recorded'|'equal'|'stretch'} policy @param {any} tuning sampler tuning settings
   */
  function draw(zones, policy, tuning) {
    svg.replaceChildren();
    const ok = zones.filter((z) => Number.isFinite(z.measuredCents));
    if (!ok.length) {
      svg.appendChild(el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle' }, 'No tuning measurements for this instrument.'));
      return;
    }
    const after = (/** @type {any} */ z) => z.measuredCents + correctionCents(policy, z.midi, z.measuredCents, z.tuneConfidence, tuning);
    const span = Math.max(12, ...ok.map((z) => Math.abs(z.measuredCents)), ...ok.map((z) => Math.abs(after(z)))) * 1.1;
    const x = (/** @type {number} */ m) => L + ((m - 21) / 87) * (W - L - R);
    const y = (/** @type {number} */ c) => T + ((span - c) / (2 * span)) * (H - T - B);
    svg.appendChild(el('rect', { x: L, y: y(3), width: W - L - R, height: y(-3) - y(3), fill: '#DCE8D5' }));
    svg.appendChild(el('line', { x1: L, x2: W - R, y1: y(0), y2: y(0), stroke: '#8DAE80', 'stroke-width': 1.5 }));
    for (const c of [-span * 0.8, span * 0.8]) {
      const v = Math.round(c);
      svg.appendChild(el('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }, `${v > 0 ? '+' : ''}${v}`));
      svg.appendChild(el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: '#E3D9C9' }));
    }
    svg.appendChild(el('text', { x: L - 6, y: y(0) + 4, 'text-anchor': 'end' }, '0'));
    for (let m = 24; m <= 108; m += 12) svg.appendChild(el('text', { x: x(m), y: H - 12, 'text-anchor': 'middle' }, noteName(m)));
    if (policy === 'stretch') {
      let d = '';
      for (let m = 21; m <= 108; m++) d += `${m === 21 ? 'M' : 'L'}${x(m).toFixed(1)},${y(stretchCents(m, tuning.stretch)).toFixed(1)}`;
      svg.appendChild(el('path', { d, fill: 'none', stroke: '#5F8196', 'stroke-width': 2, 'stroke-dasharray': '5 4' }));
    }
    for (const z of ok) {
      const cx = x(z.midi);
      // Faint: as recorded. Solid: where the chosen policy puts it.
      if (policy !== 'recorded') svg.appendChild(el('circle', { cx, cy: y(z.measuredCents), r: 3.5, fill: '#C48A5A', opacity: 0.45 }));
      const low = !(z.tuneConfidence >= tuning.minConfidence);
      const c = /** @type {SVGCircleElement} */ (el('circle', { cx, cy: y(after(z)), r: 6, fill: low ? '#FBF7F0' : '#1E2624', stroke: '#1E2624', 'stroke-width': 1.5, style: 'cursor:pointer' }));
      const tip = el('title', {}, `${z.note}: ${z.measuredCents.toFixed(1)} cents as recorded${low ? ' (measurement uncertain, left as recorded)' : ''}`);
      c.appendChild(tip);
      svg.appendChild(c);
      // A larger, invisible target so a finger can hit one dot on a phone.
      const hit = el('circle', { cx, cy: y(after(z)), r: 14, fill: 'transparent', style: 'cursor:pointer' });
      hit.appendChild(el('title', {}, tip.textContent ?? ''));
      hit.addEventListener('click', () => onPick(z));
      svg.appendChild(hit);
    }
  }
  return { draw };
}
