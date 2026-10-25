// @ts-check
// The camp's stations, live (docs/future/13 section 3.12; S1): the workbench, built in its slot from
// flat stones the way the ring is laid, and the fire, a station once its ring is laid. A click on a
// station opens its workspace (src/ui/station.js): the surface with its part spots, the pouches along
// the bottom. Clicking a pouch lays one handful (the walker sets it down); clicking a laid part takes
// it back. Nothing is taken until the station's action is pressed; walking away, or closing the
// card, puts every part back. Known makes show their missing parts as pencil outlines (making.js).
// Make draws each handful from the pack, then the camp's piles, then the store (P2j: o.store, a
// hook for now). Firsts go to the cook section (the camp page, src/ui/journal-camp.js).
//
// Publishes the store slice `stationView` (what the workspace draws), keeps `cook` (the save's cook
// section). Actions: camp.build { id }, station.lay { kind }, station.unlay { i }, station.act.
// Events: camp:placed { slot, kind }, camp:made { make, station, hour, first }.

import { emit, emitDeferred } from '../../core/events.js';
import { get, update, subscribe } from '../../core/store.js';
import { dispatch, onAction } from '../../input/actions.js';
import { hash32 } from '../../core/rng.js';
import { registerCardAction } from '../../ui/card-actions.js';
import { ringLaid, inSlot } from './model.js';
import { cleanCook, layout, drawPlan, available, recordMade, buildKinds, partKinds } from './making.js';

/**
 * @param {import('./cards.js').CampKit & { o: any, cook: any, change: (fn: (c: import('./model.js').Camp) => import('./model.js').Camp) => void,
 *   campSeed: number, frame: { addProps: (f: () => any[]) => void }, store?: { holds: () => Record<string, number>, take: (kind: string, n: number) => number } | null }} k
 *   cook: recipes/world/cook.json; store: the camp store's draw (P2j), none yet
 */
