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
// camp:lit, camp:fed, camp:banked, camp:cold, camp:rested, camp:work-taken (the overnight work done
// in the ashes, work.js, P2i; every change to the fire writes that work in first). Listens to intro:camp-ready (Skip and test
// links: the camp laid ready, cold, taking nothing) and intro:glow (an older island's tent ground).
// Split by job: where.js (where things stand), player.js (walk there, play an act), cards.js (the
// cards and the here-bar), frame.js (drawing each frame, the star fire from star.js), hearth.js (the
// hearth stones, the pots, the cup and the clay pieces, S4 and S5), carry.js (the pot in both arms,
// filled at the spring or the sea, K-26 and K-28), gift-stone.js (the gift stone and its gifts,
// the known place and the herb bed, B1 C1).

import { on, emit, emitDeferred } from '../../core/events.js';
import { get, update } from '../../core/store.js';
import { onAction } from '../../input/actions.js';
import { subSeed, hash32 } from '../../core/rng.js';
import { sunMoon } from '../sky/sun-moon.js';
import { weatherAt } from '../weather.js';
import { cleanCamp, pitched, ringLaid, pitchTent, layRing } from './model.js';
import { shapedOn } from './pots.js';
import { fireAt, lightFire, feedFire, bankFire, settleFire, fireNights } from './fire.js';
import { createPropsPass } from '../../render/passes/props.js';
import { createCampFxPass } from '../../render/passes/camp-fx.js';
import { createCampFirePass } from '../../render/passes/camp-fire.js';
import { actLength } from '../figure/acts.js';
import { steelMesh, flintMesh } from './steel-mesh.js';
import { hookMesh } from './hook-mesh.js';
import { createWhere } from './where.js';
import { createActPlayer } from './player.js';
import { registerCampCards, campCardAt, campHere } from './cards.js';
import { createCampFrame } from './frame.js';
import { createStations } from './stations.js';
import { withFire, takeDone } from './work.js';
import { createHearth } from './hearth.js';
import { createCarriers } from './carriers.js';
import { createCarry } from './carry.js';
import { createBoons } from './boons.js';
import { createTeapot } from './teapot.js';
import { createCookpot } from './cookpot.js';
import { createGiftStone } from './gift-stone.js';

const H = 3600;

/**
 * @param {{ recipe: any, seed: number, walk: any, terrain: any, clock: any, orbit: any, camera: any,
 *   world: any, seasons: any, lighting: { setPoints: (l: any[]) => void }, pack?: any,
 *   shadowBias?: { depthBias: number, depthBiasSlopeScale: number }, low?: boolean, tier?: string,
 *   beat?: () => string | null, poses?: any, piles?: any, cook?: any, water?: any, sowing?: any }} o
 *   cook: recipes/world/cook.json (the stations' makes and builds, S1); water: the live water (Fill the pot, K-26);
 *   sowing: recipes/world/sowing.json (the gifts that go to the gift spot, laid on the gift stone once it stands)
 *   piles: E2's piles at camp (src/world/pack/piles-live.js): Feed and Light take a handful from the stick pile
 *   recipe: recipes/world/camp.json; walk: the walker; lighting: the shared light block;
 *   pack: E2's pack (holds, take); beat: the evening's beat now (the director), for its glows;
 *   poses: recipes/world/figure.json poses (how long the strike act is, for its sparks); tier: the quality tier (the fire sim's settings)
 */
