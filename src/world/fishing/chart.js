// @ts-check
// The angler's chart (docs/future/17; worked out in tools/angler-chart.html): a hand-drawn sea chart
// of the island's own waters, laid out from its coast. The coast comes from the island (a ring of
// shore points round its middle, each with the near water it faces: reef, sand flats or kelp);
// open water lies offshore and deep water past a drop-off across the frame's corner on the side
// where the sea floor falls away soonest. Nothing has a fixed place: the lines go down first (the
// frame, the coast, each water's depth line, the drop-off), the compass and the title reserve
// their corners, and then water names, rare-fish marks, fish, soundings and water marks are placed
// in that order, each only where it is clear of everything placed and every line, with air round
// it (Matt, October 31, 2026: "make sure that all the text and everything has the proper spacing").
// Text is measured by an estimate, the same for the page and the tests. chartInk says what is
// inked for the sketches so far, the mockup's rules; chartFlags the journal flags its thread reads.
// Pure.

import { stream } from '../../core/rng.js';

/** The chart's frame (SVG units). */
export const CHART_W = 1000, CHART_H = 700;
const BX0 = 52, BY0 = 52, BX1 = 948, BY1 = 648;
/** Sizes of what is placed. */
const FISH = [76, 47], RARE = 56, SOUND = [34, 24], COMPASS = [112, 166], CART = [370, 62];
/** Text sizes (px) and the estimate of a character's width as a share of its size (Fraunces italic). */
export const TEXT = { label: 32, small: 24, sound: 20, title: 46, charShare: 0.52 };

/** @typedef {{ x0: number, y0: number, x1: number, y1: number }} Box */
/** @typedef {{ x: number, z: number, water: string }} CoastPoint a shore point in world meters and the near water it faces */

/** Estimated width of a line of text. @param {string} text @param {number} size */
export const textWidth = (text, size) => text.length * size * TEXT.charShare;

const hit = (/** @type {Box} */ a, /** @type {Box} */ b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const grow = (/** @type {Box} */ b, /** @type {number} */ p) => ({ x0: b.x0 - p, y0: b.y0 - p, x1: b.x1 + p, y1: b.y1 + p });
const boxAt = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ h) => ({ x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 });

/** A point in a polygon (even-odd). @param {number} x @param {number} y @param {number[][]} P */
function inside(x, y, P) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    if ((P[i][1] > y) !== (P[j][1] > y) && x < ((P[j][0] - P[i][0]) * (y - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c;
  }
  return c;
}

/** Points along a polyline every step px. @param {number[][]} P @param {number} step */
function dense(P, step = 3) {
  /** @type {number[][]} */ const Q = [];
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) Q.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  Q.push(P[P.length - 1]);
  return Q;
}

/** A cubic Bezier point. @param {number[][]} B @param {number} t */
const bez = (B, t) => { const u = 1 - t; return [0, 1].map((k) => u * u * u * B[0][k] + 3 * u * u * t * B[1][k] + 3 * u * t * t * B[2][k] + t * t * t * B[3][k]); };

/**
 * The chart's layout. Pure.
 * @param {{ coast: CoastPoint[], center: number[], deepAngle: number }} island the shore ring (in order round the
 *   middle), the island's middle (world x, z) and the angle (radians, world) toward the deep water
 * @param {{ id: string, water: string }[]} fish the ordinary species, each placed in its water
 * @param {{ id: string, water: string, mark: string }[]} rare the rare species in riddle order, each placed by its mark
 *   (near: just off the reef's coast; far: further off the reef; off: in open water; deep: past the drop-off)
 * @param {{ waters: Record<string, string>, title: string, seed: number }} o water names, the title, a seed for the hand's jitter
 */
