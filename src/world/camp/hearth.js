// @ts-check
// The hearth and the clay pieces, live (docs/future/13 sections 3.12 and 4.1 K-26; S4, S5): draws
// the hearth stones in the ring's middle and the pot on them, the other pots and the cup waiting in
// their slots at the ring's side, the dye pot's stand, the shaped pieces waiting pale on the
// workbench, the pieces firing at the star's edge (pale at first, taking the fired clay's colour as
// their hours of fire add up), and the pot in your arms. Rules: pots.js (pure); firing: work.js.

import { emit, emitDeferred } from '../../core/events.js';
import { get, update } from '../../core/store.js';
import { onAction } from '../../input/actions.js';
import { registerCardAction } from '../../ui/card-actions.js';
import { inSlot } from './model.js';
import { potOnHearth, pieceOf, shapedOn, setHearth, placeFired, addShaped, swapOn } from './pots.js';
import { fired, layWork, workDone } from './work.js';
import { workSpot } from './star.js';
import { hash32 } from '../../core/rng.js';

/** The model each piece wears (camp.json props.models): its kind's own. @param {string} kind */
const modelOf = (kind) => kind;

/**
 * @param {import('./cards.js').CampKit & { o: any, cook: any, benchAt: (id: string) => any, holdingPot: () => boolean,
 *   change: (fn: (c: import('./model.js').Camp) => import('./model.js').Camp) => void, campSeed: number }} k
 *   cook: recipes/world/cook.json; benchAt: the stations' bench pose; holdingPot: the pot is in your arms
 */
