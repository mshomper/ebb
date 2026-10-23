// @ts-check
// Gathering, live (docs/future/13 section 4.2). Below, a card on a thing that lies on the ground or
// grows there gains its Gather buttons: decorate() adds `gathers` (at most two, each labelled with
// the thing) and the word for how much is there. Gather walks you into reach, you kneel, one
// handful goes into the pack, and the card stays with its word updated. With no room, the card
// turns into the full card (Set down here, or close to leave it). From above, the same card says
// "You can gather this on foot." with no buttons. Gathering never startles anything.
//
// What a spot holds is worked out from the seed, the spot, the period and its weather (spots.js);
// the save keeps only what was taken this period (the store slice `gather`, events.js), and an
// entry goes once its day or its tide's line is over. Picked plants (reed down) shrink by their
// share and grow back (plants.js; the slow recovery is in the growth step, coarse.js).
// Emits gather:done { kind, group, x, z, from }.

import { get, update } from '../../core/store.js';
import { emitDeferred } from '../../core/events.js';
import { dayIndexOf, SECONDS_PER_YEAR } from '../../core/clock.js';
import { waterCellCenter } from '../water/grid.js';
import { groundOfCell } from '../water/shore.js';
import { strandLines } from '../water/strandline.js';
import { tideParams } from '../tide.js';
import { seasonOfTide, weatherOfTide } from '../finds/strand.js';
import { gatherSeed, spotsAt, spotsNear, share, wordFor } from './spots.js';
import { taken as takenOf, record, expire, cap } from './events.js';
import { partsOf, pickable, pick } from './plants.js';

/**
 * @param {{ recipe: any, seed: number, world: any, worldT: () => number, water: any, terrain: any, pack: any, walk: any,
 *   tide: any, strandline: any, weather: () => any, center: () => number[], boat?: () => number[] | null }} o
 *   tide: water.json tide; strandline: shore.json look.strandline; weather: { weatherSeed, weather,
 *   state } as finds take it; center: the island's middle [x, z], for onshore wind
 */
