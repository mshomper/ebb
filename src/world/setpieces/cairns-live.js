// @ts-check
// The cairn builder, live (docs/future/14): the trail planned once the set piece arms (a `trail`
// note), the cairns drawn in the pieces pass from meshes baked in code (cairn-rules.js), mossier as
// they age, a tap on one opening its card (Add a stone; Read the letter on the last), and a notice
// each morning a new one stands. A cairn that falls while you watch stays hidden until it is out of
// your way (hideM from both you and the view): they never appear while the walker watches. The
// runner (runner.js, hooks.js) keeps everything that lasts, in the world state.

import { get, update } from '../../core/store.js';
import { emit, emitDeferred, on } from '../../core/events.js';
import { subSeed } from '../../core/rng.js';
import { onAction } from '../../input/actions.js';
import { registerCardAction } from '../../ui/card-actions.js';
import { packMesh } from '../creatures/bodies.js';
import { rayToSegment } from '../creatures/perch-rules.js';
import { planTrail, leanYaw, mossOf, cairnMesh, cairnHeight } from './cairn-rules.js';

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/**
 * @param {{ R: any, sp: ReturnType<typeof import('./live.js').createSetpiecesLive>, seed: number, pieces: any, pack: any, walk: any,
 *   terrain: { sampleHeight: (x: number, z: number) => number, openBounds: () => { openMin: number[], openMax: number[] } },
 *   camera: { target: ArrayLike<number> }, hourIndex: () => number, trailEnd?: () => ({ x: number, z: number } | null) }} o
 *   R: recipes/setpieces/cairns.json; sp: the set pieces' live core; trailEnd: where the trail ends, when
 *   something gives one (the old keeper's cache, once the dig reports it); else the far shore
 */
