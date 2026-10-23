// @ts-check
// The deterministic water summary (docs/07): standing water, flow class, tide band and basin per
// cell, from quantized terrain heights and the spring list. Integer heights throughout; the only
// non-integer math (the stream depth law and the Manning cap) goes through `det` and is rounded to
// whole millimeters at once, so every device gets the same answer. Pure and worker-safe: run it as
// a 'background' lane job ({ module: './world/water/summary.js', fn: 'buildSummary' }).
//
// Steps:
//  1. Bed per 0.5 m water cell = the lowest of its 2 x 2 terrain cells.
//  2. Sea: cells 8-connected to the rect's outer ring with bed below mean sea level. Tide band:
//     bed within +-bandFactor A0 of sea level and reachable from the ring through ground no higher
//     than the band top (so an inland pond at band height is not tidal). Shore height: for the
//     band and the splash ground above it (up to splashFactor A0 over the band top, reached the
//     same way), the bed's height from the band bottom as 1..255 (0 elsewhere), so shore zones
//     (src/world/water/shore.js) and the journal read one answer.
//  3. Priority-Flood (Barnes, Lehman and Mulla 2014) from the outer ring, seeded at
//     max(bed, sea level), with a bucket queue over the 65536 height steps. Within one level the
//     queue is first in, first out, and neighbors are visited in a fixed order, so every cell's
//     flow direction is the cell that reached it first: its lowest neighbor on the filled surface,
//     ties going to the neighbor nearest the outlet in steps (a breadth-first distance-to-outlet
//     resolution of flats, equivalent in effect to Barnes' 2014 flat resolution). These parent
//     links form a tree that drains every cell to the ring.
//  The water table (table.js): a freshwater lens at mean sea level along the shore, rising inland
//     to tableMaxM (less tableSwingM in late summer), from a chamfer distance to the sea cells.
//  4. Depressions (connected cells whose filled surface is above the bed, not sea) are basins, each
//     with a source, in order: spring (spring water reaches it: full to its spill level); rain (at
//     least pondMinCatchmentM2 and rainCatchmentRatio times its own area drains into it, and it is
//     pondMinDepthM deep: its spill level less the summer drawdown, never below the table); table
//     (its floor lies at least tableMinDepthM under the water table: full to the table or its spill
//     level, whichever is lower). Otherwise, and where a basin's level leaves its bed bare, damp.
//  5. Spring discharge is accumulated down the tree. Outside ponds and sea, stream depth is
//     d = clamp(streamK Q^streamExp, streamMinM, streamMaxM), capped by the Manning depth for the
//     local slope, and speed v = Q / (w d) with w = streamW0 + streamW1 sqrt(Q) sets the class.
//  6. targetMm per 0.5 m cell, then the 1 m ecology aggregate, then an FNV-1a hash of everything.

import { quantize, WORLD_CELLS, H_RANGE } from '../terrain/grid.js';
import { det } from '../../core/rng.js';
import { waterTable, drawdownShare } from './table.js';

/** Flow classes per cell. Numeric order is also "fastest" order for the wet classes 1..4. */
export const WATER_CLASS = Object.freeze({ dry: 0, sea: 1, still: 2, slow: 3, running: 4, damp: 5 });

/** Where a basin's water comes from (summary `basinSource`): none (a damp hollow), spring, rain, table. */
export const BASIN_SOURCE = Object.freeze({ none: 0, spring: 1, rain: 2, table: 3 });

/** Mean sea level as a height step (16384). */
const SEA_Q = quantize(0);
/** Neighbor offsets: the four sides first, then the diagonals. Fixed order. */
const DI = [-1, 1, 0, 0, -1, 1, -1, 1];
const DJ = [0, 0, -1, 1, -1, -1, 1, 1];
const LEVELS = 65536;

/**
 * Height steps to whole millimeters, rounded: mm = round(q * 16000 / 65535), integer math.
 * @param {number} q non-negative step difference
 */
