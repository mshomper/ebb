// @ts-check
// The meadow islet's stories without creatures, live (F20; docs/future/20-meadow-stories.md, "The
// first cut: rye" and "The marker stone"; recipes/land/meadow-islet.json stone and rye).
//
// The marker stone stands on the islet's dome from the moment the islet shows, drawn in the pieces
// pass on the live ground, so it rises with it (an islet that rose before F20 has it on the next
// load). A few rye stalks gone wild stand at its foot; any gone come back each late summer and
// autumn. At noon on summer day 0, in a year after the islet rose, the sun through the notch marks
// one spot until the next morning (stone.js); a dig there gives the old pot with the sickle blade,
// once, and opens the sickle's make (the saved unlock `sickle`). From then on the stone's card tells
// the season by its noon shadow. Rye sown from the seed tin comes up as a strip (src/world/sowing);
// Cut the rye on a ripe rye plant's card, with the sickle, cuts the ripe rye within reach and stands
// it in stooks; Take up on a dry stook gives rye straw and rye seed.
//
// Saved inside the islet's section (islet.meadow, model.js). Story flags (journal flags, for the
// threads and hints): setpiece:stone:seen, setpiece:stone:light, setpiece:stone:pot,
// setpiece:stone:calendar, setpiece:rye:gathered, setpiece:rye:sown, setpiece:rye:cut.

import { emitDeferred, on } from '../../core/events.js';
import { get, update } from '../../core/store.js';
import { packMesh } from '../creatures/bodies.js';
import { dispatch, onAction } from '../../input/actions.js';
import { registerCardAction } from '../../ui/card-actions.js';
import { STAGE } from '../growth/plant.js';
import { cleanMeadow } from './model.js';
import { markerStoneMesh, stookMesh, lightMarkMesh } from './meshes.js';
import { stoneSpot, stoneBone, stoneToWorld, midsummerSpot, midsummerNoonH, lightShows, shadowLine } from './stone.js';
import { wildSpots, cutTakes, stooksOf, stookLeftH, inWindow } from './rye.js';

const STOOK_SHAPES = 3;
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/**
 * @param {{ R: any, islet: import('../islet/index.js').Islet, seed: number, terrain: any, pieces: any, growth: any, world: any,
 *   walk: any, pack: any, dig: any, sunOpts?: any, hours: () => number, record: () => void }} o
 *   R: recipes/land/meadow-islet.json; seed: the islet's seed (subSeed(world, 'islet')); hours: game
 *   hours now (world time); record: write the world state to the store (a plant went in or out)
 */
