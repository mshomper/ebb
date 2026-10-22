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

import { on, emit, emitDeferred } from '../../core/events.js';
import { get, update } from '../../core/store.js';
import { onAction } from '../../input/actions.js';
import { subSeed, hash32 } from '../../core/rng.js';
import { registerCardAction } from '../../ui/card-actions.js';
import { offerHere, withdrawHere } from '../../ui/ground-here.js';
import { sunMoon } from '../sky/sun-moon.js';
import { weatherAt } from '../weather.js';
import { onPad, padToWorld } from './layout.js';
import { cleanCamp, pitched, ringLaid, pitchTent, layRing } from './model.js';
import { fireAt, lightFire, feedFire, bankFire, settleFire } from './fire.js';
import { kelvinRgb, flicker } from './light.js';
import { createPropsPass } from '../../render/passes/props.js';
import { createCampFxPass } from '../../render/passes/camp-fx.js';
import { actLength } from '../figure/acts.js';
import { steelMesh, flintMesh } from './steel-mesh.js';

const H = 3600, DEG = Math.PI / 180;

/**
 * @param {{ recipe: any, seed: number, walk: any, terrain: any, clock: any, orbit: any, camera: any,
 *   world: any, seasons: any, lighting: { setPoints: (l: any[]) => void }, pack?: any,
 *   shadowBias?: { depthBias: number, depthBiasSlopeScale: number }, low?: boolean,
 *   beat?: () => string | null, poses?: any }} o
 *   recipe: recipes/world/camp.json; walk: the walker; lighting: the shared light block;
 *   pack: E2's pack (holds, take); beat: the evening's beat now (the director), for its glows;
 *   poses: recipes/world/figure.json poses (how long the strike act is, for its sparks)
 */
