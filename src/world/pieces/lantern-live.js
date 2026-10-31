// @ts-check
// The lanterns, live (B2 L1, Matt, October 30, 2026; pure parts in lantern.js). A made lantern rides
// in its own pouch; on foot, the pouch card's Set it here kneels and stands it in front of you, a
// piece of kind 'lantern' in the store slice `pieces` (saved with the island). It is drawn with the
// camp's props (a stick post, a rush tie, the clay pot and its holes; the pot is also what waits pale
// on the workbench and fires at the ring). From dusk to dawn it glows by itself: its point light
// joins the camp's small lights (app.js), and its glass and moths are drawn by the camp's effects
// pass. Its card says whether it is lit and offers Lift (carry it to a new spot, as the turtles' gift
// carries a stone; the next click sets it down) and Take up within reach. The make is offered only
// while the island has room for another lantern: the store slice `makeRoom` (stations.js reads it).
// Numbers and words: recipes/world/pieces.json lantern.

import { get, update, subscribe } from '../../core/store.js';
import { emitDeferred } from '../../core/events.js';
import { subSeed } from '../../core/rng.js';
import { hourIndex } from '../../core/clock.js';
import { onAction } from '../../input/actions.js';
import { registerCardAction } from '../../ui/card-actions.js';
import { kelvinRgb, flicker } from '../camp/light.js';
import { shapedOn } from '../camp/pots.js';
import { onCampGround } from './camp-clear.js';
import { makeLantern, lanternGlow, lanternAt, mayStand, lanternsOwned, potMesh, holesMesh, postMesh, bandMesh } from './lantern.js';

/**
 * @param {{ recipe: any, seed: number, pieces: any, pack: any, walk: any, terrain: any, water: any, camp: any, camera: any, liftM: number }} o
 *   recipe: pieces.json lantern; pieces: src/world/pieces (carrying); camp: src/world/camp (its props
 *   pass, effects pass, sun and pad); camera: the view (the glow is drawn on the pot's near side);
 *   liftM: how high a carried piece hangs (pieces.json driftwood.carry.liftM)
 */
