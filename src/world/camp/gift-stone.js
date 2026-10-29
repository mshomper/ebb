// @ts-check
// The camp becoming a known place, live (B1 C1; docs/future/13 C-14, C-24, C-36, C-37):
//
//   The gift stone, made at the workbench (cook.json makes `gift-stone`, out 'slot' into the `gift`
//   slot) and drawn here: a low flat stone with shells set on it. From then on a named creature's
//   gift that goes to the walker's gift spot (gifts.js stoneGiftFor) is laid on the stone instead, a
//   small thing you walk to; Take up on the stone's card lifts it, and it is on the gift spot as
//   before. Other systems leave their own: emit `camp:gift-leave { kind, from, name? }` (or call
//   `leave`); it is laid and `camp:gift-left { kind, from, hour }` says so. Before the stone stands,
//   nothing is laid (leave returns false) and gifts come as they always did. Taking one up says
//   `camp:gift-taken { kind, from, hour }`, for its owner to act on.
//   A known place: each rest at camp is counted by season (known.js); the store slice `campKnown`
//   is the ring creatures' comfort rings shrink within (src/world/creatures/presence.js). The first
//   time it rises, `camp:known-rose { text }` asks the journal to write it.
//   The herb bed: once the first plant stands in the strip off the pad (herb-bed.js), its edging
//   pebbles are drawn for good; the store slice `campBed` { grows } names what grows in it now.
//
// State lives in the camp section (model.js: `gifts`, `known`, `bed`); one creature pass draws the
// stone, the gifts on it and the bed's pebbles (with baked vertex colours, as the pack's piles).

import { on, emit, emitDeferred } from '../../core/events.js';
import { get, update, subscribe } from '../../core/store.js';
import { onAction } from '../../input/actions.js';
import { hash32 } from '../../core/rng.js';
import { registerCardAction } from '../../ui/card-actions.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { packMesh } from '../creatures/bodies.js';
import { pebbleMesh } from '../pack/pickup-meshes.js';
import { inSlot } from './model.js';
import { hasGiftStone, leaveGift, takeGift, lying, stoneGiftFor } from './gifts.js';
import { noteRest, seasonKey, knownRing } from './known.js';
import { bedSpecies, edgingPebbles } from './herb-bed.js';
import { giftStoneMesh, giftTokenMesh } from './gift-meshes.js';

/** @param {string} s */
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * @param {{ R: any, CW: any, camp: () => import('./model.js').Camp, change: (fn: (c: import('./model.js').Camp) => import('./model.js').Camp) => void,
 *   where: import('./where.js').Where, player: import('./player.js').ActPlayer, hourNow: () => number, campSeed: number,
 *   terrain: { sampleHeight: (x: number, z: number) => number }, world: any, sowing?: any }} k
 *   R: recipes/world/camp.json; CW: cook.json words; world: the live world (seasons, growth);
 *   sowing: recipes/world/sowing.json (which gifts go to the gift spot)
 */
