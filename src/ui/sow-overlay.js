// @ts-check
// The sowing overlay (D1a; src/world/sowing): drawn in pencil over the island while something is in
// hand. The ring under the pointer, inked where the seed, gift or net would take and faint and
// crossed where not, with the reason beside it; each tossed seed's dotted line from the hand, which
// fades once it lands; a puff of soil on land, rings of splash on water. UI only: one SVG over the
// canvas, redrawn each frame from sowing.visuals() and the camera (project).
// Numbers: recipes/world/sowing.json ring, toss, puff, splash. Styles: sow-overlay.css.

import { tossAt } from '../world/sowing/model.js';

const NS = 'http://www.w3.org/2000/svg';
/** Points around a ground circle. */
const AROUND = 28;
/** Points along a toss's line. */
const ALONG = 26;

/**
 * @param {HTMLElement} parent @param {any} R recipes/world/sowing.json
 * @returns {{ draw: (v: ReturnType<import('../world/sowing/index.js').Sowing['visuals']>, project: (x: number, y: number, z: number) => { x: number, y: number, behind: boolean }, now: number) => void, dispose: () => void }}
 */
export function mountSowOverlay(parent, R) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'ebb-sow');
  svg.setAttribute('aria-hidden', 'true');
  const tag = document.createElement('div');
  tag.className = 'ebb-sow__why';
  tag.hidden = true;
  parent.appendChild(svg);
  parent.appendChild(tag);
  let shown = '';

  /**
   * A ground circle as a path, or '' if it is behind the camera.
   * @param {(x: number, y: number, z: number) => { x: number, y: number, behind: boolean }} project
   * @param {number} x @param {number} y @param {number} z @param {number} r
   */
  function circle(project, x, y, z, r) {
    let d = '';
    for (let i = 0; i <= AROUND; i++) {
      const a = (i / AROUND) * Math.PI * 2, q = project(x + Math.cos(a) * r, y, z + Math.sin(a) * r);
      if (q.behind) return '';
      d += `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
    }
    return d + 'Z';
  }

  return {
    draw(v, project, now) {
      const r = svg.getBoundingClientRect();
      const P = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => { const q = project(x, y, z); return { x: q.x - r.left, y: q.y - r.top, behind: q.behind }; };
      let out = '';
      const g = v.ring;
      let why = '';
      if (g) {
        const d = circle(P, g.x, g.y, g.z, g.r);
        if (d) {
          if (g.ok) out += `<path class="ebb-sow__ring" d="${d}" opacity="${R.ring.ink}"/>`;
          else {
            const flash = now - g.flashAt < 600 ? 1 : 0;
            out += `<path class="ebb-sow__ring is-faint" d="${d}" opacity="${R.ring.faint + flash * 0.4}"/>`;
            const c = R.ring.crossM, a = P(g.x - c, g.y, g.z - c), b = P(g.x + c, g.y, g.z + c), e = P(g.x + c, g.y, g.z - c), f = P(g.x - c, g.y, g.z + c);
            out += `<path class="ebb-sow__ring is-faint" opacity="${R.ring.faint + flash * 0.4}" d="M${a.x} ${a.y}L${b.x} ${b.y}M${e.x} ${e.y}L${f.x} ${f.y}"/>`;
            why = g.message;
            const top = P(g.x, g.y, g.z);
            if (!top.behind && why) { tag.style.left = `${top.x + r.left}px`; tag.style.top = `${top.y + r.top}px`; }
          }
        }
      }
      for (const t of v.tosses) {
        const k = (now - t.at) / (t.plan.s * 1000);
        if (k < 0) continue;
        const sinceLand = (now - t.at) / 1000 - t.plan.s;
        // The dotted line from the hand to the seed, fading once it has landed.
        const fade = sinceLand > 0 ? Math.max(0, 1 - sinceLand / R.toss.fadeS) : 1;
        if (fade > 0) {
          let d = '', ok = true;
          const n = Math.max(2, Math.round(ALONG * Math.min(1, k)));
          for (let i = 0; i <= n; i++) {
            const q = tossAt(t.from, t.to, t.plan, (i / n) * Math.min(1, k));
            const s = P(q[0], q[1], q[2]);
            if (s.behind) { ok = false; break; }
            d += `${i ? 'L' : 'M'}${s.x.toFixed(1)} ${s.y.toFixed(1)}`;
          }
          if (ok) out += `<path class="ebb-sow__line" d="${d}" opacity="${(0.85 * fade).toFixed(2)}"/>`;
          if (ok && k < 1) { const h = tossAt(t.from, t.to, t.plan, k), s = P(h[0], h[1], h[2]); out += `<circle class="ebb-sow__seed" cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="2.6"/>`; }
        }
        if (sinceLand < 0) continue;
        const [x, y, z] = t.to;
        if (t.land.kind === 'puff') {
          const u = sinceLand / R.puff.s;
          if (u < 1) {
            const e = 1 - (1 - u) * (1 - u), rad = R.puff.rM[0] + (R.puff.rM[1] - R.puff.rM[0]) * e;
            for (let i = 0; i < R.puff.bits; i++) {
              const a = (i / R.puff.bits) * Math.PI * 2 + 0.4, s = P(x + Math.cos(a) * rad, y + 0.12 * Math.sin(Math.PI * u), z + Math.sin(a) * rad);
              if (!s.behind) out += `<circle class="ebb-sow__puff" cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="${(3.2 * (1 - u) + 1).toFixed(1)}" opacity="${(0.7 * (1 - u)).toFixed(2)}"/>`;
            }
          }
        } else {
          for (let i = 0; i < t.land.rings; i++) {
            const u = (sinceLand - i * R.splash.gapS) / R.splash.s;
            if (u < 0 || u >= 1) continue;
            const d = circle(P, x, y, z, R.splash.rM[0] + (R.splash.rM[1] - R.splash.rM[0]) * Math.sqrt(u) * (1 - i * 0.15));
            if (d) out += `<path class="ebb-sow__splash" d="${d}" opacity="${(0.8 * (1 - u)).toFixed(2)}"/>`;
          }
        }
      }
      if (out !== shown) { svg.innerHTML = out; shown = out; }
      tag.hidden = !why;
      if (tag.textContent !== why) tag.textContent = why;
    },
    dispose() { svg.remove(); tag.remove(); },
  };
}
