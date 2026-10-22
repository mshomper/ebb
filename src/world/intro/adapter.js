// @ts-check
// The evening director in the live game (docs/future/13 section 2.3): builds the context its checks
// read and the effects it asks for from the walker, the terrain, the water, the journal and the
// camp, and answers the hint line's Tuck and Skip. The camp pad and its slots come from E1's
// helpers and the pack from E2's packHolds once those land; until then small stand-ins here give
// the same shapes, so the real ones drop in by passing `camp` and `pack`. Without the real camp
// (E3), a stand-in camp below plays the walker's acts at the glowing slots and emits the camp
// events, so the evening can be played end to end.
//
// Effects go out as events other pieces answer: `intro:camp-ready { tent, ring }` (the camp left
// ready, cold: on Skip and on a test link), `intro:glow { slot }` (an older island's tent patch),
// `island:notice` (island-notes), and `journal.flag` actions (the journal keeps the flags).

import { on, emit } from '../../core/events.js';
import { get } from '../../core/store.js';
import { dispatch, onAction } from '../../input/actions.js';
import { sunMoon } from '../sky/sun-moon.js';
import { landmarks } from '../terrain/landform.js';
import { createIntro } from './index.js';

const H = 3600, DAY = 86400, DEG = Math.PI / 180;

/**
 * The hour a new island opens on: dawn (the sun crossing dawnSunDeg rising) on the recipe's day,
 * plus afterDawnH. @param {any} R recipes/world/intro.json @param {any} orbit sky.json's orbit
 */
export function dawnHour(R, orbit) {
  const S = R.startAtDawn, day = S.dayIndex ?? 0, at = (S.dawnSunDeg ?? -6) * DEG;
  const alt = (/** @type {number} */ h) => sunMoon((day * 24 + h) * H, orbit).sunAlt;
  let h = 0;
  while (h < 12 && alt(h + 1 / 60) < at) h += 1 / 60;
  return day * 24 + h + (S.afterDawnH ?? 0);
}

/**
 * Game hours until the sun next sets, or 0 or less once it has set today (until midnight).
 * @param {number} t game seconds @param {any} orbit
 */
export function sunsetInH(t, orbit) {
  const alt = (/** @type {number} */ s) => sunMoon(s, orbit).sunAlt;
  const dayFrac = (t % DAY) / DAY;
  if (alt(t) < 0 && dayFrac > 0.5) return -1;
  let s = t, up = alt(t) >= 0;
  for (let i = 0; i < 24 * 12; i++) {
    s += 300;
    const a = alt(s);
    if (up && a < 0) return (s - t) / H;
    if (a >= 0) up = true;
  }
  return 24;
}

/**
 * The camp pad (E1's `campPad(camp)` shape: { x, z, r, h, blend, fx, fz }, fx and fz the seaward
 * unit vector). A stand-in until E1 merges: the land recipe's camp block if there is one, else
 * the spec's spot on today's starter island, facing out from the island's rise.
 * @param {any} land the land recipe @param {number} terrainSeed
 */
export function standInPad(land, terrainSeed) {
  const c = land.camp ?? { x: 12.5, z: -13, radiusM: 4, heightM: 1.3, blendM: 2.5 };
  const rise = landmarks(land, terrainSeed).rise;
  let fx = c.x - rise.x, fz = c.z - rise.z;
  if (Number.isFinite(c.facingDeg)) { fx = Math.sin(c.facingDeg * DEG); fz = Math.cos(c.facingDeg * DEG); }
  const l = Math.hypot(fx, fz) || 1;
  return { x: c.x, z: c.z, r: c.radiusM ?? 4, h: c.heightM ?? 1.3, blend: c.blendM ?? 2.5, fx: fx / l, fz: fz / l };
}

/** The spec's slots (section 3.2) in the pad's frame, for the stand-in. */
const SLOTS = { tent: { u: -2.4, v: 0.1, flapU: -1.3 }, ring: { u: 1.5, v: 0 } };

/**
 * A slot in world meters (E1's `slotWorld(pad, slot)` shape): u seaward, v to the left facing the sea.
 * @param {{ x: number, z: number, fx: number, fz: number }} pad @param {{ u: number, v: number }} s
 */
export function standInSlot(pad, s) {
  return { x: pad.x + s.u * pad.fx + s.v * pad.fz, z: pad.z + s.u * pad.fz - s.v * pad.fx };
}

