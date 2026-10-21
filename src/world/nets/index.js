// @ts-check
// The nets, live (docs/future/12, piece K6). The Water tool's Net mode casts the net where you tap,
// if the shallows there are right (model.js canCast); the net is drawn staked in the water, under
// the sea at high tide, and full of weed once ready. Tapped with no tool it shows its card: how long
// it has left, or Lift. Lifting rolls the haul from the tide it fished (haul.js), brings the net in,
// and hands the haul to the tray (store slice `haul`, src/ui/haul-tray.js); living catches are let
// go from there (release), each kind's first written as a find (event `net:released`).
//
// Keeps the saved store slice `nets` (model.js NetsState) and the Net card's `netsUi`; app.js routes
// taps and actions here with ground points.

import { get, update, subscribe } from '../../core/store.js';
import { emitDeferred } from '../../core/events.js';
import { seasonOf } from '../../core/clock.js';
import { tideParams, level, amplitude } from '../tide.js';
import { waterCellOf } from '../water/grid.js';
import { WATER_CLASS } from '../water/summary.js';
import { packMesh } from '../creatures/bodies.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { cleanNets, ensureNets, canCast, cast, bringIn, netState, nextHighTide, highHour, noteReleased } from './model.js';
import { haulOf } from './haul.js';
import { netMesh } from './net-mesh.js';
import { catchPage, distinctive } from './living/index.js';

const SEASON_NAMES = ['spring', 'summer', 'autumn', 'winter'];

/**
 * @typedef {{ haul: import('./haul.js').Haul, hour: number, springTide: boolean, released: string[], kept: boolean, at: number }} HaulSlice
 *   the haul on the tray: hour of the high water it fished; released: living catches let go; kept:
 *   its keepsake is answered (kept or back to the sea)
 */

/**
 * @param {{ water: any, terrain: any, camera: any, seed: number, recipe: any, keepsakes: any, passRecipe: any,
 *   tide?: any, nowH: () => number, test?: boolean }} opts
 *   recipe: nets.json; keepsakes: keepsakes.json; passRecipe: the finds recipe, for the creature pass's
 *   look; nowH: the world's game hour; test: the ?nets link (a cast net is ready at once)
 */