export function createMeadow(o) {
  const R = o.R, S = R.stone, Y = R.rye, W = R.meadowWords, M = S.midsummer;
  const L = o.islet.layout, shape = o.islet.shape;
  const st = stoneSpot(L, shape, S, o.seed);
  const stone = markerStoneMesh(S, o.seed);
  o.pieces.pass.setMesh('marker-stone', { data: packMesh(stone.mesh), indices: stone.mesh.indices });
  for (let i = 0; i < STOOK_SHAPES; i++) { const m = stookMesh(Y.stooks.look, o.seed + i); o.pieces.pass.setMesh(`rye-stook-${i}`, { data: packMesh(m), indices: m.indices }); }
  const mark = lightMarkMesh(M.mark);
  o.pieces.pass.setMesh('noon-light', { data: packMesh(mark), indices: mark.indices });
  const bone = stoneBone(st.lean, S.sinkM);
  // The notch and the spot it lights, on the islet's final ground (the same on every load).
  const baseY = shape.heightAt(st.x, st.z);
  const notch = stoneToWorld(st, baseY, S.sinkM, [0, stone.notchY + S.notch.depthM * 0.4, 0]);
  const spot = midsummerSpot(notch, (x, z) => shape.heightAt(x, z), M, o.sunOpts);
  const wild = wildSpots(st, Y.wild);

  const islet = () => get('islet') ?? null;
  const saved = () => cleanMeadow(islet()?.meadow);
  /** @param {(m: ReturnType<typeof cleanMeadow>) => ReturnType<typeof cleanMeadow>} fn */
  const change = (fn) => update('islet', (s) => ({ ...s, meadow: fn(cleanMeadow(s?.meadow)) }));
  /** Has the islet shown (its shoal, its rise, or risen)? */
  const shown = () => { const p = islet()?.phase; return p === 'shoal' || p === 'rising' || p === 'risen'; };
  const risenH = () => (shown() ? islet()?.lowH ?? null : null);
  const lit = () => saved().potH === null && lightShows(o.hours(), risenH(), M);
  const flags = () => get('journal')?.flags ?? [];
  /** @param {string} f */
  const flag = (f) => { if (get('journal') && !flags().includes(f)) dispatch(/** @type {any} */ ({ type: 'journal.flag', flag: f })); };
  const say = (/** @type {string} */ text, showS = 6) => { if (text) emitDeferred('island:notice', { text, showS }); };
  const hasSickle = () => !!get('cook')?.tools?.includes('sickle');
  const pos = () => (o.world.state?.seasons?.index ?? 0) + (o.world.state?.seasons?.phase ?? 0);
  const ground = (/** @type {number} */ x, /** @type {number} */ z) => o.terrain.sampleHeight(x, z);

  // ---- drawing ----

  o.pieces.addBeings(() => {
    if (!shown()) return [];
    /** @type {any[]} */ const out = [{ x: st.x, y: ground(st.x, st.z), z: st.z, yaw: st.yaw, size: 1, mesh: 'marker-stone', bone, slope: [0, 0], seed: 6.7,
      half: [S.widthM / 2, S.thickM / 2] }];
    if (lit()) out.push({ x: spot.x, y: ground(spot.x, spot.z) + 0.01, z: spot.z, yaw: 0, size: 1, mesh: 'noon-light', bone: IDENTITY, slope: [0, 0], seed: 0, half: [M.mark.radiusM, M.mark.radiusM], plain: true });
    saved().stooks.forEach((s, i) => out.push({ x: s.x, y: ground(s.x, s.z), z: s.z, yaw: s.yaw, size: 1, mesh: `rye-stook-${i % STOOK_SHAPES}`, bone: IDENTITY,
      slope: [0, 0], seed: i, half: [Y.stooks.look.spreadM, Y.stooks.look.spreadM], plain: true }));
    return out;
  });

  // ---- the midsummer pot (a dig at the lit spot) ----

  o.dig?.setSpecial?.({
    due: (/** @type {number} */ x, /** @type {number} */ z) => lit() && (x - spot.x) ** 2 + (z - spot.z) ** 2 <= M.digM ** 2,
    found(/** @type {number} */ x, /** @type {number} */ z, /** @type {string | undefined} */ holeId) {
      const h = o.hours();
      change((m) => ({ ...m, potH: Math.floor(h) }));
      update('unlocks', (u) => ({ ...u, sickle: true }));
      o.pack.add('sickle-blade', 1);
      flag('setpiece:stone:pot');
      emitDeferred('journal:learn', { sp: 'markerstone', what: 'pot' });
      emitDeferred('dig:sound', { name: 'cache', seed: 7 });
      say(W.pot, 8);
      update('identify', () => ({ sp: 'markerstone', name: W.potName, sub: null, icon: 'dig', itemIcon: 'sickle-blade', text: W.potCard, wx: x, wz: z, r: 0.3, stage: -1,
        dig: true, digHole: holeId ?? null, noPage: true, at: performance.now() }));
    },
    footprint: () => (shown() ? [{ x: st.x, z: st.z, r: S.footR }] : []),
  });

  // ---- cards ----

  /** The stone's, the light's and the stooks' cards. @param {number} x @param {number} z */
  function cardAt(x, z) {
    if (!shown()) return null;
    const m = saved();
    if ((x - st.x) ** 2 + (z - st.z) ** 2 <= S.tapM ** 2) {
      const after = m.potH !== null;
      if (after) flag('setpiece:stone:calendar'); else flag('setpiece:stone:seen');
      return { sp: 'markerstone', name: W.stoneName, sub: null, icon: 'marker-stone', text: after ? `${W.stoneAfter} ${shadowLine(o.hours(), W.shadow)}` : W.stoneBefore,
        wx: st.x, wz: st.z, r: S.widthM * 0.7, reachR: S.footR + 0.6, stage: -1, canCarry: false };
    }
    if (lit() && (x - spot.x) ** 2 + (z - spot.z) ** 2 <= (M.digM) ** 2) {
      return { sp: 'markerstone', name: W.markName, sub: null, icon: 'marker-stone', text: W.markLine, wx: spot.x, wz: spot.z, r: M.mark.radiusM, stage: -1, noPage: true, canCarry: false };
    }
    const h = o.hours(), K = Y.stooks;
    const i = m.stooks.findIndex((s) => (s.x - x) ** 2 + (s.z - z) ** 2 <= K.tapM ** 2);
    if (i < 0) return null;
    const s = m.stooks[i], left = stookLeftH(s, h, K);
    const when = left > 36 ? W.days.replace('{n}', String(Math.round(left / 24))) : left > 12 ? W.aDay : W.hours;
    const text = left <= 0 ? W.stookDry : s.wetH > 0 && (o.world.state?.weather?.now?.rain ?? 0) > 0.3 ? W.stookWet : W.stookDrying.replace('{left}', when);
    return { sp: 'meadow:stook', stook: i, dry: left <= 0, name: W.stookName, sub: null, icon: 'stook', text, wx: s.x, wz: s.z, r: 0.4, reachR: 1.2, stage: -1, noPage: true, canCarry: false };
  }

  registerCardAction({ id: 'ryecut', icon: 'sickle', order: 12, main: true, label: W.cut,
    when: (c) => c?.sp === 'rye' && !c.camp && !!o.walk.below && hasSickle(), action: (c) => ({ type: 'meadow.cut', x: c.wx, z: c.wz }) });
  registerCardAction({ id: 'stooktake', icon: 'takeup', order: 10, main: true, label: W.takeUp, item: () => 'rye-straw', chip: 'pack',
    when: (c) => c?.sp === 'meadow:stook' && !!c.dry && !!o.walk.below, action: (c) => ({ type: 'meadow.takeUp', i: c.stook }) });

  /** A cut or a take-up on its way: walk there, kneel, then it happens. @type {{ kind: 'cut' | 'take', x: number, z: number, i: number, until: number, at: number } | null} */
  let job = null;
  /** @param {'cut' | 'take'} kind @param {number} x @param {number} z @param {number} i */
  function start(kind, x, z, i) {
    if (job || !o.walk.below) return;
    if (kind === 'cut') {
      if (!hasSickle()) { say(W.cutNoSickle); return; }
      if (!inWindow(pos(), Y.cut.window)) { say(W.cutNotRipe); return; }
      if (saved().stooks.length >= Y.stooks.max) { say(W.cutFull); return; }
    }
    update('identify', () => null);
    if (o.walk.distTo(x, z) > 0.9 && !o.walk.tap(-1e4, -1e4, [x, ground(x, z), z], 0.8)) return;
    job = { kind, x, z, i, until: 0, at: performance.now() };
  }
  const offAction = onAction((/** @type {any} */ a) => {
    if (a.type === 'meadow.cut') start('cut', a.x, a.z, -1);
    else if (a.type === 'meadow.takeUp') { const s = saved().stooks[a.i]; if (s) start('take', s.x, s.z, a.i); }
  });

  /** Cut the ripe rye round (x, z) into stooks. @param {number} x @param {number} z */
  function cut(x, z) {
    const took = cutTakes(o.world.state?.growth?.plants ?? [], { x, z }, st, Y.cut, (p) => p.stage === STAGE.mature || p.stage === STAGE.flowering);
    if (!took.length) { say(W.cutNotRipe); return; }
    for (const p of took) o.growth.lift(p.id);
    o.record();
    const room = Y.stooks.max - saved().stooks.length;
    change((m) => ({ ...m, stooks: [...m.stooks, ...stooksOf(took, Y.cut, Math.floor(o.hours())).slice(0, Math.max(1, room))] }));
    flag('setpiece:rye:cut');
    emitDeferred('journal:learn', { sp: 'rye', what: 'cut' });
    say(W.cutDone, 7);
  }
  /** Take up a dry stook. @param {number} i */
  function takeUp(i) {
    const s = saved().stooks[i];
    if (!s || stookLeftH(s, o.hours(), Y.stooks) > 0) return;
    if (s.straw) o.pack.add('rye-straw', s.straw);
    if (s.seed) o.pack.add('rye.seed', s.seed);
    change((m) => ({ ...m, stooks: m.stooks.filter((_, j) => j !== i) }));
    emitDeferred('journal:learn', { sp: 'rye', what: 'straw' });
    say(W.took, 5);
  }

  // ---- the wild stalks: there with the islet, and back each late summer and autumn ----

  let wildT = 0;
  function keepWild() {
    const s = islet();
    if (!o.growth.habitat?.() || s?.phase !== 'risen') return;
    const first = !(s.planted ?? []).includes('meadow:wild');
    if (!first && !inWindow(pos(), Y.wild.backWindow)) return;
    const rye = (o.world.state?.growth?.plants ?? []).filter((/** @type {any} */ p) => p.sp === 'rye');
    let any = false;
    for (const w of wild) {
      if (rye.some((/** @type {any} */ p) => (p.x - w.x) ** 2 + (p.z - w.z) ** 2 < 0.09)) continue;
      any = o.growth.plant('rye', w.x, w.z, { size: Y.wild.size, minSuit: 0.01 }).ok || any;
    }
    if (any) o.record();
    if (first) update('islet', (q) => ({ ...q, planted: [...(q?.planted ?? []), 'meadow:wild'] }));
  }

  const offs = [
    offAction,
    // Gathered from the wild stalks, or sown (the strip, src/world/sowing).
    on('plant:picked', (/** @type {{ sp: string }} */ p) => { if (p?.sp === 'rye') flag('setpiece:rye:gathered'); }),
    on('growth:planted', (/** @type {{ species: string }} */ p) => { if (p?.species === 'rye') flag('setpiece:rye:sown'); }),
    // A live hour of rain keeps the stooks wet a while longer.
    on('world:ticked', (/** @type {any} */ p) => {
      if ((p?.state?.weather?.now?.rain ?? 0) > 0.3 && saved().stooks.length) change((m) => ({ ...m, stooks: m.stooks.map((s) => ({ ...s, wetH: s.wetH + 1 })) }));
    }),
  ];

  return {
    id: 'meadow',
    stone: st, spot, notch,
    cardAt,
    /** The stone as a solid the walker walks round. */
    solids: () => (shown() ? [{ id: 'marker-stone', x: st.x, z: st.z, r: S.solidR }] : []),
    /** Each frame: the wild stalks, the midsummer light, a cut or a take-up on its way. */
    tick() {
      const now = performance.now();
      if ((wildT += 1) % 60 === 1) {
        keepWild();
        // The islet's first spring with the pot still buried: the morning hint may speak of the notch.
        if (islet()?.phase === 'risen' && (o.world.state?.seasons?.index ?? 0) === 0 && saved().potH === null) flag('setpiece:stone:spring');
      }
      if (lit()) {
        const noon = midsummerNoonH(o.hours(), M);
        if (saved().lightH !== noon) {
          change((m) => ({ ...m, lightH: noon }));
          flag('setpiece:stone:light');
          const w = o.walk.walker;
          if (w?.placed && (w.x - st.x) ** 2 + (w.z - st.z) ** 2 <= M.sayM ** 2) say(W.light, 8);
        }
      }
      if (!job) return;
      if (!o.walk.below) { job = null; return; }
      if (!job.until) {
        if (o.walk.busy()) { if (now - job.at > 8000) job = null; return; }
        if (o.walk.distTo(job.x, job.z) > 1.5) { job = null; return; }
        o.walk.kneelToward(job.x, job.z, job.kind === 'cut' ? Y.cut.kneelS : Y.stooks.takeUpS, job.kind === 'cut' ? 'gather' : 'takeUp');
        job.until = now + (job.kind === 'cut' ? Y.cut.kneelS : Y.stooks.takeUpS) * 1000;
        return;
      }
      if (now < job.until) return;
      const j = job;
      job = null;
      if (j.kind === 'cut') cut(j.x, j.z); else takeUp(j.i);
    },
    /** Tests and the test links. */
    debug: { cut, takeUp, keepWild, wild, lit },
    dispose() { for (const off of offs) off(); },
  };
}

/** @typedef {ReturnType<typeof createMeadow>} Meadow */