export function chartLayout(island, fish, rare, o) {
  // The deep water goes in the corner the sea floor falls toward; if everything will not fit round
  // the island that way, the next nearest corner, and so on. The fullest layout is kept.
  const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]].sort((a, b) => {
    const da = Math.abs(Math.atan2(Math.sin(Math.atan2(a[1], a[0]) - island.deepAngle), Math.cos(Math.atan2(a[1], a[0]) - island.deepAngle)));
    const db = Math.abs(Math.atan2(Math.sin(Math.atan2(b[1], b[0]) - island.deepAngle), Math.cos(Math.atan2(b[1], b[0]) - island.deepAngle)));
    return da - db;
  });
  let best = null;
  for (const c of corners) {
    const L = layoutToward(island, fish, rare, o, c);
    const got = L.fishMarks.length + L.rares.length + L.labels.length + (L.compass ? 1 : 0) + (L.title ? 1 : 0);
    if (!best || got > best.got) best = { L, got };
    if (got === fish.length + rare.length + 7) break;
  }
  return /** @type {{ L: ReturnType<typeof layoutToward> }} */ (best).L;
}

/**
 * The layout with the deep water toward one corner. @param {{ coast: CoastPoint[], center: number[], deepAngle: number }} island
 * @param {{ id: string, water: string }[]} fish @param {{ id: string, water: string, mark: string }[]} rare
 * @param {{ waters: Record<string, string>, title: string, seed: number }} o @param {number[]} corner [sx, sy], each 1 or -1
 */
