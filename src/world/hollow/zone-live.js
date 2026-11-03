// @ts-check
// The Hollow, live (H3a; docs/future/16-the-sea-cave.md, The arch, The Hollow, The lantern; docs/26-zones.md):
// a zone of seeded floors below the stack's arch. With a weapon made and the old lantern on its hook,
// the arch's card offers Go through: a trip begins. Each floor comes from H1's floor maker
// (floor.js makeFloor), seeded by the island, the trip's number and the floor's place in the trip,
// built across the workers while the screen is dark (the fade waits for it). You land in its way in,
// under a rope from the roof (the way up); its way down is a shaft in the floor with a rope staked
// beside it, whose card says what is left in the lantern, in words. The walker's lantern is the only
// light, and it is fuel and health in one: it burns down (a little faster each floor down), a hit
// costs a sip (hit, for H3b), and when it runs low the light shrinks and the walker says so. When it
// goes out, the screen goes dark, you feel your way up, and wake low on the floor by the hook in the mouth and get up; a
// seeded third of what this trip found is dropped. The way up brings you back by the hook keeping
// everything. Saved (the store slice `hollow`, trip.js): only the trip count and the deepest floor;
// being below is never saved and nothing down here simulates while away. Publishes the store slice
// `hollowTrip` ({ share, low, gutter, out } or null) for the HUD's flame. Numbers and words:
// recipes/world/hollow.json zone and trip.

import * as clock from '../../core/clock.js';
import { get, update } from '../../core/store.js';
import { emitDeferred, on } from '../../core/events.js';
import { hash32 } from '../../core/rng.js';
import { dispatch, onAction } from '../../input/actions.js';
import { registerCardAction } from '../../ui/card-actions.js';
import { cleanCook } from '../camp/making.js';
import { kelvinRgb, flicker } from '../camp/light.js';
import { lathe, tube, lumpStone, join } from '../spring/cave-live.js';
import { addFirst } from '../trails.js';
import { nearestOpen } from '../walk/path.js';
import { makeFloor } from './floor.js';
import { hollowRules } from './walk-grid.js';
import { cleanHollow, floorInputs, burn, sip, fuelWord, lightShare, dropInTheDark } from './trip.js';

const ID = 'hollow';

/**
 * @typedef {Object} Trip
 * @property {number} n       its number (the saved trip count once begun)
 * @property {number} floor   the floor you are on (1 the first)
 * @property {number} fuel    the lantern's fuel left
 * @property {any[]} finds    what this trip has found (H3c fills it; dropped in part if the light goes out)
 * @property {boolean} lowSaid
 * @property {number} gutter  seconds left of the flame's gutter after a hit
 * @property {number | null} outT  seconds since the light went out, or null while it burns
 */

/**
 * @param {{ H: any, seed: number, walk: any, zones: any, pass: ReturnType<typeof import('../../render/passes/hollow.js').createHollowPass>,
 *   run: (job: { module: string, fn: string }, args: any, opts?: any) => Promise<any>, mouth: any, stackMouthId: string }} o
 *   H: recipes/world/hollow.json; run: src/core/workers.js run; mouth: the stack's mouth room (createStackMouth)
 */