export function createStations(k) {
  const C = k.cook, W = C.words, R = k.R, S = R.stations;
  const o = k.o;
  const cookNow = () => cleanCook(get('cook'));
  /** @param {(c: import('./making.js').Cook) => import('./making.js').Cook} fn */
  const changeCook = (fn) => update('cook', (c) => fn(cleanCook(c)));
  update('cook', (c) => cleanCook(c));

  /**
   * A bench slot in the world: its centre, the yaw that turns the model's +z toward where you work
   * (away from the slot it faces), and where you stand to work it. @param {string} id
   */
  function benchAt(id) {
    const s = k.where.slotAt(id), pad = k.where.padNow();
    if (!s || !pad) return null;
    const f = s.slot.faces ? k.where.slotAt(s.slot.faces) : null;
    let dx = pad.fx, dz = pad.fz;
    if (f) { const l = Math.hypot(s.x - f.x, s.z - f.z) || 1; dx = (s.x - f.x) / l; dz = (s.z - f.z) / l; }
    const out = (s.slot.d ?? 0.6) / 2 + S.standM;
    return { x: s.x, z: s.z, y: s.y, yaw: Math.atan2(dx, dz), slot: s.slot, stand: { x: s.x + dx * out, z: s.z + dz * out } };
  }
  /** A station's place: where its surface is and where you stand. @param {string} id */
  function stationAt(id) {
    if (id === 'fire') {
      const r = k.where.slotAt('ring');
      return r ? { x: r.x, z: r.z, stand: { x: r.x, z: r.z }, reachM: R.reach.ringM } : null;
    }
    const b = benchAt(id);
    return b ? { x: b.x, z: b.z, stand: b.stand, reachM: S.reachM } : null;
  }
  const built = (/** @type {string} */ id) => !!inSlot(k.camp(), id);

  // ---- where handfuls come from: the pack, then the piles, then the store ----

  const packHolds = () => {
    /** @type {Record<string, number>} */ const n = {};
    for (const [kind, h] of /** @type {[string, number][]} */ (get('pack')?.pouches ?? [])) n[kind] = (n[kind] ?? 0) + h;
    return n;
  };
  const pilesHolds = () => {
    /** @type {Record<string, number>} */ const n = {};
    for (const p of o.piles?.piles?.() ?? []) if (p.handfuls > 0) n[p.holds] = (n[p.holds] ?? 0) + p.handfuls;
    return n;
  };
  const sources = () => [{ id: 'pack', holds: packHolds() }, { id: 'piles', holds: pilesHolds() }, ...(k.store ? [{ id: 'store', holds: k.store.holds() }] : [])];
  /**
   * Take the handfuls a plan names from where it says. @param {{ kind: string, from: string }[]} plan
   * @returns {boolean} all came
   */
  function takePlan(plan) {
    let ok = true;
    for (const { kind, from } of plan) {
      if (from === 'pack') ok = (o.pack?.take(kind, 1) ?? 0) > 0 && ok;
      else if (from === 'piles') {
        const pile = (o.piles?.piles?.() ?? []).find((/** @type {any} */ p) => p.holds === kind && p.handfuls > 0);
        ok = !!pile && o.piles.takeUp(pile.id, () => ({ added: 1 })).taken > 0 && ok;
      } else if (from === 'store') ok = (k.store?.take(kind, 1) ?? 0) > 0 && ok;
    }
    return ok;
  }

  // ---- building a bench in its slot ----

  /** The builds whose slot is empty now, with whether their parts are to hand. */
  function buildable() {
    const c = k.camp();
    return Object.entries(C.builds ?? {}).filter(([id, b]) => !inSlot(c, /** @type {any} */ (b).slot) && (!(/** @type {any} */ (b).afterRing) || ringLaid(c)) && benchAt(/** @type {any} */ (b).slot))
      .map(([id, b]) => ({ id, b: /** @type {any} */ (b), ready: !!drawPlan(buildKinds(b), sources()) }));
  }

  /** A build in its slot at once, taking nothing (the test link ?camp=bench). @param {string} id */
  function buildNow(id) {
    const b = C.builds?.[id];
    if (!b || inSlot(k.camp(), b.slot)) return;
    const hour = k.hourNow();
    k.change((c) => ({ ...c, slots: [...c.slots, { slot: b.slot, kind: id, seed: hash32(k.campSeed, 3 + Object.keys(C.builds).indexOf(id)) >>> 0, placedHour: hour }] }));
    changeCook((s) => recordMade(s, id, hour));
  }

  function build(/** @type {string} */ id) {
    const b = C.builds?.[id], at = b && benchAt(b.slot);
    if (!b || !at || inSlot(k.camp(), b.slot)) return;
    if (!drawPlan(buildKinds(b), sources())) { emit('island:notice', { text: W.workbenchSlot.needs, showS: 6 }); return; }
    k.player.play(b.act ?? 'lay', at.stand, S.reachM, at, () => {
      const plan = drawPlan(buildKinds(b), sources());
      if (!plan || inSlot(k.camp(), b.slot)) return;
      takePlan(plan);
      const hour = k.hourNow();
      buildNow(id);
      emitDeferred('camp:placed', { slot: b.slot, kind: id });
      emitDeferred('camp:made', { make: id, station: null, hour, first: true });
      emit('island:notice', { text: W.built, showS: 6 });
      if (get('identify')?.slotId === b.slot) dispatch({ type: 'ui.identify' });
    });
  }

  // ---- the workspace ----

  /** The station open now and what is laid on it (live only). @type {{ id: string, laid: string[], nothingT: number, line: string | null } | null} */
  let open = null;
  let makeT = -1;

  /** What the workspace draws now (the store slice `stationView`), or null. */
  function view() {
    if (!open) return null;
    const id = open.id, spots = S[id]?.spots ?? 2, cook = cookNow();
    const L = layout(C, id, open.laid, cook);
    const avail = available(sources(), open.laid);
    const nameOf = (/** @type {string} */ kind) => o.pack?.nameOf?.(kind) ?? kind;
    const packKinds = /** @type {[string, number][]} */ (get('pack')?.pouches ?? []).map(([kind, h]) => ({ kind, name: nameOf(kind), handfuls: h, left: avail[kind] ?? 0 }));
    const piles = Object.entries(pilesHolds()).map(([kind, h]) => ({ kind, name: nameOf(kind), handfuls: h, left: Math.min(h, avail[kind] ?? 0), word: o.piles?.describe?.({ holds: kind, handfuls: h })?.text ?? '' }));
    return {
      id, name: id === 'fire' ? W.fire.name : W[id]?.name ?? id, spots,
      laid: open.laid.map((kind, i) => ({ kind, name: nameOf(kind), used: L.have[i] >= 0 })),
      outlines: open.laid.length < spots ? L.missing.slice(0, spots - open.laid.length) : [],
      action: { icon: S[id]?.action ?? 'make', label: id === 'fire' ? W.fireAct : W.make, ready: L.complete && makeT < 0, make: L.make },
      line: open.line ?? (makeT >= 0 ? null : W.laid), working: makeT >= 0,
      pack: packKinds, piles, packName: W.pack, pilesName: W.piles, at: stationAt(id),
    };
  }
  let viewKey = '';
  function publish() {
    const v = view(), key = JSON.stringify(v);
    if (key === viewKey) return;
    viewKey = key;
    update('stationView', () => v);
  }
  function close() {
    open = null;
    makeT = -1;
    publish();
  }

  function lay(/** @type {string} */ kind) {
    if (!open || makeT >= 0) return;
    const spots = S[open.id]?.spots ?? 2;
    if (open.laid.length >= spots) { open.line = W.spotsFull; publish(); return; }
    if ((available(sources(), open.laid)[kind] ?? 0) <= 0) return;
    open.laid = [...open.laid, kind];
    open.line = null;
    const at = stationAt(open.id);
    o.walk.gesture('setDown', at ?? undefined);
    // Parts that make nothing together say so, then go back.
    if (!layout(C, open.id, open.laid, cookNow()).make) { open.line = W.nothing; open.nothingT = C.nothingHoldS; }
    publish();
  }
  function unlay(/** @type {number} */ i) {
    if (!open || makeT >= 0 || !open.laid[i]) return;
    open.laid = open.laid.filter((_, j) => j !== i);
    open.line = null;
    o.walk.gesture('takeUp', stationAt(open.id) ?? undefined);
    publish();
  }
  function act() {
    if (!open || makeT >= 0) return;
    const L = layout(C, open.id, open.laid, cookNow());
    if (!L.complete || !L.make) return;
    if (!drawPlan(open.laid, sources())) { open.line = W.none; publish(); return; }
    const at = stationAt(open.id);
    if (at) o.walk.kneelToward(at.x, at.z, C.makeS, 'make');
    makeT = 0;
    publish();
  }
  /** The make ends: the handfuls are taken, the thing is made, its first is written. */
  function made() {
    makeT = -1;
    if (!open) return;
    const L = layout(C, open.id, open.laid, cookNow());
    const plan = L.complete && L.make ? drawPlan(open.laid, sources()) : null;
    if (!plan || !L.make) { publish(); return; }
    takePlan(plan);
    const id = L.make, m = C.makes[id], hour = k.hourNow();
    const first = cookNow().made[id] === undefined;
    changeCook((s) => recordMade(s, id, hour, m.out === 'tool'));
    emitDeferred('camp:made', { make: id, station: open.id, hour, first });
    open.laid = [];
    open.line = W.made?.[id] ?? null;
    publish();
  }

  // A station's card opens its workspace; any other card (or none) closes it, and the parts go back.
  const offs = [
    subscribe('identify', (/** @type {any} */ c) => {
      const id = c?.station ?? null;
      if (!id) { if (open) close(); return; }
      if (open?.id !== id) { open = { id, laid: [], nothingT: 0, line: null }; makeT = -1; }
      publish();
    }),
    subscribe('pack', () => { if (open) publish(); }),
    subscribe('pieces', () => { if (open) publish(); }),
    onAction((/** @type {any} */ a) => {
      if (a.type === 'camp.build') build(a.id);
      else if (a.type === 'station.lay') lay(a.kind);
      else if (a.type === 'station.unlay') unlay(a.i);
      else if (a.type === 'station.act') act();
    }),
    registerCardAction({ id: 'campbuild', icon: 'build', order: 5, main: true, label: W.build,
      when: (c) => c?.camp === 'benchSlot' && !!c.canBuild, action: (c) => ({ type: 'camp.build', id: c.build }) }),
  ];

  // The workbench, drawn in its slot once built.
  k.frame.addProps(() => {
    const out = [];
    for (const id of Object.keys(C.builds ?? {})) {
      const b = C.builds[id], at = benchAt(b.slot);
      if (at && built(b.slot)) out.push({ key: id, x: at.x, y: at.y, z: at.z, yaw: at.yaw, shade: R.props.models[id]?.shade });
    }
    return out;
  });

  return {
    /**
     * The card at a ground point: a bench's ground (Build) or a built bench (its workspace). The
     * ring's card is the fire station (cards.js adds `station: 'fire'`). @param {number} x @param {number} z
     */
    cardAt(x, z) {
      const base = { noPage: true, stage: -1, sub: null, canCarry: false };
      for (const [id, b] of Object.entries(C.builds ?? {})) {
        const at = benchAt(/** @type {any} */ (b).slot);
        if (!at) continue;
        const dx = x - at.x, dz = z - at.z, c = Math.cos(at.yaw), s = Math.sin(at.yaw);
        // In the bench's own frame: x across it, z toward where you work.
        const bx = dx * c - dz * s, bz = dx * s + dz * c;
        if (Math.abs(bx) > (at.slot.w ?? 1) / 2 + 0.15 || Math.abs(bz) > (at.slot.d ?? 0.6) / 2 + 0.15) continue;
        if (built(/** @type {any} */ (b).slot)) {
          return { ...base, sp: `camp:${id}`, camp: 'station', station: id, name: W[id]?.name ?? id, icon: 'make', text: W[id]?.line ?? '', wx: at.stand.x, wz: at.stand.z, r: 0.3 };
        }
        const pb = /** @type {any} */ (b), c0 = k.camp();
        if (pb.afterRing && !ringLaid(c0)) continue;
        const ready = !!drawPlan(buildKinds(pb), sources());
        return { ...base, sp: `camp:${id}-slot`, camp: 'benchSlot', slotId: pb.slot, build: id, name: W.workbenchSlot.name, icon: 'build',
          text: ready ? W.workbenchSlot.line : W.workbenchSlot.needs, wx: at.stand.x, wz: at.stand.z, r: 0.3, canBuild: ready };
      }
      return null;
    },
    /** Bench slots that glow (CS-05): their parts to hand and you near camp, after the first evening. @param {number} kGlow opacity now */
    rings(kGlow) {
      return buildable().filter((q) => q.ready).map((q) => { const at = /** @type {any} */ (benchAt(q.b.slot)); return [at.x, at.z, 0.75, kGlow]; });
    },
    /** Each frame: the make's pose, the calm line's hold, and walking away puts the parts back. @param {number} dt */
    update(dt) {
      if (!open) return;
      if (makeT >= 0 && (makeT += dt) >= C.makeS) made();
      if (open && open.nothingT > 0 && (open.nothingT -= dt) <= 0) { open.laid = []; open.nothingT = 0; open.line = W.nothing; publish(); }
      const at = open ? stationAt(open.id) : null;
      if (open && at && o.walk.distTo(at.stand.x, at.stand.z) > at.reachM + S.awayM && makeT < 0 && !k.player.busy()) dispatch({ type: 'ui.identify' });
    },
    /** What the workspace shows now (tests). */
    view,
    benchAt,
    /** Tests and the test links. */
    debug: { build, buildNow, lay, unlay, act, made, open: () => open },
    dispose() { for (const off of offs) off(); },
  };
}

/** The kinds that serve a part, for the pencil outlines (re-exported for the workspace). */
export { partKinds };
