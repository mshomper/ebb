// @ts-check
// The angler's chart, the Keeper book's Chart tab (docs/future/17; the mockup is
// tools/angler-chart.html). A sea chart of the island's own waters in the keeper's hand: pencil
// first (the coast, the water names, the depth lines, the marks, the compass and the title), then
// each sketch inks part of it (its water's coast, depth line, soundings and marks, the fish itself),
// a finished water inks its name and a line in the legend, the compass inks by quarters, a riddle for
// a rare fish inks about every second sketch with its numbered mark, and the frame and title ink
// with the last ordinary fish. No count anywhere: the chart shows how far along it is. The layout is
// src/world/fishing/chart.js (pure, cached by the coast); tapping a fish or a riddle says more.
// Shown once the line is made (or a fish is sketched). Styles: keeper-book.css (.ebb-chart).

import { chartLayout, chartInk, CHART_W, CHART_H, TEXT } from '../world/fishing/chart.js';
import { fishNumbers } from '../world/nets/living/fish2.js';
import { traceFish } from './sketches/fish.js';
import { drawTracedData } from './sketches/traced.js';
import { makePen } from './sketches/pen.js';
import { iconSvg } from './icons/icons.js';

/** @param {any} s */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
const f1 = (/** @type {number} */ v) => v.toFixed(1);
const path = (/** @type {number[][]} */ P, closed = false) => P.map((p, i) => `${i ? 'L' : 'M'}${f1(p[0])} ${f1(p[1])}`).join('') + (closed ? 'Z' : '');
/** The conditions' drawn marks. */
const COND = /** @type {Record<string, string>} */ ({ night: 'cond-night', dawn: 'cond-dawn', day: 'cond-day', rain: 'cond-rain', mist: 'cond-mist', storm: 'cond-storm',
  low: 'cond-low', high: 'cond-high', sparkle: 'cond-sparkle', spring: 'season-spring', summer: 'season-summer', autumn: 'season-autumn', winter: 'season-winter' });

/**
 * @param {{ fishing: any, recipe: any }} o fishing: the live fishing (its fish, chartIsland, sketchedNow);
 *   recipe: recipes/world/fishing.json
 */
