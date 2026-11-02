// @ts-check
// The kite, live (docs/future/20, 'The kite'; Matt, November 1, 2026). Four beats:
//   washed in  the first windy autumn day with the wind onto the bar after the islet rose
//              (rules.js washDay, seeded, so catch-up finds it): a torn kite lies on the islet's
//              strandline, its card saying what mending needs; Take it up puts it in a pouch
//   mended     at the workbench (cook.json makes.kite: the torn kite, rush cord and sticks), a tool
//              on the Keeper book's belt; it hangs on the tent's back pole when it is not flying
//   flown      Fly on the kite's own card (the belt's, or the one hanging at camp), never on the
//              action bar: offered on the islet's top in wind; anywhere else the card says where and
//              when (the store slice beltNotes, read by the Kit page). Walking off reels it in.
//   the view   Rise with it on the same card while it flies (view.js), and a page in the sketchbook
// What it keeps is only journal flags (setpiece:kite:washed, :found, :mended, :flown) and the made
// tool (the cook section's tools), so older saves read as before. The flight itself is live only.

import { get, update } from '../../core/store.js';
import { emitDeferred } from '../../core/events.js';
import { onAction, dispatch } from '../../input/actions.js';
import { registerCardAction } from '../../ui/card-actions.js';
import { packMesh } from '../creatures/bodies.js';
import { cleanCook } from '../camp/making.js';
import { cleanBook, addSketch } from '../sketchbook/model.js';
import { kiteMesh, lineMesh } from './mesh.js';
import { washDay, strandSpot, isletTop, flyState, kiteAt, kitePose, linePoints, segmentBone, axes, windVec } from './rules.js';
import { createKiteView } from './view.js';

const SEGMENTS = 6;

/**
 * @param {{ recipe: any, islet: any, terrain: any, world: any, weather: any, pieces: any, walk: any, camera: any, fovYDeg: number,
 *   pack: any, camp: any, sketchRecipe: any, highTideM: number, hours: () => number, wind: () => { wind: number, dir: number },
 *   things: () => { x: number, z: number, r: number }[], photoOpen: () => boolean }} o
 *   recipe: recipes/world/kite.json; islet: src/world/islet (its layout and final shape); weather:
 *   seasons.json weather; hours: game hours now (display); wind: the wind now (0..1) and the way it blows
 *   toward; things: what the high view frames; highTideM: the highest tide over the sea's level
 */
