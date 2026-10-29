// @ts-check
// The perch stick (B1 P1, docs/future/13 8.3 F-07): the dragonflies' offering. Once they are found,
// the sticks pouch's card offers Stand in the shallows on foot: you kneel and push a handful of
// sticks into the bed of a pond's shallows, and one stands bare above the water. It is a placed
// piece of kind 'perch' (the store slice `pieces`, saved with the island), drawn here in the pieces
// pass from a mesh baked in code. Dragonflies on patrol rest on its tip now and then (patrol.js
// stickNear, fed by the store slice `perchSticks`), and one landing while you are near is their
// treat (schools.js). Its card says what it is and offers Take up, which gives the sticks back.
//
// A record: { id, kind: 'perch', x, z, yaw, seed, size, placedHour }: size its height above the bed
// (m), seed its lean, thickness and twig (perch-rules.js). Numbers and words: recipes/world/treats.json perch.

import { get, update } from '../../core/store.js';
import { emitDeferred } from '../../core/events.js';
import { hash32, subSeed } from '../../core/rng.js';
import { hourIndex } from '../../core/clock.js';
import { onAction } from '../../input/actions.js';
import { registerCardAction } from '../../ui/card-actions.js';
import { packMesh } from './bodies.js';
import { WATER_CLASS } from '../water/summary.js';
import { makePerch, shallowsAlong, perchTip, perchMesh, rayToSegment, span, u01 } from './perch-rules.js';
import { waterCellOf } from '../water/grid.js';

/**
 * @param {{ recipe: any, seed: number, pieces: any, pack: any, walk: any, terrain: any, water: any }} o
 *   recipe: recipes/world/treats.json; pieces: src/world/pieces (its pass draws the sticks); water:
 *   world/water (sampleLive and the summary's water classes)
 */