export function createHollowZone(o) {
  const H = o.H, Z = H.zone, T = H.trip, W = Z.words, F = H.floors;
  const saved = () => cleanHollow(get('hollow'));
  const flags = () => get('journal')?.flags ?? [];
  /** @param {string} f */
  const flag = (f) => { if (get('journal') && !flags().includes(f)) dispatch(/** @type {any} */ ({ type: 'journal.flag', flag: f })); };
  const notice = (/** @type {string} */ text, showS = 6) => emitDeferred('island:notice', { text, showS });
  const hasWeapon = () => { const tools = cleanCook(get('cook')).tools; return Z.weapons.some((/** @type {string} */ w) => tools.includes(w)); };
  const lampHung = () => get('stack')?.lantern === 'hung';

  /** @type {Trip | null} */ let trip = null;
  /** The floor being made (a promise), and the one made, waiting to be walked into. */
  let building = false;
  /** @type {any} */ let made = null;
  /** The floor you are on: what the walk, the cards and the light read. @type {any} */ let here = null;
  /** Where the lantern's grip is in your hand, and its flame (world). @type {number[] | null} */ let flameAt = null;
  /** A test trip waiting for its first floor. */
  let testWait = false;

  function publish() {
    update('hollowTrip', () => trip ? { share: Math.max(0, trip.fuel / T.fuel), low: trip.fuel < T.fuel * T.lowShare, gutter: trip.gutter > 0 || trip.outT !== null, out: trip.outT !== null } : null);
  }

  /** Make a floor of this trip across the workers; the fade waits on it. @param {number} floor */
  function build(floor) {
    if (!trip) return;
    building = true; made = null;
    const n = trip.n;
    makeFloor(floorInputs(o.seed, n, floor), F, { run: o.run, keepField: true }).then((f) => {
      if (trip?.n === n) made = f;
      building = false;
    }).catch((err) => { building = false; console.error('ebb: a Hollow floor did not build', err); });
  }

  // ---- a floor: its ground, its markers, its meshes ----

  /** Where you may walk on a floor: its grid's floor, eased between cells; a wall where there is none. @param {any} g */
  function groundOf(g) {
    const open = (/** @type {number} */ k) => k >= 0 && g.floor[k] && !g.steep[k];
    return (/** @type {number} */ x, /** @type {number} */ z) => {
      const k = g.cellAt(x, z);
      if (!open(k)) {
        // A wall: well over the nearest floor round it, so the walk's own grid shuts it.
        let top = -Infinity;
        const i = Math.floor((x - g.minX) / g.cellM), j = Math.floor((z - g.minZ) / g.cellM);
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const q = g.cellAt(g.minX + (i + di + 0.5) * g.cellM, g.minZ + (j + dj + 0.5) * g.cellM); if (q >= 0 && g.floor[q]) top = Math.max(top, g.height[q]); }
        return (top > -Infinity ? top : 0) + 3;
      }
      const fx = (x - g.minX) / g.cellM - 0.5, fz = (z - g.minZ) / g.cellM - 0.5, i0 = Math.floor(fx), j0 = Math.floor(fz), tx = fx - i0, tz = fz - j0;
      let sum = 0, wsum = 0;
      for (let c = 0; c < 4; c++) {
        const di = c & 1, dj = c >> 1, i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= g.w || j >= g.h) continue;
        const q = j * g.w + i;
        if (!open(q) || Math.abs(g.height[q] - g.height[k]) > F.walk.maxStepM) continue;
        const w = (di ? tx : 1 - tx) * (dj ? tz : 1 - tz);
        sum += g.height[q] * w; wsum += w;
      }
      return wsum > 1e-6 ? sum / wsum : g.height[k];
    };
  }

  /** The floor's rock, its standing water, the way up and the way down, handed to the pass. @param {any} f */
  function show(f) {
    const g = f.grid, plan = f.plan, look = Z.look[plan.depthId] ?? Z.look.shelf, r = hollowRules(g, F.walk);
    // The nearest open, dry cell (never standing in a puddle), else the nearest open one.
    const dryNear = (/** @type {number} */ x, /** @type {number} */ z) => {
      const ci = Math.floor((x - g.minX) / g.cellM), cj = Math.floor((z - g.minZ) / g.cellM), reach = Math.ceil(4 / g.cellM);
      let best = -1, bestD = Infinity;
      for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
        const i = ci + di, j = cj + dj, q = j * g.w + i, d = di * di + dj * dj;
        if (i < 0 || j < 0 || i >= g.w || j >= g.h || d >= bestD || !g.floor[q] || g.steep[q] || g.water[q] > 0.02) continue;
        best = q; bestD = d;
      }
      return best >= 0 ? best : nearestOpen(g, r, x, z, 4);
    };
    const spot = (/** @type {number} */ x, /** @type {number} */ z) => {
      const k = dryNear(x, z);
      const [cx, cz] = k >= 0 ? g.center(k) : [x, z];
      return { x: cx, z: cz, y: k >= 0 ? g.height[k] : 0, room: k >= 0 ? g.room[k] : 3 };
    };
    const wayIn = plan.chambers[0], wayDown = plan.chambers.find((/** @type {any} */ c) => c.kind === 'down') ?? plan.chambers[plan.chambers.length - 1];
    const up = spot(wayIn.x, wayIn.z), down = spot(wayDown.x, wayDown.z);
    // Arrive a little off the rope, toward the chamber's first door, facing it.
    const door = wayIn.doors[0] ?? { x: wayIn.x + 1, z: wayIn.z };
    let dx = door.x - up.x, dz = door.z - up.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const at = spot(up.x + dx * Z.arriveM, up.z + dz * Z.arriveM);
    // The rock: wet near standing water (vertex colour r), drawn as rock (alpha 0).
    const V = f.mesh.vertices, nv = V.length / 6, rock = new Float32Array(nv * 10), wet = f.dressed.chambers.filter((/** @type {any} */ c) => c.waterY > -Infinity);
    for (let v = 0; v < nv; v++) {
      const x = V[v * 6], y = V[v * 6 + 1], z = V[v * 6 + 2];
      let w = 0;
      for (const c of wet) if (Math.hypot(x - c.x, z - c.z) < c.reach) w = Math.max(w, 1 - Math.min(1, Math.max(0, (y - c.waterY) / Z.look.wetNearM)));
      rock.set([x, y, z, V[v * 6 + 3], V[v * 6 + 4], V[v * 6 + 5], w, 0, 0, 0], v * 10);
    }
    o.pass.setMesh('rock', { data: rock, idx: f.mesh.indices });
    // The water: a still sheet over each chamber that holds some, drawn a little under its level so
    // the flagstones' shallow dips stay dry and the puddles and channels fill; the shader leaves it out
    // wherever it lies inside the rock (beyond the walls, seen with the roof cut away).
    /** @type {number[]} */ const wd = [], wi = [];
    const A = Z.look.water.albedo, n = 48;
    for (const c of wet) {
      const y = c.waterY - Z.look.waterDropM, b = wd.length / 10;
      wd.push(c.x, y, c.z, 0, 1, 0, A[0], A[1], A[2], 3);
      for (let i = 0; i <= n; i++) { const t = (i / n) * 2 * Math.PI; wd.push(c.x + Math.cos(t) * c.reach, y, c.z + Math.sin(t) * c.reach, 0, 1, 0, A[0], A[1], A[2], 3); }
      for (let i = 1; i <= n; i++) wi.push(b, b + i, b + i + 1);
    }
    o.pass.setMesh('water', { data: new Float32Array(wd), idx: new Uint32Array(wi) });
    o.pass.setMesh('things', markers(up, down, plan.inputs.trip * 31 + plan.inputs.floor));
    o.pass.setField(/** @type {Float32Array} */ (f.field), f.bounds.n);
    here = { f, plan, look, up, down, at, yaw: Math.atan2(dx, dz), ground: groundOf(g), seed: plan.inputs };
  }

  /** The way up's rope and the way down's shaft, stones, stake and rope, as made things. @param {any} up @param {any} down @param {number} s */
  function markers(up, down, s) {
    const M = Z.markers, u = (/** @type {number} */ i, /** @type {number} */ k) => (hash32(s, 977, i, k) >>> 8) / 16777216, parts = [];
    // The rope: from a crack in the roof down to a coil on the floor, swaying a little out of true.
    const top = up.y + Math.min(up.room, 6);
    parts.push(tube([[up.x, top, up.z], [up.x + 0.04, (top + up.y) / 2, up.z + 0.03], [up.x + 0.02, up.y + 0.25, up.z - 0.02], [up.x + 0.12, up.y + 0.03, up.z + 0.1]], M.ropeRadiusM, 6, M.rope));
    for (let i = 0; i < 4; i++) parts.push(tube([[up.x + 0.02, up.y + 0.7 + i * 0.45, up.z - 0.02], [up.x + 0.02, up.y + 0.78 + i * 0.45, up.z - 0.02]], M.ropeRadiusM * 1.9, 6, M.rope));
    // The shaft: a dark disc in the floor, ringed with stones.
    const R = M.holeRadiusM, n = 28, hd = [down.x, down.y + 0.015, down.z, 0, 1, 0, ...M.hole, 1], hi = [];
    for (let i = 0; i <= n; i++) { const t = (i / n) * Math.PI * 2; hd.push(down.x + Math.cos(t) * R, down.y + 0.015, down.z + Math.sin(t) * R, 0, 1, 0, ...M.hole, 1); }
    for (let i = 1; i <= n; i++) hi.push(0, i, i + 1);
    parts.push({ data: hd, idx: hi });
    for (let i = 0; i < M.stones; i++) {
      const a = (i / M.stones) * Math.PI * 2 + u(i, 1) * 0.4, rr = R + 0.12 + u(i, 2) * 0.1;
      parts.push(lumpStone(down.x + Math.cos(a) * rr, down.y - 0.04, down.z + Math.sin(a) * rr, 0.12 + u(i, 3) * 0.08, (k) => u(i, k + 4), 0.25, M.stone));
    }
    // The stake beside it, and its rope over the lip and down into the dark.
    const sx = down.x + R + 0.45, sz = down.z;
    parts.push(tube([[sx, down.y - 0.1, sz], [sx, down.y + 0.55, sz]], 0.045, 6, M.stake));
    parts.push(tube([[sx, down.y + 0.45, sz], [down.x + R * 0.9, down.y + 0.06, sz], [down.x + R * 0.6, down.y - 1.5, sz]], M.ropeRadiusM, 6, M.rope));
    const all = join(parts);
    return { data: all.data, idx: all.idx };
  }

  /**
   * The lantern you carry, made hanging from its grip at the origin: the bail's wire up to your hand,
   * the body below it (alpha 4 its body, 5 its glass: the pass hangs it in your hand each frame).
   */
  function lanternMesh() {
    const M = Z.markers, H2 = Z.light.lantern, r = H2.radiusM, h = H2.heightM, top = -H2.bailM;
    const m = lathe([[0, 0], [r, 0], [r, h * 0.08], [r * 0.9, h * 0.1], [r * 0.9, h * 0.7], [r, h * 0.72], [r * 0.6, h * 0.9], [r * 0.2, h], [0, h]],
      10, M.lantern, [null, null, null, M.glass, M.glass, null, null, null, null]);
    for (let i = 0; i < m.data.length; i += 10) {
      const glass = m.data[i + 6] === M.glass[0] && m.data[i + 7] === M.glass[1] && m.data[i + 8] === M.glass[2];
      m.data[i + 1] += top - h;
      m.data[i + 9] = glass ? 5 : 4;
    }
    // The bail: a wire hoop from either side of the cap up to the grip, and the ring where it is held.
    const bail = tube([[-r * 0.85, top - h * 0.12, 0], [-r * 0.7, top + H2.bailM * 0.55, 0], [0, -0.004, 0], [r * 0.7, top + H2.bailM * 0.55, 0], [r * 0.85, top - h * 0.12, 0]], 0.004, 4, M.lantern);
    for (let i = 0; i < bail.data.length; i += 10) bail.data[i + 9] = 4;
    const all = join([m, bail]);
    return { data: all.data, idx: all.idx };
  }
  o.pass.setMesh('lantern', lanternMesh());

  /** Into the floor made: the walk on its ground and the floor's own walk grid, the Hollow's camera, standing in the way in. */
  function walkIn() {
    if (!made) return false;
    show(made);
    made = null;
    const g = here.f.grid;
    return o.walk.enterZone({ id: ID, ground: here.ground, water: (/** @type {number} */ x, /** @type {number} */ z) => { const k = g.cellAt(x, z); return k >= 0 ? g.water[k] : 0; },
      bounds: [g.minX, g.minZ, g.minX + g.w * g.cellM, g.minZ + g.h * g.cellM], cellM: F.walk.cellM, grid: g,
      at: { x: here.at.x, z: here.at.z, yaw: here.yaw, viewYaw: here.yaw + Math.PI }, camera: H.camera });
  }

  const enter = () => {
    if (!trip || !walkIn()) return false;
    if (trip.floor === 1) notice(W.through);
    record();
    publish();
    return true;
  };
  /** The next floor, with the screen dark (zones.again): out of the last one's walk and into this one's. */
  const again = () => {
    if (!trip) return;
    o.walk.leaveZone(null);
    if (!walkIn()) { console.error('ebb: nowhere to stand on the next floor'); return; }
    record();
  };
  /** Leaving the Hollow (the way up, or the light gone): the trip ends here. */
  const leave = () => {
    o.walk.leaveZone(null);
    here = null; flameAt = null;
    if (trip?.outT !== null && trip) {
      // A seeded third of this trip's finds is dropped in the dark (none yet: H3c fills the list).
      const { kept } = dropInTheDark(trip.finds, o.seed, trip.n, T.dropShare);
      trip.finds = kept;
    }
    trip = null;
    publish();
  };
  /** The deepest floor any trip has reached. */
  function record() {
    if (!trip) return;
    const s = saved();
    if (trip.floor > s.deepest) update('hollow', () => ({ ...s, deepest: trip ? trip.floor : s.deepest }));
  }

  // ---- a trip ----

  /** Through the arch: a new trip, its first floor made while the screen goes dark. @param {{ floor?: number, fuel?: number }} [test] */
  function begin(test) {
    if (trip || o.zones.busy()) return false;
    const s = saved(), n = s.trips + 1;
    update('hollow', () => ({ ...s, trips: n }));
    trip = { n, floor: test?.floor ?? 1, fuel: test?.fuel ?? T.fuel, finds: [], lowSaid: false, gutter: 0, outT: null };
    flag('setpiece:stack:through');
    update('unlocks', (u) => addFirst(u ?? {}, { trail: 'lamp', kind: 'arch', id: 'through', hour: Math.floor(clock.worldT() / clock.SECONDS_PER_HOUR) }));
    build(trip.floor);
    return true;
  }
  function goThrough() {
    if (o.walk.zone !== o.stackMouthId || !hasWeapon() || !lampHung()) return;
    update('identify', () => null);
    if (begin()) o.zones.go(ID);
  }
  function goDown() {
    if (!trip || o.walk.zone !== ID || trip.outT !== null || o.zones.busy()) return;
    update('identify', () => null);
    trip.floor++;
    build(trip.floor);
    o.zones.again();
  }
  function climbUp() {
    if (!trip || o.walk.zone !== ID || o.zones.busy()) return false;
    update('identify', () => null);
    o.mouth.arriveByHook?.({ wake: false, line: W.up });
    o.zones.go(o.stackMouthId);
    return true;
  }
  /** A hit, or a move that spends fuel (H3b): n sips, and the flame gutters. @param {number} [n] */
  function hit(n = 1) {
    if (!trip || trip.outT !== null) return;
    trip.fuel = sip(trip.fuel, T, n);
    trip.gutter = T.gutterHitS;
    publish();
  }

  function tick(/** @type {number} */ dt) {
    if (!trip || !here || o.zones.busy()) return;
    if (trip.gutter > 0) trip.gutter = Math.max(0, trip.gutter - dt);
    if (trip.outT !== null) {
      trip.outT += dt;
      // The flame gone: a moment's dark, then the long dark of feeling the way up.
      if (trip.outT >= T.gutterS) {
        o.mouth.arriveByHook?.({ wake: true, line: W.wake });
        notice(W.dark, T.darkS + 1.5);
        o.zones.go(o.stackMouthId, { holdS: T.darkS });
      }
      publish();
      return;
    }
    const b = burn(trip.fuel, dt, T, trip.floor);
    trip.fuel = b.fuel;
    // Low (crossing the line, or already under it when the trip began): said once.
    if (!trip.lowSaid && (b.low || trip.fuel < T.fuel * T.lowShare)) { trip.lowSaid = true; notice(W.low); }
    if (b.out || trip.fuel <= 0) { trip.outT = 0; o.walk.gesture?.('stuck'); }
    publish();
  }

  // ---- cards ----

  const base = { noPage: true, stage: -1, sub: null, canCarry: false };
  const upCard = () => ({ ...base, sp: 'hollow:up', hollowUp: true, name: W.wayUpName, icon: 'ropeup', text: W.wayUp, wx: here.up.x, wz: here.up.z, r: 0.4, reachR: Z.reachM });
  const downCard = () => ({ ...base, sp: 'hollow:down', hollowDown: true, name: W.wayDownName, icon: 'shaftdown',
    text: `${W.wayDown} ${W.left.replace('{left}', fuelWord(trip ? trip.fuel / T.fuel : 0, T))}`, wx: here.down.x, wz: here.down.z, r: 0.6, reachR: Z.reachM + Z.markers.holeRadiusM });
  /** @param {number} x @param {number} z */
  function cardAt(x, z) {
    if (o.walk.zone !== ID || !here) return null;
    if (Math.hypot(x - here.up.x, z - here.up.z) < Z.tapM) return upCard();
    if (Math.hypot(x - here.down.x, z - here.down.z) < Z.tapM + Z.markers.holeRadiusM) return downCard();
    return null;
  }
  /** The rope picked out along a tap's ray, high on it or low. @param {number[]} ro @param {number[]} rd */
  function rayCard(ro, rd) {
    if (o.walk.zone !== ID || !here) return null;
    const u = here.up, top = u.y + Math.min(u.room, 6);
    for (let t = 0.2; t < 30; t += 0.05) {
      const y = ro[1] + rd[1] * t;
      if (y < u.y || y > top) continue;
      if (Math.hypot(ro[0] + rd[0] * t - u.x, ro[2] + rd[2] * t - u.z) < 0.25) return upCard();
    }
    return null;
  }
  /** Where a ray meets the floor (a click), or null. @param {number[]} ro @param {number[]} rd */
  function groundAt(ro, rd) {
    if (!here) return null;
    const g = here.f.grid;
    for (let t = 0.1; t < 40; t += 0.05) {
      const x = ro[0] + rd[0] * t, y = ro[1] + rd[1] * t, z = ro[2] + rd[2] * t, k = g.cellAt(x, z);
      if (k < 0 || !g.floor[k]) continue;
      const fy = g.height[k];
      if (y <= fy && y > fy - 0.6) return [x, fy, z];
    }
    return null;
  }
  /** The floor under a point, for the view (none where there is only rock). @param {number} x @param {number} z */
  function floor(x, z) {
    if (!here) return -Infinity;
    const g = here.f.grid, k = g.cellAt(x, z);
    return k >= 0 && g.floor[k] ? g.height[k] : -Infinity;
  }

  // ---- light ----

  const rgb = kelvinRgb(Z.light.lightK);
  /**
   * This frame's light (HollowUniforms, hollow-draw.wgsl): the lantern at your left hand, its candela
   * shrinking as the fuel runs low and gone when it goes out; and the walker lit by it as the frame's sun.
   * @param {{ time: number }} d
   */
  function light(d) {
    const L = Z.light, wk = o.walk.walker, look = here?.look ?? Z.look.shelf, f = here?.f;
    const chest = [wk?.x ?? 0, (wk?.y ?? 0) + 1.0, wk?.z ?? 0];
    // The lantern hangs by its bail from your left hand (its grip a little under the wrist), its
    // flame inside it: the light goes wherever the hand goes, so the two never part.
    const hand = o.walk.hand?.('l'), yaw = hand?.yaw ?? wk?.yaw ?? 0, H2 = L.lantern;
    const grip = hand ? [hand.x, hand.y - H2.gripDropM, hand.z] : [chest[0] + 0.3 * Math.cos(yaw), chest[1] - 0.2, chest[2] - 0.3 * Math.sin(yaw)];
    flameAt = [grip[0], grip[1] - H2.bailM - H2.heightM * 0.55, grip[2]];
    const share = trip ? trip.fuel / T.fuel : 1, outK = trip?.outT != null ? Math.max(0, 1 - trip.outT / T.gutterS) ** 2 : 1;
    const gut = trip && trip.gutter > 0 ? 0.55 + 0.45 * flicker(d.time * 3, 0.9, 6, 41) : 1;
    const k = lightShare(share, T) * outK * gut * flicker(d.time, L.flicker, L.flickerHz, 29);
    const cd = rgb.map((v) => v * L.cd * k);
    const B = f?.bounds;
    const uniforms = [
      ...flameAt, k > 0 ? L.glassNits * k : 0,
      ...cd, L.softK,
      ...look.rock, look.roughness,
      ...look.floor, Z.look.wetNearM,
      ...Z.look.wetRock, Z.look.wetRoughness,
      L.bounce * 0.004, L.scatter, Z.look.water.f0, d.time,
      ...(B ? B.min : [0, 0, 0]), B ? B.cellM : 1,
      ...(B ? B.n : [1, 1, 1]), L.steps,
      ...chest, Z.fade.radiusM,
      H.camera.fade.fillAlpha, H.camera.fade.outlineAlpha, Z.fade.veilNits, L.minNits,
      ...Z.look.water.albedo, f ? 1 : 0,
      ...grip, yaw,
    ];
    const lx = flameAt[0] - chest[0], ly = flameAt[1] - chest[1], lz = flameAt[2] - chest[2], ll = Math.hypot(lx, ly, lz) || 1;
    const dd = Math.max(ll, L.figureLampMinM), e = cd.map((v) => v / (dd * dd));
    return { uniforms, sunDir: [lx / ll, ly / ll, lz / ll], sunIlluminance: e, ambient: e.map((v) => (v * L.figureFill * 0.1) / Math.PI + L.minNits) };
  }
  const sound = () => ({ under: 1, near: { waterNear: { still: 0, slow: 0, running: 0 }, surfaceNear: { water: 0, pads: 0, reeds: 0, grass: 0 }, falls: [] } });

  const offs = [
    registerCardAction({ id: 'hollowthrough', icon: 'cavemouth', order: 9, main: true, label: W.goThrough,
      when: (c) => c?.sp === 'stack:arch' && o.walk.zone === o.stackMouthId && hasWeapon() && lampHung(), action: () => ({ type: 'hollow.through' }) }),
    registerCardAction({ id: 'hollowup', icon: 'ropeup', order: 9, main: true, label: W.climbUp,
      when: (c) => !!c?.hollowUp && o.walk.zone === ID, action: () => ({ type: 'hollow.up' }) }),
    registerCardAction({ id: 'hollowdown', icon: 'shaftdown', order: 9, main: true, label: W.goDown,
      when: (c) => !!c?.hollowDown && o.walk.zone === ID && !!trip && trip.outT === null, action: () => ({ type: 'hollow.down' }) }),
    onAction((/** @type {any} */ a) => {
      if (a.type === 'hollow.through') goThrough();
      else if (a.type === 'hollow.up') climbUp();
      else if (a.type === 'hollow.down') goDown();
    }),
    on('zone:left', (/** @type {any} */ p) => { if (p?.id === ID) publish(); }),
  ];

  o.zones.register({ id: ID, enter, leave, again, tick, cardAt, rayCard, light, sound, groundAt, floor, pass: o.pass,
    viewRoom: () => Infinity, pending: () => building, up: () => climbUp(), exposureBiasEV: Z.light.exposureBiasEV });

  return {
    id: ID,
    /** The arch's line once seen: ready with a weapon and the old lantern hung, the lantern first without it, else null (empty hands). */
    archLine: () => (hasWeapon() ? (lampHung() ? W.ready : W.needLamp) : null),
    hit,
    /** Straight into a trip (the test links): floor and fuel as given, with no fade. @param {{ floor?: number, fuel?: number }} t */
    test(t) { if (begin(t)) testWait = true; },
    /** Each frame from the sim: a test trip goes in once its floor is made. */
    prepare() { if (testWait && made && !building) { testWait = false; o.zones.goNow(ID); } },
    get trip() { return trip; },
    get floorNow() { return here?.f ?? null; },
    debug: { get here() { return here; }, get building() { return building; }, pass: o.pass },
    dispose() { for (const off of offs) off(); },
  };
}