/**
 * Where you stand at the tent's flap: a little seaward of it, in the clear lane to the ring.
 * @param {{ x: number, z: number, fx: number, fz: number }} pad
 */
export function flapSpot(pad) {
  return standInSlot(pad, { u: SLOTS.tent.flapU + 0.6, v: SLOTS.tent.v });
}

/**
 * @param {{ R: any, mode?: 'full' | 'short', fresh: boolean, walk: any, terrain: any, water: any,
 *   land: any, terrainSeed: number, orbit: any, clock: any,
 *   camp?: { pad: () => any, slot: (pad: any, id: string) => { x: number, z: number } | null, fireLit: () => boolean } | null,
 *   pack?: { holds: (need: Record<string, number>) => boolean } | null }} o
 *   camp and pack: E1, E2 and E3's real ones once merged; null runs the stand-ins.
 */
export function createIntroLive(o) {
  const { walk, terrain, water } = o;
  const padNow = () => get('camp')?.pad ?? o.camp?.pad() ?? standInPad(o.land, o.terrainSeed);
  const slot = (/** @type {string} */ id) => {
    const pad = padNow();
    if (!pad) return null;
    if (o.camp) return o.camp.slot(pad, id);
    return standInSlot(pad, /** @type {any} */ (SLOTS)[id] ?? { u: 0, v: 0 });
  };
  const flapOf = () => { const pad = padNow(); return pad && flapSpot(pad); };
  const spring = landmarks(o.land, o.terrainSeed).spring;
  const stub = o.camp ? null : createStandInCamp();
  let lit = false;

  /** @type {import('./checks.js').IntroContext & { pad: () => any }} */
  const ctx = {
    walker: () => {
      const w = walk.walker;
      return { x: w.x, z: w.z, posture: w.posture, below: walk.below };
    },
    onLand: (x, z) => terrain.sampleHeight(x, z) > water.tide + 0.02,
    spring: () => spring,
    journalOpen: () => !!get('journalUi')?.open,
    packHolds: (need) => (o.pack ? o.pack.holds(need) : !!stub?.holds(need)),
    offPad: (rect, at) => {
      const pad = padNow();
      if (!pad) return true;
      const r = pad.r + (pad.blend ?? 0);
      if (at) return Math.hypot(at.x - pad.x, at.z - pad.z) > r;
      if (!rect) return true;
      // A stroke's rect reaches off the pad unless the whole rect sits inside it.
      const far = Math.max(Math.abs(rect.minX - pad.x), Math.abs(rect.maxX - pad.x)) ** 2 + Math.max(Math.abs(rect.minZ - pad.z), Math.abs(rect.maxZ - pad.z)) ** 2;
      return far > r * r;
    },
    ring: () => slot('ring'),
    fireLit: () => (o.camp ? o.camp.fireLit() : lit),
    sunsetInH: () => sunsetInH(o.clock.display(), o.orbit),
    pad: padNow,
  };

  const intro = createIntro({
    R: o.R, mode: o.mode,
    on, emit: (n, p) => emit(n, p),
    flags: () => get('journal')?.flags ?? [],
    setFlag: (flag) => dispatch(/** @type {any} */ ({ type: 'journal.flag', flag })),
    ctx,
    effects: {
      act: (name) => walk.act(name),
      openPage: (id) => dispatch(/** @type {any} */ ({ type: 'ui.journal', open: true, view: 'keeper', keeper: id, page: null })),
      skipCamp: () => {
        emit('intro:camp-ready', { tent: true, ring: true });
        const f = flapOf(), pad = padNow();
        if (f && pad) { walk.placeAt(f.x, f.z, Math.atan2(pad.fx, pad.fz), 'stand'); walk.downHere(); }
      },
      notice: (text) => emit('island:notice', { text, showS: 9 }),
      glow: (s) => emit('intro:glow', { slot: s }),
    },
  });

  const offs = [
    on('camp:lit', () => { lit = true; }),
    onAction((/** @type {any} */ a) => {
      if (a.type === 'intro.tuck') intro.tuck();
      else if (a.type === 'intro.skip') intro.skip();
    }),
  ];

  /**
   * The stand-in camp and pack (until E2 and E3 merge): kneeling on the shore picks up a handful
   * (twigs first, then stones); arriving at the tent's slot pitches it, at the ring's slot lays it,
   * kneeling at the laid ring after sunset strikes the steel and lights it, and arriving at the
   * flap after the fire is lit rests. Each plays its walker act first.
   */
  function createStandInCamp() {
    const held = { fuel: 0, stones: 0 };
    const state = { tent: false, ring: false, rested: false };
    let wasKneel = false, pending = /** @type {string | null} */ (null);
    const near = (/** @type {any} */ p, /** @type {number} */ m) => { const w = walk.walker; return !!p && Math.hypot(w.x - p.x, w.z - p.z) <= m; };
    const offReady = on('intro:camp-ready', (/** @type {any} */ p) => { state.tent ||= !!p.tent; state.ring ||= !!p.ring; });
    const offArrive = on('walk:arrived', () => {
      const id = intro.current?.id;
      if (id === 'pitch' && !state.tent && near(slot('tent'), 1.6)) { pending = 'pitch'; walk.act('pitch'); }
      else if (id === 'ring' && state.tent && !state.ring && held.fuel >= 1 && held.stones >= 2 && near(slot('ring'), 1.4)) { pending = 'lay'; walk.act('lay'); }
      else if (id === 'rest' && lit && near(flapOf(), 1.6)) { pending = 'crawlIn'; walk.act('crawlIn'); }
    });
    const offDone = on('walk:act-done', (/** @type {any} */ p) => {
      if (p.name !== pending) return;
      pending = null;
      if (p.name === 'pitch') { state.tent = true; emit('camp:pitched', {}); }
      else if (p.name === 'lay') { state.ring = true; held.fuel -= 1; held.stones -= 2; emit('pack:changed', {}); emit('camp:ring-laid', {}); }
      else if (p.name === 'strike') { emit('camp:lit', {}); }
      else if (p.name === 'crawlIn') { state.rested = true; emit('camp:rested', {}); }
    });
    const tick = () => {
      const w = walk.walker, kneel = walk.below && w.posture === 'kneel';
      if (kneel && !wasKneel && !pending) {
        const id = intro.current?.id;
        if (id === 'gather' && terrain.sampleHeight(w.x, w.z) < 0.9) {
          if (held.fuel < 1) held.fuel++; else held.stones++;
          emit('pack:changed', {});
        } else if (id === 'dusk' && state.ring && !lit && ctx.sunsetInH() <= 0 && near(slot('ring'), 1.6)) { pending = 'strike'; walk.act('strike'); }
      }
      wasKneel = kneel;
    };
    /** The stand-in glow: a soft ring on the slot the beat waits for, breathing. @param {number} now seconds */
    const rings = (now) => {
      const id = intro.current?.id, k = 0.35 + 0.15 * Math.sin(now * 2.2);
      const at = id === 'pitch' && !state.tent ? [slot('tent'), 1.2] : id === 'ring' && !state.ring ? [slot('ring'), 0.7]
        : id === 'dusk' && !lit && ctx.sunsetInH() <= 0 ? [slot('ring'), 0.7] : id === 'rest' ? [flapOf(), 0.7] : null;
      const p = /** @type {any} */ (at?.[0]);
      return p ? [[p.x, p.z, /** @type {number} */ (at?.[1]), k]] : [];
    };
    return {
      holds: (/** @type {Record<string, number>} */ need) => Object.entries(need).every(([k, n]) => (/** @type {any} */ (held)[k] ?? 0) >= n),
      tick,
      rings,
      dispose() { offReady(); offArrive(); offDone(); },
    };
  }

  return {
    intro,
    /** Start for this island (after the walker is placed). */
    start() { intro.start({ fresh: o.fresh }); },
    /** The camp pad now, a slot's world spot, and where you stand at the tent flap (test links, skip). */
    padNow,
    slot,
    flap: flapOf,
    /** The spring the evening leads to (the lab, the tests). */
    spring: () => spring,
    /** Each frame. @param {number} dt seconds */
    update(dt) { stub?.tick(); intro.update(dt); },
    /** The stand-in camp's glowing slots, [x, z, radius, opacity] for the terrain marks (none once E3's camp is in). @param {number} now seconds */
    rings: (now) => stub?.rings(now) ?? [],
    dispose() { intro.dispose(); stub?.dispose(); for (const off of offs) off(); },
  };
}