export function createCairnsLive(o) {
  const R = o.R, W = R.words, L = R.look, ID = 'cairns';
  const seed = subSeed(o.seed, 'cairns');
  const ground = (/** @type {number} */ x, /** @type {number} */ z) => o.terrain.sampleHeight(x, z);
  /** Where the trail starts: the camp pad, else the middle of the open land. */
  function start() {
    const pad = get('campPad');
    if (pad) return { x: pad.x, z: pad.z };
    const b = o.terrain.openBounds();
    return { x: (b.openMin[0] + b.openMax[0]) / 2, z: (b.openMin[1] + b.openMax[1]) / 2 };
  }
  const plan = () => planTrail(start(), ground, R.trail, seed, o.trailEnd?.() ?? null);

  const run = () => o.sp.runOf(ID);
  const list = () => /** @type {any[]} */ (run()?.data?.cairns ?? []);
  const trail = () => /** @type {[number, number][] | null} */ (run()?.data?.trail ?? null);
  const total = () => R.beats[0].repeat ?? 1;
  /** The letter lies under the last cairn: it stands, and it has not been read. */
  const letterWaits = () => { const r = run(); return !!r && list().length >= total() && r.data.read === undefined; };

  // ---- hidden while you watch ----
  /** Cairns that fell during this visit and wait to be out of your way before they show. @type {Set<number>} */
  const hidden = new Set();
  let seen = -1;
  function watchNew() {
    const n = list().length;
    if (seen < 0) { seen = n; return; }
    for (let i = seen; i < n; i++) hidden.add(i);
    seen = n;
    if (!hidden.size) return;
    const t = trail(), y = o.walk.you?.(), c = o.camera.target;
    for (const i of [...hidden]) {
      const p = t?.[i];
      if (!p) { hidden.delete(i); continue; }
      const far = (!y || Math.hypot(y[0] - p[0], y[2] - p[1]) > R.hideM) && Math.hypot(c[0] - p[0], c[2] - p[1]) > R.hideM;
      if (far) hidden.delete(i);
    }
  }

  // ---- drawing ----
  /** Baked meshes by their look. @type {Map<string, string>} */ const baked = new Map();
  function meshOf(/** @type {number} */ i, /** @type {any} */ k, /** @type {number} */ moss, /** @type {boolean} */ letter) {
    const stones = k.stones + k.added, key = `${i}:${stones}:${moss}:${letter}`;
    let name = baked.get(key);
    if (!name) {
      name = `cairn-${i}-${baked.size}`;
      const m = cairnMesh(stones, k.seed, L, R.trail.leanDeg, moss, letter);
      o.pieces.pass.setMesh(name, { data: packMesh(m), indices: m.indices });
      baked.set(key, name);
    }
    return name;
  }
  o.pieces.addBeings(() => {
    const t = trail();
    if (!t) return [];
    const hour = o.hourIndex(), last = list().length - 1, letter = letterWaits();
    return list().flatMap((k, i) => {
      const p = t[i];
      if (!p || hidden.has(i)) return [];
      return [{ x: p[0], y: ground(p[0], p[1]), z: p[1], yaw: leanYaw(t, i), size: 1, bone: IDENTITY, slope: [0, 0],
        seed: (k.seed >>> 8) / 16777216 * 10, half: [L.baseM[0] / 2, L.baseM[1] / 2], plain: true,
        mesh: meshOf(i, k, mossOf(hour - k.hour, L), letter && i === last) }];
    });
  });

  // ---- the trail, once it arms ----
  let asked = false;
  function planWhenArmed() {
    const r = run();
    if (!r || r.done !== undefined || r.data.trail || asked) return;
    const t = plan();
    if (!t) return;
    asked = true;
    o.sp.note(ID, 'trail', { points: t });
  }

  // ---- choices ----
  /** The stone kind in the pack to add, or null. */
  const stoneKind = () => R.cairn.addKinds.find((/** @type {string} */ k) => o.pack.has(k, 1)) ?? null;
  /** Is the walker in reach of cairn i? @param {number} i */
  const inReach = (i) => { const y = o.walk.you?.(), p = trail()?.[i]; return !!y && !!p && Math.hypot(y[0] - p[0], y[2] - p[1]) <= R.reachM + 0.6; };

  /** Add a stone to cairn i from the pack. @param {number} i */
  function addStone(i) {
    const k = list()[i], p = trail()?.[i];
    if (!k || !p || !o.walk.below) return;
    if (!inReach(i)) { emitDeferred('island:notice', { text: W.far, showS: 5 }); return; }
    if (k.added >= R.cairn.addMax) { emitDeferred('island:notice', { text: W.full, showS: 5 }); return; }
    const kind = stoneKind();
    if (!kind) { emitDeferred('island:notice', { text: W.noStone, showS: 5 }); return; }
    if (o.pack.take(kind, 1) < 1) return;
    o.walk.gesture?.('setDown', { x: p[0], z: p[1] });
    o.sp.note(ID, 'stone', { cairn: i });
    update('identify', () => null);
    emitDeferred('island:notice', { text: W.added, showS: 5 });
  }

  /** Read the letter under the last cairn: it opens as a page, and is kept in the journal. */
  function read() {
    if (!letterWaits() || !o.walk.below) return;
    const i = list().length - 1, p = trail()?.[i];
    if (!inReach(i)) { emitDeferred('island:notice', { text: W.far, showS: 5 }); return; }
    if (p) o.walk.gesture?.('takeUp', { x: p[0], z: p[1] });
    o.sp.note(ID, 'read');
    update('identify', () => null);
    emit('setpiece:read', { id: ID });
    emitDeferred('keeper:card', { id: 'cairns-letter' });
  }

  const offs = [
    onAction((/** @type {any} */ a) => {
      if (a.type === 'cairn.add') addStone(a.cairn);
      else if (a.type === 'cairn.read') read();
    }),
    // Cairns that stood up while you were away (or asleep) were never watched: they show at once.
    on('world:caught-up', () => { hidden.clear(); seen = list().length; }),
    registerCardAction({ id: 'cairnadd', icon: 'stone', order: 12, main: (c) => !c.letter, label: W.add, item: () => stoneKind() ?? R.cairn.addKinds[0], chip: 'offer',
      when: (c) => c?.sp === 'setpiece:cairn' && !!get('walk')?.below && !c.full, action: (c) => ({ type: 'cairn.add', cairn: c.cairn }) }),
    registerCardAction({ id: 'cairnread', icon: 'notes', order: 10, main: true, label: W.read,
      when: (c) => c?.sp === 'setpiece:cairn' && !!c.letter && !!get('walk')?.below, action: () => ({ type: 'cairn.read' }) }),
  ];

  o.sp.use({
    id: ID,
    flags(r) {
      const f = [];
      // One flag for each cairn standing (setpiece:cairns:1 and on), for the Threads page (recipes/world/threads.json).
      for (let k = 1; k <= Math.min(r.fell?.length ?? 0, total()); k++) f.push(`setpiece:cairns:${k}`);
      if ((r.data?.cairns ?? []).some((/** @type {any} */ k) => k.added > 0)) f.push('setpiece:cairns:added');
      if (r.data?.read !== undefined) f.push('keeper:cairns-letter');
      return f;
    },
    beat(p) {
      if (p.beat !== 'cairn') return;
      const k = list()[p.rep];
      emitDeferred('island:notice', { text: p.rep === 0 ? W.first : k?.answer ? W.answer : p.rep === total() - 1 ? W.end : W.next, showS: 7 });
    },
    // The test link plans the trail at once (it needs the ground under it).
    testData() { const t = plan(); return t ? { trail: t } : null; },
  });

  return {
    id: 'cairns-live',
    /** Each frame. */
    tick() { planWhenArmed(); watchNew(); },
    /**
     * The cairn a tap's ray passes near (they stand up off the ground), as { x, z }; or null.
     * @param {number[]} ro @param {number[]} rd
     */
    underRay(ro, rd) {
      const t = trail();
      if (!t) return null;
      let best = null, bt = Infinity;
      list().forEach((k, i) => {
        const p = t[i];
        if (!p || hidden.has(i)) return;
        const y0 = ground(p[0], p[1]);
        const h = rayToSegment(ro, rd, [p[0], y0, p[1]], [p[0], y0 + cairnHeight(k.stones + k.added, L), p[1]]);
        if (h.d <= L.baseM[0] * 0.7 && h.t < bt) { bt = h.t; best = { x: p[0], z: p[1] }; }
      });
      return best;
    },
    /** The card a tap on a cairn opens, or null. @param {number} x @param {number} z */
    cardAt(x, z) {
      const t = trail();
      if (!t) return null;
      const i = list().findIndex((_, j) => !!t[j] && !hidden.has(j) && Math.hypot(t[j][0] - x, t[j][1] - z) <= R.tapM);
      if (i < 0) return null;
      const k = list()[i], last = i === total() - 1, letter = last && letterWaits(), done = last && run()?.data?.read !== undefined;
      const moss = mossOf(o.hourIndex() - k.hour, L) > 0;
      const text = letter ? W.lineLetter : done ? W.lineRead : k.added > 0 || k.answer ? W.lines[1] : moss ? W.lines[2] : W.lines[0];
      return { sp: 'setpiece:cairn', cairn: i, letter, full: k.added >= R.cairn.addMax, name: last ? W.nameLast : W.name, sub: null, icon: 'cairn',
        text, wx: t[i][0], wz: t[i][1], r: 0.3, reachR: R.reachM, stage: -1, noPage: true, canCarry: false };
    },
    /** Tests and the lab. */
    debug: { plan, addStone, read, list, trail, hidden },
    dispose() { for (const off of offs) off(); },
  };
}