export function createCamp(o) {
  const R = o.recipe, W = R.words, F = R.fire;
  const campSeed = subSeed(o.seed, 'camp');
  const props = createPropsPass({ recipe: R.props, bias: o.shadowBias });
  const fx = createCampFxPass({ recipe: R, low: o.low });
  const fireRgb = kelvinRgb(F.lightK), emberRgb = kelvinRgb(F.emberLightK), lanternRgb = kelvinRgb(R.lantern.lightK);
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

  /** @returns {import('./model.js').Camp} */
  const camp = () => cleanCamp(get('camp'));
  /** @param {(c: import('./model.js').Camp) => import('./model.js').Camp} fn */
  const change = (fn) => update('camp', (c) => fn(cleanCamp(c)));
  /** @returns {import('./layout.js').Pad | null} */
  const padNow = () => get('campPad') ?? null;
  const hourNow = () => o.clock.worldT() / H;
  /** A slot's ground point and the yaw that turns a model's +z seaward. @param {string} id */
  function slotAt(id) {
    const pad = padNow();
    const s = pad?.camp?.slots?.find((/** @type {any} */ q) => q.id === id);
    if (!pad || !s) return null;
    const [x, z] = padToWorld(pad, s.u, s.v);
    return { x, z, y: o.terrain.sampleHeight(x, z), yaw: Math.atan2(pad.fx, pad.fz), slot: s };
  }
  /** Where you kneel at the tent's flap, facing the sea (the evening's flapSpot). */
  function flapAt() {
    const pad = padNow(), t = slotAt('tent');
    if (!pad || !t) return null;
    const [x, z] = padToWorld(pad, t.slot.u + (t.slot.w ?? 2.2) / 2 + 0.6, t.slot.v);
    return { x, z, yaw: Math.atan2(pad.fx, pad.fz) };
  }
  /** A point in the tent model's frame, in the world. @param {number[]} p */
  function tentPoint(p) {
    const t = /** @type {any} */ (slotAt('tent'));
    const c = Math.cos(t.yaw), s = Math.sin(t.yaw);
    return [t.x + c * p[0] + s * p[2], t.y + p[1], t.z - s * p[0] + c * p[2]];
  }
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
  const ringNeed = () => ({ fuel: R.ring.fuelHandfuls, stones: R.ring.stoneHandfuls });

  // ---- acts: walk, face, play, then the change ----

  /** @type {{ act: string, then: () => void } | null} */ let pending = null;
  let strikeT = -1, strikes = 0, strikeLen = 0;
  /** Play an act facing a point, then do `then` when it ends. @param {string} act @param {{ x: number, z: number }} at @param {() => void} then */
  function play(act, at, then) {
    if (pending || !o.walk.below) return false;
    o.walk.faceToward(at.x, at.z);
    if (!o.walk.act(act)) return false;
    pending = { act, then };
    return true;
  }
  const offs = [
    on('walk:act-done', (/** @type {any} */ p) => {
      if (!pending || p.name !== pending.act) return;
      const then = pending.then;
      pending = null;
      then();
    }),
  ];

  function pitch() {
    if (pitched(camp())) return;
    const t = slotAt('tent');
    if (!t) return;
    play('pitch', t, () => {
      change((c) => pitchTent(c, hourNow(), hash32(campSeed, 1)));
      emitDeferred('camp:pitched', { hour: hourNow() });
    });
  }

  function lay() {
    const c = camp(), r = slotAt('ring');
    if (!pitched(c) || ringLaid(c) || !r) return;
    if (!holds(ringNeed())) { emit('island:notice', { text: W.ringNeeds, showS: 6 }); return; }
    play('lay', r, () => {
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
    if (word === 'cold' && !holds({ fuel: R.fire.feedHandfuls })) { emit('island:notice', { text: W.feedNeeds, showS: 6 }); return; }
    const ok = play('strike', r, () => {
      strikeT = -1;
      const now = hourNow(), cc = camp();
      if (fireAt(cc.fire, now, F).word === 'cold' && !takeGroup('fuel', R.fire.feedHandfuls)) return;
      const lit = lightFire(cc.fire, now, F);
      if (!lit) return;
      change((x) => ({ ...x, fire: lit }));
      emitDeferred('camp:lit', { hour: now, first: lit.lightings === 1 });
      emit('camp:sound', { name: 'catch' });
    });
    if (ok) { strikeT = 0; strikes = 0; strikeLen = (o.poses && actLength(o.poses, 'strike')) || 3; }
  }

  function feed() {
    const c = camp(), r = slotAt('ring');
    if (!r) return;
    const now = hourNow(), word = fireAt(c.fire, now, F).word;
    if (word !== 'embers' && word !== 'lit') return;
    if (!holds({ fuel: R.fire.feedHandfuls })) { emit('island:notice', { text: W.feedNeeds, showS: 6 }); return; }
    o.walk.kneelToward(r.x, r.z, 1.6);
    const fed = feedFire(c.fire, now, F);
    if (!fed || !takeGroup('fuel', R.fire.feedHandfuls)) return;
    change((x) => ({ ...x, fire: fed }));
    emitDeferred('camp:fed', { hour: now });
  }

  let resting = false;
  function rest() {
    const c = camp(), f = flapAt();
    if (!pitched(c) || !f || resting) return;
    if (!nightNow()) { emit('island:notice', { text: W.restDay, showS: 6 }); return; }
    play('crawlIn', f, () => {
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
      const pose = o.camera?.pose();
      // From beside you, so the tent behind does not fill the view: the ring, the pad and the sea.
      if (pose) o.camera.setPose({ ...pose, target: [f.x, o.terrain.sampleHeight(f.x, f.z), f.z], yaw: f.yaw + Math.PI + R.rest.viewSideRad });
      o.walk.downHere();
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
  }));

  // ---- cards (one click walks there and opens it) ----

  const C = (/** @type {any} */ c) => c?.camp;
  offs.push(
    registerCardAction({ id: 'camppitch', icon: 'pitch', order: 5, main: true, label: W.pitch,
      when: (c) => C(c) === 'tentSlot', action: () => ({ type: 'camp.pitch' }) }),
    registerCardAction({ id: 'camplay', icon: 'lay', order: 5, main: true, label: W.lay,
      when: (c) => C(c) === 'ringSlot' && !!c.canLay, action: () => ({ type: 'camp.lay' }) }),
    registerCardAction({ id: 'camplight', icon: 'fire', order: 6, main: true, label: W.light,
      when: (c) => C(c) === 'ring' && !!c.canLight, action: () => ({ type: 'camp.light' }) }),
    registerCardAction({ id: 'campfeed', icon: 'fire', order: 6, main: true, label: W.feed,
      when: (c) => C(c) === 'ring' && !!c.canFeed, action: () => ({ type: 'camp.feed' }) }),
    registerCardAction({ id: 'camprest', icon: 'rest', order: 6, main: true, label: W.rest,
      when: (c) => C(c) === 'tent', action: () => ({ type: 'camp.rest' }) }),
    // Every card ties into the journal: the camp's into the keeper's first page.
    registerCardAction({ id: 'camppage', icon: 'journal', order: 90, label: 'The first page',
      when: (c) => !!C(c), action: () => ({ type: 'ui.journal', open: true, view: 'keeper', keeper: 'first', page: null }) }),
  );

  /**
   * The card a click at a ground point opens, if it lands on the camp's tent or ring (or their
   * glowing ground). The journal's cardAt asks this before the pieces. @param {number} x @param {number} z
   */
  function cardAt(x, z) {
    const c = camp(), t = slotAt('tent'), r = slotAt('ring');
    const base = { noPage: true, stage: -1, sub: null, canCarry: false };
    if (t && Math.hypot(x - t.x, z - t.z) < 1.25) {
      if (pitched(c)) return { ...base, sp: 'camp:tent', camp: 'tent', name: W.tent.name, icon: 'rest', text: nightNow() ? W.tent.line : W.restDay, wx: t.x, wz: t.z, r: 1.1 };
      if (c.kit.tent === 'pack') return { ...base, sp: 'camp:tent-slot', camp: 'tentSlot', name: W.tentSlot.name, icon: 'pitch', text: W.tentSlot.line, wx: t.x, wz: t.z, r: 1.0 };
    }
    if (r && pitched(c) && Math.hypot(x - r.x, z - r.z) < 0.8) {
      if (!ringLaid(c)) {
        const canLay = holds(ringNeed());
        return { ...base, sp: 'camp:ring-slot', camp: 'ringSlot', name: W.ringSlot.name, icon: 'lay', text: canLay ? W.ringSlot.line : W.ringNeeds, wx: r.x, wz: r.z, r: 0.5, canLay };
      }
      const word = fireAt(c.fire, hourNow(), F).word, rainy = weatherNow().rain > F.rainLow;
      const line = word === 'lit' && rainy ? W.ring.low : W.ring[word] ?? W.ring.laid;
      const fuel = holds({ fuel: R.fire.feedHandfuls });
      return { ...base, sp: 'camp:ring', camp: 'ring', name: W.ring.name, icon: 'fire', text: line, wx: r.x, wz: r.z, r: 0.5,
        canLight: word === 'laid' || (word === 'cold' && fuel), canFeed: (word === 'embers' || word === 'lit') && fuel };
    }
    return null;
  }

  // ---- each frame ----

  /** @type {'pole' | 'carried'} */ let lantern = 'pole';
  let wasCold = false, t0 = 0;

  /**
   * The slots that glow now (CS-05), as the terrain marks' filled rings [x, z, radius, opacity].
   * @param {number} now seconds
   */
  function rings(now) {
    const c = camp(), pad = padNow();
    if (!pad) return [];
    const G = R.glow, k = G.opacity * (0.75 + 0.25 * Math.sin((now * 2 * Math.PI) / G.breathS));
    const you = o.walk.below ? o.walk.you() : null;
    const nearPad = !!you && Math.hypot(you[0] - pad.x, you[2] - pad.z) <= pad.r + G.nearM;
    const beat = o.beat?.() ?? null;
    /** @type {number[][]} */ const out = [];
    const t = slotAt('tent'), r = slotAt('ring');
    if (t && !pitched(c) && c.kit.tent === 'pack' && (beat === 'pitch' || olderGlow || nearPad)) out.push([t.x, t.z, 1.2, k]);
    if (r && pitched(c) && !ringLaid(c) && (beat === 'ring' || (nearPad && holds(ringNeed())))) out.push([r.x, r.z, 0.7, k]);
    if (r && ringLaid(c) && beat === 'dusk' && sunAlt() < 0 && fireAt(c.fire, hourNow(), F).word === 'laid') out.push([r.x, r.z, 0.7, k]);
    const f = flapAt();
    if (f && beat === 'rest' && pitched(c)) out.push([f.x, f.z, 0.6, k * 0.7]);
    return out;
  }

  /**
   * The here-bar: Light at the laid ring, Feed at a burning one, Rest at the flap after dark.
   * @param {import('./model.js').Camp} c @param {import('./fire.js').FireWord} word
   */
  function here(c, word) {
    const r = slotAt('ring'), f = flapAt();
    const atRing = ringLaid(c) && near(r, R.reach.ringM) && !pending;
    const fuel = holds({ fuel: R.fire.feedHandfuls });
    if (atRing && (word === 'laid' || (word === 'cold' && fuel))) offerHere({ id: 'camplight', icon: 'fire', label: W.light, order: 10, action: { type: 'camp.light' } });
    else withdrawHere('camplight');
    if (atRing && (word === 'embers' || word === 'lit') && fuel) offerHere({ id: 'campfeed', icon: 'fire', label: W.feed, order: 11, action: { type: 'camp.feed' } });
    else withdrawHere('campfeed');
    if (pitched(c) && near(f, R.reach.flapM) && !pending && nightNow()) offerHere({ id: 'camprest', icon: 'rest', label: W.rest, order: 12, action: { type: 'camp.rest' } });
    else withdrawHere('camprest');
  }

  let hereT = 0;
  /** @param {number} dt real seconds @param {number} time real seconds (animation time) */
  function updateFrame(dt, time) {
    const c = camp(), pad = padNow();
    const hour = hourNow();
    const fireNow = fireAt(c.fire, hour, F), word = fireNow.word;
    // The ring goes cold by the clock alone; say so once when it does (live).
    const cold = word === 'cold';
    if (cold && !wasCold && t0 > 0) emitDeferred('camp:cold', { hour });
    wasCold = cold;
    t0 += dt;
    if ((hereT -= dt) <= 0) { hereT = 0.25; here(c, word); }

    /** @type {import('../../render/passes/props.js').Prop[]} */ const list = [];
    /** @type {import('../../render/lighting.js').PointLight[]} */ const lights = [];
    const w = weatherNow();
    const rainy = w.rain > F.rainLow;
    const dark = sunAlt() < R.lantern.lightsAtSunDeg * DEG;
    const t = slotAt('tent'), r = slotAt('ring');
    let lanternGlass = /** @type {number[] | null} */ (null);
    if (t && pitched(c)) {
      const sh = R.props.models.tent.shade;
      list.push({ key: 'tent', x: t.x, y: t.y, z: t.z, yaw: t.yaw, shade: sh });
      // The lantern: on the front pole, or in your hand off the pad at night.
      const you = o.walk.below ? o.walk.you() : null;
      lantern = dark && you && pad && !onPad(pad, you[0], you[2]) ? 'carried' : 'pole';
      const hand = lantern === 'carried' ? o.walk.hand('l') : null;
      const at = hand ? [hand.x, hand.y - R.lantern.carryDropM, hand.z] : tentPoint(R.lantern.hangM);
      const yaw = hand ? hand.yaw : t.yaw;
      list.push({ key: 'lantern', x: at[0], y: at[1], z: at[2], yaw });
      if (dark) {
        lanternGlass = [at[0], at[1] + 0.15, at[2]];
        const L = R.lantern;
        lights.push({ x: lanternGlass[0], y: lanternGlass[1], z: lanternGlass[2], rangeM: L.rangeM, cd: L.cd * flicker(time, L.flicker, L.flickerHz, 2), rgb: lanternRgb });
      }
    }
    let flame = 0, smoke = 0, embers = 0;
    if (r && ringLaid(c)) {
      list.push({ key: 'ring', x: r.x, y: r.y, z: r.z, yaw: r.yaw, shade: R.props.models.ring.shade });
      const left = word === 'lit' ? Math.max(0, Math.min(1, fireNow.flameLeftH / F.flameH)) : 0;
      const ch = word === 'lit' ? F.char.lit + (F.char.embers - F.char.lit) * (1 - left) : word === 'embers' ? F.char.embers : word === 'cold' ? F.char.cold : 0;
      const sq = word === 'lit' ? 1 + (F.squash.lit - 1) * (1 - left) : word === 'embers' ? F.squash.embers : word === 'cold' ? F.squash.cold : 1;
      embers = word === 'embers' ? 1 : word === 'lit' ? (rainy ? 1 : 0.6) : 0;
      // The cold ring's wood and ash fade over the day; then only the stones are left.
      if (word !== 'cold' || fireNow.ash > 0.02) list.push({ key: 'wood', x: r.x, y: r.y, z: r.z, yaw: r.yaw + 0.6, char: ch, squash: sq * (word === 'cold' ? 0.6 + 0.4 * fireNow.ash : 1), glow: embers });
      if (word === 'lit') {
        flame = (rainy ? F.rainFlame : 1) * (0.55 + 0.45 * Math.min(1, left * 3));
        smoke = rainy ? R.smoke.rainThick : 1;
        lights.push({ x: r.x, y: r.y + F.heightM, z: r.z, rangeM: F.rangeM, cd: F.cd * flame * flicker(time, F.flicker, F.flickerHz, 1), rgb: fireRgb });
      } else if (word === 'embers') {
        smoke = R.smoke.embersShare * (rainy ? R.smoke.rainThick : 1);
        lights.push({ x: r.x, y: r.y + 0.3, z: r.z, rangeM: F.rangeM * 0.5, cd: F.emberCd * flicker(time, 0.2, 0.4, 3), rgb: emberRgb });
      }
    }
    // Rain on a burning fire: a hiss as it drops low (once as the rain sets in).
    if (word === 'lit' && rainy && !wasRainy) emit('camp:sound', { name: 'hiss' });
    wasRainy = word === 'lit' && rainy;
    // The steel and flint in your hands while you strike.
    if (pending?.act === 'strike') {
      const hr = o.walk.hand('r'), hl = o.walk.hand('l');
      if (hr) list.push({ key: 'steel', x: hr.x, y: hr.y - 0.02, z: hr.z, yaw: hr.yaw + 1.2 });
      if (hl) list.push({ key: 'flint', x: hl.x, y: hl.y - 0.01, z: hl.z, yaw: hl.yaw });
    }
    props.setProps(list);
    o.lighting.setPoints(lights);
    // The fire steel's sparks, at each strike in the act.
    let sparks = null;
    if (strikeT >= 0 && r) {
      strikeT += dt;
      const share = strikeT / Math.max(0.1, strikeLen), at = R.steel.strikesAt;
      while (strikes < at.length && share >= at[strikes]) { strikes++; strikeAt = strikeT; emit('camp:sound', { name: 'strike' }); }
      const hand = o.walk.hand('r');
      if (strikes > 0 && hand) sparks = [hand.x, hand.y, hand.z, (strikeT - strikeAt) + 10 * (strikes - 1)];
    }
    const wind = w.wind * R.smoke.lean, dir = o.world.state?.weather?.today?.windDir ?? 0;
    fx.set(r && (flame > 0 || smoke > 0 || lanternGlass || sparks) ? {
      fire: [r.x, r.y + 0.04, r.z], flame, smoke, embers: word === 'embers' ? 1 : 0,
      wind: [Math.cos(dir) * wind, -Math.sin(dir) * wind], mist: w.mist,
      lantern: lanternGlass, sparks, moths: sunAlt() < R.moths.atSunDeg * DEG, time,
    } : null);
  }
  let wasRainy = false, strikeAt = 0;

  return {
    id: 'camp',
    /** The draw passes: the models (with their shadow caster), then the fire's effects after the sky. */
    props, fx,
    /** A sim system: each frame. @param {{ realDt: number }} f */
    tick(f) { updateFrame(f.realDt, o.clock.animT()); },
    rings,
    cardAt,
    /** For the evening director: the fire is burning. */
    fireLit: () => fireAt(camp().fire, hourNow(), F).word === 'lit',
    /** The fire now (tools, tests). */
    fire: () => fireAt(camp().fire, hourNow(), F),
    /** The lantern: on its pole or carried (live only). */
    lantern: () => lantern,
    /** Where you kneel at the flap. */
    flap: flapAt,
    /** For the test page and the bench: act on the camp now (as a card press would). */
    debug: { pitch, lay, light, feed, rest },
    dispose() { for (const off of offs) off(); },
  };
}

/** @typedef {ReturnType<typeof createCamp>} Camp */