const qToMm = (q) => Math.floor((q * H_RANGE * 1000 + 32767) / 65535);

/**
 * @typedef {Object} SummaryEco  1 m ecology aggregate. Eco cell (ex, ey) covers water cells
 *   2ex..2ex+1 and 2ey..2ey+1 (the 1 m grid aligned to the world origin, -80 m), so
 *   eco.x = floor(rect.x / 2) and eco.w = ceil((rect.x + rect.w) / 2) - eco.x. Subcells outside the
 *   rect count as dry.
 * @property {number} x @property {number} y @property {number} w @property {number} h
 * @property {Uint8Array} depthCm   mean standing depth at mean tide over wet subcells (sea: depth below sea level)
 * @property {Uint8Array} cls       fastest wet subcell's class when any subcell is wet; else damp if any, else dry
 * @property {Uint8Array} band      1 if any subcell is in the tide band
 * @property {Uint16Array} basin    most common nonzero subcell basin id (ties to the lower id)
 */

/**
 * @typedef {Object} Summary
 * @property {{x:number,y:number,w:number,h:number}} rect  water cells
 * @property {Uint16Array} targetMm  standing depth target (ponds and streams; sea and others 0)
 * @property {Uint8Array} cls        WATER_CLASS per 0.5 m cell
 * @property {Uint16Array} basin     basin id (1..65535) for pond and damp cells, else 0
 * @property {Uint8Array} band       1 in the tide band
 * @property {Uint16Array} tableMm   water table height above mean sea level (mm; 0 on the sea)
 * @property {Uint8Array} basinSource  BASIN_SOURCE per basin id (index 0 unused; ids past 65534 share 65535)
 * @property {Uint16Array} basinDrawMm how far a basin stands below its spill level now (mm): the
 *   summer drawdown of a rain-fed pond, or the gap to the lip of one held up by the table
 * @property {Uint16Array} basinSeasonMm how much of that the season brought (mm): how far below its
 *   spring level it stands now; 0 through spring and once refilled (F13: only that margin cracks)
 * @property {number} drawdown       the season's drawdown share now, 0..1000
 * @property {Uint8Array} shore      shore height: 1..255 from the band bottom to the splash top, 0 off the shore
 * @property {{loM:number, hiM:number}} shoreRange  meters about mean sea level that shore 1 and 255 stand for
 * @property {SummaryEco} eco
 * @property {number} hash           FNV-1a over all output arrays (uint32)
 * @property {{ponds:number, streamCells:number, ms?:number}} stats
 * @property {ArrayBuffer[]} __transfer
 */

/**
 * Build the water summary for a rect of water cells.
 * @param {{ heightQ: Uint16Array,
 *   rect: {x:number,y:number,w:number,h:number},
 *   springs: {cellX:number, cellY:number, rateLps:number}[],
 *   params: any, tide: any, yearDay?: number }} args
 *   heightQ: 768 x 768 quantized terrain heights, row-major, x fastest. rect: water cells (0.5 m);
 *   its outer ring touches open sea. springs: water-cell coords. params: water.json `summary`.
 *   tide: water.json `tide` (amplitudeM). yearDay: game day of the year, 0..55 from the first day
 *   of spring (0 when left out), for the season's table and drawdown.
 * @returns {Summary}
 */
