// @ts-check
// The hearth and the clay pieces, live (docs/future/13 sections 3.12 and 4.1 K-26; S4, S5): draws
// the hearth stones in the ring's middle and the pot on them, the other pots and the cup waiting in
// their slots at the ring's side, the dye pot's stand, the shaped pieces waiting pale on the
// workbench, the pieces firing at the star's edge (pale at first, taking the fired clay's colour as
// their hours of fire add up), and the pot in your arms. Rules: pots.js (pure); firing: work.js.

import { inSlot } from './model.js';
import { potOnHearth, pieceOf, shapedOn, setHearth, placeFired, addShaped } from './pots.js';
import { fired, layWork } from './work.js';
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
        const yaw = Math.atan2(hr.x - hl.x, hr.z - hl.z) - Math.PI / 2, A = H.carryAt;
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

  return { props, debug: { setUp, clearHearth } };
}