export function createGiftStone(k) {
  const R = k.R, G = R.giftStone, B = R.bed, KN = R.known, W = R.words.giftStone ?? {};
  const pass = createCreaturePass({ recipe: { body: { scaleReal: [G.pass.lengthM, G.pass.lengthM], contactShadow: G.pass.shadow, wetSpecular: { roughness: 0.85, strength: 0 } } },
    maxBones: 1, name: 'camp-gifts', liftGroup: 'camp-gifts' });
  const put = (/** @type {string} */ key, /** @type {import('../pack/pickup-meshes.js').Mesh} */ m) => pass.setMesh(key, { data: packMesh(m), indices: m.indices });
  const stone = giftStoneMesh(hash32(k.campSeed, 0x6f7), G);
  put('stone', stone.mesh);
  /** Token meshes made as gifts first need them. @type {Set<string>} */ const tokens = new Set();
  const tokenOf = (/** @type {string} */ kind) => (G.tokens[kind] ? kind : 'parcel');
  const tokenKey = (/** @type {string} */ kind) => {
    const t = tokenOf(kind);
    if (!tokens.has(t)) { tokens.add(t); put(`gift:${t}`, giftTokenMesh(hash32(k.campSeed, 0x61f, tokens.size), G.tokens[t] ?? G.tokens.parcel)); }
    return `gift:${t}`;
  };
  B.edging.shades.forEach((/** @type {number} */ s, /** @type {number} */ i) => put(`pebble:${i}`, pebbleMesh(0xbed0 + i, [0.5, 0.32, 0.42], 0.14, B.edging.color.map((/** @type {number} */ c) => c * s), 0.25)));

  const stoneAt = () => k.where.slotAt('gift');
  /** Where you stand to reach the stone: on the ring's side of it. */
  function standAt() {
    const s = stoneAt(), r = k.where.slotAt('ring');
    if (!s) return null;
    const dx = r ? r.x - s.x : 0, dz = r ? r.z - s.z : 1, l = Math.hypot(dx, dz) || 1, out = (s.slot.r ?? 0.28) + G.standM;
    return { x: s.x + (dx / l) * out, z: s.z + (dz / l) * out };
  }

  // ---- the gifts ----

  /**
   * Lay something on the stone. False before the stone stands, or when this kind from this
   * creature was laid before. @param {string} kind @param {string | null} [from] @param {string} [name]
   */
  function leave(kind, from = null, name) {
    const c = k.camp();
    if (!hasGiftStone(c)) return false;
    const hour = k.hourNow();
    const next = leaveGift(c.gifts, { kind, from, hour, seed: hash32(k.campSeed, 0x9f7, c.gifts.length) >>> 0, name });
    if (!next) return false;
    k.change((x) => ({ ...x, gifts: next }));
    emitDeferred('camp:gift-left', { kind, from, hour });
    return true;
  }
  /** Take up the first gift lying on the stone (or the one at i). @param {number} [i] */
  function take(i) {
    const c = k.camp(), g = i === undefined ? lying(c.gifts)[0] : lying(c.gifts).find((q) => q.i === i);
    if (!g) return false;
    const hour = k.hourNow(), next = takeGift(c.gifts, g.i, hour);
    if (!next) return false;
    k.change((x) => ({ ...x, gifts: next }));
    emitDeferred('camp:gift-taken', { kind: g.kind, from: g.from, hour });
    const spot = (k.sowing?.gifts ?? []).some((/** @type {any} */ q) => q.id === g.kind);
    emit('island:notice', { text: spot ? W.toSpot : W.taken, showS: 6 });
    if (get('identify')?.camp === 'giftstone') update('identify', () => null);
    return true;
  }
  /** Walk to the stone, kneel, and take up what lies there (the card's Take up). */
  function takeUp() {
    const s = stoneAt(), at = standAt();
    if (!s || !at || !lying(k.camp().gifts).length) return;
    k.player.play('lay', at, G.reachM, s, () => take());
  }
  /** A gift's words: the camp's for its kind (cook.json giftNames), else the name it was left with. @param {import('./gifts.js').Gift} g */
  const giftName = (g) => lower(k.CW.giftNames?.[g.kind] ?? g.name ?? g.kind);

  // ---- the known place ----

  /** The ring creatures' comfort rings shrink within (presence.js), published as `campKnown`. */
  let knownKey = '';
  function publishKnown() {
    const ring = knownRing(k.where.padNow(), k.camp().known, KN), key = JSON.stringify(ring);
    if (key !== knownKey) { knownKey = key; update('campKnown', () => ring); }
  }
  function rested() {
    const c = k.camp(), was = c.known.level;
    const r = noteRest(c.known, seasonKey(k.world.state?.seasons), KN);
    k.change((x) => ({ ...x, known: r.known }));
    if (r.rose && was === 0) emitDeferred('camp:known-rose', { text: W.knownRose, level: r.known.level });
  }

  // ---- the herb bed ----

  let bedT = 0, bedKey = '';
  function watchBed() {
    const pad = k.where.padNow();
    const grows = pad ? bedSpecies(pad, k.world.state?.growth?.plants ?? []) : [];
    if (grows.length && k.camp().bed.edged === null) {
      const hour = k.hourNow();
      k.change((x) => ({ ...x, bed: { ...x.bed, edged: hour } }));
      emitDeferred('camp:bed-edged', { hour });
    }
    const key = grows.join();
    if (key !== bedKey) { bedKey = key; update('campBed', () => ({ grows })); }
  }

  // ---- drawing ----

  let drawKey = '';
  function draw() {
    const c = k.camp(), s = stoneAt(), pad = k.where.padNow();
    const key = JSON.stringify([!!inSlot(c, 'gift'), lying(c.gifts).map((g) => g.kind + g.seed), c.bed.edged !== null, pad?.x, pad?.z, s?.y]);
    if (key === drawKey) return;
    drawKey = key;
    /** @type {import('../../render/passes/creatures.js').Being[]} */ const out = [];
    if (s && inSlot(c, 'gift')) {
      out.push({ x: s.x, y: s.y, z: s.z, yaw: s.yaw + G.yawDeg * Math.PI / 180, size: 1, mesh: 'stone' });
      // What lies on it, spread over its near half so each can be seen.
      lying(c.gifts).forEach((g, n) => {
        const u = (/** @type {number} */ q) => ((hash32(g.seed, q) >>> 8) / 16777216);
        const a = s.yaw + Math.PI + (n - 0.5) * G.giftApartRad + (u(1) - 0.5) * 0.2, d = G.stoneRadiiM[0] * G.giftRingShare;
        out.push({ x: s.x + Math.sin(a) * d, y: s.y + stone.topM, z: s.z + Math.cos(a) * d, yaw: u(2) * 2 * Math.PI, size: G.giftScale, mesh: tokenKey(g.kind) });
      });
    }
    if (pad && c.bed.edged !== null) {
      for (const p of edgingPebbles(pad, hash32(k.campSeed, 0xbed), B.edging)) {
        out.push({ x: p.x, y: k.terrain.sampleHeight(p.x, p.z), z: p.z, yaw: p.yaw, size: p.size, mesh: `pebble:${p.seed % B.edging.shades.length}` });
      }
    }
    pass.setBeings(out);
  }

  const offs = [
    // A species' gift for the gift spot, once the stone stands, is laid on it instead.
    on('progress:gifted', (/** @type {any} */ g) => {
      const id = stoneGiftFor(g, k.sowing);
      if (id && hasGiftStone(k.camp())) leave(id, g.id ?? null);
    }),
    on('camp:gift-leave', (/** @type {any} */ p) => { if (p?.kind) leave(p.kind, p.from ?? null, p.name); }),
    on('camp:rested', rested),
    subscribe('camp', publishKnown),
    subscribe('campPad', publishKnown),
    onAction((/** @type {any} */ a) => { if (a.type === 'camp.giftTake') takeUp(); }),
    registerCardAction({ id: 'campgifttake', icon: 'takeup', order: 4, main: true, label: W.takeUp ?? 'Take up',
      when: (c) => c?.camp === 'giftstone' && !!c.canTake, action: () => ({ type: 'camp.giftTake' }) }),
  ];
  publishKnown();

  return {
    pass,
    leave, take,
    /** The stone's card at a ground point, or null. @param {number} x @param {number} z */
    cardAt(x, z) {
      const s = stoneAt(), c = k.camp();
      if (!s || !inSlot(c, 'gift') || Math.hypot(x - s.x, z - s.z) > (s.slot.r ?? 0.28) + 0.15) return null;
      const at = /** @type {{ x: number, z: number }} */ (standAt()), here = lying(c.gifts);
      const text = here.length ? `${W.lies} ${here.map(giftName).join(', ')}.` : W.empty;
      return { noPage: true, stage: -1, sub: null, canCarry: false, sp: 'camp:giftstone', camp: 'giftstone', campPage: true, name: W.name, icon: 'gift-spot',
        text, wx: at.x, wz: at.z, r: 0.3, canTake: here.length > 0 };
    },
    /** Each frame. @param {number} dt */
    update(dt) {
      if ((bedT -= dt) <= 0) { bedT = B.checkS; watchBed(); }
      draw();
    },
    /** The species growing in the bed now (tests). */
    bedNow: () => get('campBed')?.grows ?? [],
    dispose() { for (const off of offs) off(); },
  };
}