export function buildSummary(args) {
  const perf = /** @type {any} */ (globalThis).performance;
  const t0 = perf ? perf.now() : 0;
  const { heightQ, params, tide } = args;
  const springs = args.springs ?? [];
  const rect = { x: args.rect.x | 0, y: args.rect.y | 0, w: args.rect.w | 0, h: args.rect.h | 0 };
  const { w, h } = rect;
  const n = w * h;
  const T = WORLD_CELLS;

  // 1. Bed: the lowest of each water cell's 2 x 2 terrain cells.
  const bed = new Uint16Array(n);
  for (let j = 0; j < h; j++) {
    const r0 = 2 * (rect.y + j) * T, r1 = r0 + T;
    for (let i = 0; i < w; i++) {
      const c = 2 * (rect.x + i);
      let m = heightQ[r0 + c];
      const b = heightQ[r0 + c + 1], d = heightQ[r1 + c], e = heightQ[r1 + c + 1];
      if (b < m) m = b;
      if (d < m) m = d;
      if (e < m) m = e;
      bed[j * w + i] = m;
    }
  }

  // 2. Sea and tide band: breadth-first from the outer ring.
  const bandQ = Math.round((params.bandFactor ?? 1.15) * (tide?.amplitudeM ?? 0.6) * 65535 / H_RANGE);
  const bandLo = SEA_Q - bandQ, bandHi = SEA_Q + bandQ;
  const sea = new Uint8Array(n);
  const band = new Uint8Array(n);
  const queue = new Int32Array(n);
  floodFromRing(bed, w, h, SEA_Q - 1, sea, queue);
  const reach = new Uint8Array(n);
  floodFromRing(bed, w, h, bandHi, reach, queue);
  for (let k = 0; k < n; k++) if (reach[k] && bed[k] >= bandLo) band[k] = 1;
  // Shore height over the band and the splash ground above it (integers: 1..255 across the span).
  const splashQ = Math.round((params.splashFactor ?? 0.6) * (tide?.amplitudeM ?? 0.6) * 65535 / H_RANGE);
  const shoreTop = bandHi + splashQ, span = shoreTop - bandLo;
  const shore = new Uint8Array(n);
  reach.fill(0);
  floodFromRing(bed, w, h, shoreTop, reach, queue);
  for (let k = 0; k < n; k++) {
    if (reach[k] && bed[k] >= bandLo) shore[k] = 1 + Math.floor(((bed[k] - bandLo) * 254) / span);
  }
  const shoreRange = { loM: (-bandQ * H_RANGE) / 65535, hiM: ((bandQ + splashQ) * H_RANGE) / 65535 };

  // The water table: a lens over the sea, lower in late summer. Absolute height steps per cell.
  const drawdown = drawdownShare(args.yearDay ?? 0, params.drawdownDays ?? [14, 25, 35]);
  const tableTopM = (params.tableMaxM ?? 0) - ((params.tableSwingM ?? 0) * drawdown) / 1000;
  const lens = waterTable(sea, w, h, Math.max(0, Math.round((tableTopM * 65535) / H_RANGE)), queue);
  const table = new Uint16Array(n);
  const tableMm = new Uint16Array(n);
  for (let k = 0; k < n; k++) {
    table[k] = SEA_Q + lens[k];
    if (!sea[k]) tableMm[k] = qToMm(lens[k]);
  }

  // 3. Priority-Flood with a first-in, first-out bucket queue.
  const fill = new Uint16Array(n);
  const parent = new Int32Array(n).fill(-1);
  const order = new Int32Array(n);   // pop order: parents always come before their children
  const seen = new Uint8Array(n);
  const head = new Int32Array(LEVELS).fill(-1);
  const tail = new Int32Array(LEVELS).fill(-1);
  const next = queue;                // reuse: one link per cell, each cell is queued once
  let lowest = LEVELS;
  /** @param {number} lv @param {number} k */
  const push = (lv, k) => {
    next[k] = -1;
    if (tail[lv] < 0) head[lv] = k; else next[tail[lv]] = k;
    tail[lv] = k;
    if (lv < lowest) lowest = lv;
  };
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (i > 0 && j > 0 && i < w - 1 && j < h - 1) continue;
      const k = j * w + i;
      seen[k] = 1;
      fill[k] = bed[k] > SEA_Q ? bed[k] : SEA_Q;
      push(fill[k], k);
    }
  }
  let cur = lowest;
  for (let popped = 0; popped < n; popped++) {
    while (head[cur] < 0) cur++;
    const k = head[cur];
    head[cur] = next[k];
    if (head[cur] < 0) tail[cur] = -1;
    order[popped] = k;
    const i = k % w, j = (k - i) / w;
    for (let d = 0; d < 8; d++) {
      const ni = i + DI[d], nj = j + DJ[d];
      if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
      const q = nj * w + ni;
      if (seen[q]) continue;
      seen[q] = 1;
      parent[q] = k;
      fill[q] = bed[q] > cur ? bed[q] : cur;
      push(fill[q], q);
    }
  }

  // Catchment (cells draining through each cell) and spring discharge (mL/s), down the tree.
  const acc = new Int32Array(n).fill(1);
  const flow = new Int32Array(n);
  for (const s of springs) {
    const i = (s.cellX | 0) - rect.x, j = (s.cellY | 0) - rect.y;
    if (i < 0 || j < 0 || i >= w || j >= h) continue;
    flow[j * w + i] += Math.round(s.rateLps * 1000);
  }
  for (let p = n - 1; p >= 0; p--) {
    const k = order[p], up = parent[k];
    if (up < 0) continue;
    acc[up] += acc[k];
    flow[up] += flow[k];
  }

  // 4. Depressions: connected (8-way) non-sea cells with the filled surface above the bed.
  const label = new Int32Array(n);   // depression id, 1-based, in scan order
  const exitAcc = [0];               // per depression: cells draining out of it (its catchment)
  const fed = [0];                   // per depression: spring water reaches it
  const deep = [0];                  // per depression: deepest fill above the bed (height steps)
  const area = [0];                  // per depression: cells
  const floor = [0];                 // per depression: its deepest cell (the first found)
  let nDep = 0;
  for (let k0 = 0; k0 < n; k0++) {
    if (label[k0] || sea[k0] || fill[k0] <= bed[k0]) continue;
    const id = ++nDep;
    let catchment = 0, isFed = 0, qh = 0, qt = 0, deepest = 0, floorK = k0;
    label[k0] = id;
    queue[qt++] = k0;
    while (qh < qt) {
      const k = queue[qh++];
      if (flow[k] > 0) isFed = 1;
      if (fill[k] - bed[k] > deepest) { deepest = fill[k] - bed[k]; floorK = k; }
      // An exit (its parent is outside the depression; a flooded non-sea neighbor would be in this
      // same depression): everything upstream of the depression drains out through it.
      const up = parent[k];
      if (up < 0 || sea[up] || fill[up] <= bed[up]) catchment += acc[k];
      const i = k % w, j = (k - i) / w;
      for (let d = 0; d < 8; d++) {
        const ni = i + DI[d], nj = j + DJ[d];
        if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
        const q = nj * w + ni;
        if (label[q] || sea[q] || fill[q] <= bed[q]) continue;
        label[q] = id;
        queue[qt++] = q;
      }
    }
    exitAcc.push(catchment);
    fed.push(isFed);
    deep.push(deepest);
    area.push(qt);
    floor.push(floorK);
  }
  const minCells = Math.ceil((params.pondMinCatchmentM2 ?? 30) * 4 - 1e-9);
  const ratio = params.rainCatchmentRatio ?? 0;
  // Rain alone only keeps a hollow wet if it is deep enough; shallower ones stay damp (height steps).
  const minDeepQ = Math.round(((params.pondMinDepthM ?? 0) * 65535) / 16);
  const tableDeepQ = Math.round(((params.tableMinDepthM ?? 0) * 65535) / 16);
  const drawMaxQ = Math.round(((params.drawdownMaxM ?? 0) * 65535) / 16);
  const drawFracK = Math.round((params.drawdownMaxFrac ?? 0) * 1000);
  // Per basin: its source and how far below its spill level it stands (height steps; the spill
  // level is the filled surface, flat across a basin), and how much of that is the season's: how
  // far below its spring level it stands now (F13: only that bare margin dries and cracks).
  const source = new Uint8Array(nDep + 1);
  const lowerQ = new Int32Array(nDep + 1);
  const seasonQ = new Int32Array(nDep + 1);
  // The table as it stands in spring, where the season has lowered it (the summer swing).
  const lens0 = drawdown > 0 && (params.tableSwingM ?? 0) > 0
    ? waterTable(sea, w, h, Math.max(0, Math.round(((params.tableMaxM ?? 0) * 65535) / H_RANGE)), queue) : null;
  let ponds = 0;
  for (let id = 1; id <= nDep; id++) {
    const fk = floor[id], spill = fill[fk];
    const tableLv = table[fk] < spill ? table[fk] : spill;
    const table0 = lens0 ? SEA_Q + lens0[fk] : table[fk];
    const tableLv0 = table0 < spill ? table0 : spill;
    const underTable = tableLv - bed[fk] >= (tableDeepQ > 1 ? tableDeepQ : 1);
    if (fed[id]) source[id] = BASIN_SOURCE.spring;
    else if (exitAcc[id] >= minCells && exitAcc[id] >= ratio * area[id] && deep[id] >= minDeepQ) {
      source[id] = BASIN_SOURCE.rain;
      // Summer drawdown: at most drawdownMaxM, never more than drawdownMaxFrac of the depth.
      const byM = Math.floor((drawMaxQ * drawdown) / 1000), byFrac = Math.floor((deep[id] * drawFracK) / 1000);
      let level = spill - (byM < byFrac ? byM : byFrac);
      if (underTable && tableLv > level) level = tableLv;   // the table holds it up
      lowerQ[id] = spill - level;
      seasonQ[id] = lowerQ[id];   // full to its lip in spring
    } else if (underTable) {
      source[id] = BASIN_SOURCE.table;
      lowerQ[id] = spill - tableLv;
      seasonQ[id] = tableLv0 > tableLv ? tableLv0 - tableLv : 0;
    }
    if (source[id]) ponds++;
  }

  // 5 and 6. Classes and target depths.
  const targetMm = new Uint16Array(n);
  const cls = new Uint8Array(n);
  const basin = new Uint16Array(n);
  const K = params.streamK ?? 0.08, EXP = params.streamExp ?? 0.4;
  const dMin = params.streamMinM ?? 0.02, dMax = params.streamMaxM ?? 0.3;
  const W0 = params.streamW0 ?? 0.5, W1 = params.streamW1 ?? 0.1;
  const manN = params.manningN ?? 0.045;
  const slowMmS = Math.round((params.slowSpeed ?? 0.05) * 1000);
  const runMmS = Math.round((params.runningSpeed ?? 0.3) * 1000);
  const STEP_M = H_RANGE / 65535;
  let streamCells = 0;
  for (let k = 0; k < n; k++) {
    if (sea[k]) { cls[k] = WATER_CLASS.sea; continue; }
    const id = label[k];
    if (id) {
      basin[k] = id < 65535 ? id : 65535;
      const top = fill[k] - lowerQ[id];
      if (source[id] && top > bed[k]) {
        cls[k] = WATER_CLASS.still;
        targetMm[k] = qToMm(top - bed[k]);
      } else cls[k] = WATER_CLASS.damp;   // a damp hollow, or a lowered pond's bare margin
      continue;
    }
    const qml = flow[k];
    if (qml <= 0) continue;
    // Stream cell: depth law, Manning cap for the drop to the next cell, then whole millimeters.
    const Q = qml / 1000;                                   // L/s
    let dm = K * det.pow(Q, EXP);
    dm = dm < dMin ? dMin : dm > dMax ? dMax : dm;
    const wM = W0 + W1 * Math.sqrt(Q);
    const up = parent[k];
    let dropQ, dist = 0.5;
    if (up >= 0) {
      dropQ = fill[k] - fill[up];
      if ((k - up) % w !== 0 && Math.abs(k - up) !== 1) dist = 0.5 * Math.SQRT2;
    } else dropQ = fill[k] - SEA_Q;
    if (dropQ > 0) {
      const S = (dropQ * STEP_M) / dist;
      const cap = det.pow(((Q / 1000) * manN) / (wM * Math.sqrt(S)), 0.6);
      if (cap < dm) dm = cap;
    }
    let dMm = Math.round(dm * 1000);
    if (dMm < 1) dMm = 1;
    const wMm = Math.round(wM * 1000);
    // v (mm/s) = Q (m^3/s) / (w d) * 1000 = qml * 1000 / (wMm * dMm), integer division.
    const vMmS = Math.floor((qml * 1000) / (wMm * dMm));
    cls[k] = vMmS < slowMmS ? WATER_CLASS.still : vMmS < runMmS ? WATER_CLASS.slow : WATER_CLASS.running;
    targetMm[k] = dMm;
    streamCells++;
  }

  // 1 m ecology aggregate.
  const ex = Math.floor(rect.x / 2), ey = Math.floor(rect.y / 2);
  const ew = Math.ceil((rect.x + w) / 2) - ex, eh = Math.ceil((rect.y + h) / 2) - ey;
  const en = Math.max(0, ew) * Math.max(0, eh);
  const eco = {
    x: ex, y: ey, w: ew, h: eh,
    depthCm: new Uint8Array(en), cls: new Uint8Array(en), band: new Uint8Array(en), basin: new Uint16Array(en),
  };
  const ids = [0, 0, 0, 0];
  for (let b = 0; b < eh; b++) {
    for (let a = 0; a < ew; a++) {
      let wet = 0, sumMm = 0, fast = 0, damp = 0, bnd = 0, nId = 0;
      for (let s = 0; s < 4; s++) {
        const i = 2 * (ex + a) + (s & 1) - rect.x, j = 2 * (ey + b) + (s >> 1) - rect.y;
        if (i < 0 || j < 0 || i >= w || j >= h) continue;
        const k = j * w + i, c = cls[k];
        if (band[k]) bnd = 1;
        if (basin[k]) ids[nId++] = basin[k];
        if (c === WATER_CLASS.damp) { damp = 1; continue; }
        if (c >= WATER_CLASS.sea && c <= WATER_CLASS.running) {
          wet++;
          sumMm += c === WATER_CLASS.sea ? qToMm(SEA_Q - bed[k]) : targetMm[k];
          if (c > fast) fast = c;
        }
      }
      const e = b * ew + a;
      if (wet > 0) {
        const cm = Math.floor((sumMm + wet * 5) / (wet * 10));
        eco.depthCm[e] = cm > 255 ? 255 : cm;
        eco.cls[e] = fast;
      } else eco.cls[e] = damp ? WATER_CLASS.damp : WATER_CLASS.dry;
      eco.band[e] = bnd;
      eco.basin[e] = commonId(ids, nId);
    }
  }

  // Per basin id as the cells carry it (ids past 65534 share 65535 and take the last one's).
  const nIds = (nDep < 65535 ? nDep : 65535) + 1;
  const basinSource = new Uint8Array(nIds);
  const basinDrawMm = new Uint16Array(nIds);
  const basinSeasonMm = new Uint16Array(nIds);
  for (let id = 1; id <= nDep; id++) {
    const b = id < 65535 ? id : 65535;
    basinSource[b] = source[id];
    basinDrawMm[b] = qToMm(lowerQ[id]);
    basinSeasonMm[b] = qToMm(seasonQ[id]);
  }

  const out = {
    rect, targetMm, cls, basin, band, shore, shoreRange, eco, tableMm, basinSource, basinDrawMm, basinSeasonMm, drawdown, hash: 0,
    stats: /** @type {{ponds:number, streamCells:number, ms?:number}} */ ({ ponds, streamCells }),
    __transfer: [targetMm.buffer, cls.buffer, basin.buffer, band.buffer, shore.buffer, tableMm.buffer,
      basinSource.buffer, basinDrawMm.buffer, basinSeasonMm.buffer, eco.depthCm.buffer, eco.cls.buffer, eco.band.buffer, eco.basin.buffer],
  };
  out.hash = hashSummary(out);
  if (perf) out.stats.ms = perf.now() - t0;
  return out;
}