export function createHearth(k) {
  const R = k.R, H = R.hearth, F = R.fire;
  /** A seeded turn for a piece, so each sits its own way. @param {number} seed */
  const turnOf = (seed) => (((seed >>> 8) % 1000) / 1000) * 2 * Math.PI;

  /** The fire make that fires a shaped kind (cook.json makes, out 'work', fires: kind). @param {string} make */
  const firesOf = (make) => k.cook.makes?.[make]?.fires ?? null;

  /** Everything the hearth draws now. @returns {import('../../render/passes/props.js').Prop[]} */
  function props() {
    const c = k.camp(), M = R.props.models, out = [];
    const r = k.where.slotAt('ring');
    const hearth = inSlot(c, 'hearth'), onIt = potOnHearth(c), held = k.holdingPot();
    if (r && hearth) {
      out.push({ key: 'hearth-stones', x: r.x, y: r.y, z: r.z, yaw: r.yaw });
      const p = onIt ? pieceOf(c, onIt) : null;
      if (p && !held) out.push({ key: modelOf(onIt), x: r.x, y: r.y + H.stonesTopM, z: r.z, yaw: r.yaw + turnOf(p.seed), shade: [0, 0, 0] });
    }
    // The pots and the cup in their own slots, unless on the hearth (or in your arms).
    for (const [kind, slot] of Object.entries(H.slots)) {
      const p = pieceOf(c, kind), s = k.where.slotAt(slot);
      if (!p || !s || (kind === onIt && hearth)) continue;
      out.push({ key: modelOf(kind), x: s.x, y: s.y, z: s.z, yaw: s.yaw + turnOf(p.seed), shade: M[modelOf(kind)]?.shade });
    }
    // The dye pot's stand: a flat stone by the fire, waiting for Phase 4's dyes.
    const d = k.where.slotAt(H.slots['dye-pot']);
    if (d && hearth && !pieceOf(c, 'dye-pot')) out.push({ key: 'stand', x: d.x, y: d.y - 0.01, z: d.z, yaw: d.yaw + 0.7, scale: H.standScale, squash: H.standSquash, shade: M.stand?.shade });
    // Shaped pieces waiting pale on the workbench's slab.
    const b = k.benchAt('workbench');
    if (b && inSlot(c, 'workbench')) {
      const cb = Math.cos(b.yaw), sb = Math.sin(b.yaw);
      shapedOn(c).forEach((kind, i) => {
        const at = H.benchAt[i % H.benchAt.length];
        out.push({ key: modelOf(kind), x: b.x + cb * at[0] + sb * at[2], y: b.y + at[1], z: b.z - sb * at[0] + cb * at[2], yaw: b.yaw + i * 1.3, raw: 1 });
      });
    }
    // Pieces firing at the star's edge: pale, taking the fired clay's colour as their hours add up.
    if (r) {
      const cy = Math.cos(r.yaw), sy = Math.sin(r.yaw), hour = k.hourNow();
      let i = 0;
      for (const p of c.work) {
        const kind = firesOf(p.id);
        if (!kind) continue;
        const w = workSpot(i++, R.star), share = Math.min(1, fired(p, c.fire, hour, F) / Math.max(1e-6, p.needH));
        const seed = hash32(Math.round(p.laidHour * 60), i);
        out.push({ key: modelOf(kind), x: r.x + cy * w.x + sy * w.z, y: r.y + (R.star.workLiftM ?? 0), z: r.z - sy * w.x + cy * w.z, yaw: r.yaw + turnOf(seed), raw: 1 - share });
      }
    }
    // The pot in your arms, between your hands.
    if (held && onIt) {
      const hl = k.walk.hand?.('l'), hr = k.walk.hand?.('r');
      if (hl && hr) {
        // Between your hands, turned your way (a hand's yaw is your facing: +z of the walker's frame).
        const yaw = hl.yaw, A = H.carryAt;
        const fx = Math.sin(yaw), fz = Math.cos(yaw);
        out.push({ key: modelOf(onIt), x: (hl.x + hr.x) / 2 + fx * A[2], y: (hl.y + hr.y) / 2 + A[1], z: (hl.z + hr.z) / 2 + fz * A[2], yaw });
      }
    }
    return out;
  }

  /**
   * The test link's hearth (?camp=hearth, unsaved): the hearth stones set, the cooking pot, tea pot
   * and cup fired in their places, the shaped kinds waiting pale on the workbench, the firing ones
   * laid at the star's edge. Takes nothing. @param {{ shaped?: string[], firing?: string[] }} [o]
   */
  function setUp(o = {}) {
    const hour = k.hourNow();
    k.change((c) => {
      let x = setHearth(c, hour, hash32(k.campSeed, 40), H);
      for (const [i, kind] of ['cooking-pot', 'tea-pot', 'cup'].entries()) x = placeFired(x, kind, hour, hash32(k.campSeed, 41 + i), H);
      for (const kind of o.shaped ?? []) x = addShaped(x, kind);
      for (const kind of o.firing ?? []) x = { ...x, work: layWork(x.work, { id: `fire-${kind}`, needH: k.cook.makes?.[`fire-${kind}`]?.needH ?? 8, gives: kind, count: 1 }, hour) };
      return x;
    });
  }

  /** The hearth stones lifted out again (tools/hearth-check.html: the star as the first evening has it). */
  const clearHearth = () => k.change((c) => ({ ...c, slots: c.slots.filter((s) => s.slot !== 'hearth') }));

  // ---- cards: the pot on the hearth, the pots and cup waiting by the fire, the dye pot's stand ----

  const CW = k.cookWords ?? {};
  const base = { noPage: true, stage: -1, sub: null, canCarry: false, campPage: true };
  /** A pot's line: its water now. @param {string} kind */
  const waterLine = (kind) => CW.potWater?.[pieceOf(k.camp(), kind)?.water ?? 'none'] ?? '';

  /**
   * The card a click at a ground point opens, if it lands on the hearth's pot, a piece waiting in its
   * slot, or the dye pot's stand. @param {number} x @param {number} z
   */
  function cardAt(x, z) {
    const c = k.camp(), r = k.where.slotAt('ring'), onIt = potOnHearth(c);
    if (r && inSlot(c, 'hearth') && onIt && !k.holdingPot() && Math.hypot(x - r.x, z - r.z) < (H.potCardM ?? 0.22)) {
      return { ...base, sp: 'camp:pot', camp: 'pot', pot: onIt, onHearth: true, name: CW.pieceNames?.[onIt] ?? onIt, icon: 'takeup',
        text: [CW.pieceLines?.hearth ?? '', waterLine(onIt)].filter(Boolean).join(' '), wx: r.x, wz: r.z, r: 0.5 };
    }
    for (const [kind, slot] of Object.entries(H.slots)) {
      const s = k.where.slotAt(slot);
      if (!s || Math.hypot(x - s.x, z - s.z) > (s.slot.r ?? 0.15) + 0.12) continue;
      const p = pieceOf(c, kind);
      if (kind === 'dye-pot' && !p) {
        if (!inSlot(c, 'hearth')) continue;
        return { ...base, sp: 'camp:dyepot', camp: 'dyeStand', name: CW.pieceNames?.stand ?? 'Pot stand', icon: 'fire', text: CW.pieceLines?.stand ?? '', wx: s.x, wz: s.z, r: 0.3 };
      }
      if (!p || (kind === onIt && inSlot(c, 'hearth'))) continue;
      const pot = H.pots.includes(kind);
      return { ...base, sp: `camp:${kind}`, camp: pot ? 'potWaiting' : 'piece', pot: kind, name: CW.pieceNames?.[kind] ?? kind, icon: pot ? 'setdown' : 'fire',
        text: [CW.pieceLines?.[pot ? 'waiting' : kind] ?? '', pot ? waterLine(kind) : ''].filter(Boolean).join(' '), wx: s.x, wz: s.z, r: 0.3,
        canSwap: pot && !!inSlot(c, 'hearth') && !k.holdingPot() };
    }
    return null;
  }

  /** A waiting pot onto the hearth stones; the one there goes back to its slot. @param {string} kind */
  function swap(kind) {
    const s = k.where.slotAt(H.slots[kind] ?? ''), r = k.where.slotAt('ring');
    if (!s || !r || k.holdingPot()) return;
    k.walk.gesture('takeUp', s);
    k.change((c) => swapOn(c, kind));
    emitDeferred('pot:swapped', { pot: kind });
    if (get('identify')?.pot === kind) update('identify', () => null);
  }

  const offs = [
    registerCardAction({ id: 'potswap', icon: 'setdown', order: 4, main: true, label: CW.potSwap ?? 'Set it on the hearth',
      when: (c) => c?.camp === 'potWaiting' && !!c.canSwap, action: (c) => ({ type: 'pot.swap', pot: c.pot }) }),
    onAction((/** @type {any} */ a) => { if (a.type === 'pot.swap') swap(a.pot); }),
  ];

  // ---- fired pieces to their places ----

  /** A fired pot or the cup: done at the fire, it goes to its own slot (a bowl waits to be taken up). @param {import('./work.js').WorkPiece} p */
  const toSlot = (p) => { const f = firesOf(p.id); return !!f && !!H.slots[f]; };
  let settleT = 0;
  /**
   * Each frame, now and then: pieces whose hours of fire are done leave the work list for their
   * slots, the first pot onto empty hearth stones (pots.js placeFired). The clock alone decides, so
   * live play and a return from rest or time away end the same. @param {number} dt
   */
  function settle(dt) {
    if ((settleT -= dt) > 0) return;
    settleT = 1;
    const c0 = k.camp(), hour = k.hourNow();
    const due = c0.work.filter((p) => toSlot(p) && workDone(p, c0.fire, hour, F));
    if (!due.length) return;
    k.change((c) => {
      let x = { ...c, work: c.work.filter((p) => !(toSlot(p) && workDone(p, c.fire, hour, F))) };
      for (const p of due) x = placeFired(x, /** @type {string} */ (firesOf(p.id)), hour, hash32(k.campSeed, 60, Math.round(p.laidHour * 60)), H);
      return x;
    });
    for (const p of due) {
      const kind = /** @type {string} */ (firesOf(p.id));
      emitDeferred('camp:fired', { make: p.id, kind, hour });
      // Said on the island when you are at camp to see it; the camp page keeps it either way.
      const you = k.walk.below ? k.walk.you() : null, pad = k.where.padNow();
      if (you && pad && Math.hypot(you[0] - pad.x, you[2] - pad.z) <= pad.r + 3 && CW.firedLines?.[kind]) emit('island:notice', { text: CW.firedLines[kind], showS: 6 });
    }
  }

  return { props, cardAt, swap, settle, debug: { setUp, clearHearth }, dispose() { for (const off of offs) off(); } };
}
