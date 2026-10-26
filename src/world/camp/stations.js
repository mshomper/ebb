// @ts-check
// The camp's stations, live (docs/future/13 section 3.12; S1, S2, P2j): the workbench, built in its
// slot from flat stones the way the ring is laid; the apothecary bench, built from sticks and rush
// cord, with Dry (a herb onto the drying rack) and Grind (shells to crushed shell in the mortar); and
// the fire, a station once its ring is laid. A click on a station opens its workspace
// (src/ui/station.js): the surface with its part spots, the pouches along the bottom. Clicking a pouch
// lays one handful (the walker sets it down); clicking a laid part takes it back. Nothing is taken
// until the station's action is pressed; walking away, or closing the card, puts every part back.
// Known makes show their missing parts as pencil outlines (making.js). Make draws each handful from
// the pack, then the camp's piles, then the hamper. A make may stand in its own camp slot (the rack,
// the mortar, the hamper) or stack a second hamper on the first. Firsts go to the cook section (the
// camp page, src/ui/journal-camp.js). S4, S5: the hearth stones made at the workbench go into the
// ring's middle; a clay piece shaped there waits pale on its slab (out 'shaped', pots.js) and is laid
// at the fire from the workspace's workbench row (kinds 'shaped:<make>', the 'bench' source), then
// fired on the overnight work list (work.js; hearth.js moves it to its slot once done).
//
// The hamper and the rack (keeps.js) open in the same wide card in its store mode: their slots or
// bunches as drawn icons with their words, each with Take up, and the pouches to set down.
//
// Publishes the store slice `stationView` (what the workspace draws), keeps `cook` (the save's cook
// section). Actions: camp.build { id }, station.lay { kind }, station.unlay { i }, station.act,
// keep.takeUp { i }. Events: camp:placed { slot, kind }, camp:made { make, station, hour, first }.

import { emit, emitDeferred } from '../../core/events.js';
import { get, update, subscribe } from '../../core/store.js';
import { dispatch, onAction } from '../../input/actions.js';
import { hash32 } from '../../core/rng.js';
import { registerCardAction } from '../../ui/card-actions.js';
import { ringLaid, inSlot } from './model.js';
import { cleanCook, layout, drawPlan, available, recordMade, buildKinds, partKinds, givesOf } from './making.js';
import { createKeeps } from './keeps.js';
import { layWork } from './work.js';
import { shapedOn, addShaped, takeShaped, setHearth } from './pots.js';
import { pileWord, rackWord } from '../pack/piles.js';
import { campCardAt } from './cards.js';

/** The keeps that open in the workspace's store mode, and the slot each stands in. */
const KEEPS = /** @type {Record<string, string>} */ ({ store: 'store', rack: 'rack' });

/**
 * @param {import('./cards.js').CampKit & { o: any, cook: any, change: (fn: (c: import('./model.js').Camp) => import('./model.js').Camp) => void,
 *   campSeed: number, frame: { addProps: (f: () => any[]) => void } }} k
 *   cook: recipes/world/cook.json; o.pack, o.piles: the pack and the camp's piles
 */