function layoutToward(island, fish, rare, o, corner) {
  const rnd = stream(o.seed, 0xc4a7).next;
  // World to chart: the island fills about a third of the frame, set off from the deep corner.
  const n = island.coast.length;
  let rmax = 1;
  for (const p of island.coast) rmax = Math.max(rmax, Math.hypot(p.x - island.center[0], p.z - island.center[1]));
  const s = 135 / rmax;
  const dx = corner[0], dz = corner[1];
  const deepCorner = [dx >= 0 ? CHART_W : 0, dz >= 0 ? CHART_H : 0];
  const cx = CHART_W / 2 - Math.sign(dx || 1) * 120, cy = CHART_H / 2 - Math.sign(dz || 1) * 45;
  const toChart = (/** @type {number} */ x, /** @type {number} */ z) => [cx + (x - island.center[0]) * s, cy + (z - island.center[1]) * s];
  const coast = island.coast.map((p) => toChart(p.x, p.z));
  /** Out from the middle through a coast point (between two for a fraction), e px further. @param {number} i @param {number} e */
  const off = (i, e) => {
    const k = Math.floor(i), t = i - k, a = coast[((k % n) + n) % n], b = coast[(((k + 1) % n) + n) % n];
    const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], vx = p[0] - cx, vy = p[1] - cy, l = Math.hypot(vx, vy) || 1;
    return [p[0] + (vx / l) * e, p[1] + (vy / l) * e];
  };

  // The near waters round the coast, smoothed, each a run of coast points.
  let waterAt = island.coast.map((p) => p.water);
  waterAt = waterAt.map((_, i) => {
    /** @type {Record<string, number>} */ const c = {};
    for (let k = -6; k <= 6; k++) { const w = waterAt[((i + k) % n + n) % n]; c[w] = (c[w] ?? 0) + 1; }
    return Object.entries(c).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
  });
  // A near water the coast lacks still has its stretch (its fish are on the roster): a share of the longest run.
  for (const w of ['reef', 'sand', 'kelp']) {
    if (waterAt.includes(w)) continue;
    const runs = runsOf(waterAt);
    const long = runs.sort((a, b) => b.len - a.len)[0];
    const take = Math.max(8, Math.floor(long.len * 0.35)), start = long.start + Math.floor((long.len - take) / 2);
    for (let k = 0; k < take; k++) waterAt[(start + k) % n] = w;
  }
  const runs = runsOf(waterAt);
  /** @type {Record<string, number[]>} */ const idxOf = { reef: [], sand: [], kelp: [] };
  waterAt.forEach((w, i) => idxOf[w]?.push(i));

  /** @type {Box[]} */ const occ = [];
  /** @type {number[][][]} */ const lines = [];
  const addLine = (/** @type {number[][]} */ P) => lines.push(dense(P));
  /** Is a box clear of the frame's edge, every box and every line, with pad px of air? @param {Box} b @param {number} pad @param {number} [linePad] */
  function free(b, pad = 6, linePad = pad) {
    if (b.x0 < BX0 || b.y0 < BY0 || b.x1 > BX1 || b.y1 > BY1) return false;
    const B = grow(b, pad);
    for (const q of occ) if (hit(B, q)) return false;
    const L = grow(b, linePad);
    for (const Q of lines) for (const p of Q) if (p[0] > L.x0 && p[0] < L.x1 && p[1] > L.y0 && p[1] < L.y1) return false;
    return true;
  }
  /** Of the candidates, k spread as far apart as they can be (or nearest a preferred spot), each taken. */
  function pick(/** @type {number[][]} */ cands, /** @type {number} */ w, /** @type {number} */ h, /** @type {number} */ k, /** @type {{ pad?: number, linePad?: number }} */ op = {}) {
    /** @type {number[][]} */ const got = [];
    const pad = op.pad ?? 6, lp = op.linePad ?? pad;
    for (let m = 0; m < k; m++) {
      let best = null, bd = -1;
      for (const c of cands) {
        if (!free(boxAt(c[0], c[1], w, h), pad, lp)) continue;
        const d = got.length ? Math.min(...got.map((q) => Math.hypot(q[0] - c[0], q[1] - c[1]))) : 1e9 - Math.hypot(c[0] - CHART_W / 2, c[1] - CHART_H / 2);
        if (d > bd) { bd = d; best = c; }
      }
      if (!best) break;
      got.push(best);
      occ.push(boxAt(best[0], best[1], w, h));
    }
    return got;
  }

  // The land and the deep corner's drop-off.
  const land = coast;
  addLine([...coast, coast[0]]);
  const contours = runs.map((r) => ({ water: r.water, pts: Array.from({ length: r.len + 1 }, (_, k) => off(r.start + k, 46)) }));
  for (const c of contours) addLine(c.pts);
  // The drop-off: across the deep corner, pulled toward it until it is clear of the land and its depth lines.
  /** @type {number[][]} */ let drop = [];
  for (let f = 0.95; f >= 0.35; f -= 0.04) {
    const ax = deepCorner[0] === CHART_W ? CHART_W - f * 560 : f * 560, ay = deepCorner[1];
    const bx = deepCorner[0], by = deepCorner[1] === 0 ? f * 560 : CHART_H - f * 560;
    const B = [[ax, ay], [ax + (bx - ax) * 0.25, ay + (by - ay) * 0.3], [ax + (bx - ax) * 0.7, ay + (by - ay) * 0.62], [bx, by]];
    drop = Array.from({ length: 41 }, (_, i) => bez(B, i / 40));
    // Clear of the land and its depth lines, and far enough off the reef for its fish and marks.
    const reefPts = (idxOf.reef ?? []).map((i) => coast[i]);
    const clear = drop.every((p) => [...land, ...contours.flatMap((c) => c.pts)].every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) > 50)
      && reefPts.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) > 210));
    if (clear) break;
  }
  addLine(drop);
  const deepPoly = [...drop, deepCorner];
  const inDeep = (/** @type {number} */ x, /** @type {number} */ y) => inside(x, y, deepPoly);
  const onLand = (/** @type {number} */ x, /** @type {number} */ y) => inside(x, y, land);
  for (const inset of [30, 40]) addLine([[inset, inset], [CHART_W - inset, inset], [CHART_W - inset, CHART_H - inset], [inset, CHART_H - inset], [inset, inset]]);

  /** Candidate points off a water's coast between e0 and e1 px out (never on land or in the deep). @param {string} w */
  const nearPts = (w, e0, e1, k = 900) => {
    const ids = idxOf[w] ?? [];
    /** @type {number[][]} */ const P = [];
    for (let i = 0; i < k && ids.length; i++) { const p = off(ids[Math.floor(rnd() * ids.length)] + (rnd() - 0.5), e0 + (e1 - e0) * rnd()); if (!inDeep(p[0], p[1]) && !onLand(p[0], p[1])) P.push(p); }
    return P;
  };
  /** Open water: anywhere offshore (past the depth lines), out of the deep. */
  const openPts = (e0 = 80, e1 = 300, k = 900) => {
    /** @type {number[][]} */ const P = [];
    for (let i = 0; i < k; i++) { const p = off(Math.floor(rnd() * n), e0 + (e1 - e0) * rnd()); if (!inDeep(p[0], p[1]) && !onLand(p[0], p[1])) P.push(p); }
    return P;
  };
  const deepPts = (k = 900) => {
    /** @type {number[][]} */ const P = [];
    for (let i = 0; i < k; i++) { const p = [BX0 + rnd() * (BX1 - BX0), BY0 + rnd() * (BY1 - BY0)]; if (inDeep(p[0], p[1])) P.push(p); }
    return P;
  };
  const ptsOf = (/** @type {string} */ w, /** @type {number} */ e0, /** @type {number} */ e1, k = 900) => (w === 'deep' ? deepPts(k) : w === 'open' ? openPts(Math.max(e0, 80), Math.max(e1, 200), k) : nearPts(w, e0, e1, k));

  // The compass and the title reserve their corners: the two corners furthest from the deep and clear of everything.
  const corners = [[BX0, BY0], [BX1, BY0], [BX0, BY1], [BX1, BY1]];
  const freeCorner = (/** @type {number[]} */ size, /** @type {number[][]} */ order) => {
    for (const c of order) {
      for (let t = 0; t < 40; t++) {
        const x = c[0] === BX0 ? BX0 + size[0] / 2 + 8 + t * 6 : BX1 - size[0] / 2 - 8 - t * 6;
        const y = c[1] === BY0 ? BY0 + size[1] / 2 + 8 : BY1 - size[1] / 2 - 8;
        const b = boxAt(x, y, size[0], size[1]);
        if (free(b, 10) && ![[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].some((q) => inDeep(q[0], q[1]))) { occ.push(b); return [x, y]; }
      }
    }
    return null;
  };
  // Never the deep corner itself; the furthest from it first.
  const away = corners.sort((a, b) => Math.hypot(b[0] - deepCorner[0], b[1] - deepCorner[1]) - Math.hypot(a[0] - deepCorner[0], a[1] - deepCorner[1])).slice(0, 3);
  const title = freeCorner(CART, away.filter((c) => c[1] === BY1).concat(away.filter((c) => c[1] === BY0)));
  const compass = freeCorner(COMPASS, away);

  // Water names: off their own coast, or in their own water.
  /** @type {{ water: string, x: number, y: number, w: number, size: number }[]} */ const labels = [];
  for (const w of ['reef', 'sand', 'kelp', 'open', 'deep']) {
    const name = o.waters[w];
    for (const size of [TEXT.label, TEXT.small]) {
      const tw = textWidth(name, size), th = size * 1.15;
      const got = pick(w === 'deep' ? deepPts(1200) : w === 'open' ? openPts(120, 320, 1200) : nearPts(w, 60, 230, 1200), tw, th, 1, { pad: 8, linePad: 10 });
      if (got.length) { labels.push({ water: w, x: got[0][0], y: got[0][1], w: tw, size }); break; }
    }
  }
  // Rare marks, easiest first, each in its place.
  /** @type {{ id: string, i: number, x: number, y: number }[]} */ const rares = [];
  rare.forEach((r, i) => {
    for (const pad of [6, 4, 2]) {
      const c = r.mark === 'deep' ? deepPts(1500) : r.mark === 'off' ? openPts(110, 320, 1500) : r.mark === 'far' ? nearPts('reef', 110, 230, 1500) : nearPts('reef', 30, 110, 1500);
      const got = pick(c.length ? c : openPts(100, 320, 1500), RARE, RARE, 1, { pad, linePad: pad });
      if (got.length) { rares.push({ id: r.id, i, x: got[0][0], y: got[0][1] }); return; }
    }
  });
  // The fish, each in its water: the near waters first (their room is the tightest), open water last.
  /** @type {{ id: string, x: number, y: number }[]} */ const fishMarks = [];
  for (const w of ['reef', 'kelp', 'sand', 'deep', 'open']) {
    const mine = fish.filter((f) => f.water === w);
    /** @type {number[][]} */ const got = [];
    for (const [pad, e1] of [[8, 190], [6, 260], [4, 330], [3, 420]]) {
      got.push(...pick(ptsOf(w, 58, e1, 1800), FISH[0], FISH[1], mine.length - got.length, { pad, linePad: pad - 1 }));
      if (got.length >= mine.length) break;
    }
    mine.forEach((f, i) => { if (got[i]) fishMarks.push({ id: f.id, x: got[i][0], y: got[i][1] }); });
  }
  // Soundings: depths in each water.
  /** @type {{ water: string, i: number, x: number, y: number, v: number }[]} */ const soundings = [];
  for (const w of ['reef', 'sand', 'kelp', 'open', 'deep']) {
    const k = w === 'deep' ? 5 : 3;
    pick(ptsOf(w, 58, w === 'open' ? 240 : 170, 600), SOUND[0], SOUND[1], k, { pad: 6, linePad: 4 }).forEach((p, i) => {
      const v = w === 'deep' ? 36 + Math.floor(rnd() * 40) : w === 'open' ? 10 + Math.floor(rnd() * 18) : 1 + Math.floor(rnd() * 6);
      soundings.push({ water: w, i, x: p[0], y: p[1], v });
    });
  }
  // Each near water's own marks: rocks on the reef, stipple on the sand, fronds in the kelp, waves offshore.
  const spec = /** @type {Record<string, { n: number, e: number[], w: number, h: number }>} */ ({ reef: { n: 14, e: [8, 80], w: 14, h: 14 }, sand: { n: 40, e: [8, 46], w: 5, h: 5 }, kelp: { n: 14, e: [10, 95], w: 12, h: 26 }, open: { n: 14, e: [90, 260], w: 26, h: 12 } });
  /** @type {{ water: string, i: number, of: number, x: number, y: number }[]} */ const features = [];
  for (const [w, f] of Object.entries(spec)) {
    const got = pick(w === 'open' ? openPts(f.e[0], f.e[1], 1500) : nearPts(w, f.e[0], f.e[1], 1500), f.w, f.h, f.n, { pad: w === 'sand' ? 1 : 3, linePad: w === 'sand' ? 2 : 3 });
    got.forEach((p, i) => features.push({ water: w, i, of: got.length, x: p[0], y: p[1] }));
  }
  // Ticks along the drop-off, on its line, on its deep side.
  /** @type {{ i: number, x0: number, y0: number, x1: number, y1: number }[]} */ const ticks = [];
  for (let i = 0; i < 16; i++) {
    const t = 0.06 + i * 0.058, a = drop[Math.round(t * 40)], b = drop[Math.min(40, Math.round(t * 40) + 1)];
    let nx = b[1] - a[1], ny = -(b[0] - a[0]);
    const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    if (!inDeep(a[0] + nx * 8, a[1] + ny * 8)) { nx = -nx; ny = -ny; }
    const tb = boxAt(a[0] + nx * 6, a[1] + ny * 6, 10, 10);
    if (occ.some((q) => hit(grow(tb, 3), q))) continue;
    ticks.push({ i, x0: a[0], y0: a[1], x1: a[0] + nx * 12, y1: a[1] + ny * 12 });
  }
  return { land, runs: runs.map((r) => ({ ...r, pts: Array.from({ length: r.len + 1 }, (_, k) => coast[(r.start + k) % n]) })), contours, drop, deepCorner, compass, title,
    labels, rares, fishMarks, soundings, features, ticks, boxes: occ, lines };
}