export function createPerchSticks(o) {
  const P = o.recipe.perch, W = P.words;
  const piecesSeed = subSeed(o.seed, 'pieces');
  const bed = (/** @type {number} */ x, /** @type {number} */ z) => o.terrain.sampleHeight(x, z);
  const list = () => /** @type {any[]} */ (get('pieces')?.list ?? []).filter((p) => p.kind === 'perch');
  /** Each stick's mesh, baked once (by id and height). @type {Map<string, string>} */
  const baked = new Map();
  const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  /** The water at a point: its depth and class. @param {number} x @param {number} z */
  function waterAt(x, z) {
    const s = o.water.getSummary?.(), depth = o.water.sampleLive?.(x, z)?.depth ?? 0;
    if (!s?.rect) return { depth, cls: depth > 0 ? WATER_CLASS.still : WATER_CLASS.dry };
    const i = waterCellOf(x) - s.rect.x, j = waterCellOf(z) - s.rect.y;
    const cls = i < 0 || j < 0 || i >= s.rect.w || j >= s.rect.h ? WATER_CLASS.sea : s.cls[j * s.rect.w + i];
    return { depth, cls };
  }

  /** A stick's mesh name, baked the first time. @param {any} p */
  function meshOf(p) {
    const key = `${p.id}:${p.size}`;
    let name = baked.get(key);
    if (!name) {
      name = `perch-${p.id}-${baked.size}`;
      const m = perchMesh(p, p.size - P.sinkM - span(P.aboveM, u01(hash32(p.seed, 1))), P);
      o.pieces.pass.setMesh(name, { data: packMesh(m), indices: m.indices });
      baked.set(key, name);
    }
    return name;
  }

  o.pieces.addBeings(() => list().map((p) => ({ x: p.x, y: bed(p.x, p.z) - P.sinkM, z: p.z, yaw: 0, size: 1, mesh: meshOf(p), bone: IDENTITY,
    slope: [0, 0], seed: ((p.seed >>> 8) / 16777216) * 10, half: [0.03, 0.03], plain: true })));

  /** The tips for the dragonflies (patrol.js), kept in the store slice `perchSticks`. */
  function publish() {
    const tips = list().map((p) => ({ id: p.id, ...perchTip(p, bed(p.x, p.z), P) }));
    tips.forEach((t) => { t.y += 0.015; });
    update('perchSticks', () => tips);
  }
  publish();

  /** Is the walker in reach of a stick to take it up? @param {any} p */
  const inReach = (p) => { const y = o.walk.you?.(); return !!y && Math.hypot(y[0] - p.x, y[2] - p.z) <= P.takeReachM; };

  /** Stand a stick in the shallows in front of you; the line to show. */
  function stand() {
    if (!o.walk.below || !o.pack.has(P.kind, 1)) return '';
    if (list().length >= P.cap) return W.full;
    const w = o.walk.walker;
    const like = (/** @type {number} */ x, /** @type {number} */ z) => {
      const dx = x - w.x, dz = z - w.z, d = Math.hypot(dx, dz) || 1;
      return !!shallowsAlong(w.x, w.z, dx / d, dz / d, waterAt, P, d);
    };
    const p = o.walk.feedPoint(P.aheadM, P.turnDeg, like, true);
    if (!p) return '';
    const dx = p[0] - w.x, dz = p[2] - w.z, d = Math.hypot(dx, dz) || 1;
    const at = shallowsAlong(w.x, w.z, dx / d, dz / d, waterAt, P, d);
    if (!at) return W.where;
    if (o.pack.take(P.kind, 1) < 1) return '';
    const s = get('pieces');
    const piece = makePerch(piecesSeed, s.nextId, Math.round(at.x * 100) / 100, Math.round(at.z * 100) / 100, at.depth, hourIndex(), P);
    update('pieces', () => ({ ...s, list: [...s.list, piece], nextId: s.nextId + 1 }));
    publish();
    emitDeferred('perch:stood', { id: piece.id, x: piece.x, z: piece.z });
    return W.stood;
  }

  /** Take a stick up: the sticks go back into the pack. @param {string} id */
  function takeUp(id) {
    const p = list().find((q) => q.id === id);
    if (!p || !o.walk.below) return;
    if (!inReach(p)) { emitDeferred('island:notice', { text: W.far, showS: 5 }); return; }
    if (!o.pack.room(P.kind)) { emitDeferred('island:notice', { text: W.noRoom, showS: 5 }); return; }
    o.walk.gesture('takeUp', { x: p.x, z: p.z });
    o.pack.add(P.kind, 1);
    update('pieces', (s) => ({ ...s, list: s.list.filter((/** @type {any} */ q) => q.id !== id) }));
    update('identify', () => null);
    publish();
    emitDeferred('perch:taken', { id });
  }

  const offs = [
    onAction((/** @type {any} */ a) => {
      if (a.type === 'perch.stand') {
        const line = stand();
        update('identify', () => null);
        if (line) emitDeferred('island:notice', { text: line, showS: 6 });
      } else if (a.type === 'perch.takeUp') takeUp(a.id);
    }),
    registerCardAction({ id: 'perchstand', icon: 'feed', order: 12, main: true, label: W.stand, item: () => P.kind, chip: 'offer',
      when: (c) => c?.sp === 'pouch' && c.kindId === P.kind && !!get('walk')?.below && !!get('journal')?.species?.[P.after]?.ever,
      action: () => ({ type: 'perch.stand' }) }),
    registerCardAction({ id: 'perchtakeup', icon: 'takeup', order: 10, main: true, label: W.takeUp, item: () => P.kind, chip: 'pack',
      when: (c) => !!c?.perchStick && !!get('walk')?.below, action: (c) => ({ type: 'perch.takeUp', id: c.perchStick }) }),
  ];

  let refreshS = 0;
  return {
    id: 'perch-sticks',
    /** recipes/world/treats.json perch. */
    recipe: P,
    /** Each frame: the tips follow the ground under them now and then (a sculpt). @param {{ realDt: number }} f */
    tick(f) { if ((refreshS += f.realDt) > 2) { refreshS = 0; publish(); } },
    /**
     * The stick a tap's ray passes within rayM of (standing up out of the water, a tap on it lands on
     * the ground behind), nearest first, as { x, z }; or null. @param {number[]} ro @param {number[]} rd
     */
    underRay(ro, rd) {
      let best = null, bt = Infinity;
      for (const p of list()) {
        const y0 = bed(p.x, p.z) - P.sinkM, tip = perchTip(p, bed(p.x, p.z), P);
        const h = rayToSegment(ro, rd, [p.x, y0, p.z], [tip.x, tip.y, tip.z]);
        if (h.d <= P.rayM && h.t < bt) { bt = h.t; best = { x: p.x, z: p.z }; }
      }
      return best;
    },
    /** The card a tap on a stick opens, or null. @param {number} x @param {number} z */
    cardAt(x, z) {
      const p = list().find((q) => Math.hypot(q.x - x, q.z - z) <= P.tapM);
      if (!p) return null;
      return { sp: 'piece:perch', perchStick: p.id, name: W.name, sub: null, icon: 'dragonfly', itemIcon: 'perch-stick',
        text: W.line, wx: p.x, wz: p.z, r: 0.25, reachR: P.cardReachM, stage: -1, noPage: true, canCarry: false };
    },
    /** Tests and the test links. */
    debug: { stand, takeUp, list, publish },
    dispose() { for (const off of offs) off(); },
  };
}