export function createNets(opts) {
  const { water, terrain, camera, recipe: NR } = opts;
  const W = NR.words, L = NR.look;
  const tideP = tideParams(opts.tide);
  const pass = createCreaturePass({ recipe: opts.passRecipe, maxBones: 1 });
  for (const full of [false, true]) {
    const m = netMesh(L, full);
    pass.setMesh(full ? 'net-full' : 'net', { data: packMesh(m), indices: m.indices });
  }

  update('nets', (v) => ensureNets(cleanNets(v), get('unlocks')?.nets));
  /** @returns {import('./model.js').NetsState} */
  const state = () => get('nets');
  const offUnlocks = subscribe('unlocks', (/** @type {any} */ u) => {
    const next = ensureNets(state(), u?.nets);
    if (next !== state()) update('nets', () => next);
  });

  /** How the net stands, in words for its card and the Net card. @param {import('./model.js').Net} net */
  function words(net) {
    const s = netState(net, opts.nowH(), tideP);
    if (s.state === 'in') return W.in;
    if (s.state === 'ready') return W.ready;
    const h = Math.round(s.hoursLeft);
    if (h < 1) return W.fishingSoon;
    return W.fishing.replace('{h}', h === 1 ? W.hours.one : W.hours.many.replace('{n}', String(h)));
  }

  /** Mirror the nets into the Net card's slice. @param {{ message?: string, refused?: boolean }} [say] */
  function sync(say) {
    const net = state().nets[0];
    update('netsUi', (u) => ({ has: !!net, id: net?.id ?? null, out: !!net?.at, hint: W.hint, liftLabel: W.lift, inLabel: W.bringIn, ready: !!net && netState(net, opts.nowH(), tideP).state === 'ready',
      status: net ? words(net) : '', message: say?.message ?? '', refused: !!say?.refused, at: say ? performance.now() : u?.at ?? 0 }));
  }
  sync();

  /** Which way a net stands: along the shore's contour (across the slope), so the tide runs into it. @param {number} x @param {number} z */
  function yawAt(x, z) {
    const e = 0.4, h = (/** @type {number} */ a, /** @type {number} */ b) => terrain.sampleHeight(a, b);
    const gx = (h(x + e, z) - h(x - e, z)) / (2 * e), gz = (h(x, z + e) - h(x, z - e)) / (2 * e);
    if (Math.hypot(gx, gz) < 1e-4) return Math.atan2(camera.eye[0] - x, camera.eye[2] - z);
    return Math.atan2(-gx, -gz);
  }

  /** Is this water cell in the tide band, and is it open sea? @param {number} x @param {number} z */
  function placeOf(x, z) {
    const s = water.getSummary?.();
    if (!s) return { band: false, sea: false };
    const i = waterCellOf(x) - s.rect.x, j = waterCellOf(z) - s.rect.y;
    // Off the summary's rect is all open sea.
    if (i < 0 || j < 0 || i >= s.rect.w || j >= s.rect.h) return { band: false, sea: true };
    const k = j * s.rect.w + i;
    return { band: !!s.band[k], sea: s.cls[k] === WATER_CLASS.sea };
  }

  let clock = 0;
  const api = {
    id: 'nets',
    pass,
    /** @param {import('../../sim/live-sim.js').FrameInfo} f */
    tick(f) {
      clock += f.realDt;
      if (clock < 0.25) return;
      clock = 0;
      const nowH = opts.nowH(), t = camera.target, near2 = L.nearM * L.nearM;
      pass.setBeings(state().nets.filter((n) => n.at && (n.at.x - t[0]) ** 2 + (n.at.z - t[2]) ** 2 < near2).map((n) => {
        const a = /** @type {import('./model.js').NetCast} */ (n.at);
        return { x: a.x, y: terrain.sampleHeight(a.x, a.z), z: a.z, yaw: yawAt(a.x, a.z), size: 1,
          mesh: netState(n, nowH, tideP).state === 'ready' ? 'net-full' : 'net' };
      }));
      // The card's countdown moves on.
      const u = get('netsUi'), net = state().nets[0];
      if (net && u?.status !== words(net)) sync();
    },

    /**
     * A tap with the Water tool's Net mode at a ground point: cast the net there (or move it), if the
     * shallows are right; else the card says why, calmly. @param {ArrayLike<number>} p
     */
    tap(p) {
      const net = state().nets[0];
      if (!net) return;
      const nowH = opts.nowH();
      // A tap on the net itself never moves it: a full one is lifted, one still fishing says so.
      if (api.netAt(p[0], p[2])?.id === net.id) {
        if (netState(net, nowH, tideP).state === 'ready') api.lift(net.id);
        else sync({ message: words(net) });
        return;
      }
      const live = water.sampleLive?.(p[0], p[2]);
      // A full net stays where it is until it is lifted: moving it would lose its haul.
      if (netState(net, nowH, tideP).state === 'ready') { sync({ message: W.fullStays, refused: true }); return; }
      const at = { ...placeOf(p[0], p[2]), depth: live?.depth ?? 0, ground: terrain.sampleHeight(p[0], p[2]),
        nextHighLevel: level(highHour(nextHighTide(nowH, tideP), tideP), tideP) };
      const r = canCast(at, NR.set);
      if (!r.ok) { sync({ message: W.refused[r.reason], refused: true }); return; }
      const readyNow = !!opts.test && !!NR.test?.readyNow;
      update('nets', () => cast(state(), net.id, p[0], p[2], nowH, tideP, { readyNow }));
      emitDeferred('keepsake:sound', { name: 'net-set' });
      sync({ message: readyNow ? W.castTest : W.cast });
    },

    /** Bring the net in without lifting a haul. @param {number} id */
    bringIn(id) {
      update('nets', () => bringIn(state(), id));
      sync();
    },

    /**
     * The net a tap at a ground point lands on, with its card's words.
     * @param {number} x @param {number} z
     * @returns {{ id: number, x: number, z: number, text: string, canLift: boolean, liftLabel: string, inLabel: string, name: string } | null}
     */
    netAt(x, z) {
      const r = L.tapM + L.tapPerM * (camera.distance ?? 10);
      const net = state().nets.find((n) => n.at && (n.at.x - x) ** 2 + (n.at.z - z) ** 2 < r * r);
      if (!net?.at) return null;
      return { id: net.id, x: net.at.x, z: net.at.z, text: words(net), canLift: netState(net, opts.nowH(), tideP).state === 'ready',
        liftLabel: W.lift, inLabel: W.bringIn, name: W.card };
    },

    /**
     * Lift a full net: roll its haul from the tide it fished, bring it in, and put the haul on the tray.
     * @param {number} id @returns {import('./haul.js').Haul | null}
     */
    lift(id) {
      const net = state().nets.find((n) => n.id === id);
      if (!net?.at || netState(net, opts.nowH(), tideP).state !== 'ready') return null;
      const { x, z, setTide } = net.at;
      const hH = highHour(setTide, tideP);
      const spring = (amplitude(hH, tideP) / tideP.amplitudeM - 1) / tideP.springNeap;
      const haul = haulOf({ seed: opts.seed, net, tideId: setTide, cell: [waterCellOf(x), waterCellOf(z)],
        depthM: Math.max(0, level(hH, tideP) - terrain.sampleHeight(x, z)), spring,
        season: SEASON_NAMES[seasonOf(hH * 3600).index], sign: null, released: state().released }, NR, opts.keepsakes);
      update('nets', () => bringIn(state(), id));
      update('haul', () => /** @type {HaulSlice} */ ({ haul, hour: hH, springTide: spring >= opts.keepsakes.shore.springMin, released: [], kept: !haul.keepsake, at: performance.now() }));
      emitDeferred('keepsake:sound', { name: 'net-lift' });
      for (let i = 0; i < haul.living.length; i++) setTimeout(() => emitDeferred('keepsake:sound', { name: 'flop', seed: haul.living[i].n.seed }), 700 + i * 450);
      sync();
      return haul;
    },

    /** Let a living catch on the tray go: remembered if it is a kind's first or distinctive, and written as a find. @param {string} itemId */
    release(itemId) {
      /** @type {HaulSlice | null} */ const h = get('haul');
      const c = h?.haul.living.find((l) => l.id === itemId);
      if (!h || !c || h.released.includes(itemId)) return;
      update('nets', () => noteReleased(state(), { kind: c.n.kind, seed: c.n.seed, hour: h.hour, rarity: c.n.rarity }, distinctive(c.n)));
      update('haul', () => ({ ...h, released: [...h.released, itemId] }));
      emitDeferred('net:released', { kind: c.n.kind, page: catchPage(c.n.kind, NR), seed: c.n.seed });
      emitDeferred('keepsake:sound', { name: 'leave', seed: c.n.seed });
    },

    /** Close the tray: every living thing still on it goes back too. */
    closeTray() {
      /** @type {HaulSlice | null} */ const h = get('haul');
      if (!h) return;
      for (const c of h.haul.living) if (!h.released.includes(c.id)) api.release(c.id);
      update('haul', () => null);
    },

    /** The tray's keepsake was answered: kept, or back to the sea (gone: it slips off the tray). @param {boolean} [gone] */
    answered(gone = false) { const h = get('haul'); if (h) update('haul', () => ({ ...h, kept: true, ksGone: gone })); },

    /** The nets now (tools and tests). */
    nets: () => state().nets,

    dispose() { offUnlocks(); },
  };
  // On the ?nets test link only, a handle for the console and tools.
  if (opts.test) {
    /** @type {any} */ (globalThis).ebbNets = {
      ...api,
      /** Look at the net from close by. */
      look() { const a = state().nets[0]?.at; if (a) camera.focus(a.x, a.z, 3, 35, terrain.sampleHeight(a.x, a.z)); return !!a; },
    };
  }
  return api;
}
