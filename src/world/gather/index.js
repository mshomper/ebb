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
import { cleanAshes, spreadAsh, liveAshes, ashFresh } from './ashes.js';
import { partsOf, pickable, pick, outOfSeasonLine, coverPickable, coverPick } from './plants.js';
import { habitatCell } from '../growth/habitat.js';
import { coverSpecies, coverTarget } from '../growth/cover.js';

/**
 * @param {{ recipe: any, seed: number, world: any, worldT: () => number, water: any, terrain: any, pack: any, walk: any,
 *   tide: any, strandline: any, weather: () => any, center: () => number[], boat?: () => number[] | null,
 *   ring?: () => import('./spots.js').RingPlace | null }} o
 *   tide: water.json tide; strandline: shore.json look.strandline; weather: { weatherSeed, weather,
 *   state } as finds take it; center: the island's middle [x, z], for onshore wind; ring: the camp's
 *   fire ring and its fire-nights (P2i), for charcoal and ash at dawn
 */
export function createGather(o) {
  const R = o.recipe, W = R.words;
  const seed = gatherSeed(o.seed);
  const tideP = tideParams(o.tide);
  /** A Gather on its way: walking to the spot, then the kneel. @type {{ g: any, t: number, kneelT: number } | null} */
  let pending = null;
  /** The plants whose refusal was said this session (the journal keeps it from then on). @type {Set<string>} */
  const refusedSaid = new Set();

  const events = () => /** @type {number[]} */ (get('gather')?.events ?? []);
  /** @param {number[]} ev */
  const keepEvents = (ev) => update('gather', (g) => ({ ...(g ?? {}), version: 1, events: cap(ev, R.eventCap ?? 256) }));
  /** The ash patches spread on the ground (P2i, ashes.js). */
  const ashes = () => cleanAshes(get('gather')?.ashes);
  const AS = R.kinds?.ash?.spread ?? { patchM: 1.2, days: 14, max: 6 };

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
      hour: o.worldT() / 3600,
      ring: o.ring?.() ?? null,
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

  /**
   * The plant rules now: the world's gather recipe, which the gathering knife changes (src/world/forager.js
   * knifed: ready again sooner), so picking and growing back read the same numbers.
   */
  const plantRules = () => o.world.env.recipes?.gather ?? R;

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
      // Ground that is the ground itself (sand) is never a card: the here-bar offers it (src/world/dig).
      if (R.kinds?.[sp.kind]?.hereOnly) continue;
      const n = share(sp.kind, sp.sourceKey, sp.period, c, R);
      // The ring says nothing of charcoal or ash until a fire-night leaves some (P2i).
      if (sp.source === 'ring' && n <= 0) continue;
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
    // Look, don't pick (docs/future/13 PR-44): iris and marsh marigold are never gathered.
    if (pl && R.lookOnly?.includes(pl.sp)) {
      lines.push(W.notForDrinking);
      return { gathers: out.slice(0, 2), word: out[0]?.word ?? lines[0] ?? null, lookOnly: pl.sp };
    }
    if (pl) {
      const flora = o.world.env.recipes?.flora?.[pl.sp];
      for (const part of partsOf(pl.sp, R)) {
        const r = pickable(pl, part, { flora, pos: seasonPos() }, plantRules());
        const kind = `${pl.sp}.${part}`;
        if (r.ok) { out.push({ kind, name: o.pack.nameOf(kind), plant: pl.id, part, x: pl.x, z: pl.z, left: 1, word: W.plenty }); lines.push(W.plenty); }
        else if (r.why === 'rest') lines.push(W.rest);
        else if (r.why === 'young') lines.push(W.young);
        else if (r.why === 'season') lines.push(outOfSeasonLine(pl, pl.sp, part, R, seasonPos()));
      }
    }
    // A cover plant's stand (rushes): a pick takes a share of the cell, which grows back.
    const cv = coverAt(x, z);
    if (cv) {
      const r = coverPickable(cv.share, cv.target, cv.sp, seasonPos(), R);
      const kind = r.part ? `${cv.sp}.${r.part}` : null;
      if (r.ok && kind) { out.push({ kind, name: o.pack.nameOf(kind), cover: cv.sp, cell: cv.k, x, z, left: 1, word: W.plenty }); lines.push(W.plenty); }
      else if (r.why === 'rest') lines.push(W.rest);
      else if (r.why === 'season' && R.cover?.species?.[cv.sp]?.outOfSeason) lines.push(R.cover.species[cv.sp].outOfSeason);
    }
    // The word for what you can take first; with nothing to take, the first spot's word.
    return { gathers: out.slice(0, 2), word: out[0]?.word ?? lines[0] ?? null, lookOnly: null };
  }

  /**
   * The cover plant (rushes) standing in the 1 m cell under a point, with its share and the share the
   * ground there supports, or null where none stands. @param {number} x @param {number} z
   */
  function coverAt(x, z) {
    const hab = o.world.env.habitat?.(), k = habitatCell(x, z);
    if (!hab || k < 0) return null;
    for (const [sp, rec] of coverSpecies(o.world.env)) {
      const share = o.world.state?.growth?.cover?.[sp]?.[k] ?? 0;
      if (share > 0 && R.cover?.species?.[sp]) return { sp, k, share, target: coverTarget(rec, hab, k) };
    }
    return null;
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
    // Carrying the pot in both arms (K-26): no Gather, only the line saying so.
    const arms = below && g.gathers.length && get('pack')?.holding === 'pot' ? o.pack?.recipe?.words?.pot?.arms ?? null : null;
    const text = [own, g.word, !below && g.gathers.length ? W.above : null, arms].filter(Boolean).join(' ');
    // The first time the walker meets a plant not to pick, the refusal is said once and its page
    // learns why (journal trigger pick:refused).
    if (g.lookOnly && below && !refusedSaid.has(g.lookOnly) && !get('journal')?.species?.[g.lookOnly]?.learned?.includes('pick:refused')) {
      refusedSaid.add(g.lookOnly);
      emitDeferred('pick:refused', { species: g.lookOnly });
      const said = W.refused?.[g.lookOnly];
      if (said) emitDeferred('island:notice', { text: said, showS: R.refusedS ?? 6 });
    }
    return { ...card, baseText: card.text, text, gathers: below && !arms ? g.gathers : [], gatherAt: [x, z], lookOnly: below ? g.lookOnly : null, leaveBeLabel: W.leaveBe };
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
    } else if (g.cover) {
      // A pick between hours, as a plant's: the cell's share goes down and grows back toward its target.
      const st = o.world.state, was = st?.growth?.cover?.[g.cover];
      if (!was) { refresh(); return; }
      const c = was.slice();
      c[g.cell] = coverPick(c[g.cell], R);
      o.world.state = { ...st, growth: { ...st.growth, cover: { ...st.growth.cover, [g.cover]: c } } };
      emitDeferred('plant:picked', { id: -1, sp: g.cover, part: g.kind.split('.')[1], cell: g.cell });
    } else if (g.plant !== undefined) {
      const st = o.world.state;
      const flora = o.world.env.recipes?.flora?.[g.kind.split('.')[0]];
      const plants = st.growth.plants.map((/** @type {any} */ p) => (p.id === g.plant ? pick(p, g.part, { flora }, plantRules()) : p));
      o.world.state = { ...st, growth: { ...st.growth, plants } };
      emitDeferred('plant:picked', { id: g.plant, sp: g.kind.split('.')[0], part: g.part });
    }
    o.pack.add(g.kind, 1);
    const x = g.spot?.x ?? g.x, z = g.spot?.z ?? g.z;
    emitDeferred('gather:done', { kind: g.kind, group: o.pack.kinds.groupOf(g.kind), x, z, from: g.spot ? 'spot' : g.cover ? 'cover' : 'plant' });
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

    /**
     * The dry sand at a point for Scoop sand on the here-bar (src/world/dig): its spot and what is left
     * today, whether rain has wet it through, or null where there is no dry sand.
     * @param {number} x @param {number} z @returns {{ spot: any, left: number, wet: boolean } | null}
     */
    sandAt(x, z) {
      const c = ctx();
      const sp = spotsAt(x, z, c, R).find((s) => s.kind === 'sand');
      if (!sp) return null;
      const wet = (c.today?.rainAmount ?? 0) > 0 || (c.yesterday?.rainAmount ?? 0) > 0;
      const n = share(sp.kind, sp.sourceKey, sp.period, c, R);
      return { spot: sp, left: Math.max(0, n - takenOf(events(), sp.key, sp.period)), wet };
    },

    /**
     * Take one handful of sand from a spot (you have knelt). 'full' when the pack has no room.
     * @param {any} spot @returns {'ok' | 'full' | 'none'}
     */
    takeSand(spot) {
      const c = ctx();
      if (takenOf(events(), spot.key, spot.period) >= share(spot.kind, spot.sourceKey, spot.period, c, R)) return 'none';
      if (!o.pack.room(spot.kind)) { emitDeferred('pack:full', { kind: spot.kind }); return 'full'; }
      keepEvents(record(events(), spot.key, spot.period, 1));
      o.pack.add(spot.kind, 1);
      emitDeferred('gather:done', { kind: spot.kind, group: o.pack.kinds.groupOf(spot.kind), x: spot.x, z: spot.z, from: 'spot' });
      return 'ok';
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
        o.walk.kneelToward(x, z, R.kneelS ?? 1.2, 'gather');
        pending.kneelT = now;
        return;
      }
      if (now - pending.kneelT < (R.kneelS ?? 1.2) * 600) return;
      const g = pending.g;
      pending = null;
      apply(g);
    },

    /** Each game hour: picked spots whose day or line is over look fresh again; old heaps and ash patches go. */
    expire() {
      const ev = events();
      const day = dayIndexOf(o.worldT());
      const next = expire(ev, { day, year: Math.floor(o.worldT() / SECONDS_PER_YEAR), tides: linesNow().map((l) => l.tideId) });
      if (next.length !== ev.length) keepEvents(next);
      const was = ashes(), live = liveAshes(was, o.worldT() / 3600, AS);
      if (live.length !== was.length) update('gather', (g) => ({ ...(g ?? {}), ashes: live }));
      o.pack.dawn();
    },

    /**
     * Spread here on the ash pouch's card (P2i): a handful tipped where you stand, a pale patch that
     * lies there for a while (ashes.js), nettles already on the island may come up on it.
     * @returns {boolean} whether it was spread
     */
    spreadAsh() {
      const you = o.walk.below ? o.walk.you() : null;
      if (!you || o.pack.take('ash', 1) < 1) return false;
      const hour = o.worldT() / 3600;
      update('gather', (g) => ({ ...(g ?? { version: 1, events: [] }), ashes: spreadAsh(ashes(), you[0], you[2], hour, AS) }));
      emitDeferred('gather:ash-spread', { x: you[0], z: you[2], hour });
      if (W.ashSpread) emitDeferred('island:notice', { text: W.ashSpread, showS: 5 });
      return true;
    },
    /** The ash patches lying now: where, how big and how fresh (drawn marks, tests). */
    ashesNow() {
      const h = o.worldT() / 3600;
      return liveAshes(ashes(), h, AS).map((p) => ({ x: p[0], z: p[1], r: AS.patchM / 2, fresh: ashFresh(p, h, AS) }));
    },
    /** Every patch as saved, with the radius and days the habitat reads (catch-up filters by the hour). */
    ashHabitat: () => { const a = ashes(); return a.length ? { patches: a, r: AS.patchM / 2, days: AS.days } : null; },
  };
}
