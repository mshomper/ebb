// @ts-check
// The journal sketch of a living catch from the nets (docs/future/12, K6): traced from the very
// animal you first let go of that kind (its seed is kept in the nets' released list, src/world/
// nets/model.js), so every island's sand eel page shows its own sand eel. Before one is let go the
// page draws, in pencil, a plain one of its kind. Tracings are kept per animal for the visit.
// A net fish sketched on the fishing line (docs/future/17) is drawn from that fish instead (fish.js).

import { traceKeepsake } from './keepsake.js';
import { drawTracedData } from './traced.js';
import { registerSketch } from './index.js';
import { catchMesh, catchNumbers, catchLook } from '../../world/nets/living/index.js';
import { traceFish, drawFish } from './fish.js';

/** @type {Map<string, import('./trace.js').Traced>} */
const TRACED = new Map();

/**
 * Register a sketch for each living kind's journal page (the moon jelly keeps its own drawing).
 * @param {any} NR recipes/world/nets.json @param {() => { kind: string, seed: number, rarity?: string }[]} released the
 *   nets' released list, first of each kind first
 * @param {(kind: string) => any} [onLine] a net fish's gen 2 numbers once sketched on the line (else null), and the fishing recipe as onLine.FR
 */
export function registerCatchSketches(NR, released, onLine) {
  for (const [kind, k] of Object.entries(NR.catches.kinds)) {
    if (k.plan === 'jelly') continue;
    registerSketch(k.journal ?? kind, (p, scale) => {
      const line = onLine?.(kind);
      if (line) return drawFish(p, traceFish(line.n, line.FR), scale, k.name);
      const r = released().find((e) => e.kind === kind);
      const n = catchNumbers(r?.seed ?? 1, kind, r?.rarity ?? 'common', NR);
      const key = `${kind}:${n.seed}`;
      let T = TRACED.get(key);
      if (!T) { T = traceKeepsake(catchMesh(n, NR), {}, catchLook(n).view); TRACED.set(key, T); }
      // Shallow water behind it, then the animal, as wide as the page allows.
      p.tint('M44 60H346V220H44Z', '#C9DCE0', 0.3);
      const w = Math.min(270, 140 / Math.max(T.aspect, 0.05)), h = T.aspect * w;
      const x0 = 200 - w / 2, y0 = 140 - h / 2;
      drawTracedData(p, T, x0, y0, w, { creases: 30, hatch: 3.6 });
      p.scale(30, y0, y0 + h, scale);
      return p.svg(380, 245, `Field sketch of a ${k.name.toLowerCase()}`);
    });
  }
}