export function createLanterns(o) {
  const L = o.recipe, W = L.words;
  const piecesSeed = subSeed(o.seed, 'pieces');
  const ground = (/** @type {number} */ x, /** @type {number} */ z) => o.terrain.sampleHeight(x, z);
  const list = () => /** @type {any[]} */ (get('pieces')?.list ?? []).filter((p) => p.kind === 'lantern');
  const rgb = kelvinRgb(L.light.lightK);
  const DEG = 180 / Math.PI;

  o.camp.props.addMesh('lantern-pot', potMesh(L), L.pot.srgb, L.pot.rough);
  o.camp.props.addMesh('lantern-holes', holesMesh(L), L.pot.holeSrgb, 1);
  o.camp.props.addMesh('lantern-post', postMesh(L), L.post.srgb, L.post.rough);
  o.camp.props.addMesh('lantern-band', bandMesh(L), L.band.srgb, L.band.rough);

  /** A lantern as it stands now: its ground, raised while carried. @param {any} p */
  function standing(p) {
    const up = o.pieces.carrying?.()?.id === p.id ? o.liftM : 0;
    return lanternAt(p, ground(p.x, p.z) + up, L);
  }
  /** How lit the lanterns are now (all alike: the sun decides). */
  const glow = () => lanternGlow(o.camp.sunAlt() * DEG, L.light);

  o.camp.addProps(() => list().flatMap((p) => {
    const a = standing(p), y = a.top[1] - Math.cos(a.tilt) * L.post.heightM;
    return [
      { key: 'lantern-post', x: p.x, y, z: p.z, yaw: a.dir, pitch: a.tilt },
      { key: 'lantern-band', x: p.x, y, z: p.z, yaw: a.dir, pitch: a.tilt },
      { key: 'lantern-pot', x: a.top[0], y: a.top[1], z: a.top[2], yaw: p.yaw },
      { key: 'lantern-holes', x: a.top[0], y: a.top[1], z: a.top[2], yaw: p.yaw },
    ];
  }));

  /** The water over a spot now, the camp ground, the other lanterns: may one stand here? @param {number} x @param {number} z @param {string} [not] */
  const may = (x, z, not) => mayStand({ depth: o.water.sampleLive?.(x, z)?.depth ?? 0, camp: onCampGround(get('campPad') ?? null, x, z, L.sizeM),
    others: list().filter((q) => q.id !== not) }, x, z, L);

  /** Is there room for another lantern (the make is offered)? Kept in the store slice makeRoom. */
  function publishRoom() {
    const c = get('camp');
    const owned = lanternsOwned({ standing: list().length, pouches: get('pack')?.pouches ?? [], shaped: Array.isArray(c?.slots) ? shapedOn(c) : [],
      work: Array.isArray(c?.work) ? c.work : [] });
    const room = owned < L.cap;
    if (get('makeRoom')?.lantern !== room) update('makeRoom', (r) => ({ ...(r ?? {}), lantern: room }));
  }
  const offs = [subscribe('pieces', publishRoom), subscribe('pack', publishRoom), subscribe('camp', publishRoom)];
  publishRoom();

  /** Stand a lantern at a point (the pouch card, or the test link); its record, or null. @param {number} x @param {number} z */
  function standAt(x, z) {
    const s = get('pieces');
    const p = makeLantern(piecesSeed, s.nextId, Math.round(x * 100) / 100, Math.round(z * 100) / 100, hourIndex(), L);
    update('pieces', () => ({ ...s, list: [...s.list, p], nextId: s.nextId + 1 }));
    emitDeferred('lantern:set', { id: p.id, x: p.x, z: p.z });
    return p;
  }

  /** Set it here: kneel and stand the lantern in front of you; the line to show. */
  function setHere() {
    if (!o.walk.below || !o.pack.has('post-lantern', 1)) return '';
    if (list().length >= L.cap) return W.full;
    const p = o.walk.feedPoint(L.setAheadM, L.setTurnDeg, (/** @type {number} */ x, /** @type {number} */ z) => may(x, z), true);
    if (!p || !may(p[0], p[2])) return W.where;
    if (o.pack.take('post-lantern', 1) < 1) return '';
    standAt(p[0], p[2]);
    return W.set;
  }

  /** Take a lantern up: back into its pouch. @param {string} id */
  function takeUp(id) {
    const p = list().find((q) => q.id === id), you = o.walk.below ? o.walk.you?.() : null;
    if (!p || !you) return;
    if (Math.hypot(you[0] - p.x, you[2] - p.z) > L.reachM) { emitDeferred('island:notice', { text: W.far, showS: 5 }); return; }
    if (!o.pack.room('post-lantern')) { emitDeferred('island:notice', { text: W.noRoom, showS: 5 }); return; }
    o.walk.gesture('takeUp', { x: p.x, z: p.z });
    o.pack.add('post-lantern', 1);
    update('pieces', (s) => ({ ...s, list: s.list.filter((/** @type {any} */ q) => q.id !== id) }));
    update('identify', () => null);
    emitDeferred('lantern:taken', { id });
  }

  /** Lift: carry it (the next click on land sets it down, app.js carryTap). @param {string} id */
  function lift(id) {
    if (!list().some((q) => q.id === id) || !o.pieces.carry(id)) return;
    update('identify', (c) => (c ? { ...c, carrying: true, canCarry: true, carryNote: null, pinned: false } : c));
  }

  offs.push(
    onAction((/** @type {any} */ a) => {
      if (a.type === 'lantern.set') {
        const line = setHere();
        update('identify', () => null);
        if (line) emitDeferred('island:notice', { text: line, showS: 6 });
      } else if (a.type === 'lantern.takeUp') takeUp(a.id);
      else if (a.type === 'lantern.lift') lift(a.id);
    }),
    registerCardAction({ id: 'lanternset', icon: 'setdown', order: 11, main: true, label: W.setHere, item: () => 'post-lantern', chip: 'setdown',
      when: (c) => c?.sp === 'pouch' && c.kindId === 'post-lantern' && !!get('walk')?.below, action: () => ({ type: 'lantern.set' }) }),
    registerCardAction({ id: 'lanternlift', icon: 'carry', order: 12, label: W.lift,
      when: (c) => !!c?.lantern && !c.carrying, action: (c) => ({ type: 'lantern.lift', id: c.lantern }) }),
    registerCardAction({ id: 'lanterntakeup', icon: 'takeup', order: 10, main: true, label: W.takeUp, item: () => 'post-lantern', chip: 'pack',
      when: (c) => !!c?.lantern && !c.carrying && !!get('walk')?.below, action: (c) => ({ type: 'lantern.takeUp', id: c.lantern }) }),
  );

  return {
    id: 'lanterns',
    /** pieces.json lantern. */
    recipe: L,
    /** Each frame: the glass and moths of the lit lanterns (the camp's effects pass). @param {{ realDt: number }} f */
    tick() {
      const g = glow();
      // The glow through the holes, drawn just on the pot's near side so the pot does not hide it.
      const eye = o.camera.eye, near = L.pot.radiusM * L.glass.nearShare;
      const lit = g > 0.01 ? list().map((p) => {
        const c = standing(p).glass, d = [eye[0] - c[0], eye[1] - c[1], eye[2] - c[2]], l = Math.hypot(d[0], d[1], d[2]) || 1;
        return { glass: [c[0] + (d[0] / l) * near, c[1] + (d[1] / l) * near, c[2] + (d[2] / l) * near, g], look: [L.glass.nits, L.glass.m] };
      }) : [];
      o.camp.fx.setLanterns?.(lit, g > 0.5, performance.now() / 1000, 0);
    },
    /**
     * The lit lanterns' point lights now (doc 06, Lanterns and small lights), for the lighting's
     * small lights after the camp's own. @returns {import('../../render/lighting.js').PointLight[]}
     */
    lights() {
      const g = glow();
      if (g <= 0.01) return [];
      const t = performance.now() / 1000, F = L.light;
      return list().map((p, i) => {
        const at = standing(p).glass;
        return { key: `lantern:${p.id ?? i}`, x: at[0], y: at[1], z: at[2], rangeM: F.rangeM, cd: F.cd * g * flicker(t, F.flicker, F.flickerHz, 5 + i), rgb };
      });
    },
    /** The card a tap on a lantern opens, or null. @param {number} x @param {number} z */
    cardAt(x, z) {
      const p = list().find((q) => Math.hypot(q.x - x, q.z - z) <= L.tapM);
      if (!p) return null;
      return { sp: 'piece:lantern', lantern: p.id, piece: p.id, name: W.name, sub: null, icon: 'moment-dusk', itemIcon: 'post-lantern',
        text: glow() > 0.01 ? W.lit : W.dark, wx: p.x, wz: p.z, r: 0.3, reachR: L.reachM, stage: -1, noPage: true, campPage: true, canCarry: false };
    },
    /**
     * Ray picking (a tap on the pot or the post lands on the ground behind it): the lantern within
     * a hand of the ray, nearest first, as { x, z }; or null. @param {number[]} ro @param {number[]} rd
     */
    underRay(ro, rd) {
      let best = null, bt = Infinity;
      for (const p of list()) {
        const a = standing(p), c = [a.top[0], a.top[1] - L.post.heightM * 0.4, a.top[2]];
        const w = [c[0] - ro[0], c[1] - ro[1], c[2] - ro[2]], t = Math.max(0, w[0] * rd[0] + w[1] * rd[1] + w[2] * rd[2]);
        const d = Math.hypot(ro[0] + rd[0] * t - c[0], ro[1] + rd[1] * t - c[1], ro[2] + rd[2] * t - c[2]);
        if (d <= L.post.heightM * 0.55 && t < bt) { bt = t; best = { x: p.x, z: p.z }; }
      }
      return best;
    },
    /**
     * The test link (`?lantern`): a lantern standing on the nearest spot that will take one, rings
     * outward from a point; its record, or null. @param {number} x @param {number} z
     */
    standNear(x, z) {
      for (let r = 0; r <= 8; r += 0.5) for (let i = 0; i < Math.max(1, Math.round(r * 8)); i++) {
        const a = (i / Math.max(1, Math.round(r * 8))) * Math.PI * 2, px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
        if (may(px, pz)) return standAt(px, pz);
      }
      return null;
    },
    /** Tests and the test links. */
    debug: { setHere, takeUp, list, publishRoom, glow },
    dispose() { for (const off of offs) off(); },
  };
}
