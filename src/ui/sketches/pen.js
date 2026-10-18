// @ts-check
// The journal's drawing pen (docs 13, 15, J1.6): every field sketch is drawn with it, and the same
// drawing comes out three ways by stage: 0 pencil (a faint dashed outline, nothing labelled, before
// the thing is seen), 1 ink (firm lines, fine detail and the labels the page has learned), 2 washed
// (ink plus soft watercolor fills, once it has been caught at a moment or in flower). Pure string
// building; the colors are paper-and-ink colors for the cream journal page, not world materials.

const PENCIL = '#A7A196';
const INK = '#2F3A35';
/** The journal's paper: shapes are filled with it so whatever is in front hides what is behind. */
const PAPER = '#F4EEE4';
const NOTE = '#4A5551';
const LEADER = '#8A8478';
/** Label size in drawing units: about 16 px on a 343 px wide phone page, 18 px on desktop. */
const TEXT = 18;

/** @param {number} n */
const f = (n) => (Math.round(n * 10) / 10).toString();

/** @param {string} s */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/**
 * @param {0|1|2} stage
 * @param {Record<string, string[]>} labels the labels the page has learned, by key (lines of text)
 */
export function makePen(stage, labels) {
  const pencil = stage === 0;
  const wash = stage === 2;
  const color = pencil ? PENCIL : INK;
  const scaleW = pencil ? 0.7 : 1;
  const dash = pencil ? ' stroke-dasharray="5 4"' : '';
  let out = '';

  const pen = {
    stage, pencil, wash, f,
    /** A drawn line. @param {string} d @param {number} [w] */
    line(d, w = 1.6) {
      out += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${f(w * scaleW)}" stroke-linecap="round" stroke-linejoin="round"${dash}/>`;
    },
    /** A soft watercolor fill, only when washed. @param {string} d @param {string} c @param {number} [opacity] */
    tint(d, c, opacity = 0.4) {
      if (wash) out += `<path d="${d}" fill="${c}" opacity="${opacity}"/>`;
    },
    /**
     * A solid closed shape: paper fill (so it hides what was drawn behind it), its wash, and an
     * outline. Draw back to front.
     * @param {string} d @param {string} c @param {number} [opacity] @param {number} [w]
     */
    shape(d, c, opacity = 0.4, w = 1.4) {
      out += `<path d="${d}" fill="${PAPER}" stroke="none"/>`;
      pen.tint(d, c, opacity);
      pen.line(d, w);
    },
    /** Fine detail (hatching, veins, grains): ink stages only. @param {string} d @param {number} [w] @param {number} [opacity] */
    fine(d, w = 0.8, opacity = 0.6) {
      if (!pencil) out += `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${f(w)}" stroke-linecap="round" opacity="${opacity}"/>`;
    },
    /** A small filled dot: ink stages only, washed in a color when given. @param {number} cx @param {number} cy @param {number} r @param {string} [c] */
    dot(cx, cy, r, c) {
      if (!pencil) out += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${wash && c ? c : INK}" opacity="${wash && c ? 0.85 : 0.7}"/>`;
    },
    /** An ellipse shape. @param {number} cx @param {number} cy @param {number} rx @param {number} ry @param {string} c @param {number} [opacity] @param {number} [w] */
    oval(cx, cy, rx, ry, c, opacity = 0.4, w = 1.4) {
      pen.shape(`M${f(cx - rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)}Z`, c, opacity, w);
    },
    /**
     * A learned label in the italic hand, to the right of what it names, with a leader from a point
     * on the drawing to the start of its first line. Drawn only in ink stages and only once the page
     * knows it.
     * @param {string} key @param {number} x @param {number} y first baseline @param {number} lx @param {number} ly the point on the drawing
     */
    label(key, x, y, lx, ly) {
      const lines = labels[key];
      if (pencil || !lines?.length) return;
      out += `<path d="M${f(lx)} ${f(ly)}L${f(x - 6)} ${f(y - 6)}" stroke="${LEADER}" stroke-width="1" fill="none"/>`;
      out += `<text x="${f(x)}" y="${f(y)}" font-family="Fraunces, Georgia, serif" font-style="italic" font-size="${TEXT}" fill="${NOTE}">` +
        lines.map((t, i) => `<tspan x="${f(x)}" dy="${i ? TEXT * 1.15 : 0}">${esc(t)}</tspan>`).join('') + '</text>';
    },
    /** A vertical scale bar with its words, ink stages only. @param {number} x @param {number} y0 @param {number} y1 @param {string} [text] */
    scale(x, y0, y1, text) {
      if (pencil || !text) return;
      out += `<path d="M${f(x)} ${f(y0)}V${f(y1)}M${f(x - 4)} ${f(y0)}h8M${f(x - 4)} ${f(y1)}h8" stroke="${LEADER}" stroke-width="1" fill="none"/>`;
      const my = (y0 + y1) / 2;
      out += `<text x="${f(x - 8)}" y="${f(my)}" font-family="Fraunces, Georgia, serif" font-style="italic" font-size="${TEXT}" fill="${NOTE}" text-anchor="middle" transform="rotate(-90 ${f(x - 8)} ${f(my)})">${esc(text)}</text>`;
    },
    /** Add finished markup as it is (a part drawn by a sub pen, inside a transform). @param {string} s */
    raw(s) { out += s; },
    /** A pen of the same stage for a part drawn inside a transform; take() hands back its markup. */
    sub() { return makePen(stage, labels); },
    /** This pen's markup so far, emptied. */
    take() { const s = out; out = ''; return s; },
    /** The finished drawing. @param {number} w @param {number} h @param {string} aria */
    svg(w, h, aria) {
      return `<svg class="ebb-sketch" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(aria)}">${out}</svg>`;
    },
  };
  return pen;
}

