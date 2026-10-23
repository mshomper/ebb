// @ts-check
// The evening director in the live game (docs/future/13 section 2.3): builds the context its checks
// read and the effects it asks for from the walker, the terrain, the water, the journal, the camp
// pad (E1: the store slice `campPad`, src/world/camp/layout.js) and the pack (E2: holds and
// pack:changed), and answers the hint line's Tuck and Skip.
//
// The tent, the fire ring, lighting and resting are E3's camp (src/world/camp), handed in through
// the `camp` option: then the stand-in camp here stays quiet. Without it (a tool page with no camp),
// the stand-in plays the walker's acts when you walk onto the slot a beat waits for (a soft ring
// glows there) and emits the same camp events: camp:pitched, camp:ring-laid (taking the ring's
// handfuls from the pack), camp:lit (kneel at the laid ring after sunset) and camp:rested.
//
// Effects go out as events other pieces answer: `intro:camp-ready { tent, ring }` (the camp left
// ready, cold: on Skip and on a test link), `intro:glow { slot }` (an older island's tent patch),
// `island:notice` (island-notes), and `journal.flag` actions (the journal keeps the flags).

import { on, emit } from '../../core/events.js';
import { get, update } from '../../core/store.js';
import { dispatch, onAction } from '../../input/actions.js';
import { sunMoon } from '../sky/sun-moon.js';
import { landmarks } from '../terrain/landform.js';
import { padToWorld, slotWorld } from '../camp/layout.js';
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

/** Where the flap is in the pad's frame: just seaward of the tent, in the clear lane to the ring. */
const FLAP_U = 0.6;

/**
 * Where you stand at the tent's flap, in world meters, facing the sea.
 * @param {import('../camp/layout.js').Pad} pad
 */
export function flapSpot(pad) {
  const tent = pad.camp?.slots?.find((/** @type {any} */ s) => s.id === 'tent') ?? { u: -2.4, v: 0.1, d: 1.6 };
  const [x, z] = padToWorld(pad, tent.u + (tent.w ?? 2.2) / 2 + FLAP_U, tent.v);
  return { x, z, yaw: Math.atan2(pad.fx, pad.fz) };
}

/**
 * Did a Sculpt stroke or a Water pour reach ground off the camp pad? Off the pad means past where
 * the brushes are locked (the pad, then its fade). A stroke's rect is terrain:stroke-ended's (world
 * m, x0, z0 to x1, z1): it reaches off unless the whole rect sits inside; a pour is its point. Pure.
 * @param {{ x: number, z: number, r: number, lockFadeM?: number } | null} pad
 * @param {{ x0: number, z0: number, x1: number, z1: number } | null} rect @param {{ x: number, z: number }} [at]
 */
export function offPadOf(pad, rect, at) {
  if (!pad) return true;
  const r = pad.r + (pad.lockFadeM ?? 1);
  if (at) return Math.hypot(at.x - pad.x, at.z - pad.z) > r;
  if (!rect) return true;
  const far = Math.max(Math.abs(rect.x0 - pad.x), Math.abs(rect.x1 - pad.x)) ** 2 + Math.max(Math.abs(rect.z0 - pad.z), Math.abs(rect.z1 - pad.z)) ** 2;
  // A rect that is not numbers (a payload of another shape) counts as off the pad, never as stuck on it.
  return !(far <= r * r);
}

/**
 * @param {{ R: any, mode?: 'full' | 'short', fresh: boolean, walk: any, terrain: any, water: any,
 *   land: any, terrainSeed: number, orbit: any, clock: any,
 *   pack?: { holds: (need: Record<string, number>) => boolean, take: (kind: string, n?: number) => number, recipe?: any } | null,
 *   camp?: { fireLit: () => boolean, pitched?: () => boolean, ringLaid?: () => boolean } | null }} o
 *   pack: E2's pack; camp: E3's camp once it exists (null runs the stand-in camp)
 */