/**
 * Breadth-first from the rect's outer ring through cells with bed <= maxQ (8-way), marking them.
 * @param {Uint16Array} bed @param {number} w @param {number} h @param {number} maxQ
 * @param {Uint8Array} mark @param {Int32Array} queue
 */
function floodFromRing(bed, w, h, maxQ, mark, queue) {
  let qh = 0, qt = 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (i > 0 && j > 0 && i < w - 1 && j < h - 1) continue;
      const k = j * w + i;
      if (bed[k] <= maxQ) { mark[k] = 1; queue[qt++] = k; }
    }
  }
  while (qh < qt) {
    const k = queue[qh++];
    const i = k % w, j = (k - i) / w;
    for (let d = 0; d < 8; d++) {
      const ni = i + DI[d], nj = j + DJ[d];
      if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
      const q = nj * w + ni;
      if (mark[q] || bed[q] > maxQ) continue;
      mark[q] = 1;
      queue[qt++] = q;
    }
  }
}

/**
 * Most common id among the first n entries, ties to the lower id; 0 when n is 0.
 * @param {number[]} ids @param {number} n
 */
function commonId(ids, n) {
  let best = 0, bestCount = 0;
  for (let a = 0; a < n; a++) {
    let c = 0;
    for (let b = 0; b < n; b++) if (ids[b] === ids[a]) c++;
    if (c > bestCount || (c === bestCount && ids[a] < best)) { best = ids[a]; bestCount = c; }
  }
  return best;
}