export function createGather(o) {
  const R = o.recipe, W = R.words;
  const seed = gatherSeed(o.seed);
  const tideP = tideParams(o.tide);
  /** A Gather on its way: walking to the spot, then the kneel. @type {{ g: any, t: number, kneelT: number } | null} */
  let pending = null;

  const events = () => /** @type {number[]} */ (get('gather')?.events ?? []);
  /** @param {number[]} ev */
  const keepEvents = (ev) => update('gather', () => ({ version: 1, events: cap(ev, R.eventCap ?? 256) }));

  /** The strandlines lying now, newest first, with each one's tide, springness, season and day. */
  function linesNow() {
    const L = o.strandline;
    if (!L) return [];
    const t = o.worldT() / 3600;
    const lines = strandLines(t, tideP, L);
    const w = o.weather();
    return lines.levels.map((level, n) => {
      const tideId = Math.round((t - lines.ages[n] - tideP.phaseH) / tideP.periodH);
      const tideH = tideP.phaseH + tideId * tideP.periodH;
      return { tideId, level, spring: (level / tideP.amplitudeM - 1) / tideP.springNeap, season: seasonOfTide(tideH), day: w ? weatherOfTide(tideH, w) : null };
    });
  }

  /** The context spots.js reads, from the live world now. @returns {import('./spots.js').GatherCtx} */
  function ctx() {
    const st = o.world.state;
    const s = o.water.getSummary?.() ?? null;
    const material = get('terrainLive')?.mirror?.material ?? null;
    const R0 = s?.rect;
    /** @param {number} k */
    const cellXZ = (k) => [waterCellCenter(R0.x + (k % R0.w)), waterCellCenter(R0.y + Math.floor(k / R0.w))];
    return {
      seed, day: dayIndexOf(o.worldT()), season: st?.seasons?.index ?? 0,
      today: st?.weather?.today ?? null, yesterday: st?.weather?.yesterday ?? null,
      plants: st?.growth?.plants ?? [],
      crownOf: (sp) => o.world.env.recipes?.flora?.[sp]?.shape?.crownRadius ?? 0.8,
      summary: s ?? undefined,
      groundOf: material && R0 ? (k) => groundOfCell(material, R0.x + (k % R0.w), R0.y + Math.floor(k / R0.w)) : undefined,
      heightOf: R0 ? (k) => { const [x, z] = cellXZ(k); return o.terrain.sampleHeight(x, z); } : undefined,
      slopeOf: R0 ? (k) => {
        const [x, z] = cellXZ(k), d = 0.5;
        const gx = o.terrain.sampleHeight(x + d, z) - o.terrain.sampleHeight(x - d, z);
        const gz = o.terrain.sampleHeight(x, z + d) - o.terrain.sampleHeight(x, z - d);
        return Math.atan(Math.hypot(gx, gz) / (2 * d)) * 180 / Math.PI;
      } : undefined,
      lines: linesNow(),
      runupM: o.strandline?.runupM ?? 0,
      center: o.center(),
      boat: o.boat?.() ?? null,
    };
  }

  /** Is the ground at a spot under the tide right now? @param {number} x @param {number} z */
  function underWater(x, z) {
    const w = o.water.sampleLive?.(x, z);
    return !!w && Number.isFinite(w.surface) && w.surface > o.terrain.sampleHeight(x, z) + 0.02;
  }

  /** The growth plant a card is about (nearest to its ring's middle, of its species). @param {any} card */
  function plantOf(card) {
    let best = null, bd = 0.25;
    for (const p of o.world.state?.growth?.plants ?? []) {
      if (p.sp !== card.sp) continue;
      const d = Math.hypot(p.x - card.wx, p.z - card.wz);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** The season position (0 spring .. 4), for part windows. */
  const seasonPos = () => {
    const st = o.world.state?.seasons;
    return (st?.index ?? 0) + (st?.phase ?? 0);
  };

  /**
   * What can be gathered under a card now: spots with what is left of them, and a plant's part.
   * @param {any} card @param {number} x @param {number} z
   */
  function gathersAt(card, x, z) {
    const out = [];
    /** @type {string[]} */ const lines = [];
    const c = ctx();
    for (const sp of spotsAt(x, z, c, R)) {
      const n = share(sp.kind, sp.sourceKey, sp.period, c, R);
      const left = Math.max(0, n - takenOf(events(), sp.key, sp.period));
      const under = underWater(sp.x, sp.z);
      const word = under ? W.underTide : wordFor(left, n, sp.source, W);
      lines.push(word);
      if (!under && left > 0) out.push({ kind: sp.kind, name: o.pack.nameOf(sp.kind), spot: sp, left, word });
    }
    // A small heap you left when the pack was full (K-21): it gives its handfuls back.
    const tapM = (o.pack.recipe.heaps?.tapM ?? 0.25) + 0.5;
    o.pack.heaps().forEach((/** @type {any[]} */ h, /** @type {number} */ i) => {
      if (Math.hypot(h[1] - x, h[2] - z) > tapM) return;
      out.unshift({ kind: h[0], name: o.pack.nameOf(h[0]), heap: i, x: h[1], z: h[2], left: h[4], word: o.pack.recipe.words.heap });
      lines.unshift(o.pack.recipe.words.heap);
    });
    // A plant's part in season (reed down).
    const pl = card?.sp ? plantOf(card) : null;
    if (pl) {
      const flora = o.world.env.recipes?.flora?.[pl.sp];
      for (const part of partsOf(pl.sp, R)) {
        const r = pickable(pl, part, { flora, pos: seasonPos() }, R);
        const kind = `${pl.sp}.${part}`;
        if (r.ok) { out.push({ kind, name: o.pack.nameOf(kind), plant: pl.id, part, x: pl.x, z: pl.z, left: 1, word: W.plenty }); lines.push(W.plenty); }
        else if (r.why === 'rest') lines.push(W.rest);
        else if (r.why === 'young') lines.push(W.young);
      }
    }
    // The word for what you can take first; with nothing to take, the first spot's word.
    return { gathers: out.slice(0, 2), word: out[0]?.word ?? lines[0] ?? null };
  }

  /**
   * A card gains its Gather buttons and its word (journal cardAt calls this last). Above, the
   * buttons are left off and the card says to go on foot.
   * @param {any} card @param {number} x @param {number} z
   */
  function decorate(card, x, z) {
    if (!card) return card;
    const g = gathersAt(card, x, z);
    if (!g.gathers.length && !g.word) return card;
    const below = !!o.walk.below;
    // The card's own line, then the word for what is there (a line that ends bare gets its stop).
    const own = card.text && !/[.!?]$/.test(card.text.trim()) ? `${card.text.trim()}.` : card.text;
    const text = [own, g.word, !below && g.gathers.length ? W.above : null].filter(Boolean).join(' ');
    return { ...card, baseText: card.text, text, gathers: below ? g.gathers : [], gatherAt: [x, z] };
  }

  /** The card again after a handful: its word and buttons as they are now. */
  function refresh() {
    const c = get('identify');
    if (!c?.gatherAt) return;
    const next = decorate({ ...c, text: c.baseText ?? c.text }, c.gatherAt[0], c.gatherAt[1]);
    update('identify', () => ({ ...c, text: next.text, gathers: next.gathers, at: performance.now() }));
  }

  /** Take one handful now (you are in reach and have knelt). @param {any} g */
  function apply(g) {
    if (!o.pack.room(g.kind)) {
      const c = get('identify');
      update('identify', () => (c ? { ...c, full: { kind: g.kind, g }, text: R.fullText ?? o.pack.recipe.words.full, gathers: [], at: performance.now() } : c));
      emitDeferred('pack:full', { kind: g.kind });
      return;
    }
    if (g.heap !== undefined) {
      if (o.pack.takeHeap(g.heap)) emitDeferred('gather:done', { kind: g.kind, group: o.pack.kinds.groupOf(g.kind), x: g.x, z: g.z, from: 'heap' });
      refresh();
      return;
    }
    if (g.spot) {
      const c = ctx();
      const n = share(g.spot.kind, g.spot.sourceKey, g.spot.period, c, R);
      if (takenOf(events(), g.spot.key, g.spot.period) >= n) { refresh(); return; }
      keepEvents(record(events(), g.spot.key, g.spot.period, 1));
    } else if (g.plant !== undefined) {
      const st = o.world.state;
      const flora = o.world.env.recipes?.flora?.[g.kind.split('.')[0]];
      const plants = st.growth.plants.map((/** @type {any} */ p) => (p.id === g.plant ? pick(p, g.part, { flora }, R) : p));
      o.world.state = { ...st, growth: { ...st.growth, plants } };
      emitDeferred('plant:picked', { id: g.plant, sp: g.kind.split('.')[0], part: g.part });
    }
    o.pack.add(g.kind, 1);
    const x = g.spot?.x ?? g.x, z = g.spot?.z ?? g.z;
    emitDeferred('gather:done', { kind: g.kind, group: o.pack.kinds.groupOf(g.kind), x, z, from: g.spot ? 'spot' : 'plant' });
    refresh();
  }

  return {
    recipe: R,
    decorate,

    /**
     * The ground spots near a point with what is left on them today (for drawing what lies there).
     * @param {number} x @param {number} z @param {number} r
     * @returns {{ kind: string, x: number, z: number, left: number, share: number, source: string, key: number }[]}
     */
    near(x, z, r) {
      const c = ctx();
      const ev = events();
      return spotsNear(x, z, r, c, R).map((sp) => {
        const n = share(sp.kind, sp.sourceKey, sp.period, c, R);
        return { kind: sp.kind, x: sp.x, z: sp.z, left: Math.max(0, n - takenOf(ev, sp.key, sp.period)), share: n, source: sp.source, key: sp.key };
      });
    },

    /**
     * Gather the n-th thing on the open card: walk into reach if you are not, kneel, take a handful.
     * A second press while one is on its way waits for it. @param {number} n
     */
    take(n) {
      if (pending || !o.walk.below) return;
      const c = get('identify');
      const g = c?.gathers?.[n];
      if (!g) return;
      const x = g.spot?.x ?? g.x, z = g.spot?.z ?? g.z;
      const reach = R.reachM ?? 0.9;
      if (o.walk.distTo(x, z) > reach) {
        const y = o.terrain.sampleHeight(x, z);
        if (!o.walk.tap(-1e4, -1e4, [x, y, z], reach)) return;
      }
      pending = { g, t: performance.now(), kneelT: 0 };
    },

    /** Set down here (the full card): the handful goes as a small heap at your feet. */
    heapHere() {
      const c = get('identify');
      const g = c?.full?.g;
      if (!g) return;
      if (g.spot) keepEvents(record(events(), g.spot.key, g.spot.period, 1));
      o.pack.heapHere(g.kind, 1);
      update('identify', () => null);
    },

    /** Each frame: the walk to a spot, then the kneel, then the handful. */
    update() {
      if (!pending) return;
      if (!o.walk.below) { pending = null; return; }
      const now = performance.now();
      if (!pending.kneelT) {
        if (o.walk.busy()) {
          if (now - pending.t > (R.approachTimeoutS ?? 8) * 1000) pending = null;
          return;
        }
        const g = pending.g, x = g.spot?.x ?? g.x, z = g.spot?.z ?? g.z;
        if (o.walk.distTo(x, z) > (R.reachM ?? 0.9) + 0.6) { pending = null; return; }
        o.walk.kneelToward(x, z, R.kneelS ?? 1.2);
        pending.kneelT = now;
        return;
      }
      if (now - pending.kneelT < (R.kneelS ?? 1.2) * 600) return;
      const g = pending.g;
      pending = null;
      apply(g);
    },

    /** Each game hour: picked spots whose day or line is over look fresh again; old heaps go. */
    expire() {
      const ev = events();
      const day = dayIndexOf(o.worldT());
      const next = expire(ev, { day, year: Math.floor(o.worldT() / SECONDS_PER_YEAR), tides: linesNow().map((l) => l.tideId) });
      if (next.length !== ev.length) keepEvents(next);
      o.pack.dawn();
    },
  };
}