/** @typedef {ReturnType<typeof makePen>} Pen */

/**
 * A tapering leaf or blade from a base point to a tip, as a closed shape.
 * @param {number} bx @param {number} by base @param {number} tx @param {number} ty tip @param {number} w half width at the base @param {number} [bend] sideways bow of the middle
 */
export function blade(bx, by, tx, ty, w, bend = 0) {
  const mx = (bx + tx) / 2 + bend, my = (by + ty) / 2;
  const dx = tx - bx, dy = ty - by, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  return `M${f(bx - nx * w)} ${f(by - ny * w)}Q${f(mx - nx * w * 0.8)} ${f(my - ny * w * 0.8)} ${f(tx)} ${f(ty)}` +
    `Q${f(mx + nx * w * 0.8)} ${f(my + ny * w * 0.8)} ${f(bx + nx * w)} ${f(by + ny * w)}Z`;
}

/** A gently bowed line from a to b. @param {number} ax @param {number} ay @param {number} bx @param {number} by @param {number} [bend] */
export function stem(ax, ay, bx, by, bend = 0) {
  return `M${f(ax)} ${f(ay)}Q${f((ax + bx) / 2 + bend)} ${f((ay + by) / 2)} ${f(bx)} ${f(by)}`;
}

/**
 * The point a share t (0..1) along a stem() from a to b, so things can be attached to it.
 * @param {number} ax @param {number} ay @param {number} bx @param {number} by @param {number} bend @param {number} t
 * @returns {[number, number]}
 */
export function along(ax, ay, bx, by, bend, t) {
  const cx = (ax + bx) / 2 + bend, cy = (ay + by) / 2, u = 1 - t;
  return [u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by];
}

/**
 * Points along a cubic Bezier, for profiles that other parts must sit on exactly.
 * @param {number[]} p [x0, y0, x1, y1, x2, y2, x3, y3] @param {number} [n] samples
 * @returns {[number, number][]}
 */
export function cubicPoints(p, n = 64) {
  /** @type {[number, number][]} */ const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    pts.push([a * p[0] + b * p[2] + c * p[4] + d * p[6], a * p[1] + b * p[3] + c * p[5] + d * p[7]]);
  }
  return pts;
}

/** The height of a sampled profile at x (linear between samples). @param {[number, number][]} pts @param {number} x */
export function yAt(pts, x) {
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    if ((x >= x0 && x <= x1) || (x <= x0 && x >= x1)) return x1 === x0 ? y0 : y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
  }
  return pts[pts.length - 1][1];
}

/** Where a sampled, falling profile reaches height y. @param {[number, number][]} pts @param {number} y */
export function xAt(pts, y) {
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    if ((y >= y0 && y <= y1) || (y <= y0 && y >= y1)) return y1 === y0 ? x0 : x0 + ((y - y0) * (x1 - x0)) / (y1 - y0);
  }
  return pts[pts.length - 1][0];
}

/** A path through points. @param {[number, number][]} pts */
export const polyline = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('');

/**
 * A straight line from a to b with small ripples across it (sand ripples on a slope).
 * @param {number} ax @param {number} ay @param {number} bx @param {number} by @param {number} amp @param {number} step
 */
export function ripple(ax, ay, bx, by, amp, step) {
  const len = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(len / step));
  const ux = (bx - ax) / len, uy = (by - ay) / len, nx = uy, ny = -ux;
  let d = `M${f(ax)} ${f(ay)}`;
  for (let i = 0; i < n; i++) {
    const s0 = (i / n) * len, s1 = ((i + 1) / n) * len, sm = (s0 + s1) / 2, k = i % 2 ? -amp : amp;
    d += `Q${f(ax + ux * sm + nx * k)} ${f(ay + uy * sm + ny * k)} ${f(ax + ux * s1)} ${f(ay + uy * s1)}`;
  }
  return d;
}

/** A wavy horizontal line. @param {number} x0 @param {number} x1 @param {number} y @param {number} amp @param {number} step */
export function wave(x0, x1, y, amp, step) {
  let d = `M${f(x0)} ${f(y)}`;
  for (let x = x0, up = true; x < x1; x += step, up = !up) d += `Q${f(x + step / 2)} ${f(y + (up ? -amp : amp))} ${f(Math.min(x1, x + step))} ${f(y)}`;
  return d;
}
