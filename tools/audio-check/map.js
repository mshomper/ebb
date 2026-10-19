// @ts-check
// The top-down pond map on the listening page: the pond, the frogs on their ring (flashing as
// they call), the midge swarm with its reach, and the listener, who can be dragged anywhere.
// Map units are meters; +x right (east), +z down (south), as seen from above.

const NS = 'http://www.w3.org/2000/svg';

/**
 * @param {SVGSVGElement} svg viewBox -12 -12 24 24
 * @param {{pondR: number, midge: number[], midgeReach: number, onMove: (x: number, z: number) => void}} o
 */
export function createMap(svg, o) {
  /** @param {string} tag @param {Record<string, string|number>} attrs @param {Element} [parent] */
  const el = (tag, attrs, parent = svg) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    parent.appendChild(e);
    return e;
  };
  // Grass, the pond and its reeds.
  el('rect', { x: -12, y: -12, width: 24, height: 24, fill: '#E9E2D3' });
  el('ellipse', { cx: 0, cy: 0, rx: o.pondR * 1.2, ry: o.pondR * 1.05, fill: '#D6DCC6' });
  el('ellipse', { cx: 0, cy: 0, rx: o.pondR * 0.85, ry: o.pondR * 0.74, fill: '#A9C3C4', stroke: '#8FAFB0', 'stroke-width': 0.08 });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * 2 * Math.PI + 0.2 * Math.sin(i * 3.1);
    const r = o.pondR * (0.9 + 0.05 * Math.sin(i * 1.7));
    const x = Math.cos(a) * r * 1.1, z = Math.sin(a) * r * 0.96;
    el('path', { d: `M${x} ${z} l${0.12 * Math.cos(a + 1)} -0.55`, stroke: '#7E9A6E', 'stroke-width': 0.09, 'stroke-linecap': 'round' });
  }
  el('text', { x: 0, y: 0.25, 'text-anchor': 'middle', style: 'font-size:0.75px' }).textContent = 'pond';
  // Scale bar: 5 m.
  el('path', { d: 'M-11 11 h5', stroke: '#4A5551', 'stroke-width': 0.12 });
  el('text', { x: -8.5, y: 10.5, 'text-anchor': 'middle', style: 'font-size:0.75px' }).textContent = '5 m';
  // Midges and their reach.
  const reach = el('circle', { cx: o.midge[0], cy: o.midge[2], r: o.midgeReach, fill: 'none', stroke: '#9C8F7A', 'stroke-width': 0.06, 'stroke-dasharray': '0.25 0.2', opacity: 0.6 });
  const swarm = el('g', {});
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4, r = 0.12 + 0.05 * (i % 3);
    el('circle', { cx: o.midge[0] + Math.cos(a) * r, cy: o.midge[2] + Math.sin(a) * r, r: 0.05, fill: '#6F6555' }, swarm);
  }
  const frogLayer = el('g', {});
  // The listener: a figure with a facing wedge.
  const you = el('g', { style: 'cursor:grab' });
  el('path', { d: 'M0 0 L-0.9 -2.2 A2.4 2.4 0 0 1 0.9 -2.2 Z', fill: '#2B3532', opacity: 0.18 }, you);
  el('circle', { cx: 0, cy: 0, r: 0.55, fill: '#2B3532' }, you);
  el('circle', { cx: 0, cy: 0, r: 0.9, fill: 'transparent' }, you);

  /** @type {Map<string, {g: SVGGElement, ring: SVGCircleElement, until: number}>} */
  const frogs = new Map();

  /** Point in map meters from a pointer event. @param {PointerEvent} e */
  function toMap(e) {
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 24 - 12;
    const z = ((e.clientY - r.top) / r.height) * 24 - 12;
    return [Math.max(-11.5, Math.min(11.5, x)), Math.max(-11.5, Math.min(11.5, z))];
  }
  let dragging = false;
  svg.addEventListener('pointerdown', (e) => {
    dragging = true;
    svg.setPointerCapture(e.pointerId);
    const [x, z] = toMap(e);
    o.onMove(x, z);
  });
  svg.addEventListener('pointermove', (e) => { if (dragging) { const [x, z] = toMap(e); o.onMove(x, z); } });
  const end = () => { dragging = false; };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  return {
    /** @param {{id: string, pos: number[]}[]} list */
    setFrogs(list) {
      frogLayer.replaceChildren();
      frogs.clear();
      for (const f of list) {
        const g = /** @type {SVGGElement} */ (el('g', { transform: `translate(${f.pos[0]} ${f.pos[2]})` }, frogLayer));
        const ring = /** @type {SVGCircleElement} */ (el('circle', { r: 0.95, fill: 'none', stroke: '#E0A84A', 'stroke-width': 0.16, opacity: 0 }, g));
        el('ellipse', { rx: 0.42, ry: 0.32, fill: '#5F7F5B' }, g);
        el('circle', { cx: -0.18, cy: -0.2, r: 0.09, fill: '#2B3532' }, g);
        el('circle', { cx: 0.18, cy: -0.2, r: 0.09, fill: '#2B3532' }, g);
        frogs.set(f.id, { g, ring, until: 0 });
      }
    },
    /** A frog called: flash its ring. @param {string} id */
    flash(id) {
      const f = frogs.get(id);
      if (!f) return;
      f.ring.animate([{ opacity: 1, r: 0.6 }, { opacity: 0, r: 1.5 }], { duration: 650, easing: 'ease-out' });
      f.g.children[1].animate([{ fill: '#E0A84A' }, { fill: '#5F7F5B' }], { duration: 650 });
    },
    /** @param {number} x @param {number} z @param {number} heading radians, 0 = north (up) */
    setListener(x, z, heading) {
      you.setAttribute('transform', `translate(${x} ${z}) rotate(${(heading * 180) / Math.PI})`);
    },
    /** @param {number} density 0..1 @param {boolean} heard */
    setMidge(density, heard) {
      swarm.setAttribute('opacity', String(0.15 + 0.85 * Math.min(1, density)));
      reach.setAttribute('stroke', heard ? '#4a6a47' : '#9C8F7A');
      reach.setAttribute('opacity', heard ? '1' : '0.6');
    },
  };
}