export function createIntroLive(o) {
  const { walk, terrain, water } = o;
  /** @returns {import('../camp/layout.js').Pad | null} */
  const padNow = () => get('campPad') ?? null;
  const slot = (/** @type {string} */ id) => {
    const pad = padNow();
    const s = pad?.camp?.slots?.find((/** @type {any} */ x) => x.id === id);
    return pad && s ? slotWorld(pad, s) : null;
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
    packHolds: (need) => !!o.pack?.holds(need),
    offPad: (rect, at) => offPadOf(padNow(), rect, at),
    ring: () => slot('ring'),
    fireLit: () => (o.camp ? o.camp.fireLit() : lit),
    // The camp's own word if it gives one; else its save section (store slice `camp`: the kit, and
    // what stands in which slot); else the stand-in camp.
    campHas: (part) => {
      if (!o.camp) return !!stub?.has(part);
      const own = part === 'tent' ? o.camp.pitched?.() : o.camp.ringLaid?.();
      if (own !== undefined) return !!own;
      const c = get('camp');
      const inSlot = !!c?.slots?.some?.((/** @type {any} */ s) => s.slot === part);
      return part === 'tent' ? c?.kit?.tent === 'pitched' && inSlot : inSlot;
    },
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
        const f = flapOf();
        if (f) { walk.placeAt(f.x, f.z, f.yaw, 'stand'); walk.downHere(); }
      },
      notice: (text) => emit('island:notice', { text, showS: 9 }),
      glow: (s) => emit('intro:glow', { slot: s }),
      flow: (n) => dispatch(/** @type {any} */ ({ type: 'time.flow', flow: n })),
    },
  });

  // The evening's place for other pieces (E3 offers Light and Rest only when their beat comes):
  // the store slice `intro` { beat, started, done }, kept as the director moves.
  let shown = '', marked = '';
  function publish() {
    const c = intro.current, done = (get('journal')?.flags ?? []).includes(`${o.R.flagPrefix ?? 'intro:'}done`);
    // A mark over the view on where the beat leads you (island-notes draws it): the spring's pool,
    // the tent's patch, the ring, the tent's door. Not while an act plays, and gone once it is done.
    const at = !c?.started || c.acting ? null
      : c.id === 'spring' ? (o.R.springGlow ? spring : null)
      : c.id === 'pitch' ? (ctx.campHas('tent') ? null : slot('tent'))
      : c.id === 'ring' ? (ctx.campHas('ring') ? null : slot('ring'))
      : c.id === 'dusk' ? (ctx.fireLit() ? null : slot('ring'))
      : c.id === 'rest' ? flapOf() : null;
    const mark = at ? { x: at.x, z: at.z } : null;
    const mk = mark ? `${mark.x},${mark.z}` : '';
    if (mk !== marked) { marked = mk; emit('intro:mark', mark ? { x: mark.x, z: mark.z } : null); }
    const key = `${c?.id}|${c?.started}|${done}`;
    if (key === shown) return;
    shown = key;
    update('intro', () => ({ beat: c?.id ?? null, started: !!c?.started, done }));
  }

  const offs = [
    // When the evening is over, time runs at its own pace again (the time button may have hurried it).
    on('intro:done', () => dispatch(/** @type {any} */ ({ type: 'time.flow', flow: 1 }))),
    on('camp:lit', () => { lit = true; }),
    onAction((/** @type {any} */ a) => {
      if (a.type === 'intro.tuck') intro.tuck();
      else if (a.type === 'intro.skip') intro.skip();
    }),
  ];

  /** Take handfuls of a group (fuel, stones) from the pack, kind by kind. @param {string} group @param {number} n */
  function takeGroup(group, n) {
    const kinds = (o.pack?.recipe?.kinds ?? []).filter((/** @type {any} */ k) => k.group === group).map((/** @type {any} */ k) => k.id);
    for (const k of kinds) if (n > 0) n -= o.pack?.take(k, n) ?? 0;
  }

  /**
   * The stand-in camp (until E3): arriving at the tent's slot pitches it, at the ring's slot (with the
   * ring's handfuls in the pack) lays it, kneeling at the laid ring after sunset strikes the steel and
   * lights it, and arriving at the flap after the fire is lit rests. Each plays its walker act first.
   */
  function createStandInCamp() {
    const state = { tent: false, ring: false };
    let wasKneel = false, pending = /** @type {string | null} */ (null);
    const near = (/** @type {any} */ p, /** @type {number} */ m) => { const w = walk.walker; return !!p && Math.hypot(w.x - p.x, w.z - p.z) <= m; };
    const offReady = on('intro:camp-ready', (/** @type {any} */ p) => { state.tent ||= !!p.tent; state.ring ||= !!p.ring; });
    const offArrive = on('walk:arrived', () => {
      const id = intro.current?.id;
      if (id === 'pitch' && !state.tent && near(slot('tent'), 1.8)) { pending = 'pitch'; walk.act('pitch'); }
      else if (id === 'ring' && state.tent && !state.ring && ctx.packHolds({ fuel: 1, stones: 2 }) && near(slot('ring'), 1.4)) { pending = 'lay'; walk.act('lay'); }
      else if (id === 'rest' && lit && near(flapOf(), 1.6)) { pending = 'crawlIn'; walk.act('crawlIn'); }
    });
    const offDone = on('walk:act-done', (/** @type {any} */ p) => {
      if (p.name !== pending) return;
      pending = null;
      if (p.name === 'pitch') { state.tent = true; emit('camp:pitched', {}); }
      else if (p.name === 'lay') { state.ring = true; takeGroup('fuel', 1); takeGroup('stones', 2); emit('camp:ring-laid', {}); }
      else if (p.name === 'strike') { emit('camp:lit', {}); }
      else if (p.name === 'crawlIn') { emit('camp:rested', {}); }
    });
    const tick = () => {
      const w = walk.walker, kneel = walk.below && w.posture === 'kneel';
      if (kneel && !wasKneel && !pending && intro.current?.id === 'dusk' && state.ring && !lit && ctx.sunsetInH() <= 0 && near(slot('ring'), 1.6)) {
        pending = 'strike';
        walk.act('strike');
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
    return { tick, rings, has: (/** @type {'tent' | 'ring'} */ part) => state[part], dispose() { offReady(); offArrive(); offDone(); } };
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
    /** Set the store slice `intro` and the mark now (at start, before the first frame). */
    publish,
    /** Each frame. @param {number} dt seconds */
    update(dt) { stub?.tick(); intro.update(dt); publish(); },
    /**
     * Soft rings for the terrain marks, [x, z, radius, opacity]: the spring's pool while the evening
     * leads you to it (so it can be found from the beach), and the stand-in camp's glowing slots
     * (none once E3's camp is in). @param {number} now seconds
     */
    rings: (now) => {
      const G = o.R.springGlow, c = intro.current;
      const out = stub?.rings(now) ?? [];
      if (G && spring && c?.id === 'spring' && c.started && !c.acting) {
        const k = 0.5 + 0.5 * Math.sin((2 * Math.PI * now) / G.breatheS);
        out.push([spring.x, spring.z, G.radiusM, G.opacity[0] + (G.opacity[1] - G.opacity[0]) * k]);
      }
      return out;
    },
    dispose() { intro.dispose(); stub?.dispose(); for (const off of offs) off(); },
  };
}
