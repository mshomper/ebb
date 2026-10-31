// @ts-check
// The fishing line over the island (docs/future/17; src/world/fishing visuals()): the line itself,
// a thin dark thread from the rod's tip to the float that sags while it waits and pulls straight
// as a fish comes in, and the ripples where the float lands and where it dips. UI only: one SVG
// over the canvas (the sowing overlay's layer, sow-overlay.css), redrawn each frame from the camera.

const NS = 'http://www.w3.org/2000/svg';
/** Points round a ripple. */
const AROUND = 24;

/**
 * @param {HTMLElement} parent
 * @returns {{ draw: (v: { line: number[][] | null, rings: { x: number, y: number, z: number, k: number }[] }, project: (x: number, y: number, z: number) => { x: number, y: number, behind: boolean }) => void, dispose: () => void }}
 */
export function mountFishingOverlay(parent) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'ebb-sow ebb-fishline');
  svg.setAttribute('aria-hidden', 'true');
  parent.appendChild(svg);
  let shown = '';
  return {
    draw(v, project) {
      const r = svg.getBoundingClientRect();
      const P = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => { const q = project(x, y, z); return { x: q.x - r.left, y: q.y - r.top, behind: q.behind }; };
      let out = '';
      if (v.line) {
        let d = '', ok = true;
        v.line.forEach((p, i) => { const q = P(p[0], p[1], p[2]); if (q.behind) ok = false; d += `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`; });
        if (ok) out += `<path d="${d}" fill="none" stroke="rgba(28,30,26,0.72)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
      for (const g of v.rings) {
        for (const lag of [0, 0.25]) {
          const k = g.k - lag;
          if (k <= 0 || k >= 1) continue;
          const rad = 0.08 + 0.7 * k;
          let d = '', ok = true;
          for (let i = 0; i <= AROUND; i++) {
            const a = (i / AROUND) * Math.PI * 2, q = P(g.x + Math.cos(a) * rad, g.y + 0.01, g.z + Math.sin(a) * rad);
            if (q.behind) { ok = false; break; }
            d += `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
          }
          if (ok) out += `<path d="${d}Z" fill="none" stroke="rgba(244,238,228,${(0.7 * (1 - k)).toFixed(2)})" stroke-width="1.4"/>`;
        }
      }
      if (out !== shown) { svg.innerHTML = out; shown = out; }
    },
    dispose() { svg.remove(); },
  };
}