export function createChartView(o) {
  const FR = o.recipe, W = FR.words, C = FR.chart;
  const fish = o.fishing.fish().filter((/** @type {any} */ f) => f.kind !== 'rare');
  const rare = o.fishing.fish().filter((/** @type {any} */ f) => f.kind === 'rare');
  const rareBy = new Map(FR.rare.map((/** @type {any} */ r) => [r.id, r]));
  /** @type {{ key: string, L: any } | null} */ let cache = null;
  /** @type {Map<string, string>} */ const thumbs = new Map();
  /** @type {{ kind: 'fish' | 'riddle', id: string } | null} */ let picked = null;

  /** The layout for the island as it is (cached by its coast, so a reshaped coast redraws it). */
  function layout() {
    const isl = o.fishing.chartIsland();
    const key = isl.coast.map((/** @type {any} */ p) => `${Math.round(p.x)},${Math.round(p.z)},${p.water[0]}`).join(';') + isl.deepAngle.toFixed(1);
    if (cache?.key === key) return cache.L;
    const L = chartLayout(isl, fish, rare.map((/** @type {any} */ f) => ({ id: f.id, water: f.water, mark: /** @type {any} */ (rareBy.get(f.id)).mark })),
      { waters: W.waters, title: C.title, seed: 20261031 });
    cache = { key, L };
    return L;
  }

  /** A fish's thumbnail, traced from the fish its page was drawn from, as an image. @param {any} f @param {number} seed */
  function thumb(f, seed) {
    const k = `${f.id}:${seed}`;
    let url = thumbs.get(k);
    if (!url) {
      const T = traceFish(fishNumbers(f.id, f.ref, seed, FR), FR);
      const p = makePen(1, {});
      const w = Math.min(140, 84 / Math.max(T.aspect, 0.05)), h = T.aspect * w;
      drawTracedData(p, T, 76 - w / 2, 47 - h / 2, w, { creases: 18, hatch: 3 });
      const svg = p.svg(152, 94, f.name);
      // As an image, the drawing needs its namespace.
      url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.includes('xmlns=') ? svg : svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'))}`;
      thumbs.set(k, url);
    }
    return url;
  }

  /** What most of a water's fish take, and when more bite (the legend line). @param {string} w */
  function waterNote(w) {
    const mine = fish.filter((/** @type {any} */ f) => f.water === w);
    /** @type {Record<string, number>} */ const c = { small: 0, big: 0, either: 0 };
    for (const f of mine) c[f.bait]++;
    const bait = c.small >= c.big + 1 && c.small >= c.either ? C.most.replace('{bait}', W.bait.small) : c.big >= c.small + 1 && c.big >= c.either ? C.most.replace('{bait}', W.bait.big) : C.either;
    /** @type {Record<string, number>} */ const when = {};
    for (const f of mine) for (const k of f.when) when[k] = (when[k] ?? 0) + 1;
    const top = Object.entries(when).sort((a, b) => b[1] - a[1])[0];
    return top && top[1] >= 2 ? `${bait} ${C.more.replace('{when}', W.when[top[0]])}` : bait;
  }

  const view = {
    /** Is the tab shown: once the line is made, or a fish is sketched. */
    shown: () => o.fishing.hasLine() || o.fishing.sketchedNow().size > 0,

    /** The page, as HTML. @param {any} st the fishing section */
    html(st) {
      const L = layout();
      const sk = o.fishing.sketchedNow();
      const ink = chartInk(fish, sk, rare.length);
      /** An element pencilled, and inked over it when its test holds. */
      const both = (/** @type {string} */ el, /** @type {boolean} */ on, /** @type {string} */ pen = 'ebb-chart__pen', /** @type {string} */ inked = 'ebb-chart__ink') =>
        `${el.replace('CLS', pen)}${on ? el.replace('CLS', inked) : ''}`;
      let svg = `<svg class="ebb-chart__svg" viewBox="0 0 ${CHART_W} ${CHART_H}" role="img" aria-label="${esc(C.aria)}">`;
      svg += `<defs><clipPath id="ebb-chart-clip"><rect x="41" y="41" width="918" height="618"/></clipPath></defs>`;
      // The frame: pencil, inked when the chart is full.
      for (const p of [30, 40]) svg += both(`<rect x="${p}" y="${p}" width="${CHART_W - 2 * p}" height="${CHART_H - 2 * p}" rx="4" class="CLS${p === 40 ? ' is-thin' : ''}"/>`, ink.full);
      svg += `<g clip-path="url(#ebb-chart-clip)">`;
      // The sea's wash deepens as each water fills; the deep corner past the drop-off.
      L.contours.forEach((/** @type {any} */ c, /** @type {number} */ i) => {
        svg += `<path d="${path([...L.runs[i].pts, ...c.pts.slice().reverse()], true)}" class="ebb-chart__wash" style="opacity:${ink.wash(c.water).toFixed(3)}"/>`;
      });
      svg += `<path d="${path([...L.drop, L.deepCorner], true)}" class="ebb-chart__wash" style="opacity:${ink.wash('deep').toFixed(3)}"/>`;
      svg += `<path d="${path(L.land, true)}" class="ebb-chart__land"/>`;
      svg += `<path d="${path(L.land, true)}" class="ebb-chart__pen"/>`;
      for (const r of L.runs) if (ink.coast(r.water)) svg += `<path d="${path(r.pts)}" class="ebb-chart__ink is-coast"/>`;
      for (const c of L.contours) svg += both(`<path d="${path(c.pts)}" class="CLS is-thin is-dash"/>`, ink.contour(c.water));
      svg += both(`<path d="${path(L.drop)}" class="CLS"/>`, ink.drop());
      for (const t of L.ticks) if (ink.tick(t.i)) svg += `<path d="M${f1(t.x0)} ${f1(t.y0)}L${f1(t.x1)} ${f1(t.y1)}" class="ebb-chart__ink is-thin"/>`;
      // Each water's marks: rocks, stipple, fronds, waves.
      for (const ft of L.features) {
        const x = ft.x, y = ft.y;
        const d = ft.water === 'reef' ? `M${f1(x - 5)} ${f1(y - 5)}l10 10M${f1(x + 5)} ${f1(y - 5)}l-10 10` : ft.water === 'sand' ? `M${f1(x)} ${f1(y)}h.1`
          : ft.water === 'kelp' ? `M${f1(x)} ${f1(y + 11)}c-5-4 5-7 0-11s5-7 0-11` : `M${f1(x - 11)} ${f1(y)}c4-5 7-5 11 0s7 5 11 0`;
        svg += both(`<path d="${d}" class="CLS${ft.water === 'sand' ? ' is-stip' : ''}"/>`, ink.feature(ft.water, ft.i, ft.of));
      }
      // Soundings, inked as their water fills.
      for (const s of L.soundings) if (ink.sounding(s.water, s.i)) svg += `<text x="${f1(s.x)}" y="${f1(s.y + 7)}" class="ebb-chart__sound">${s.v}</text>`;
      // Water names: pencil, inked when the water is finished.
      for (const l of L.labels) {
        const t = `<text x="${f1(l.x)}" y="${f1(l.y + l.size * 0.35)}" class="CLS" style="font-size:${l.size}px" text-anchor="middle">${esc(W.waters[l.water])}</text>`;
        svg += both(t, ink.finished(l.water), 'ebb-chart__label is-pencil', 'ebb-chart__label');
      }
      // The compass inks a quarter at a time; the title with the last fish.
      if (L.compass) {
        const [cx, cy] = [L.compass[0], L.compass[1] + 18];
        svg += both(`<circle cx="${f1(cx)}" cy="${f1(cy)}" r="44" class="CLS is-thin"/>`, ink.compass(0));
        [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([dx, dy], i) => {
          const len = i ? 48 : 62, w = 11, tip = [cx + dx * len, cy + dy * len], a = [cx - dy * w, cy + dx * w], b = [cx + dy * w, cy - dx * w];
          svg += both(`<path d="M${f1(tip[0])} ${f1(tip[1])}L${f1(a[0])} ${f1(a[1])}L${f1(cx)} ${f1(cy)}L${f1(b[0])} ${f1(b[1])}Z" class="CLS${i % 2 ? ' is-hollow' : ' is-solid'}"/>`, ink.compass(i));
        });
        svg += both(`<text x="${f1(cx)}" y="${f1(cy - 66)}" class="CLS" style="font-size:${TEXT.small}px" text-anchor="middle">N</text>`, ink.compass(0), 'ebb-chart__label is-pencil', 'ebb-chart__label');
      }
      if (L.title) {
        const [tx, ty] = L.title;
        svg += both(`<rect x="${f1(tx - 185)}" y="${f1(ty - 31)}" width="370" height="62" rx="6" class="CLS is-thin"/>`, ink.full);
        svg += both(`<text x="${f1(tx)}" y="${f1(ty + 15)}" class="CLS" text-anchor="middle">${esc(C.title)}</text>`, ink.full, 'ebb-chart__title is-pencil', 'ebb-chart__title');
      }
      // The rare fish's numbered marks, each with its riddle.
      for (const r of L.rares) {
        if (!ink.riddle(r.i)) continue;
        const sel = picked?.kind === 'riddle' && picked.id === r.id ? ' is-picked' : '';
        svg += `<g class="ebb-chart__rare${sel}" data-chart-riddle="${esc(r.id)}" transform="translate(${f1(r.x)} ${f1(r.y)})"><circle r="24" class="ebb-chart__ring"/><circle r="15" class="ebb-chart__dot"/>`
          + `<text y="6" text-anchor="middle" class="ebb-chart__num">${r.i + 1}</text><circle r="27" class="ebb-chart__hit"/></g>`;
      }
      // The fish: inked from their sketches; a glimpsed one in faint pencil.
      for (const m of L.fishMarks) {
        const f = fish.find((/** @type {any} */ x) => x.id === m.id);
        if (!f) continue;
        const on = sk.has(f.id), seen = !on && st?.glimpsed?.[f.id] !== undefined;
        if (!on && !seen) continue;
        const seed = st?.sketched?.[f.id]?.seed ?? 1;
        const sel = picked?.kind === 'fish' && picked.id === f.id ? ' is-picked' : '';
        svg += `<g class="ebb-chart__fish${seen ? ' is-glimpse' : ''}${sel}" data-chart-fish="${esc(f.id)}" transform="translate(${f1(m.x)} ${f1(m.y)})">`
          + `<image href="${thumb(f, seed)}" x="-38" y="-23.5" width="76" height="47"/><rect x="-38" y="-23.5" width="76" height="47" class="ebb-chart__hit"/></g>`;
      }
      svg += '</g></svg>';
      // The legend: a line for each finished water.
      const legend = FR.waters.order.map((/** @type {string} */ w) => `<li class="${ink.finished(w) ? 'is-on' : ''}"><b>${esc(W.waters[w])}</b>${ink.finished(w)
        ? `<span class="ebb-chart__note">${esc(waterNote(w))}</span>` : '<span class="ebb-chart__blank" aria-label="Not yet"></span>'}</li>`).join('');
      // The riddles, numbered as their marks, each with its conditions drawn beside it.
      const riddles = rare.map((/** @type {any} */ f, /** @type {number} */ i) => {
        const r = /** @type {any} */ (rareBy.get(f.id)), on = ink.riddle(i), sel = picked?.kind === 'riddle' && picked.id === f.id ? ' is-picked' : '';
        return `<li class="${on ? 'is-on' : ''}${sel}"${on ? ` data-chart-riddle="${esc(f.id)}"` : ''}><span class="ebb-chart__n">${i + 1}</span>${on
          ? `<span class="ebb-chart__riddle">${esc(r.riddle)}</span><span class="ebb-chart__conds">${r.when.map((/** @type {string} */ c) => `<span class="ebb-chart__cond" title="${esc(W.when[c])}">${iconSvg(COND[c] ?? 'notes')}</span>`).join('')}</span>`
          : '<span class="ebb-chart__blank" aria-label="Not yet"></span>'}</li>`;
      }).join('');
      return `<article class="ebb-chart">${svg}<p class="ebb-chart__cap" aria-live="polite">${view.caption(sk)}</p>
        <ul class="ebb-chart__legend">${legend}</ul>
        <section class="ebb-chart__notes"><h3>${esc(ink.riddles ? C.notes : C.notesNone)}</h3><ol class="ebb-chart__riddles">${riddles}</ol></section></article>`;
    },

    /** The line under the chart for what was tapped. @param {Set<string>} sk */
    caption(sk) {
      if (!picked) return esc(C.tap);
      if (picked.kind === 'fish') {
        const f = fish.find((/** @type {any} */ x) => x.id === picked?.id);
        if (!f) return '';
        if (!sk.has(f.id)) return esc(C.glimpsed);
        const when = f.when.length ? ` ${C.more.replace('{when}', f.when.map((/** @type {string} */ c) => W.when[c]).join(` ${FR.pages.and} `))}` : '';
        return `<b>${esc(f.name)}</b> ${esc(`${W.waters[f.water]}. ${C.takes.replace('{bait}', W.bait[f.bait])}${when}`)}`;
      }
      const i = rare.findIndex((/** @type {any} */ f) => f.id === picked?.id), r = /** @type {any} */ (rareBy.get(picked.id));
      return r ? `<b>${i + 1}.</b> <i>${esc(r.riddle)}</i>` : '';
    },

    /** A tap on the page: a fish or a riddle says more. Returns whether it was one. @param {HTMLElement} t */
    click(t) {
      const el = /** @type {HTMLElement | null} */ (t.closest('[data-chart-fish],[data-chart-riddle]'));
      if (!el) return false;
      picked = el.dataset.chartFish ? { kind: 'fish', id: el.dataset.chartFish } : { kind: 'riddle', id: /** @type {string} */ (el.dataset.chartRiddle) };
      return true;
    },
  };
  return view;
}