export function createCamp(o) {
  const R = o.recipe, W = R.words, F = R.fire;
  const campSeed = subSeed(o.seed, 'camp');
  const props = createPropsPass({ recipe: R.props, bias: o.shadowBias });
  const fx = createCampFxPass({ recipe: R, low: o.low });
  // The live fire sim and its volume (Matt's fire study): the flame and its smoke while it burns.
  const firePass = createCampFirePass({ recipe: R, tier: o.tier ?? (o.low ? 'low' : 'high'), getViewProj: () => o.camera?.viewProj ?? null });
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
   * @returns {string | null} the kind that came (charcoal burns longer, P2i), or null
   */
  function takeFuel() {
    for (const k of kindsOf('fuel')) if ((o.pack?.take(k, R.fire.feedHandfuls) ?? 0) >= R.fire.feedHandfuls) return k;
    const pile = fuelPile();
    if (!pile || !o.piles) return null;
    return o.piles.takeUp(pile.id, () => ({ added: 1 })).taken > 0 ? pile.holds : null;
  }
  const ringNeed = () => ({ fuel: R.ring.fuelHandfuls, stones: R.ring.stoneHandfuls });

  /**
   * Overnight work taken up from the ring into the pack (charcoal sticks, a fired bowl): not a fired
   * pot or the cup, which go to their own slots (hearth.js). @param {import('./work.js').WorkPiece} p
   */
  const takeable = (p) => { const f = o.cook?.makes?.[p.id]?.fires; return !f || !R.hearth?.slots?.[f]; };
  /** What the cards and the frame read. @type {import('./cards.js').CampKit} */
  const kit = { R, walk: o.walk, camp, where, player, hourNow, holds, ringNeed, hasFuel, nightNow, restAllowed, beatAllows, weatherNow, near, cookWords: o.cook?.words ?? {}, takeable };
  const holdingPot = () => get('pack')?.holding === 'pot';
  const frame = createCampFrame({ ...kit, o, props, fx, fire: firePass, sunAlt, holdingPot });
  // The stations (S1, S2): the workbench and the apothecary bench built in their slots, the fire,
  // their workspace, and the keeps (the drying rack and the hamper, P2j).
  const stations = createStations({ ...kit, o, cook: o.cook ?? { builds: {}, makes: {}, words: {} }, change, campSeed, frame });
  // The hearth stones, the pots, the cup and the clay pieces (S4, S5): drawn with the camp's models.
  /** @type {ReturnType<typeof createTeapot> | null} */ let teapot = null;
  const hearth = createHearth({ ...kit, o, cook: o.cook ?? { makes: {} }, benchAt: stations.benchAt, holdingPot, change, campSeed, cupInHand: () => !!teapot?.sipping() });
  frame.addProps(hearth.props);
  // The carriers (P2f): the one worn on the figure, the others set down by the workbench.
  const carriers = createCarriers({ P: o.pack?.recipe ?? {}, pack: o.pack, walk: o.walk, benchAt: stations.benchAt });
  frame.addProps(carriers.props);
  // The pot carried in both arms, filled at the spring or the sea, set back on the hearth (K-26).
  const carry = createCarry({ ...kit, o, change });
  // The tea's boon (P2e, boons.js): one at a time, counting down only while you play; and the tea
  // pot's workspace, Brew, the steep and the sip (teapot.js).
  const boons = createBoons({ cook: o.cook ?? { boons: {} }, change, hourNow });
  // The gift stone and its gifts, the known place and the herb bed (B1 C1).
  const gifts = createGiftStone({ R, CW: o.cook?.words ?? {}, camp, change, where, player, hourNow, campSeed, terrain: o.terrain, world: o.world, sowing: o.sowing });
  teapot = createTeapot({ ...kit, o, cook: o.cook ?? { boons: {}, teas: { herbs: {}, strength: [] }, words: {} }, keeps: stations.keeps, change, frame, boons });
  // The walker's meal (docs/future/15 slice 4): the cooking pot's workspace, an egg and a pinch of
  // salt, Cook, the boil and the sit by the fire (cookpot.js).
  const cookpot = o.cook?.meal ? createCookpot({ ...kit, o, cook: o.cook, keeps: stations.keeps, change, frame, boons }) : null;

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
      // A cold ring takes a fresh handful, which burns by its kind; a laid one has its own.
      const kind = fireAt(cc.fire, now, F).word === 'cold' ? takeFuel() : undefined;
      if (kind === null) return;
      const lit0 = lightFire(cc.fire, now, F, kind);
      if (!lit0) return;
      const lit = burnLonger(cc.fire, lit0, now);
      change((x) => withFire(x, lit, now, F));
      emitDeferred('camp:lit', { hour: now, first: lit.lightings === 1 });
      emit('camp:sound', { name: 'catch' });
    }, () => frame.strikeBegin((o.poses && actLength(o.poses, 'strike')) || 3));
  }

  /**
   * A tea's steady hands (P2e, boonLift.burn): the flame hours a light or a feed adds, a little
   * longer. Written into the fire record as it goes on, so the night runs on from the save alike.
   * @param {import('./fire.js').Fire} before @param {import('./fire.js').Fire} after @param {number} now
   */
  function burnLonger(before, after, now) {
    const k = get('boonLift')?.burn ?? 1, from = Math.max(now, before.flameUntilHour ?? now), added = (after.flameUntilHour ?? now) - from;
    return k === 1 || !(added > 0) ? after : { ...after, flameUntilHour: after.flameUntilHour + added * (k - 1) };
  }

  function feed() {
    const c = camp(), r = slotAt('ring');
    if (!r) return;
    const now = hourNow(), word = fireAt(c.fire, now, F).word;
    if (word !== 'embers' && word !== 'lit') return;
    if (!hasFuel()) { emit('island:notice', { text: W.feedNeeds, showS: 6 }); return; }
    o.walk.kneelToward(r.x, r.z, 1.6, 'feedFire');
    if (!feedFire(c.fire, now, F)) return;
    const kind = takeFuel();
    const fed0 = kind ? feedFire(c.fire, now, F, kind) : null;
    if (!fed0) return;
    const fed = burnLonger(c.fire, fed0, now);
    // The flames lift at once as the wood goes on (live only; the fuel itself is in the save).
    frame.flare();
    change((x) => withFire(x, fed, now, F));
    emitDeferred('camp:fed', { hour: now });
    emit('camp:sound', { name: 'feed' });
  }

  /** Take up what the night's fire has done (P2i, work.js): into the pack, or a heap at your feet. */
  function workTake() {
    const c = camp(), now = hourNow(), r = slotAt('ring');
    // Taken up into the pack: charcoal sticks, a fired bowl; never a pot or the cup, which go to their slots.
    const { work, piece } = takeDone(c.work, c.fire, now, F, takeable);
    if (!piece || !r) return;
    o.walk.kneelToward(r.x, r.z, 1.2, 'gather');
    change((x) => ({ ...x, work }));
    if (o.pack?.room(piece.gives)) o.pack.add(piece.gives, piece.count);
    else o.pack?.heapHere?.(piece.gives, piece.count);
    emitDeferred('camp:work-taken', { make: piece.id, gives: piece.gives, hour: now });
    // The open card says so at once.
    const card = get('identify');
    if (card?.camp === 'ring') update('identify', () => ({ ...card, ...(campCardAt(kit, card.wx, card.wz) ?? {}), at: performance.now() }));
    else if (card?.camp === 'firing') update('identify', () => null);
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
        change((x) => withFire(x, bankFire(x.fire, now, F), now, F));
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
    change((c) => ({ ...withFire(c, settleFire(c.fire, hour, F), hour, F), rested: { hour, at: Date.now() } }));
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
    else if (a.type === 'camp.workTake') workTake();
    // I'm stuck: inside the tent, you step out to its flap.
    else if (a.type === 'walk.stuck') stepOut();
  }));

  // ---- cards (one click walks there and opens it) ----

  offs.push(...registerCampCards(W, o.cook?.words));

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
    // The ring, while a pale piece waits on the workbench for its night in the fire (S5).
    if (byPack && r && ringLaid(c) && shapedOn(c).length) out.push([r.x, r.z, 0.7, k]);
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
    hearth.settle(dt);
    carry.update(dt);
    teapot?.update(dt);
    cookpot?.update(dt);
    boons.update(dt);
    gifts.update(dt);
    frame.draw(dt, time, c, fireNow);
  }
  let hidden = false;

  return {
    id: 'camp',
    /** The draw passes: the models (with their shadow caster), then after the sky the fire sim's volume and the fire's other effects. */
    props, firePass, fx,
    /** Draw more things with the camp's models each frame (the hen's feather by the ring). @param {() => import('../../render/passes/props.js').Prop[]} f */
    addProps: (f) => frame.addProps(f),
    /** A sim system: each frame. @param {{ realDt: number }} f */
    tick(f) {
      if (!hidden) { updateFrame(f.realDt, o.clock.animT()); return; }
      frame.hide();
    },
    rings,
    /** The card a click at a ground point opens (cards.js). @param {number} x @param {number} z */
    cardAt: (x, z) => hearth.benchPieceAt(x, z) ?? carriers.cardAt(x, z) ?? stations.cardAt(x, z) ?? gifts.cardAt(x, z) ?? hearth.cardAt(x, z) ?? campCardAt(kit, x, z),
    /**
     * What a view ray meets first among the things sitting up on the hearth and by the fire (a pot,
     * the cup, a piece firing), as the ground point under its middle: tried before the ground, so
     * they win over the ring that holds them. @param {number[]} o @param {number[]} d
     */
    liftedUnderRay: (o, d) => (hidden ? null : hearth.liftedUnderRay(o, d)),
    /** The stations (S1): the workbench and the fire's workspace (tools, tests, test links). */
    stations,
    /** The hearth, the pots and the clay pieces (S4, S5; tools, tests, test links). */
    hearth,
    /** The pot carried in both arms (K-26; tests). */
    carry,
    /** The carriers (P2f; tests). */
    carriers,
    /** The tea's boon and the tea pot (P2e; tests, test links). */
    boons, teapot: () => teapot,
    /** The cooking pot's meal (docs/future/15 slice 4; tests, test links). */
    cookpot,
    /** Where a camp slot is in the world (the hen's nest box stands in `nest`). */
    slotAt,
    /**
     * The gift stone (B1 C1): its draw pass (`gifts.pass`), `leave(kind, from, name)` to lay
     * something on it (false before it stands), `take()` (tests, test links).
     */
    gifts,
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
    /**
     * The laid ring and its fire-nights, for charcoal and ash at dawn (P2i; src/world/gather/spots.js
     * RingPlace), or null before the ring is laid.
     */
    ringPlace() {
      const r = slotAt('ring'), c = camp();
      if (!r || !ringLaid(c)) return null;
      return { x: r.x, z: r.z, r: R.reach.ringCardM ?? 0.8, nights: fireNights(c.fire, hourNow(), F), dawnH: F.night?.dawnH ?? 4, duskH: F.night?.duskH ?? 20 };
    },
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
        if (lit) change((c) => withFire(c, lit, hourNow(), F));
        return !!lit;
      },
      /** @param {boolean} on */
      hide(on) { hidden = on; },
      /** The star's logs left out (the bench's star row). @param {boolean} on */
      hideStar(on) { frame.hideStar(on); },
      /** @param {Parameters<typeof frame.starAs>[0]} f */
      starAs(f) { frame.starAs(f); },
      /**
       * The fire set as a word (the test links, tools/hearth-check.html): lit with four hours of
       * flame left, banked two hours ago, or gone cold half a day ago. @param {'lit' | 'embers' | 'cold'} word
       */
      fireAs(word) {
        const h = hourNow(), set = word === 'lit' ? { state: 'lit', sinceHour: h - 1, flameUntilHour: h + 4 }
          : word === 'embers' ? { state: 'embers', sinceHour: h - 2, flameUntilHour: h - 2 } : { state: 'embers', sinceHour: h - 36, flameUntilHour: h - 36 };
        update('camp', (c) => ({ ...c, fire: { ...c.fire, ...set, lightings: Math.max(1, c.fire?.lightings ?? 0) } }));
      },
    },
    dispose() { for (const off of offs) off(); player.dispose(); stations.dispose(); hearth.dispose(); carry.dispose(); gifts.dispose(); teapot?.dispose(); cookpot?.dispose(); boons.dispose(); carriers.dispose(); },
  };
}

/** @typedef {ReturnType<typeof createCamp>} Camp */
