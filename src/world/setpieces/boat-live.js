// @ts-check
// The passing boat, live (docs/future/14): the camp's stores reported to the runner (a `stores`
// condition), and while the boat lies at anchor (dusk fallen, dawn not yet) the keeper's boat drawn
// again far offshore (src/world/intro/boat.js, Matt's model), its anchor line into the water, a
// lantern's light in it (a small light: the hull glows, its path lies on the water), and a bell now
// and then. The parcel stone stands at
// the tide line beside the mooring stake from the first dusk on, for good: Leave a parcel on its
// card while the boat is there; by dawn, what came back lies on it, and Take it up puts it in the
// pack and opens the letter that came with it. The runner (runner.js, hooks.js) keeps what lasts.

import { get, update } from '../../core/store.js';
import { emit, emitDeferred } from '../../core/events.js';
import { hash32, subSeed } from '../../core/rng.js';
import { onAction } from '../../input/actions.js';
import { registerCardAction } from '../../ui/card-actions.js';
import { packMesh } from '../creatures/bodies.js';
import { pebbleMesh } from '../pack/pickup-meshes.js';
import { createBoat } from '../intro/boat.js';
import { kelvinRgb, flicker } from '../camp/light.js';
import { slabMesh, joinMeshes } from './cairn-rules.js';

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const RAD = Math.PI / 180;

/**
 * @param {{ R: any, sp: ReturnType<typeof import('./live.js').createSetpiecesLive>, seed: number, pieces: any, pack: any, walk: any,
 *   terrain: { sampleHeight: (x: number, z: number) => number }, water: any, boatRecipe: any,
 *   mooring: () => import('../intro/boat.js').Mooring | null }} o
 *   R: recipes/setpieces/boat.json; boatRecipe: recipes/world/boat.json; mooring: where the keeper's boat is moored
 */
