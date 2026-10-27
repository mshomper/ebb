// @ts-check
// The walker's carriers, live (P2f; recipes/world/pack.json carriersNote): the one worn drawn on the
// figure's bone (the rush satchel at the hip, the willow basket on the pack's spring) with the
// baked pack folded away, and the ones not worn set down by the workbench, each with a card whose
// Wear swaps it back on (the pack refuses, with a line, when what it holds would not fit). Carriers
// replace, never stack. Reads the pack (src/world/pack/index.js) and the walker's figure; drawn with
// the camp's models (the starting pack, which has no model of its own, by the figure's pass).
// Action: camp.wear { id } ('pack' for the starting pack).

import { update } from '../../core/store.js';
import { emitDeferred } from '../../core/events.js';
import { onAction } from '../../input/actions.js';
import { registerCardAction } from '../../ui/card-actions.js';

const DEG = Math.PI / 180;

/**
 * @param {{ P: any, pack: any, walk: any, benchAt: (slot: string) => { x: number, y: number, z: number, yaw: number } | null }} o
 *   P: recipes/world/pack.json; pack: the live pack; walk: the walker
 */
export function createCarriers(o) {
  const P = o.P, H = P.hang, WR = P.wear ?? {}, W = P.words ?? {};
  /** Every carrier that can be worn, in the recipe's order: the starting pack first. */
  const ORDER = ['pack', ...(P.carriers ?? [])];
  const state = () => o.pack?.carriers?.() ?? { made: [], worn: null };

  /** The carriers set down at camp now, each with its place (world m) and its spot's yaw. */
  function hanging() {
    const { made, worn } = state(), at = H ? o.benchAt(H.slot) : null;
    if (!at || !made.length) return [];
    const c = Math.cos(at.yaw), s = Math.sin(at.yaw);
    return ORDER.map((id, i) => ({ id, spot: H.spots[i] }))
      .filter(({ id, spot }) => spot && id !== (worn ?? 'pack') && (id === 'pack' || made.includes(id)))
      .map(({ id, spot }) => ({ id, x: at.x + spot[0] * c + spot[2] * s, y: at.y + spot[1], z: at.z - spot[0] * s + spot[2] * c, yaw: at.yaw + spot[3] * DEG }));
  }

  /** The camp props now: the carrier worn, on the figure; the made ones set down. The starting pack, set down, goes to the figure's pass. */
  function props() {
    const { worn } = state(), fig = o.walk.figure?.();
    /** @type {any[]} */ const out = [];
    fig?.motion.showPack(!worn);
    const R = worn ? WR[worn] : null;
    const on = R && fig ? fig.carried(R.bone, R.at, R.turnDeg ?? [0, 0, 0]) : null;
    if (on && R) out.push({ key: R.model, x: on.x, y: on.y, z: on.z, yaw: on.yaw, pitch: on.pitch, roll: on.roll, scale: R.scale ?? 1 });
    let packAt = null;
    for (const h of hanging()) {
      if (h.id === 'pack') { packAt = h; continue; }
      const M = WR[h.id];
      if (M) out.push({ key: M.model, x: h.x, y: h.y, z: h.z, yaw: h.yaw, scale: M.scale ?? 1 });
    }
    fig?.hangPack(packAt);
    return out;
  }

  const offs = [
    registerCardAction({ id: 'carrierwear', icon: 'wear', order: 4, main: true, label: W.wear ?? 'Wear it',
      when: (c) => c?.camp === 'carrier', action: (c) => ({ type: 'camp.wear', id: c.carrier }) }),
    onAction((/** @type {any} */ a) => {
      if (a.type !== 'camp.wear') return;
      const h = hanging().find((q) => q.id === a.id);
      if (!h || !o.pack?.wear(a.id === 'pack' ? null : a.id)) return;
      o.walk.gesture('takeUp', h);
      update('identify', () => null);
      emitDeferred('island:notice', { text: W.worn, showS: 4 });
    }),
  ];

  return {
    props,
    /** A carrier set down at camp, under a ground point: its card. @param {number} x @param {number} z */
    cardAt(x, z) {
      const h = hanging().find((q) => Math.hypot(x - q.x, z - q.z) <= (H.r ?? 0.3));
      if (!h) return null;
      return { noPage: true, stage: -1, sub: null, canCarry: false, sp: `camp:carrier-${h.id}`, camp: 'carrier', carrier: h.id,
        name: W.carrierNames?.[h.id] ?? h.id, icon: 'wear', text: W.carrierLines?.[h.id] ?? '', wx: h.x, wz: h.z, r: H.r ?? 0.3, campPage: true };
    },
    /** The carriers set down now (tests). */
    hanging,
    dispose() { for (const off of offs) off(); },
  };
}