export function createStations(k) {
  const C = k.cook, W = C.words, R = k.R, S = R.stations;
  const o = k.o, P = o.pack?.recipe ?? {};
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
  const built = (/** @type {string} */ id) => !!inSlot(k.camp(), id);
  /** Room at the fire for another piece overnight (cook.json work.max). */
  const workRoom = () => k.camp().work.length < (C.work?.max ?? 2);
  const keeps = createKeeps({ R, P, camp: k.camp, change: k.change, where: k.where, hourNow: k.hourNow, benchAt, piles: o.piles });

  /** A keep's place: its slot, and where you stand (on the ring's side of it). @param {string} id */
  function keepAt(id) {
    const s = k.where.slotAt(KEEPS[id]), r = k.where.slotAt('ring');
    if (!s) return null;
    const dx = r ? r.x - s.x : 0, dz = r ? r.z - s.z : 1, l = Math.hypot(dx, dz) || 1, out = (s.slot.r ?? (s.slot.d ?? 0.5) / 2) + S.standM;
    return { x: s.x, z: s.z, stand: { x: s.x + (dx / l) * out, z: s.z + (dz / l) * out }, reachM: S.reachM };
  }
  /** A station's place: where its surface is and where you stand. @param {string} id */
  function stationAt(id) {
    if (id === 'fire') {
      const r = k.where.slotAt('ring');
      return r ? { x: r.x, z: r.z, stand: { x: r.x, z: r.z }, reachM: R.reach.ringM } : null;
    }
    if (KEEPS[id]) return keepAt(id);
    const b = benchAt(id);
    return b ? { x: b.x, z: b.z, stand: b.stand, reachM: S.reachM } : null;
  }
  /** What making reads: which slots are built, a kind's pack group. @type {import('./making.js').MakeCtx} */
  const ctx = { filled: built, groupOf: (kind) => o.pack?.kinds?.groupOf?.(kind) ?? null };

  // ---- where handfuls come from: the pack, then the piles, then the hamper ----

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
  /** The clay pieces waiting pale on the workbench (S5), as kinds 'shaped:<kind>' the fire lays. */
  const benchHolds = () => {
    /** @type {Record<string, number>} */ const n = {};
    for (const kind of shapedOn(k.camp())) n[`shaped:${kind}`] = (n[`shaped:${kind}`] ?? 0) + 1;
    return n;
  };
  const sources = () => [{ id: 'pack', holds: packHolds() }, { id: 'piles', holds: pilesHolds() }, { id: 'store', holds: keeps.hamper.holds() }, { id: 'bench', holds: benchHolds() }];
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
      } else if (from === 'store') ok = keeps.hamper.take(kind, 1) > 0 && ok;
      // A pale piece lifted off the workbench to the fire (S5).
      else if (from === 'bench') k.change((c) => takeShaped(c, kind.slice('shaped:'.length)));
    }
    return ok;
  }

  // ---- building a bench in its slot ----

  /** A build's ground card words. @param {string} id */
  const slotWords = (id) => W[`${id}Slot`] ?? W.workbenchSlot;

  /** The builds whose slot is empty now, with whether their parts are to hand. */
  function buildable() {
    const c = k.camp();
    return Object.entries(C.builds ?? {}).filter(([id, b]) => !inSlot(c, /** @type {any} */ (b).slot) && (!(/** @type {any} */ (b).afterRing) || ringLaid(c)) && benchAt(/** @type {any} */ (b).slot))
      .map(([id, b]) => ({ id, b: /** @type {any} */ (b), ready: !!drawPlan(buildKinds(b), sources()) }));
  }

  /** A new slot record for a thing made or built, seeded by its id. @param {string} slot @param {string} kind @param {number} hour */
  const slotRecord = (slot, kind, hour) => ({ slot, kind, seed: hash32(k.campSeed, 3 + [...Object.keys(C.builds), ...Object.keys(C.makes)].indexOf(kind)) >>> 0, placedHour: hour,
    ...(kind === 'hamper' ? { stack: 1, holds: [] } : kind === 'rack' ? { bunches: [] } : {}) });

  /** A build in its slot at once, taking nothing (the test link ?camp=bench). @param {string} id */
  function buildNow(id) {
    const b = C.builds?.[id];
    if (!b || inSlot(k.camp(), b.slot)) return;
    const hour = k.hourNow();
    k.change((c) => ({ ...c, slots: [...c.slots, slotRecord(b.slot, id, hour)] }));
    changeCook((s) => recordMade(s, id, hour));
  }

  /**
   * A make that stands in a camp slot, at once, taking nothing (the test links): the rack, the
   * mortar, the hamper, the second hamper. @param {string} id
   */
  function placeNow(id) {
    const m = C.makes?.[id];
    if (!m || (m.out !== 'slot' && m.out !== 'stack')) return;
    const hour = k.hourNow();
    if (m.out === 'stack') {
      if (!built(m.slot)) return;
      k.change((c) => ({ ...c, slots: c.slots.map((s) => (s.slot === m.slot ? { ...s, stack: 2 } : s)) }));
    } else {
      if (built(m.slot)) return;
      k.change((c) => ({ ...c, slots: [...c.slots, slotRecord(m.slot, id, hour)] }));
    }
    changeCook((s) => recordMade(s, id, hour));
    emitDeferred('camp:placed', { slot: m.slot, kind: id });
    // Once a hamper stands, the loose heaps retire into it.
    if (m.slot === 'store') keeps.retireHeaps();
  }

  function build(/** @type {string} */ id) {
    const b = C.builds?.[id], at = b && benchAt(b.slot);
    if (!b || !at || inSlot(k.camp(), b.slot)) return;
    if (!drawPlan(buildKinds(b), sources())) { emit('island:notice', { text: slotWords(id).needs, showS: 6 }); return; }
    k.player.play(b.act ?? 'lay', at.stand, S.reachM, at, () => {
      const plan = drawPlan(buildKinds(b), sources());
      if (!plan || inSlot(k.camp(), b.slot)) return;
      takePlan(plan);
      const hour = k.hourNow();
      buildNow(id);
      emitDeferred('camp:placed', { slot: b.slot, kind: id });
      emitDeferred('camp:made', { make: id, station: null, hour, first: true });
      emit('island:notice', { text: W.builtLines?.[id] ?? W.built, showS: 6 });
      if (get('identify')?.slotId === b.slot) dispatch({ type: 'ui.identify' });
    });
  }

  // ---- the workspace ----

  /** The station open now and what is laid on it (live only). @type {{ id: string, laid: string[], nothingT: number, line: string | null } | null} */
  let open = null;
  let makeT = -1, retireT = 0;
  const nameOf = (/** @type {string} */ kind) => (kind.startsWith('shaped:') ? W.shapedNames?.[kind.slice(7)] ?? kind.slice(7) : o.pack?.nameOf?.(kind) ?? kind);
  /** Room on the workbench for another shaped piece to wait (cook.json shaped.max). */
  const benchRoom = () => shapedOn(k.camp()).length < (C.shaped?.max ?? 4);
  /** How long a make takes now: a tea's steady hands make it quicker (P2e, boonLift.make). */
  const makeS = () => C.makeS * (get('boonLift')?.make ?? 1);

  /** The action a station shows: its make's own (Dry, Grind), else the station's. @param {string} id @param {string | null} make */
  function actionOf(id, make) {
    const act = make ? C.makes[make]?.act : null;
    if (act) return { icon: act, label: W.acts?.[act] ?? act };
    return { icon: S[id]?.action ?? 'make', label: id === 'fire' ? W.fireAct : id === 'apothecary' ? W.acts?.[S.apothecary.action] ?? W.make : W.make };
  }

  /** The hamper's or the rack's card in the workspace (store mode). @param {string} id */
  function keepView(id) {
    const pack = /** @type {[string, number][]} */ (get('pack')?.pouches ?? []).map(([kind, h]) => ({ kind, name: nameOf(kind), handfuls: h, left: h }));
    const words = P.words ?? {};
    let slots, size;
    if (id === 'store') {
      const r = inSlot(k.camp(), 'store');
      size = keeps.hamper.slots();
      slots = (r?.holds ?? []).map(([kind, h], i) => ({ i, kind, name: nameOf(kind), word: pileWord(h, P) }));
    } else {
      size = Math.min(R.rack.hangs.length, P.piles?.rackBunches ?? R.rack.hangs.length);
      slots = keeps.rack.bunches().map((b, i) => ({ i, kind: b.kind, name: nameOf(b.kind), word: rackWord(b.dry, words.rack ?? {}), dried: b.dry >= 1 }));
    }
    return { id, mode: 'store', name: W[id]?.name ?? id, size, slots, emptyName: W.emptySlot, takeLabel: W.takeUp, pack, packName: W.pack,
      line: open?.line ?? W.setDownHere, at: stationAt(id) };
  }

  /** What the workspace draws now (the store slice `stationView`), or null. */
  function view() {
    if (!open) return null;
    const id = open.id;
    if (KEEPS[id]) return keepView(id);
    const spots = S[id]?.spots ?? 2, cook = cookNow();
    const L = layout(C, id, open.laid, cook, ctx);
    const avail = available(sources(), open.laid);
    const packKinds = /** @type {[string, number][]} */ (get('pack')?.pouches ?? []).map(([kind, h]) => ({ kind, name: nameOf(kind), handfuls: h, left: avail[kind] ?? 0 }));
    const row = (/** @type {Record<string, number>} */ holds) => Object.entries(holds).map(([kind, h]) => ({ kind, name: nameOf(kind), handfuls: h,
      left: Math.min(h, avail[kind] ?? 0), word: o.piles?.describe?.({ holds: kind, handfuls: h })?.text ?? '' }));
    const store = Object.entries(keeps.hamper.holds()).map(([kind, h]) => ({ kind, name: nameOf(kind), handfuls: h,
      left: Math.min(h, avail[kind] ?? 0), word: pileWord(h, P) }));
    // At the fire, the pale pieces waiting on the workbench, to lay at the star's edge (S5).
    // At the workbench, the same pieces, each carried to the fire and laid there with a press.
    const bench = id === 'fire' ? Object.entries(benchHolds()).map(([kind, h]) => ({ kind, name: nameOf(kind), handfuls: h, left: Math.min(h, avail[kind] ?? 0), word: '' }))
      : id === 'workbench' ? Object.entries(benchHolds()).map(([kind, h]) => ({ kind, name: nameOf(kind), handfuls: h, left: h, word: '' })) : [];
    return {
      id, name: id === 'fire' ? W.fire.name : W[id]?.name ?? id, spots,
      laid: open.laid.map((kind, i) => ({ kind, name: nameOf(kind), used: L.have[i] >= 0 })),
      outlines: open.laid.length < spots ? L.missing.slice(0, spots - open.laid.length) : [],
      action: { ...actionOf(id, L.make), ready: L.complete && makeT < 0, make: L.make },
      line: open.line ?? (makeT >= 0 ? null : W.laid), working: makeT >= 0,
      pack: packKinds, piles: row(pilesHolds()), store, bench, packName: W.pack, pilesName: W.piles, storeName: W.hamper, at: stationAt(id),
      benchName: id === 'workbench' ? W.benchWaiting : W.onBench, benchToFire: id === 'workbench', benchLine: id === 'workbench' && bench.length ? W.benchToFire : null,
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

  function lay(/** @type {string} */ kind, quiet = false) {
    if (!open || makeT >= 0 || KEEPS[open.id]) return;
    const spots = S[open.id]?.spots ?? 2;
    if (open.laid.length >= spots) { open.line = W.spotsFull; publish(); return; }
    if ((available(sources(), open.laid)[kind] ?? 0) <= 0) return;
    open.laid = [...open.laid, kind];
    open.line = null;
    const at = stationAt(open.id);
    if (!quiet) o.walk.gesture('setDown', at ?? undefined);
    // Parts that make nothing together say so, then go back.
    if (!layout(C, open.id, open.laid, cookNow(), ctx).make) { open.line = W.nothing; open.nothingT = C.nothingHoldS; }
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
    const L = layout(C, open.id, open.laid, cookNow(), ctx);
    if (!L.complete || !L.make) return;
    if (!drawPlan(open.laid, sources())) { open.line = W.none; publish(); return; }
    // A herb for the rack needs a place on it; a piece for the night's fire, room at the fire (P2i).
    if (C.makes[L.make].out === 'rack' && !keeps.rack.room(open.laid[0])) { open.line = W.rackFull; publish(); return; }
    if (C.makes[L.make].out === 'work' && !workRoom()) { open.line = W.workFull; publish(); return; }
    // A shaped piece needs room on the workbench to wait for the fire (S5).
    if (C.makes[L.make].out === 'shaped' && !benchRoom()) { open.line = W.benchFull; publish(); return; }
    const at = stationAt(open.id);
    if (at) o.walk.kneelToward(at.x, at.z, makeS(), 'make');
    makeT = 0;
    publish();
  }
  /** The make ends: the handfuls are taken, the thing is made, its first is written. */
  function made() {
    makeT = -1;
    if (!open) return;
    const L = layout(C, open.id, open.laid, cookNow(), ctx);
    const plan = L.complete && L.make ? drawPlan(open.laid, sources()) : null;
    if (!plan || !L.make) { publish(); return; }
    const id = L.make, m = C.makes[id], hour = k.hourNow(), laid = open.laid;
    if (m.out === 'rack' && !keeps.rack.room(laid[0])) { open.line = W.rackFull; publish(); return; }
    if (m.out === 'work' && !workRoom()) { open.line = W.workFull; publish(); return; }
    if (m.out === 'shaped' && !benchRoom()) { open.line = W.benchFull; publish(); return; }
    takePlan(plan);
    const first = cookNow().made[id] === undefined;
    // A make that stands in a camp slot (the rack, the mortar, the hamper) or stacks on one.
    if (m.out === 'slot' || m.out === 'stack') placeNow(id);
    else changeCook((s) => recordMade(s, id, hour, m.out === 'tool'));
    // The hearth stones set in the ring's middle, the first pot on them (S4); a clay piece shaped,
    // waiting pale on the workbench for the fire (S5).
    if (m.out === 'hearth') { k.change((c) => setHearth(c, hour, hash32(k.campSeed, 40) >>> 0, R.hearth)); emitDeferred('camp:placed', { slot: 'hearth', kind: id }); }
    if (m.out === 'shaped') k.change((c) => addShaped(c, id));
    // A make that fills a pouch (rush cord, crushed shell): into the pack, or a small heap at your feet when full.
    if (m.out === 'pouch') {
      const kind = givesOf(m, id, laid), n = m.count ?? 1;
      if (o.pack?.room(kind)) o.pack.add(kind, n);
      else o.pack?.heapHere?.(kind, n);
    }
    // Dry: the herb hangs on the rack as a bunch.
    if (m.out === 'rack') keeps.rack.hang(laid[0], 1);
    // A carrier (P2f): put on at once; the one taken off hangs by the bench (carriers.js).
    if (m.out === 'carrier') o.pack?.addCarrier?.(id);
    // A piece for the night's fire goes on the overnight work list (work.js): willow charcoal.
    if (m.out === 'work') k.change((c) => ({ ...c, work: layWork(c.work, { id, needH: m.needH ?? 8, gives: m.gives ?? id, count: m.count ?? 1 }, hour) }));
    emitDeferred('camp:made', { make: id, station: open.id, hour, first });
    if (!open) return;
    open.laid = [];
    open.line = W.made?.[id] ?? null;
    publish();
  }

  /**
   * A pale piece waiting on the workbench carried to the fire (S5): taken up from the bench, walked
   * to the ring and laid there, the fire's workspace open on it so Fire is one press away. From the
   * workbench's workspace or the piece's own card, so a piece is never left stranded on the bench.
   * @param {string} kind 'shaped:<kind>' or the kind alone
   */
  function toFire(kind) {
    const key = kind.startsWith('shaped:') ? kind : `shaped:${kind}`, at = stationAt('fire'), from = stationAt('workbench');
    if (!at || !ringLaid(k.camp()) || !((benchHolds()[key] ?? 0) > 0)) return;
    if (get('identify')) update('identify', () => null);
    if (from) o.walk.gesture('takeUp', from);
    k.player.play('lay', at.stand, at.reachM, at, () => {
      const card = campCardAt(k, at.x, at.z);
      if (!card) return;
      update('identify', () => ({ ...card, at: performance.now() }));
      if (open?.id === 'fire') lay(key, true);
    });
  }

  /** Take up on a hamper slot or a rack bunch: one pouch's worth into the pack. @param {number} i */
  function keepTakeUp(i) {
    if (!open || !KEEPS[open.id] || !o.pack) return;
    const add = (/** @type {string} */ kind, /** @type {number} */ n) => o.pack.add(kind, n);
    const r = open.id === 'store' ? keeps.hamper.takeUp(i, add) : keeps.rack.takeUp(i, add);
    if (r.taken) o.walk.gesture('takeUp', stationAt(open.id) ?? undefined);
    open.line = r.full ? P.words?.full ?? null : null;
    publish();
  }

  // A station's card opens its workspace; any other card (or none) closes it, and the parts go back.
  const offs = [
    subscribe('identify', (/** @type {any} */ c) => {
      const id = c?.station ?? null;
      // The tea pot's workspace is its own (teapot.js, P2e).
      if (!id || id === 'teapot') { if (open) close(); return; }
      if (open?.id !== id) { open = { id, laid: [], nothingT: 0, line: null }; makeT = -1; }
      publish();
    }),
    subscribe('pack', () => { if (open) publish(); }),
    subscribe('pieces', () => { if (open) publish(); }),
    subscribe('camp', () => { if (open) publish(); }),
    onAction((/** @type {any} */ a) => {
      if (a.type === 'camp.build') build(a.id);
      else if (a.type === 'station.lay') lay(a.kind);
      else if (a.type === 'station.unlay') unlay(a.i);
      else if (a.type === 'station.act') act();
      else if (a.type === 'keep.takeUp') keepTakeUp(a.i);
      else if (a.type === 'shaped.toFire') toFire(a.kind);
    }),
    registerCardAction({ id: 'shapedtofire', icon: 'fire', order: 4, main: true, label: W.toFire ?? 'Lay it at the fire',
      when: (c) => c?.camp === 'shaped' && !!c.canFire, action: (c) => ({ type: 'shaped.toFire', kind: c.kind }) }),
    registerCardAction({ id: 'campbuild', icon: 'build', order: 5, main: true, label: (c) => slotWords(c?.build ?? '').build ?? W.build,
      when: (c) => c?.camp === 'benchSlot' && !!c.canBuild, action: (c) => ({ type: 'camp.build', id: c.build }) }),
  ];

  // The benches, drawn in their slots once built, and the keeps (the rack and its bunches, the
  // mortar and pestle, the hamper).
  k.frame.addProps(() => {
    const out = [];
    for (const id of Object.keys(C.builds ?? {})) {
      const b = C.builds[id], at = benchAt(b.slot);
      if (at && built(b.slot)) out.push({ key: id, x: at.x, y: at.y, z: at.z, yaw: at.yaw, shade: R.props.models[id]?.shade });
    }
    return [...out, ...keeps.props()];
  });

  /** A ground point in a keep's footprint? @param {string} id @param {number} x @param {number} z */
  function onKeep(id, x, z) {
    const s = k.where.slotAt(KEEPS[id]);
    if (!s || !built(KEEPS[id])) return false;
    if (s.slot.w) {
      // The rack lies along its slot: a box, turned by its yaw.
      const yaw = s.yaw + (R.rack.yawDeg * Math.PI) / 180, c = Math.cos(yaw), sn = Math.sin(yaw), dx = x - s.x, dz = z - s.z;
      return Math.abs(dx * c - dz * sn) <= s.slot.w / 2 + 0.15 && Math.abs(dx * sn + dz * c) <= (s.slot.d ?? 0.5) / 2 + 0.15;
    }
    return Math.hypot(x - s.x, z - s.z) <= (s.slot.r ?? 0.3) + 0.15;
  }

  return {
    /**
     * The card at a ground point: a bench's ground (Build), a built bench (its workspace), or the
     * hamper or rack (their workspace's store mode). The ring's card is the fire station (cards.js
     * adds `station: 'fire'`). @param {number} x @param {number} z
     */
    cardAt(x, z) {
      const base = { noPage: true, stage: -1, sub: null, canCarry: false };
      for (const id of Object.keys(KEEPS)) {
        if (!onKeep(id, x, z)) continue;
        const at = /** @type {any} */ (keepAt(id));
        return { ...base, sp: `camp:${id}`, camp: 'station', station: id, name: W[id]?.name ?? id, icon: id === 'rack' ? 'dry' : 'takeup', text: W[id]?.line ?? '', wx: at.stand.x, wz: at.stand.z, r: 0.3 };
      }
      for (const [id, b] of Object.entries(C.builds ?? {})) {
        const at = benchAt(/** @type {any} */ (b).slot);
        if (!at) continue;
        const dx = x - at.x, dz = z - at.z, c = Math.cos(at.yaw), s = Math.sin(at.yaw);
        // In the bench's own frame: x across it, z toward where you work.
        const bx = dx * c - dz * s, bz = dx * s + dz * c;
        if (Math.abs(bx) > (at.slot.w ?? 1) / 2 + 0.15 || Math.abs(bz) > (at.slot.d ?? 0.6) / 2 + 0.15) continue;
        if (built(/** @type {any} */ (b).slot)) {
          return { ...base, sp: `camp:${id}`, camp: 'station', station: id, name: W[id]?.name ?? id, icon: S[id]?.action ?? 'make', text: W[id]?.line ?? '', wx: at.stand.x, wz: at.stand.z, r: 0.3 };
        }
        const pb = /** @type {any} */ (b), c0 = k.camp();
        if (pb.afterRing && !ringLaid(c0)) continue;
        const ready = !!drawPlan(buildKinds(pb), sources()), w = slotWords(id);
        return { ...base, sp: `camp:${id}-slot`, camp: 'benchSlot', slotId: pb.slot, build: id, name: w.name, icon: 'build',
          text: ready ? w.line : w.needs, wx: at.stand.x, wz: at.stand.z, r: 0.3, canBuild: ready };
      }
      return null;
    },
    /** Bench slots that glow (CS-05): their parts to hand and you near camp, after the first evening. @param {number} kGlow opacity now */
    rings(kGlow) {
      return buildable().filter((q) => q.ready).map((q) => { const at = /** @type {any} */ (benchAt(q.b.slot)); return [at.x, at.z, 0.75, kGlow]; });
    },
    /** Each frame: the make's pose, the calm line's hold, and walking away puts the parts back. @param {number} dt */
    update(dt) {
      // A camp with a hamper and heaps still lying out (a save loaded, a test link): they move in.
      if ((retireT -= dt) <= 0) { retireT = 1; if (keeps.hamper.here()) keeps.retireHeaps(); }
      if (!open) return;
      if (makeT >= 0 && (makeT += dt) >= makeS()) made();
      if (open && open.nothingT > 0 && (open.nothingT -= dt) <= 0) { open.laid = []; open.nothingT = 0; open.line = W.nothing; publish(); }
      const at = open ? stationAt(open.id) : null;
      if (open && at && o.walk.distTo(at.stand.x, at.stand.z) > at.reachM + S.awayM && makeT < 0 && !k.player.busy()) dispatch({ type: 'ui.identify' });
    },
    /** What the workspace shows now (tests). */
    view,
    benchAt,
    /** The hamper and the rack (the pack's set-down routing, tests). */
    keeps,
    /** Tests and the test links. */
    debug: { build, buildNow, placeNow, lay, unlay, act, made, keepTakeUp, open: () => open },
    dispose() { for (const off of offs) off(); },
  };
}

/** The kinds that serve a part, for the pencil outlines (re-exported for the workspace). */
export { partKinds };
