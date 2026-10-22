// @ts-check
// The journal sketches of what lives under a log (docs/future/11 L3a): woodlice and the violet ground
// beetle, each traced from above from its own model (src/world/finds/under-log-meshes.js) and drawn in
// the journal pen on the damp earth a lifted log leaves; and the loose stone, tipped up on one edge
// over its damp patch. Registered once the recipe is in (src/main.js); traced once per visit.

import { registerSketch } from './index.js';
import { trace } from './trace.js';
import { drawTracedData } from './traced.js';
import { woodlouseMesh, beetleMesh } from '../../world/finds/under-log-meshes.js';

const EARTH = '#8A7358', DAMP = '#5E4C3A', GRASS = '#93A86A', STONE = '#B8B2A6';

/**
 * Register the woodlice, groundbeetle and loosestone sketches. @param {any} R recipes/species/under-log.json
 */
export function registerUnderLogSketches(R) {
  /** @type {Record<string, import('./trace.js').Traced>} */ const traced = {};
  /** Traced from above, head up the page. @param {'woodlice' | 'beetle'} sp */
  const of = (sp) => (traced[sp] ??= trace(sp === 'woodlice' ? woodlouseMesh(R.woodlice.shape) : beetleMesh(R.beetle.shape), 180, 82, { cells: 200 }));

  registerSketch('woodlice', (p, scale) => {
    const T = of('woodlice');
    // The damp patch a lifted log leaves, the log's rounded edge along the top.
    p.tint('M30 70C120 58 260 60 352 72V226C260 236 120 234 30 224Z', DAMP, 0.35);
    p.shape('M24 22C130 14 250 16 356 24C360 36 360 48 356 58C250 52 130 52 24 58C20 46 20 34 24 22Z', '#C9C2B4', 0.45, 1.4);
    p.fine('M40 34C140 28 240 30 340 36M44 46C150 42 240 42 336 46', 0.8, 0.45);
    // Two small ones tucked in at the side, one large in the middle.
    drawTracedData(p, T, 52, 150, 44, { hatch: 0, creases: 10 });
    drawTracedData(p, T, 176, 166, 38, { mirror: true, hatch: 0, creases: 10 });
    const w = Math.min(120, 150 / Math.max(T.aspect, 0.05)), h = T.aspect * w;
    const x0 = 140 - w / 2, y0 = 142 - h / 2;
    const at = drawTracedData(p, T, x0, y0, w, { creases: 30, hatch: 3 }).at;
    p.label('antennae', 226, 84, ...at(0.68, 0.06 * T.aspect));
    p.label('plates', 226, 136, ...at(0.6, 0.45 * T.aspect));
    p.label('legs', 226, 188, ...at(0.9, 0.62 * T.aspect));
    p.label('tail', 226, 232, ...at(0.52, 0.96 * T.aspect));
    p.scale(24, y0 + h * 0.1, y0 + h * 0.9, scale);
    return p.svg(380, 245, 'Field sketch of woodlice in the damp under a lifted log');
  });

  registerSketch('groundbeetle', (p, scale) => {
    const T = of('beetle');
    p.tint('M30 40H352V226H30Z', GRASS, 0.25);
    p.fine('M40 220C44 200 40 186 46 176M70 224C72 206 80 196 78 182M310 222C312 204 306 194 314 180M340 224C336 206 344 196 342 184', 0.8, 0.5);
    const w = Math.min(170, 190 / Math.max(T.aspect, 0.05)), h = T.aspect * w;
    const x0 = 130 - w / 2, y0 = 128 - h / 2;
    const at = drawTracedData(p, T, x0, y0, w, { creases: 34, hatch: 2.6 }).at;
    // The violet rim along the wing cases, only once the page has learned it.
    if (p.knows('rim') && p.wash) {
      const [lx, ly] = at(0.3, 0.62 * T.aspect), [rx, ry] = at(0.7, 0.62 * T.aspect);
      p.raw(`<path d="M${p.f(lx)} ${p.f(ly - h * 0.18)}Q${p.f(lx - 4)} ${p.f(ly + h * 0.1)} ${p.f((lx + rx) / 2)} ${p.f(ly + h * 0.28)}Q${p.f(rx + 4)} ${p.f(ry + h * 0.1)} ${p.f(rx)} ${p.f(ry - h * 0.18)}" fill="none" stroke="#7B58B0" stroke-width="2.2" opacity="0.55"/>`);
    }
    p.label('jaws', 236, 50, ...at(0.55, 0.04 * T.aspect));
    p.label('cases', 236, 104, ...at(0.55, 0.55 * T.aspect));
    p.label('rim', 236, 158, ...at(0.7, 0.66 * T.aspect));
    p.label('legs', 236, 212, ...at(0.92, 0.78 * T.aspect));
    p.scale(24, y0 + h * 0.05, y0 + h * 0.95, scale);
    return p.svg(380, 245, 'Field sketch of a violet ground beetle from above');
  });

  registerSketch('loosestone', (p, scale) => {
    const f = p.f, g = 200;
    // The ground, the damp patch the stone lay on, and the stone tipped up on its far edge.
    p.tint(`M30 ${g}H350V236H30Z`, EARTH, 0.25);
    p.line(`M30 ${g}C120 ${g - 2} 250 ${g + 2} 350 ${g}`, 1.3);
    p.oval(170, g + 10, 82, 16, DAMP, 0.5, 1.1);
    p.fine(`M110 ${g + 8}C140 ${g + 4} 180 ${g + 6} 210 ${g + 12}M126 ${g + 16}C150 ${g + 14} 190 ${g + 16} 220 ${g + 20}`, 0.7, 0.5);
    p.shape(`M232 ${g + 2}C222 150 230 92 262 70C292 50 330 66 336 104C342 142 320 184 288 ${g + 4}C270 ${g + 8} 246 ${g + 8} 232 ${g + 2}Z`, STONE, 0.55, 1.5);
    p.fine('M252 96C262 84 280 78 296 82M244 136C256 128 270 126 284 130M300 120C310 136 312 154 306 170', 0.8, 0.5);
    // A small arc where it was tipped back.
    p.fine(`M204 92C214 74 232 64 252 62M244 56L252 62L246 70`, 1, 0.6);
    p.label('damp', 30, 156, 150, g + 8);
    p.label('edge', 30, 108, 236, g);
    p.scale(360, 66, g, scale);
    return p.svg(380, 245, 'Field sketch of a loose stone tipped up over the damp earth it lay on');
  });
}