export function createBoatLive(o) {
  const R = o.R, B = R.boat, S = R.stone, W = R.words, ID = 'boat';
  const seed = subSeed(o.seed, 'passing-boat');
  const ground = (/** @type {number} */ x, /** @type {number} */ z) => o.terrain.sampleHeight(x, z);
  const sea = () => o.water?.tide ?? 0;
  const far = createBoat({ recipe: o.boatRecipe, ground, water: o.water });
  far.visible = false;

  const run = () => o.sp.runOf(ID);
  /** The boat lies at anchor: its dusk has fallen and its dawn not yet. */
  const atAnchor = () => { const r = run(); return !!r && r.done === undefined && r.fell.length === 1; };
  /** The stone stands once the boat has first come. */
  const stoneStands = () => { const r = run(); return !!r && (r.fell.length > 0 || r.n > 0); };
  /** A gift taken here this visit, before the next hour's tick writes it. */
  let takenAt = -1;
  const giftNow = () => { const g = run()?.data?.gift; return g && g.taken === undefined && g.hour !== takenAt ? g : null; };

  /** Where the stone stands, and where the boat anchors, from the mooring (null before it exists). */
  function places() {
    const m = o.mooring();
    if (!m) return null;
    let fx = m.boat.x - m.stake.x, fz = m.boat.z - m.stake.z;
    const l = Math.hypot(fx, fz) || 1;
    fx /= l; fz /= l;
    const stone = { x: m.stake.x - fz * S.sideM - fx * S.upM, z: m.stake.z + fx * S.sideM - fz * S.upM };
    let d = B.offM;
    while (d < B.searchM && sea() - ground(m.stake.x + fx * d, m.stake.z + fz * d) < B.minDepthM) d += 2;
    const yaw = Math.atan2(fx, fz) + B.yawDeg * RAD;
    const bx = m.stake.x + fx * d, bz = m.stake.z + fz * d;
    return { stone, boat: { x: bx, z: bz, yaw }, anchor: { x: bx + Math.sin(yaw) * 3, z: bz + Math.cos(yaw) * 3 } };
  }

  // ---- meshes ----
  const stoneMesh = pebbleMesh(hash32(seed, 1), [S.radiiM[0], S.thickM / 2, S.radiiM[1]], 0.08, S.color, 0.3);
  const P = R.parcelLook, Lt = B.lantern;
  const parcel = joinMeshes([
    { m: slabMesh(P.sizeM[0], P.sizeM[1], P.sizeM[2], P.color), dx: 0, dy: 0, dz: 0, yaw: 0 },
    { m: slabMesh(0.02, P.sizeM[1] + 0.006, P.sizeM[2] + 0.01, P.cord), dx: 0, dy: 0, dz: 0, yaw: 0 },
    { m: slabMesh(P.sizeM[0] + 0.01, P.sizeM[1] + 0.006, 0.02, P.cord), dx: 0, dy: 0, dz: 0, yaw: 0 },
  ]);
  for (const [key, m] of /** @type {[string, any][]} */ ([['boat-stone', stoneMesh], ['boat-parcel', parcel]])) {
    o.pieces.pass.setMesh(key, { data: packMesh(m), indices: m.indices });
  }
  const stoneTop = S.thickM * 0.7;
  /** Where the lantern stands now: at the stern, upM over the water, bobbing with the hull. @param {number} t */
  function lanternAt(t) {
    const p = places();
    if (!p) return null;
    const F = o.boatRecipe.boat.float, y = sea() + Lt.upM + F.bobM * Math.sin((t / F.bobS) * 2 * Math.PI);
    return [p.boat.x - Math.sin(p.boat.yaw) * Lt.aftM, y, p.boat.z - Math.cos(p.boat.yaw) * Lt.aftM];
  }
  let animT = 0;
  const being = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z, /** @type {number} */ yaw, /** @type {string} */ mesh, /** @type {number} */ half) =>
    ({ x, y, z, yaw, size: 1, mesh, bone: IDENTITY, slope: [0, 0], seed: 1, half: [half, half], plain: true });
  o.pieces.addBeings(() => {
    const p = places();
    if (!p || !stoneStands()) return [];
    const st = p.stone, gy = ground(st.x, st.z), out = [being(st.x, gy, st.z, 0.6, 'boat-stone', S.radiiM[0])];
    if ((atAnchor() && run()?.data?.parcel) || giftNow()) out.push(being(st.x, gy + stoneTop, st.z, 1.1, 'boat-parcel', 0.1));
    return out;
  });

  /** The lantern's light while the boat is there (the camp's lights take the rest). */
  const lightRgb = kelvinRgb(Lt.lightK);
  function lights() {
    if (!atAnchor()) return [];
    const l = lanternAt(animT);
    return l ? [{ x: l[0], y: l[1], z: l[2], rangeM: Lt.rangeM, cd: Lt.cd * flicker(animT, Lt.flicker, Lt.flickerHz, 5), rgb: lightRgb }] : [];
  }

  // ---- choices ----
  const inReach = () => { const y = o.walk.you?.(), p = places(); return !!y && !!p && Math.hypot(y[0] - p.stone.x, y[2] - p.stone.z) <= S.reachM + 0.6; };
  const parcelKind = () => R.parcelKinds.find((/** @type {string} */ k) => o.pack.has(k, 1)) ?? null;
  const notice = (/** @type {string} */ text) => emitDeferred('island:notice', { text, showS: 6 });

  function leave() {
    const p = places();
    if (!atAnchor() || run()?.data?.parcel || !p || !o.walk.below) return;
    if (!inReach()) { notice(W.far); return; }
    const kind = parcelKind();
    if (!kind) { notice(W.noParcel); return; }
    if (o.pack.take(kind, 1) < 1) return;
    o.walk.gesture?.('setDown', { x: p.stone.x, z: p.stone.z });
    o.sp.note(ID, 'parcel', { what: kind });
    update('identify', () => null);
    notice(W.left);
  }
  function take() {
    const g = giftNow(), p = places();
    if (!g || !p || !o.walk.below) return;
    if (!inReach()) { notice(W.far); return; }
    if (!o.pack.room(g.kind)) { notice(W.noRoom); return; }
    o.walk.gesture?.('takeUp', { x: p.stone.x, z: p.stone.z });
    o.pack.add(g.kind, g.n);
    takenAt = g.hour;
    o.sp.note(ID, 'taken');
    update('identify', () => null);
    notice(W.taken);
    if (g.letter) { emitDeferred('keeper:card', { id: g.letter }); emit('keepsake:sound', { name: 'letter' }); }
  }

  const offs = [
    onAction((/** @type {any} */ a) => { if (a.type === 'boat.leave') leave(); else if (a.type === 'boat.take') take(); }),
    registerCardAction({ id: 'boatleave', icon: 'gift-spot', order: 12, main: true, label: W.leave, item: () => parcelKind(), chip: 'offer',
      when: (c) => c?.sp === 'setpiece:boatstone' && !!c.canLeave && !!get('walk')?.below, action: () => ({ type: 'boat.leave' }) }),
    registerCardAction({ id: 'boattake', icon: 'takeup', order: 10, main: true, label: W.take, item: () => giftNow()?.kind ?? null, chip: 'pack',
      when: (c) => c?.sp === 'setpiece:boatstone' && !!c.canTake && !!get('walk')?.below, action: () => ({ type: 'boat.take' }) }),
  ];

  o.sp.use({
    id: ID,
    flags(r) {
      const f = [];
      if ((r.data?.sent ?? 0) > 0 || r.data?.parcel) f.push('setpiece:boat:parcel');
      const g = r.data?.gift;
      if (g?.letter && (g.taken !== undefined || g.hour === takenAt)) f.push(`keeper:${g.letter}`);
      return f;
    },
    beat(p) {
      if (p.beat === 'dusk') { notice(W.warn); bellS = 2; }
      else if (p.beat === 'dawn') notice(giftNow() ? W.goneGift : W.gone);
    },
    // The test link needs the mooring (the camp pad) to place the boat and the stone.
    testData() { return o.mooring() ? {} : null; },
  });

  let condS = 0, bellS = 0, bells = 0;
  return {
    id: 'boat-live',
    lights,
    /** Each frame: the stores reported now and then; the boat posed; the bell. @param {{ realDt: number, animT: number }} f */
    tick(f) {
      animT = f.animT;
      if ((condS -= f.realDt) <= 0) { condS = 2; o.sp.cond('stores', !!parcelKind()); }
      const on = atAnchor(), p = on ? places() : null;
      if (p) {
        const m = far.mooring;
        if (!m || m.boat.x !== p.boat.x || m.boat.z !== p.boat.z) far.setMooring({ stake: p.anchor, boat: p.boat, stand: p.boat });
        far.visible = true;
        far.update(f.realDt, f.animT);
        if ((bellS -= f.realDt) <= 0) {
          bells++;
          bellS = B.bellEveryS[0] + ((hash32(seed, 7, bells) >>> 8) / 16777216) * (B.bellEveryS[1] - B.bellEveryS[0]);
          emit('setpiece:bell', { ...B.bell, seed: hash32(seed, 9, bells) });
        }
      } else if (far.visible) { far.visible = false; }
    },
    /** The boat's draw pass, for the frame graph. */
    pass: far.pass,
    /** The stone's card at a ground point, or null. @param {number} x @param {number} z */
    cardAt(x, z) {
      const p = places();
      if (!p || !stoneStands() || Math.hypot(x - p.stone.x, z - p.stone.z) > S.tapM) return null;
      const anchor = atAnchor(), left = !!run()?.data?.parcel, g = giftNow();
      const text = g ? W.stoneGift : anchor && left ? W.stoneLeft : anchor ? W.stoneBoat : W.stoneLine;
      return { sp: 'setpiece:boatstone', name: W.stoneName, sub: null, icon: 'boat-lantern', text, wx: p.stone.x, wz: p.stone.z, r: 0.3,
        reachR: S.reachM, stage: -1, noPage: true, canCarry: false, canLeave: anchor && !left, canTake: !!g };
    },
    /** Tests and the lab. */
    debug: { places, atAnchor, leave, take, giftNow },
    dispose() { for (const off of offs) off(); far.dispose(); },
  };
}
