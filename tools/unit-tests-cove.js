// @ts-check
// The cove field for tools/unit-tests.html (docs/future/12): how sheltered each shore cell is. An open
// coast scores low, the head of a U-shaped bay scores high and the score rises toward it, the same
// input gives the same field, and cells off the shore are 0.

import { coveField } from '../src/world/water/cove.js';
import { WATER_CLASS } from '../src/world/water/summary.js';

const G = 'cove';

/**
 * A water summary over a rect from a sea mask: sea cells where `isSea(i, j)`, and shore (band) for
 * every cell within `reach` cells of the water's edge, sea or land. Dry land elsewhere.
 * @param {number} w @param {number} h @param {(i: number, j: number) => boolean} isSea @param {number} [reach]
 */
function summaryOf(w, h, isSea, reach = 4) {
  const n = w * h, cls = new Uint8Array(n), shore = new Uint8Array(n), band = new Uint8Array(n);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) cls[j * w + i] = isSea(i, j) ? WATER_CLASS.sea : WATER_CLASS.dry;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      let edge = false;
      for (let dj = -reach; dj <= reach && !edge; dj++) {
        for (let di = -reach; di <= reach; di++) {
          const x = i + di, y = j + dj;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          if (cls[y * w + x] !== cls[k]) { edge = true; break; }
        }
      }
      if (edge) { shore[k] = 100; band[k] = 1; }
    }
  }
  return { rect: { x: 100, y: 100, w, h }, cls, shore, band };
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addCoveTests(test, assert, eq) {
  const recipe = fetch('../recipes/world/cove.json').then((r) => r.json());

  // 200 x 200 cells (100 m). Open coast: sea to the west of column 60, land to the east.
  const COAST = () => summaryOf(200, 200, (i) => i < 60);
  // U-shaped bay: the same coast, with a bay 24 cells (12 m) wide cut 60 cells (30 m) into the land,
  // its head round at column 120, centered on row 100.
  const BAY_W = 24, BAY_HEAD = 120;
  const bay = () => summaryOf(200, 200, (i, j) => {
    if (i < 60) return true;
    const dj = Math.abs(j - 100);
    if (i <= BAY_HEAD - BAY_W / 2) return dj < BAY_W / 2;
    return Math.hypot(i - (BAY_HEAD - BAY_W / 2), dj) < BAY_W / 2;
  });

  test(G, 'a straight open coast scores low', async () => {
    const R = await recipe, s = COAST(), f = coveField(s, R);
    let max = 0, scored = 0;
    for (let j = 40; j < 160; j++) for (let i = 50; i < 70; i++) {
      const v = f[j * 200 + i];
      if (s.shore[j * 200 + i]) scored++;
      if (v > max) max = v;
    }
    assert(scored > 100, `the coast has shore cells (${scored})`);
    assert(max < 40, `open coast peaks at ${max}`);
  });

  test(G, 'the head of a U-shaped bay scores high, and the score rises toward it', async () => {
    const R = await recipe, s = bay(), f = coveField(s, R);
    // Dry cell at the head, just beyond the water on the bay's axis; and the bank beside the water
    // (one cell past the side wall) at 6, 14, 22 and 30 m in from the mouth.
    const head = f[100 * 200 + (BAY_HEAD + 1)];
    assert(head >= 150, `bay head scores ${head}`);
    const bank = (/** @type {number} */ col) => f[(100 + BAY_W / 2 + 1) * 200 + col];
    const along = [72, 88, 104].map(bank);
    assert(along[0] < along[1] && along[1] < along[2], `rising along the bank: ${along.join(', ')}`);
    assert(along[0] < head, 'the head beats the mouth');
    const coast = f[100 * 200 + 30 + 40];   // not on the shore: land far from any water
    eq(coast, 0, 'inland of the shore is 0');
  });

  test(G, 'the same input gives the same field, and the recipe sets the rays', async () => {
    const R = await recipe, s = bay();
    const a = coveField(s, R), b = coveField(bay(), R);
    eq(a.length, b.length);
    let same = true;
    for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) { same = false; break; }
    assert(same, 'two runs differ');
    const c = coveField(s, { ...R, rays: 8 });
    let differs = false;
    for (let k = 0; k < a.length; k++) if (a[k] !== c[k]) { differs = true; break; }
    assert(differs, 'fewer rays should change the field');
  });

  test(G, 'cells off the shore are 0, and so is a summary with no shore at all', async () => {
    const R = await recipe, s = bay(), f = coveField(s, R);
    for (let k = 0; k < f.length; k++) if (!s.shore[k]) assert(f[k] === 0, `cell ${k} is off the shore but scores ${f[k]}`);
    let any = 0;
    for (let k = 0; k < f.length; k++) if (f[k]) any++;
    assert(any > 100, 'the shore has scored cells');
    const none = summaryOf(60, 60, () => false);
    const g = coveField(none, R);
    assert(g.every((v) => v === 0), 'no shore, no field');
  });
}