/**
 * FNV-1a (32-bit) over the rect and every output array, element by element (little-endian bytes),
 * so the result is the same on any platform. Used by the determinism page and tests.
 * @param {{ rect: {x:number,y:number,w:number,h:number}, targetMm: Uint16Array, cls: Uint8Array,
 *   basin: Uint16Array, band: Uint8Array, shore?: Uint8Array, tableMm?: Uint16Array,
 *   basinSource?: Uint8Array, basinDrawMm?: Uint16Array, basinSeasonMm?: Uint16Array, eco: { x:number, y:number, w:number, h:number,
 *   depthCm: Uint8Array, cls: Uint8Array, band: Uint8Array, basin: Uint16Array } }} s
 * @returns {number} uint32
 */
export function hashSummary(s) {
  let hsh = 0x811c9dc5;
  /** @param {number} b */
  const byte = (b) => { hsh = Math.imul(hsh ^ (b & 0xff), 0x01000193) >>> 0; };
  /** @param {number} v */
  const u16 = (v) => { byte(v); byte(v >>> 8); };
  /** @param {ArrayLike<number>} a */
  const bytes = (a) => { for (let k = 0; k < a.length; k++) byte(a[k]); };
  /** @param {ArrayLike<number>} a */
  const words = (a) => { for (let k = 0; k < a.length; k++) u16(a[k]); };
  for (const v of [s.rect.x, s.rect.y, s.rect.w, s.rect.h, s.eco.x, s.eco.y, s.eco.w, s.eco.h]) u16(v);
  words(s.targetMm); bytes(s.cls); words(s.basin); bytes(s.band);
  if (s.shore) bytes(s.shore);
  if (s.tableMm) words(s.tableMm);
  if (s.basinSource) bytes(s.basinSource);
  if (s.basinDrawMm) words(s.basinDrawMm);
  if (s.basinSeasonMm) words(s.basinSeasonMm);
  bytes(s.eco.depthCm); bytes(s.eco.cls); bytes(s.eco.band); words(s.eco.basin);
  return hsh >>> 0;
}
