// @ts-check
// The keeper's camp, live (docs/future/13 sections 3.2 to 3.7; E3): the tent and the fire ring in
// their slots, drawn with Matt's models (src/render/passes/props.js), the fire's flame, smoke, moths
// and sparks (src/render/passes/camp-fx.js), and the fire and lantern as the island's first small
// lights (src/render/lighting.js setPoints).
//
//   Setup (CS-05): a slot glows; a click walks you there and opens its card; Pitch the tent or Lay
//   the fire ring plays the act, and the ring takes a handful of fuel and two of stones from the pack.
//   Light (the here-bar at the laid ring) kneels and strikes the fire steel; Feed the fire wakes
//   embers or adds flame. Rest (the tent's card, or the here-bar at the flap after dark) banks the
//   fire, runs the night behind the cream screen (src/sim/away.js, `rest:begin`) and wakes you at
//   the flap just before sunrise. The lantern hangs on the tent's front pole; walk off the pad at
//   night and you carry it, come back and it is hung again.
//
// State is the store slice `camp` (model.js; save format 9 section `camp`); the fire is worked out
// from the clock (fire.js), so nothing here ticks the world. Events: camp:pitched, camp:ring-laid,
// camp:lit, camp:fed, camp:banked, camp:cold, camp:rested. Listens to intro:camp-ready (Skip and test
// links: the camp laid ready, cold, taking nothing) and intro:glow (an older island's tent ground).
// Split by job: where.js (where things stand), player.js (walk there, play an act), cards.js (the
// cards and the here-bar), frame.js (drawing each frame).

import { on, emit, emitDeferred } from '../../core/events.js';
import { get, update } from '../../core/store.js';
import { onAction } from '../../input/actions.js';
import { subSeed, hash32 } from '../../core/rng.js';
import { sunMoon } from '../sky/sun-moon.js';
import { weatherAt } from '../weather.js';
import { cleanCamp, pitched, ringLaid, pitchTent, layRing } from './model.js';
import { fireAt, lightFire, feedFire, bankFire, settleFire } from './fire.js';
import { createPropsPass } from '../../render/passes/props.js';
import { createCampFxPass } from '../../render/passes/camp-fx.js';
import { actLength } from '../figure/acts.js';
import { steelMesh, flintMesh } from './steel-mesh.js';
import { hookMesh } from './hook-mesh.js';
import { createWhere } from './where.js';
import { createActPlayer } from './player.js';
import { registerCampCards, campCardAt, campHere } from './cards.js';
import { createCampFrame } from './frame.js';
import { createStations } from './stations.js';

const H = 3600;

/**
 * @param {{ recipe: any, seed: number, walk: any, terrain: any, clock: any, orbit: any, camera: any,
 *   world: any, seasons: any, lighting: { setPoints: (l: any[]) => void }, pack?: any,
 *   shadowBias?: { depthBias: number, depthBiasSlopeScale: number }, low?: boolean,
 *   beat?: () => string | null, poses?: any, piles?: any, cook?: any }} o
 *   cook: recipes/world/cook.json (the stations' makes and builds, S1)
 *   piles: E2's piles at camp (src/world/pack/piles-live.js): Feed and Light take a handful from the stick pile
 *   recipe: recipes/world/camp.json; walk: the walker; lighting: the shared light block;
 *   pack: E2's pack (holds, take); beat: the evening's beat now (the director), for its glows;
 *   poses: recipes/world/figure.json poses (how long the strike act is, for its sparks)
 */