/** The runs of one water round a ring. @param {string[]} ring */
function runsOf(ring) {
  const n = ring.length;
  let s0 = 0;
  while (s0 < n && ring[s0] === ring[(s0 - 1 + n) % n]) s0++;
  if (s0 >= n) return [{ water: ring[0], start: 0, len: n }];
  /** @type {{ water: string, start: number, len: number }[]} */ const out = [];
  for (let k = 0; k < n; k++) {
    const i = (s0 + k) % n;
    const last = out[out.length - 1];
    if (last && last.water === ring[i]) last.len++;
    else out.push({ water: ring[i], start: i, len: 1 });
  }
  return out;
}

/**
 * What is inked for the sketches so far (the mockup's rules): each water's coast at its first
 * sketch, its depth line at the second, its marks and soundings as it fills, its name and legend
 * line when it is finished; the compass by quarters; a riddle about every second sketch; the frame
 * and title with the last. Pure. @param {{ id: string, water: string }[]} fish the ordinary species
 * @param {Set<string>} sketched @param {number} rareCount
 */
export function chartInk(fish, sketched, rareCount = 12) {
  /** @type {Record<string, number>} */ const zc = {}, zn = {};
  for (const f of fish) { zn[f.water] = (zn[f.water] ?? 0) + 1; if (sketched.has(f.id)) zc[f.water] = (zc[f.water] ?? 0) + 1; }
  const total = fish.filter((f) => sketched.has(f.id)).length, max = fish.length;
  const need = (/** @type {string} */ w, /** @type {number} */ k) => (zc[w] ?? 0) >= k;
  return {
    total, max, zc, zn, full: total >= max && max > 0,
    coast: (/** @type {string} */ w) => need(w, 1),
    contour: (/** @type {string} */ w) => need(w, 2),
    finished: (/** @type {string} */ w) => (zn[w] ?? 0) > 0 && need(w, zn[w]),
    sounding: (/** @type {string} */ w, /** @type {number} */ i) => need(w, 1 + ((i + 1) % Math.max(1, zn[w] ?? 1))),
    feature: (/** @type {string} */ w, /** @type {number} */ i, /** @type {number} */ of) => need(w, 1 + Math.floor((i * (zn[w] ?? 1)) / Math.max(1, of))),
    drop: () => need('deep', 1),
    tick: (/** @type {number} */ i) => need('deep', 1 + (i % 4)),
    compass: (/** @type {number} */ q) => total >= Math.ceil((max * (q + 1)) / 4),
    riddle: (/** @type {number} */ i) => total >= Math.ceil((max * (i + 1)) / rareCount),
    riddles: Array.from({ length: rareCount }, (_, i) => total >= Math.ceil((max * (i + 1)) / rareCount)).filter(Boolean).length,
    wash: (/** @type {string} */ w) => (0.5 * (zc[w] ?? 0)) / Math.max(1, zn[w] ?? 1),
  };
}

/**
 * The journal flags the chart's thread reads (threads.json "angler"): a first sketch, each riddle
 * written, each water finished, a rare fish sketched, the chart full. Pure.
 * @param {ReturnType<typeof chartInk>} ink @param {boolean} rareSketched
 */
export function chartFlags(ink, rareSketched) {
  const out = [];
  if (ink.total > 0) out.push('fishing:sketch');
  for (let i = 1; i <= ink.riddles; i++) out.push(`fishing:riddle:${i}`);
  for (const w of Object.keys(ink.zn)) if (ink.finished(w)) out.push(`fishing:water:${w}`);
  if (rareSketched) out.push('fishing:rare');
  if (ink.full) out.push('fishing:chart:full');
  return out;
}