export function createKite(o) {
  const R = o.recipe, W = R.words, F = R.fly, T = R.tap;
  const L = o.islet?.layout ?? null;
  const shapeAt = (/** @type {number} */ x, /** @type {number} */ z) => o.islet.shape.heightAt(x, z);
  const ground = (/** @type {number} */ x, /** @type {number} */ z) => o.terrain.sampleHeight(x, z);
  const flags = () => /** @type {string[]} */ (get('journal')?.flags ?? []);
  const has = (/** @type {string} */ f) => flags().includes(f);
  const flag = (/** @type {string} */ f) => { if (get('journal') && !has(f)) dispatch(/** @type {any} */ ({ type: 'journal.flag', flag: f })); };
  const say = (/** @type {string} */ text) => emitDeferred('island:notice', { text, showS: 6 });
  const owned = () => cleanCook(get('cook')).tools.includes('kite');
  const risen = () => get('islet')?.phase === 'risen';
  const you = () => (o.walk.below ? o.walk.you() : null);

  /** @type {{ x: number, z: number } | null | undefined} */ let spot;
  /** @type {{ x: number, z: number, y: number } | null | undefined} */ let top;
  const spotNow = () => (spot === undefined ? (spot = L ? strandSpot(L, shapeAt, o.highTideM, R.wash) : null) : spot);
  const topNow = () => (top === undefined ? (top = L ? isletTop(L, shapeAt) : null) : top);
  /** The torn kite lies on the strand: washed in, not taken up, not mended. */
  const lying = () => risen() && has('setpiece:kite:washed') && !has('setpiece:kite:found') && !owned() && !!spotNow();

  /** @type {{ key: string, day: number | null }} */ let wash = { key: '', day: null };
  function checkWash() {
    if (!L || !risen() || has('setpiece:kite:washed')) return;
    const riseDay = get('islet')?.riseDay ?? null, lean = o.world.state?.weather?.lean ?? 0, key = `${riseDay}|${lean}`;
    if (key !== wash.key) wash = { key, day: washDay({ weatherSeed: o.world.env.weatherSeed, lean, weather: o.weather, riseDay, L, W: R.wash }) };
    if (wash.day !== null && o.hours() >= wash.day * 24 + R.wash.hour) flag('setpiece:kite:washed');
  }

  /** May it go up from where you stand? */
  const state = () => flyState(you(), topNow(), ground, o.wind().wind, F);
  /** @type {{ t: number, from: number[], dir: number } | null} */ let flying = null;
  const up = () => !!flying && flying.t >= F.climbS;
  /** What the kite's card adds: flying, or whether and where it may go up. */
  const note = () => (flying ? W.flying : { ok: W.ready, calm: W.calm, where: W.where }[state()]);

  /** The hand holding the line. */
  function hand() {
    const h = o.walk.hand('r'), y = you();
    return h ? [h.x, h.y, h.z] : y ? [y[0], y[1] + 0.9, y[2]] : null;
  }
  /** The kite in the air now, or null. */
  function inAir() {
    const h = flying && hand();
    if (!flying || !h) return null;
    return { hand: h, k: kiteAt(h, flying.dir, flying.t, F) };
  }

  const view = createKiteView({ camera: o.camera, fovY: (o.fovYDeg * Math.PI) / 180, V: R.view, things: o.things, photoOpen: o.photoOpen,
    kite: () => { const a = inAir(); return a ? [a.k.x, a.k.y, a.k.z] : null; }, onHeld: sketch });

  /** A page in the sketchbook from the kite (subject 'kite'): no charcoal is worn for it. */
  function sketch() {
    const S = o.sketchRecipe;
    if (!S) return;
    const b = cleanBook(get('sketchbook')), hour = o.hours(), hod = hour % 24, M = S.moments ?? {};
    const inside = (/** @type {number[] | undefined} */ r) => !!r && hod >= r[0] && hod <= r[1];
    const moment = inside(M.dusk) ? 'dusk' : inside(M.dawn) ? 'dawn' : null;
    const r = addSketch(b, 'kite', { hour, season: o.world.state?.seasons?.index ?? 0, moment }, S);
    update('sketchbook', () => ({ ...r.book, wear: b.wear }));
    if (r.stage > 0) say(S.words?.newPage ?? '');
  }

  function take() {
    const s = spotNow();
    if (!lying() || !s) return;
    if (o.walk.distTo(s.x, s.z) > T.reachM) { say(W.away); return; }
    if (!o.pack.room('torn-kite')) { say(W.full); return; }
    o.walk.kneelToward(s.x, s.z, 1.2, 'takeUp');
    o.pack.add('torn-kite', 1);
    flag('setpiece:kite:found');
    update('identify', () => null);
    say(W.taken);
  }
  function fly() {
    const y = you(), st = state();
    if (!owned() || flying || !y) return;
    if (st !== 'ok') { say(st === 'calm' ? W.calm : W.where); return; }
    if (get('keeperUi')?.open) dispatch(/** @type {any} */ ({ type: 'ui.keeper', open: false }));
    update('identify', () => null);
    const dir = o.wind().dir, w = windVec(dir);
    o.walk.faceToward(y[0] + w[0] * 5, y[2] + w[1] * 5);
    o.walk.gesture('takeUp');
    o.walk.hold(true);
    flying = { t: 0, from: [y[0], y[2]], dir };
    emitDeferred('kite:up', { x: y[0], z: y[2] });
  }
  /** Wind it in: the view comes back, the hands come down. @param {string} [line] */
  function reel(line) {
    if (!flying) return;
    view.stop();
    flying = null;
    o.walk.hold(false);
    o.walk.gesture('takeUp');
    if (line) say(line);
    emitDeferred('kite:down', {});
  }

  // ---- drawing (the pieces pass, meshes baked once) ----
  o.pieces.pass.setMesh('kite-whole', (() => { const m = kiteMesh(R.look, false); return { data: packMesh(m), indices: m.indices }; })());
  o.pieces.pass.setMesh('kite-torn', (() => { const m = kiteMesh(R.look, true); return { data: packMesh(m), indices: m.indices }; })());
  o.pieces.pass.setMesh('kite-line', (() => { const m = lineMesh(R.look); return { data: packMesh(m), indices: m.indices }; })());
  /** The way the torn kite's spine lies on the sand (from its spot, so always the same). @param {{ x: number, z: number }} s */
  const lieYaw = (s) => 0.6 + (Math.abs(s.x * 13.1 + s.z * 7.7) % 1) * 2;
  /** The middle of what you see of it lying there: down its spine from the spars' crossing, toward its tail. @param {{ x: number, z: number }} s */
  const lieMiddle = (s) => { const a = lieYaw(s), d = R.look.spanM * 0.35; return { x: s.x - Math.sin(a) * d, z: s.z - Math.cos(a) * d }; };
  const being = (/** @type {number[]} */ at, /** @type {string} */ mesh, /** @type {Float32Array} */ bone) =>
    ({ x: at[0], y: at[1], z: at[2], yaw: 0, size: 1, mesh, bone, slope: [0, 0], seed: 3.7, half: [0.3, 0.3], plain: true });

  /** Where it hangs at camp: on the tent's back pole, once the tent is pitched. */
  function hangAt() {
    const t = o.camp?.pitched?.() ? o.camp.slotAt('tent') : null;
    if (!t) return null;
    const p = R.hang.tentM, c = Math.cos(t.yaw), s = Math.sin(t.yaw), k = (R.hang.tiltDeg * Math.PI) / 180;
    const at = [t.x + c * p[0] + s * p[2], t.y + p[1], t.z - s * p[0] + c * p[2]];
    const y = [s * Math.sin(k), Math.cos(k), c * Math.sin(k)], z = [-s * Math.cos(k), Math.sin(k), -c * Math.cos(k)];
    const x = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]];
    return { at, bone: axes(x, y, z) };
  }
  o.pieces.addBeings(() => {
    const out = [];
    const s = lying() ? spotNow() : null;
    if (s) {
      const a = lieYaw(s);
      out.push(being([s.x, ground(s.x, s.z) + 0.02, s.z], 'kite-torn', axes([-Math.cos(a), 0, Math.sin(a)], [Math.sin(a), 0, Math.cos(a)], [0, 1, 0])));
    }
    const air = inAir();
    if (air) {
      const k = [air.k.x, air.k.y, air.k.z];
      out.push(being(k, 'kite-whole', kitePose(k, air.hand, flying ? flying.t : 0, F)));
      const pts = linePoints(air.hand, k, air.k.len * F.sagShare, SEGMENTS);
      for (let i = 0; i < SEGMENTS; i++) out.push(being(pts[i], 'kite-line', segmentBone(pts[i], pts[i + 1])));
    } else if (owned()) {
      const h = hangAt();
      if (h) out.push(being(h.at, 'kite-whole', h.bone));
    }
    return out;
  });

  // ---- cards ----
  const base = { sub: null, icon: 'kite', noPage: true, stage: -1, canCarry: false };
  /**
   * The torn kite lying on the strand, or the kite hanging at camp. @param {number} x @param {number} z
   */
  function cardAt(x, z) {
    const s = lying() ? spotNow() : null;
    const sm = s ? lieMiddle(s) : null;
    if (s && sm && Math.hypot(x - sm.x, z - sm.z) < T.lyingR) {
      return { ...base, sp: 'kite:torn', name: W.tornName, itemIcon: 'torn-kite', text: `${W.torn} ${W.tornNeeds}`, wx: s.x, wz: s.z, r: 0.5, reachR: 1.0, kiteTorn: true };
    }
    const h = !flying && owned() ? hangAt() : null;
    if (h && Math.hypot(x - h.at[0], z - h.at[2]) < T.hangR) {
      return { ...base, sp: 'kite', name: W.name, text: `${W.hung} ${note()}`, wx: h.at[0], wz: h.at[2], r: 0.4, reachR: 0.9, kiteHung: true };
    }
    return null;
  }
  /** A card for the kite itself: on the Keeper book's belt, or hanging at camp. @param {any} c */
  const isKite = (c) => (c?.belt === 'kite' && !!c.owned) || !!c?.kiteHung;

  const offs = [
    registerCardAction({ id: 'kitetake', icon: 'takeup', order: 9, main: true, label: W.takeUp, item: () => 'torn-kite', chip: 'pack',
      when: (c) => !!c?.kiteTorn && lying(), action: () => ({ type: 'kite.take' }) }),
    registerCardAction({ id: 'kitefly', icon: 'fly', order: 6, main: true, label: W.fly,
      when: (c) => isKite(c) && owned() && !flying && state() === 'ok', action: () => ({ type: 'kite.fly' }) }),
    registerCardAction({ id: 'kiterise', icon: 'kiteview', order: 7, main: true, label: W.rise,
      when: (c) => isKite(c) && up() && !view.viewing, action: () => ({ type: 'kite.rise' }) }),
    registerCardAction({ id: 'kitereel', icon: 'reel', order: 8, label: W.reel,
      when: (c) => isKite(c) && !!flying, action: () => ({ type: 'kite.reel' }) }),
    onAction((/** @type {any} */ a) => {
      if (a.type === 'kite.take') take();
      else if (a.type === 'kite.fly') fly();
      else if (a.type === 'kite.rise') { if (up()) { if (get('keeperUi')?.open) dispatch(/** @type {any} */ ({ type: 'ui.keeper', open: false })); update('identify', () => null); view.start(); } }
      else if (a.type === 'kite.reel') reel(W.reeled);
    }),
  ];

  let slow = 0;
  /** The Kit page's line for the kite on the belt (src/world/kit beltNotes). */
  function publish() {
    const n = owned() ? note() : null;
    if ((get('beltNotes')?.kite ?? null) !== n) update('beltNotes', (b) => ({ ...(b ?? {}), kite: n }));
  }

  return {
    id: 'kite',
    cardAt,
    /** Where it lies on the strand, the islet's top (tests, the test link). */
    spot: spotNow,
    top: topNow,
    lying,
    /** Is it in the air? */
    get flying() { return !!flying; },
    /** Is the view up with it? */
    get viewing() { return view.viewing; },
    fly, reel, take,
    rise: () => { if (up()) view.start(); },
    /** Each frame. @param {{ realDt: number }} f */
    tick(f) {
      if ((slow -= f.realDt) <= 0) {
        slow = 0.5;
        checkWash();
        if (owned()) flag('setpiece:kite:mended');
        publish();
        // Standing, you keep facing the kite as it swings about on the wind.
        const air = inAir();
        if (air && !o.walk.busy()) o.walk.faceToward(air.k.x, air.k.z);
      }
      if (flying) {
        flying.t += f.realDt;
        const y = you();
        if (!y || Math.hypot(y[0] - flying.from[0], y[2] - flying.from[1]) > F.walkOffM) reel(W.reeled);
        else if (o.wind().wind < F.windMin * F.calmShare) reel(W.down);
        else if (up()) flag('setpiece:kite:flown');
      }
      view.tick(f.realDt);
    },
    dispose() { view.dispose(); for (const off of offs) off(); },
  };
}