export function createCamp(o) {
  const R = o.recipe, W = R.words, F = R.fire;
  const campSeed = subSeed(o.seed, 'camp');
  const props = createPropsPass({ recipe: R.props, bias: o.shadowBias });
  const fx = createCampFxPass({ recipe: R, low: o.low });
  /** Models' tops, once loaded: the tent's height for the camera, the ring's for the flame. */
  /** @type {Record<string, number[]>} */ const bounds = {};
  for (const [key, m] of Object.entries(R.props.models)) {
    props.loadModel(key, new URL(`../../../${/** @type {any} */ (m).file}`, import.meta.url), /** @type {any} */ (m).look)
      .then((b) => { bounds[key] = b; })
      .catch((e) => console.warn(`camp: ${/** @type {any} */ (m).file} did not load (${e.message})`));
  }

  // The fire steel and flint (made here, tiny): in your hands while you strike a light.
  props.addMesh('steel', steelMesh(), R.steel.steelSrgb, R.steel.steelRough);
  props.addMesh('flint', flintMesh(), R.steel.flintSrgb, R.steel.flintRough);
  // The lantern's hook: a loop of cord round the tent's front pole crossing, down to its handle (F2).
  {
    const L = R.lantern, top = [L.hangM[0], L.hangM[1] + L.handleM, L.hangM[2]];
    props.addMesh('hook', hookMesh({ at: L.hookM, to: top, loopM: L.hookLoopM, cordM: L.cordM }), L.cordSrgb, 0.9);
  }

  /** @returns {import('./model.js').Camp} */
  const camp = () => cleanCamp(get('camp'));
  /** @param {(c: import('./model.js').Camp) => import('./model.js').Camp} fn */
  const change = (fn) => update('camp', (c) => fn(cleanCamp(c)));
  const where = createWhere(o);
  const { slotAt, flapAt, inTent } = where;
  const player = createActPlayer(o);
  const { play } = player;
  const hourNow = () => o.clock.worldT() / H;
  /** Out of the pitched tent to its flap, if you stand inside it (after pitching; I'm stuck). */
  function stepOut() {
    const you = o.walk.you(), f = flapAt();
    if (!you || !f || !pitched(camp()) || !inTent(you[0], you[2], 0.1)) return false;
    o.walk.placeAt(f.x, f.z, f.yaw, 'stand');
    return true;
  }
  /** The low view from beside you at the flap: you, the tent and the ring (after pitching, on waking). */
  function frameCamp() {
    const f = flapAt(), pose = o.camera?.pose();
    if (!f || !pose || !o.walk.below) return;
    // Its own distance and pitch: the pose may still be the view from above, mid-glide down.
    o.camera.setPose({ ...pose, target: [f.x, o.terrain.sampleHeight(f.x, f.z) + 0.8, f.z], yaw: f.yaw + Math.PI + R.rest.viewSideRad,
      distance: R.rest.viewDistanceM, pitch: (R.rest.viewPitchDeg * Math.PI) / 180 });
  }
  /**
   * The first evening, while it runs (E4's store slice `intro` { beat, done }): Light waits for its
   * dusk beat and Rest for its rest beat. After the evening (or with no director), always true.
   * @param {'dusk' | 'rest'} beat
   */
  const beatAllows = (beat) => {
    const s = get('intro');
    if (s) return s.done !== false || (s.beat === beat && s.started !== false);
    // Before the slice: the director's beat now (null once the evening is done, or with none).
    const now = o.beat?.() ?? null;
    return now === null || now === beat;
  };
  /**
   * Rest may be offered: after the first evening, or in its rest beat, or once its dusk beat has
   * begun (night has come): resting then ends dusk and rest together (the director's alsoDoneBy), so
   * a player who never sat by the fire is not left at night with no way to rest.
   */
  const restAllowed = () => beatAllows('rest') || beatAllows('dusk');
  /** The sun's height now (radians). */
  const sunAlt = () => sunMoon(o.clock.display(), o.orbit).sunAlt;
  const weatherNow = () => weatherAt(o.world.state?.weather, o.clock.display(), o.seasons);
  const near = (/** @type {{ x: number, z: number } | null} */ p, /** @type {number} */ m) => {
    const d = p ? o.walk.distTo(p.x, p.z) : Infinity;
    return d <= m;
  };

  // ---- the fire's sunrise and the night ----

  /** The game second to wake at: wakeBeforeSunriseMin before the next sunrise. */
  function wakeAt() {
    const t0 = o.clock.worldT();
    let up = sunMoon(t0, o.orbit).sunAlt >= 0;
    for (let t = t0 + 60; t < t0 + 30 * H; t += 60) {
      const a = sunMoon(t, o.orbit).sunAlt >= 0;
      if (a && !up) return t - R.rest.wakeBeforeSunriseMin * 60;
      up = a;
    }
    return t0;
  }
  /** After sunset and before the wake hour: a rest is possible. */
  const nightNow = () => sunAlt() < 0 && wakeAt() > o.clock.worldT() + 60;

  // ---- the pack ----

  /** The pack kinds of a group (fuel, stones). @param {string} group */
  const kindsOf = (group) => (Array.isArray(o.pack?.recipe?.kinds) ? o.pack.recipe.kinds : []).filter((/** @type {any} */ k) => k.group === group).map((/** @type {any} */ k) => k.id);
  /** Take handfuls of a group from the pack, kind by kind; how many came. @param {string} group @param {number} n */
  function takeGroup(group, n) {
    let got = 0;
    for (const k of kindsOf(group)) if (got < n) got += o.pack?.take(k, n - got) ?? 0;
    return got;
  }
  const holds = (/** @type {Record<string, number>} */ need) => !!o.pack?.holds(need);
  /** A fuel pile at camp (E2's stick pile, or any pile of fuel), or null. */
  const fuelPile = () => (o.piles?.piles?.() ?? []).find((/** @type {any} */ p) => p.handfuls > 0 && kindsOf('fuel').includes(p.holds)) ?? null;
  /** A handful of fuel to hand, in the pack or on the camp's pile (F9). */
  const hasFuel = () => holds({ fuel: R.fire.feedHandfuls }) || !!fuelPile();
  /**
   * Take a handful of fuel: from the pack first, else from the pile (it lowers by one handful).
   * @returns {boolean} whether one came
   */
  function takeFuel() {
    if (takeGroup('fuel', R.fire.feedHandfuls) >= R.fire.feedHandfuls) return true;
    const pile = fuelPile();
    if (!pile || !o.piles) return false;
    return o.piles.takeUp(pile.id, () => ({ added: 1 })).taken > 0;
  }
  const ringNeed = () => ({ fuel: R.ring.fuelHandfuls, stones: R.ring.stoneHandfuls });

  /** What the cards and the frame read. @type {import('./cards.js').CampKit} */
  const kit = { R, walk: o.walk, camp, where, player, hourNow, holds, ringNeed, hasFuel, nightNow, restAllowed, beatAllows, weatherNow, near };
  const frame = createCampFrame({ ...kit, o, props, fx, sunAlt });
  // The stations (S1, S2): the workbench and the apothecary bench built in their slots, the fire,
  // their workspace, and the keeps (the drying rack and the hamper, P2j).
  const stations = createStations({ ...kit, o, cook: o.cook ?? { builds: {}, makes: {}, words: {} }, change, campSeed, frame });

  // ---- acts: walk, face, play, then the change ----

  const offs = [];

  function pitch() {
    if (pitched(camp())) return;
    const t = slotAt('tent');
    if (!t) return;
    // From the flap itself, outside where the tent will stand, facing it; then the low view turns
    // to show you, the tent and the ring.
    const f = /** @type {any} */ (flapAt());
    play('pitch', f, R.reach.standM, t, () => {
      change((c) => pitchTent(c, hourNow(), hash32(campSeed, 1)));
      emitDeferred('camp:pitched', { hour: hourNow() });
      stepOut();
      frameCamp();
    });
  }

  function lay() {
    const c = camp(), r = slotAt('ring');
    if (!pitched(c) || ringLaid(c) || !r) return;
    if (!holds(ringNeed())) { emit('island:notice', { text: W.ringNeeds, showS: 6 }); return; }
    play('lay', r, R.reach.ringM, r, () => {
      if (!holds(ringNeed())) return;
      takeGroup('fuel', R.ring.fuelHandfuls);
      takeGroup('stones', R.ring.stoneHandfuls);
      change((cc) => layRing(cc, hourNow(), hash32(campSeed, 2)));
      emitDeferred('camp:ring-laid', { hour: hourNow() });
    });
  }

  function light() {
    const c = camp(), r = slotAt('ring');
    if (!r || !ringLaid(c)) return;
    const word = fireAt(c.fire, hourNow(), F).word;
    if (word === 'embers' || word === 'lit') { feed(); return; }
    // A cold ring needs a fresh handful; a laid one has its own.
    if (word === 'cold' && !hasFuel()) { emit('island:notice', { text: W.feedNeeds, showS: 6 }); return; }
    play('strike', r, R.reach.ringM, r, () => {
      frame.strikeEnd();
      const now = hourNow(), cc = camp();
      if (fireAt(cc.fire, now, F).word === 'cold' && !takeFuel()) return;
      const lit = lightFire(cc.fire, now, F);
      if (!lit) return;
      change((x) => ({ ...x, fire: lit }));
      emitDeferred('camp:lit', { hour: now, first: lit.lightings === 1 });
      emit('camp:sound', { name: 'catch' });
    }, () => frame.strikeBegin((o.poses && actLength(o.poses, 'strike')) || 3));
  }

  function feed() {
    const c = camp(), r = slotAt('ring');
    if (!r) return;
    const now = hourNow(), word = fireAt(c.fire, now, F).word;
    if (word !== 'embers' && word !== 'lit') return;
    if (!hasFuel()) { emit('island:notice', { text: W.feedNeeds, showS: 6 }); return; }
    o.walk.kneelToward(r.x, r.z, 1.6, 'feedFire');
    const fed = feedFire(c.fire, now, F);
    if (!fed || !takeFuel()) return;
    // The flames lift at once as the wood goes on (live only; the fuel itself is in the save).
    frame.flare();
    change((x) => ({ ...x, fire: fed }));
    emitDeferred('camp:fed', { hour: now });
    emit('camp:sound', { name: 'feed' });
  }

  let resting = false;
  function rest() {
    const c = camp(), f = flapAt();
    if (!pitched(c) || !f || resting) return;
    if (!nightNow() || !restAllowed()) { emit('island:notice', { text: W.restDay, showS: 6 }); return; }
    // Into the tent: from the flap, facing in.
    const t = /** @type {any} */ (slotAt('tent'));
    play('crawlIn', f, R.reach.standM, t, () => {
      const now = hourNow(), cc = camp();
      if (fireAt(cc.fire, now, F).word === 'lit') {
        change((x) => ({ ...x, fire: bankFire(x.fire, now, F) }));
        emitDeferred('camp:banked', { hour: now });
      }
      resting = true;
      emit('rest:begin', { toS: wakeAt() });
    });
  }

  offs.push(on('world:caught-up', (/** @type {any} */ p) => {
    if (p.why !== 'rest' || !resting) return;
    resting = false;
    const f = flapAt();
    if (f && o.walk.placeAt(f.x, f.z, f.yaw, 'kneel')) {
      // From beside you, so the tent behind does not fill the view: the ring, the pad and the sea.
      o.walk.downHere();
      frameCamp();
    }
    const hour = hourNow();
    change((c) => ({ ...c, fire: settleFire(c.fire, hour, F), rested: { hour, at: Date.now() } }));
    emitDeferred('camp:rested', { hour });
  }));

  // Skip and the test links: the camp left ready, cold, with nothing taken from the pack.
  offs.push(on('intro:camp-ready', (/** @type {any} */ p) => {
    const hour = hourNow();
    if (p.tent && !pitched(camp())) { change((c) => pitchTent(c, hour, hash32(campSeed, 1))); emitDeferred('camp:pitched', { hour, ready: true }); }
    if (p.ring && !ringLaid(camp())) { change((c) => layRing(c, hour, hash32(campSeed, 2))); emitDeferred('camp:ring-laid', { hour, ready: true }); }
  }));
  // An older island: its tent ground glows the first time you go down near it.
  let olderGlow = false;
  offs.push(on('intro:glow', (/** @type {any} */ p) => { if (p.slot === 'tent') olderGlow = true; }));

  offs.push(onAction((/** @type {any} */ a) => {
    if (a.type === 'camp.pitch') pitch();
    else if (a.type === 'camp.lay') lay();
    else if (a.type === 'camp.light') light();
    else if (a.type === 'camp.feed') feed();
    else if (a.type === 'camp.rest') rest();
    // I'm stuck: inside the tent, you step out to its flap.
    else if (a.type === 'walk.stuck') stepOut();
  }));

  // ---- cards (one click walks there and opens it) ----

  offs.push(...registerCampCards(W));

  // ---- each frame ----

  let wasCold = false, t0 = 0;

  /**
   * The slots that glow now (CS-05), as the terrain marks' filled rings [x, z, radius, opacity].
   * @param {number} now seconds
   */
  function rings(now) {
    const c = camp(), pad = where.padNow();
    if (!pad) return [];
    const G = R.glow, k = G.opacity * (0.75 + 0.25 * Math.sin((now * 2 * Math.PI) / G.breathS));
    const you = o.walk.below ? o.walk.you() : null;
    const nearPad = !!you && Math.hypot(you[0] - pad.x, you[2] - pad.z) <= pad.r + G.nearM;
    const beat = o.beat?.() ?? null;
    // During the first evening only the beat's own slot glows; after it, the pack's rule (CS-05).
    const s = get('intro'), evening = s ? s.done === false : beat !== null;
    const byPack = !evening && nearPad;
    /** @type {number[][]} */ const out = [];
    const t = slotAt('tent'), r = slotAt('ring');
    if (t && !pitched(c) && c.kit.tent === 'pack' && (beat === 'pitch' || olderGlow || byPack)) out.push([t.x, t.z, 1.2, k]);
    if (r && pitched(c) && !ringLaid(c) && (beat === 'ring' || (byPack && holds(ringNeed())))) out.push([r.x, r.z, 0.7, k]);
    if (r && ringLaid(c) && beat === 'dusk' && sunAlt() < 0 && fireAt(c.fire, hourNow(), F).word === 'laid') out.push([r.x, r.z, 0.7, k]);
    const f = flapAt();
    if (f && beat === 'rest' && pitched(c)) out.push([f.x, f.z, 0.6, k * 0.7]);
    // A bench's ground, while its parts are to hand (S1).
    if (byPack) out.push(...stations.rings(k));
    return out;
  }

  let hereT = 0;
  /** @param {number} dt real seconds @param {number} time real seconds (animation time) */
  function updateFrame(dt, time) {
    const c = camp();
    const hour = hourNow();
    const fireNow = fireAt(c.fire, hour, F), word = fireNow.word;
    // The ring goes cold by the clock alone; say so once when it does (live).
    const cold = word === 'cold';
    if (cold && !wasCold && t0 > 0) emitDeferred('camp:cold', { hour });
    wasCold = cold;
    t0 += dt;
    if ((hereT -= dt) <= 0) { hereT = 0.25; campHere(kit, c, word); }
    player.watch(dt);
    // Never left standing inside the pitched tent: out to the flap once you are still.
    if (!player.busy() && !o.walk.busy()) stepOut();
    stations.update(dt);
    frame.draw(dt, time, c, fireNow);
  }
  let hidden = false;

  return {
    id: 'camp',
    /** The draw passes: the models (with their shadow caster), then the fire's effects after the sky. */
    props, fx,
    /** A sim system: each frame. @param {{ realDt: number }} f */
    tick(f) {
      if (!hidden) { updateFrame(f.realDt, o.clock.animT()); return; }
      frame.hide();
    },
    rings,
    /** The card a click at a ground point opens (cards.js). @param {number} x @param {number} z */
    cardAt: (x, z) => stations.cardAt(x, z) ?? campCardAt(kit, x, z),
    /** The stations (S1): the workbench and the fire's workspace (tools, tests, test links). */
    stations,
    /** For the evening director: the tent is up; the ring is laid. */
    pitched: () => pitched(camp()),
    ringLaid: () => ringLaid(camp()),
    /** For the evening director: the fire is burning. */
    fireLit: () => fireAt(camp().fire, hourNow(), F).word === 'lit',
    /** Where the smoke keeps midges clear while the fire burns or smoulders (C-29), or null. */
    smokeClear() {
      const r = slotAt('ring'), w = fireAt(camp().fire, hourNow(), F).word;
      return r && (w === 'lit' || w === 'embers') ? { x: r.x, z: r.z, r: R.smoke.midgeClearM } : null;
    },
    /** The fire now (tools, tests). */
    fire: () => fireAt(camp().fire, hourNow(), F),
    /** The lantern: on its pole or carried (live only). */
    lantern: frame.lantern,
    /** Where you kneel at the flap. */
    flap: flapAt,
    /**
     * For the test pages and tools/camp-bench.html: act on the camp now (as a card press would);
     * lightNow lights a laid ring at once, with no act; hide draws no camp at all (the bench's
     * "camp off" half).
     */
    debug: {
      pitch, lay, light, feed, rest, frame: frameCamp,
      lightNow() {
        const lit = lightFire(camp().fire, hourNow(), F);
        if (lit) change((c) => ({ ...c, fire: lit }));
        return !!lit;
      },
      /** @param {boolean} on */
      hide(on) { hidden = on; },
    },
    dispose() { for (const off of offs) off(); player.dispose(); stations.dispose(); },
  };
}

/** @typedef {ReturnType<typeof createCamp>} Camp */
