// @ts-check
// ebb shore lab (docs/future/10, step Z1): the live island, which you can shape and paint, and a map
// of the shore zones it works out (src/world/water/shore.js) from the water summary's shore height
// and the painted ground. A sea-level slider shows what each tide uncovers. The map follows the
// island: it redraws when the water summary is rebuilt after an edit, and when paint changes.

import { startApp } from '../src/app.js';
import { get } from '../src/core/store.js';
import { loadRecipe } from '../src/core/recipes.js';
import { mountTools } from '../src/ui/tools.js';
import { mountHud } from '../src/ui/hud.js';
import { shoreZones, groundOfCell } from '../src/world/water/shore.js';
import { WORLD_CELLS } from '../src/world/terrain/grid.js';

/** Zone colors for the map (a tool page; the game's look comes from the palette, later). */
/** @type {Record<string, number[]>} */
const ZONE_RGB = {
  kelp: [47, 93, 58], wrack: [138, 106, 43], channelled: [184, 146, 66], lichen: [44, 44, 42],
  ripples: [214, 190, 132], wetSand: [176, 160, 122], mud: [107, 84, 64],
};
const OTHER_RGB = [200, 90, 140];
const GROUND_RGB = [[143, 168, 103], [227, 211, 165], [150, 146, 136], [138, 110, 82]];
const WATER_RGB = [59, 127, 168];

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const map = /** @type {HTMLCanvasElement} */ ($('map'));
const level = /** @type {HTMLInputElement} */ ($('level'));

const [shoreRecipe, waterRecipe] = await Promise.all([loadRecipe('world/shore'), loadRecipe('world/water')]);
const A0 = waterRecipe.tide.amplitudeM;
const names = Object.fromEntries(shoreRecipe.zones.map((/** @type {any} */ z) => [z.id, z.name]));

const r = await startApp(/** @type {HTMLCanvasElement} */ ($('view')));
if (!r.ok) {
  $('status').textContent = `WebGPU is not available here (${r.reason}). Open this page in current Chrome or Edge.`;
} else {
  // The game's tool bar, on the game's HUD layer (it keeps to the window's edges).
  mountTools((await mountHud(document.body)).layer);
  const app = /** @type {any} */ (r);
  /** @type {any} */ let lastSummary = null;
  let lastMaterialSum = -1;
  /** @type {ReturnType<typeof shoreZones> | null} */ let zones = null;
  /** @type {Float32Array | null} */ let bed = null;
  /** @type {Uint8Array | null} */ let ground = null;

  /** Recompute when the summary or the paint changed; cheap enough to check twice a second. */
  const refresh = () => {
    const s = app.water.getSummary();
    const mirror = get('terrainLive')?.mirror;
    if (!s || !s.shore || !mirror) return;
    const sum = checksum(mirror.material);
    if (s === lastSummary && sum === lastMaterialSum) return;
    lastSummary = s; lastMaterialSum = sum;
    zones = shoreZones({ summary: s, material: mirror.material, recipe: shoreRecipe, amplitudeM: A0 });
    ({ bed, ground } = cells(s.rect, mirror));
    draw();
  };

  const draw = () => {
    if (!zones || !bed || !ground) return;
    const { rect, zone, ids, cells: counts } = zones;
    const sea = Number(level.value) * A0;
    $('level-out').textContent = `${sea >= 0 ? '+' : ''}${sea.toFixed(2)} m`;
    map.width = rect.w; map.height = rect.h;
    const g = /** @type {CanvasRenderingContext2D} */ (map.getContext('2d'));
    const img = g.createImageData(rect.w, rect.h);
    const under = new Array(ids.length).fill(0);
    for (let k = 0; k < rect.w * rect.h; k++) {
      const z = zone[k];
      let c = z ? (ZONE_RGB[ids[z - 1]] ?? OTHER_RGB) : GROUND_RGB[ground[k]];
      if (bed[k] < sea) {
        // Under the sea: water over it, the zone still faintly there.
        const t = z ? 0.55 : 0.85;
        c = [0, 1, 2].map((q) => c[q] * (1 - t) + WATER_RGB[q] * t);
        if (z) under[z - 1]++;
      }
      img.data.set([c[0], c[1], c[2], 255], k * 4);
    }
    g.putImageData(img, 0, 0);
    $('legend').innerHTML = ids.map((id, i) => {
      const c = ZONE_RGB[id] ?? OTHER_RGB;
      const m2 = counts[i] * 0.25;
      const out = counts[i] ? Math.round((100 * (counts[i] - under[i])) / counts[i]) : 0;
      return `<span><i style="background:rgb(${c.join(',')})"></i>${names[id] ?? id}<b>${m2.toFixed(0)} m²${counts[i] ? `, ${out}% out` : ''}</b></span>`;
    }).join('');
    const total = counts.reduce((a, b) => a + b, 0) * 0.25;
    $('status').textContent = `${total.toFixed(0)} m² of shore in zones, one square per 0.5 m, north up.`;
  };

  level.addEventListener('input', draw);
  for (const b of $('tides').querySelectorAll('button')) {
    b.addEventListener('click', () => { level.value = /** @type {HTMLElement} */ (b).dataset.a0 ?? '0'; draw(); });
  }
  setInterval(refresh, 500);
  refresh();
}

/**
 * Bed (meters, the lowest of each water cell's 2 x 2 terrain cells, as the summary takes it) and
 * the painted ground per water cell, for drawing.
 * @param {{x:number,y:number,w:number,h:number}} rect @param {{ heightF: Float32Array, material: Uint8Array }} mirror
 */
function cells(rect, mirror) {
  const T = WORLD_CELLS, n = rect.w * rect.h;
  const bed = new Float32Array(n), ground = new Uint8Array(n);
  for (let j = 0; j < rect.h; j++) {
    for (let i = 0; i < rect.w; i++) {
      const cx = rect.x + i, cy = rect.y + j, k = j * rect.w + i;
      let m = Infinity;
      for (let s = 0; s < 4; s++) {
        const h = mirror.heightF[(2 * cy + (s >> 1)) * T + 2 * cx + (s & 1)];
        if (h < m) m = h;
      }
      bed[k] = m;
      ground[k] = groundOfCell(mirror.material, cx, cy);
    }
  }
  return { bed, ground };
}

/** A quick sum that changes when paint changes. @param {Uint8Array} a */
function checksum(a) {
  let h = 0;
  for (let k = 0; k < a.length; k += 7) h = (h * 31 + a[k]) | 0;
  return h;
}
