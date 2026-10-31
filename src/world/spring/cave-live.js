// @ts-check
// The spring's cave, live (the spring-ore plan, O3): the island's first zone (src/world/zones). Under
// the hole where the ground gave way above the spring lies a small cave round the pool that feeds
// it. Climb down on the hole's card fades you down into it; the rope's card (or Go up) climbs back.
// Its shape is seeded (cave-field.js), meshed once in a worker the first time it is needed; its
// light is the hole's (cave-draw.wgsl); its sound bed is the trickle with the island's beds gone
// quiet. The old keeper's pan lies by the pool: Pan the pool is a calm kneel, a few pans a game day
// (pan.js), each turning up iron ore, copper ore or only gravel, seeded so time away never changes
// it. The pans are kept in the dig section's spring record. Numbers: recipes/world/spring-cave.json.

import { get, update } from '../../core/store.js';
import { emitDeferred, emit } from '../../core/events.js';
import { subSeed, hash32 as hashOf } from '../../core/rng.js';
import { run } from '../../core/workers.js';
import { dispatch, onAction } from '../../input/actions.js';
import { registerCardAction } from '../../ui/card-actions.js';
import { rayToSegment } from '../creatures/perch-rules.js';
import { cleanCook, recordMade } from '../camp/making.js';
import { caveShape } from './cave-field.js';
import { cleanPans, pansLeft, panFind, panned, keeperDue, panKeepsake } from './pan.js';
import { springNumbers } from '../keepsakes/families/spring.js';
import { DAYS_PER_SEASON } from '../../core/clock.js';
import { cleanDig } from '../dig/rest.js';

const ID = 'spring-cave';

/**
 * A lathe round +y (the pan): profile [radius, height] pairs, n sides, both faces; VERT floats a
 * vertex with an albedo. @param {number[][]} prof @param {number} n @param {number[]} col
 */
function lathe(prof, n, col) {
  const data = [], idx = [];
  for (let j = 0; j < prof.length; j++) {
    const [r, y] = prof[j], [r0, y0] = prof[Math.max(0, j - 1)], [r1, y1] = prof[Math.min(prof.length - 1, j + 1)];
    const tx = r1 - r0, ty = y1 - y0, l = Math.hypot(tx, ty) || 1;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      data.push(r * c, y, r * s, (-ty / l) * c, tx / l, (-ty / l) * s, col[0], col[1], col[2], 1);
    }
  }
  for (let j = 0; j < prof.length - 1; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + n + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return { data, idx };
}

/**
 * A tube along points (the rope), sides round, VERT floats a vertex. @param {number[][]} pts @param {number} r
 * @param {number} sides @param {number[]} col @param {number} [alpha] 1 for a made thing's own albedo
 */
function tube(pts, r, sides, col, alpha = 1) {
  const data = [], idx = [];
  for (let j = 0; j < pts.length; j++) {
    const p = pts[j], q = pts[Math.min(pts.length - 1, j + 1)], o = pts[Math.max(0, j - 1)];
    let tx = q[0] - o[0], ty = q[1] - o[1], tz = q[2] - o[2];
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    // A side vector across the tube, then the other.
    let ax = -tz, az = tx, ay = 0; const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
    if (Math.hypot(tx, tz) < 1e-3) { ax = 1; az = 0; }
    const bx = ty * az - tz * ay, by = tz * ax - tx * az, bz = tx * ay - ty * ax;
    const rr = Array.isArray(r) ? r[j] : r;
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const nx = ax * c + bx * s, ny = ay * c + by * s, nz = az * c + bz * s;
      data.push(p[0] + nx * rr, p[1] + ny * rr, p[2] + nz * rr, nx, ny, nz, col[0], col[1], col[2], alpha);
    }
  }
  for (let j = 0; j < pts.length - 1; j++) for (let i = 0; i < sides; i++) {
    const a = j * (sides + 1) + i, b = a + sides + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return { data, idx };
}

/** Several meshes in one. @param {{ data: number[], idx: number[] }[]} parts */
function join(parts) {
  const data = [], idx = [];
  for (const p of parts) { const base = data.length / 10; data.push(...p.data); for (const i of p.idx) idx.push(i + base); }
  return { data: new Float32Array(data), idx: new Uint32Array(idx) };
}

/**
 * @param {{ R: any, seed: number, dig: any, terrain: { sampleHeight: (x: number, z: number) => number }, walk: any, pack: any,
 *   pass: ReturnType<typeof import('../../render/passes/cave.js').createCavePass>, zones: any, hour: () => number, day: () => number,
 *   walkerCamera: any, K?: any }} o
 *   R: recipes/world/spring-cave.json; zones: src/world/zones/live.js; hour: game hours; day: the game day;
 *   walkerCamera: recipes/world/walker.json camera (the cave's view keeps closer); K: recipes/world/keepsakes.json
 *   (the pan's keepsakes, the pan finds)
 */
export function createSpringCave(o) {
  const R = o.R, W = R.words, S = R.shape, P = R.pan;
  const seed = subSeed(o.seed, 'spring-cave') ^ R.seed;
  const shape = caveShape(S, seed);
  const panSeed = subSeed(o.seed, 'spring-pan');

  /** Where the cave sits: under the hole, its floor depthM below the island's ground there. @type {{ x: number, y: number, z: number, top: number } | null} */
  let O = null;
  let built = false, building = false;
  function origin() {
    if (O) return O;
    const h = o.dig.springHole();
    if (!h) return null;
    const g = o.terrain.sampleHeight(h.x, h.z);
    O = { x: h.x, y: g - R.depthM, z: h.z, top: g };
    return O;
  }
  /** World to the cave's frame and back. */
  const lx = (/** @type {number} */ x) => x - (O?.x ?? 0), lz = (/** @type {number} */ z) => z - (O?.z ?? 0);
  /** The pan's place by the pool, toward the light (cave frame). */
  const panAt = (() => {
    const p = S.pool, dx = -p.at[0], dz = -p.at[1], l = Math.hypot(dx, dz) || 1, d = p.radiusM + P.fromPoolM;
    return { x: p.at[0] + (dx / l) * d + P.at[0], z: p.at[1] + (dz / l) * d + P.at[1] };
  })();
  /** Where you stand to pan: just back from the water's edge, by the pan. */
  const panStand = (() => {
    const p = S.pool, dx = panAt.x - p.at[0], dz = panAt.z - p.at[1], l = Math.hypot(dx, dz) || 1;
    return { x: panAt.x + (dx / l) * 0.25, z: panAt.z + (dz / l) * 0.25, yaw: Math.atan2(-dx, -dz) };
  })();

  /** The cave's floor (world height) under a point, high where the walls close in. @param {number} x @param {number} z */
  function ground(x, z) {
    const a = lx(x), b = lz(z), base = (O?.y ?? 0) + shape.floorAt(a, b);
    return shape.inside(a, b) > R.walk.wallM ? base : base + 3;
  }
  /** Water over the floor (m). @param {number} x @param {number} z */
  const water = (x, z) => (shape.inside(lx(x), lz(z)) > 0 ? shape.poolDepth(lx(x), lz(z)) : 0);

  // ---- the meshes ----

  /** The rock, meshed in a worker the first time, then the pool, the beam and the made things. */
  function build() {
    const at = origin();
    if (!at || built || building) return;
    building = true;
    run({ module: './world/spring/cave-field.js', fn: 'caveMeshJob' }, { S, seed, top: R.depthM }, { lane: 'interactive' }).then((m) => {
      const v = new Float32Array(m.count * 10);
      for (let i = 0; i < m.count; i++) {
        v.set([m.pos[i * 3] + at.x, m.pos[i * 3 + 1] + at.y, m.pos[i * 3 + 2] + at.z, m.nrm[i * 3], m.nrm[i * 3 + 1], m.nrm[i * 3 + 2], 0, 0, 0, 0], i * 10);
      }
      o.pass.setMesh('rock', { data: v, idx: m.idx });
      built = true;
      building = false;
      emitDeferred('spring:cave-built', { verts: m.count });
    }).catch((err) => { building = false; console.error('ebb: the spring cave did not build', err); });
    // The pool's surface: a disc at the water's level, drawn where it is over the stones.
    const p = S.pool, wl = at.y + p.levelM, n = 40, wd = [at.x + p.at[0], wl, at.z + p.at[1], 0, 1, 0, 0, 0, 0, 0], wi = [];
    for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; wd.push(at.x + p.at[0] + Math.cos(a) * p.radiusM * 1.1, wl, at.z + p.at[1] + Math.sin(a) * p.radiusM * 1.1, 0, 1, 0, 0, 0, 0, 0); }
    for (let i = 1; i <= n; i++) wi.push(0, i, i + 1);
    o.pass.setMesh('water', { data: new Float32Array(wd), idx: new Uint32Array(wi) });
    // The beam: a widening cone from the hole down to the floor under it.
    const top = at.top, foot = at.y + shape.floorAt(0, 0) + 0.05, r0 = R.light.holeRadiusM, r1 = r0 * (R.light.beam.spread ?? 1.2);
    const beam = tube([[at.x, top, at.z], [at.x, (top + foot) / 2, at.z], [at.x, foot, at.z]], /** @type {any} */ ([r0, (r0 + r1) / 2, r1]), 28, [0, 0, 0], 0);
    o.pass.setMesh('beam', { data: new Float32Array(beam.data), idx: new Uint32Array(beam.idx) });
    things(null);
  }

  let thingsKey = '';
  /** The made things: the rope down from the hole, and the pan, lying by the pool or in your hands. @param {{ x: number, y: number, z: number, tilt: number } | null} held */
  function things(held) {
    const at = origin();
    if (!at) return;
    const key = (held ? held.x.toFixed(2) + held.y.toFixed(2) + held.z.toFixed(2) + held.tilt.toFixed(2) : hasPan() ? 'kit' : 'lying') + (shrimpT > 0 ? `s${Math.round(shrimpT * 30)}` : '');
    if (key === thingsKey) return;
    thingsKey = key;
    const L = R.look, r = P.radiusM, rim = P.rimM;
    const pan = lathe([[0, 0], [r * 0.55, 0.008], [r * 0.85, rim * 0.6], [r, rim], [r * 1.04, rim * 1.05]], 28, L.pan);
    const px = held ? held.x : at.x + panAt.x, pz = held ? held.z : at.z + panAt.z, py = held ? held.y : at.y + shape.floorAt(panAt.x, panAt.z) + 0.01;
    const tilt = held ? held.tilt : 0.12, ct = Math.cos(tilt), st = Math.sin(tilt);
    for (let i = 0; i < pan.data.length; i += 10) {
      const x = pan.data[i], y = pan.data[i + 1], nx = pan.data[i + 3], ny = pan.data[i + 4];
      pan.data[i] = px + x * ct - y * st; pan.data[i + 1] = py + x * st + y * ct; pan.data[i + 2] += pz;
      pan.data[i + 3] = nx * ct - ny * st; pan.data[i + 4] = nx * st + ny * ct;
    }
    // The rope, from the hole's lip down to its foot, sagging a little.
    const fx = at.x + R.rope.at[0], fz = at.z + R.rope.at[1], fy = at.y + shape.floorAt(R.rope.at[0], R.rope.at[1]) + 0.02;
    const pts = [];
    for (let k = 0; k <= 12; k++) { const t = k / 12; pts.push([at.x + (fx - at.x) * t + Math.sin(t * Math.PI) * 0.04, at.top + 0.05 + (fy - at.top - 0.05) * t, at.z + (fz - at.z) * t]); }
    pts.push([fx + 0.12, fy, fz + 0.05], [fx + 0.2, fy, fz - 0.06]);
    const rope = tube(pts, R.rope.radiusM, 6, L.rope);
    // The well shrimp in the lying pan: a tiny pale curl, flexing (cheap motion for a tiny creature,
    // the creature rule), until it is tipped back.
    const parts = [pan, rope, stones()];
    if (shrimpT > 0 && !held) {
      const t = shrimpT * 9, len = R.shrimp?.lengthM ?? 0.03, sp = [];
      for (let k = 0; k <= 7; k++) {
        const a = (k / 7 - 0.5) * (1.6 + 0.9 * Math.sin(t + k * 0.5));
        sp.push([px + Math.sin(a) * len, py + 0.012 + Math.cos(a) * len * 0.3 - len * 0.25, pz + (k / 7 - 0.5) * len * 0.6]);
      }
      parts.push(tube(sp, /** @type {any} */ ([0.002, 0.004, 0.005, 0.005, 0.0045, 0.004, 0.003, 0.0015]), 5, R.shrimp?.color ?? [0.7, 0.68, 0.62]));
    }
    // Taken into the kit, the pan is not by the pool any more (only in your hands while you pan).
    if (!held && hasPan()) parts.splice(parts.indexOf(pan), 1);
    o.pass.setMesh('things', join(parts));
  }

  /** @type {{ data: number[], idx: number[] } | null} */ let stoneMesh = null;
  /**
   * The loose stones (seeded): along the walls' foot and round the pool's edge, lumpy, each a small
   * sphere pushed in and out, sunk a little into the floor; never on the rope's foot, the pan or the
   * way from the rope to the pool.
   */
  function stones() {
    if (stoneMesh) return stoneMesh;
    const at = /** @type {NonNullable<typeof O>} */ (origin()), T = R.stones, parts = [];
    const u = (/** @type {number} */ i, /** @type {number} */ k) => (hashOf(T.seed, i, k) >>> 8) / 16777216;
    const foot = { x: R.rope.at[0], z: R.rope.at[1] };
    for (let i = 0, n = 0; i < T.count * 8 && n < T.count; i++) {
      // Half by the walls, half by the pool.
      let x, z;
      if (i % 2) { const a = u(i, 1) * Math.PI * 2, rr = S.pool.radiusM + 0.08 + u(i, 2) * 0.35; x = S.pool.at[0] + Math.cos(a) * rr; z = S.pool.at[1] + Math.sin(a) * rr; }
      else { x = S.centre[0] + (u(i, 1) - 0.5) * 2 * S.radiusM[0]; z = S.centre[1] + (u(i, 2) - 0.5) * 2 * S.radiusM[1]; const k = shape.inside(x, z); if (k < 0.1 || k > 0.6) continue; }
      if (shape.inside(x, z) < 0.05 || shape.poolDepth(x, z) > 0.02) continue;
      if (Math.hypot(x - foot.x, z - foot.z) < 0.5 || Math.hypot(x - panAt.x, z - panAt.z) < 0.35) continue;
      // The way from the rope to the pool stays clear.
      const ax = S.pool.at[0] - foot.x, az = S.pool.at[1] - foot.z, al = Math.hypot(ax, az), t = Math.max(0, Math.min(1, ((x - foot.x) * ax + (z - foot.z) * az) / (al * al)));
      if (Math.hypot(x - (foot.x + ax * t), z - (foot.z + az * t)) < 0.4) continue;
      const size = T.sizeM[0] + (T.sizeM[1] - T.sizeM[0]) * u(i, 3) ** 2, r = size / 2, y0 = at.y + shape.floorAt(x, z);
      const sph = [], sidx = [], LAT = 5, LON = 8;
      for (let a = 0; a <= LAT; a++) for (let b = 0; b <= LON; b++) {
        const th = (a / LAT) * Math.PI, ph = (b / LON) * Math.PI * 2;
        const k = 1 + T.lump * (Math.sin(2 * ph + u(i, 4) * 6) * Math.sin(th) * 0.6 + Math.cos(3 * th + u(i, 5) * 6) * 0.4);
        const nx = Math.sin(th) * Math.cos(ph), ny = Math.cos(th), nz = Math.sin(th) * Math.sin(ph);
        sph.push(at.x + x + nx * r * k, y0 + r * 0.55 + ny * r * 0.65 * k, at.z + z + nz * r * k * (0.8 + u(i, 6) * 0.4), nx, ny, nz, T.albedo[0], T.albedo[1], T.albedo[2], 1);
      }
      for (let a = 0; a < LAT; a++) for (let b = 0; b < LON; b++) { const q = a * (LON + 1) + b; sidx.push(q, q + LON + 1, q + 1, q + 1, q + LON + 1, q + LON + 2); }
      parts.push({ data: sph, idx: sidx });
      n++;
    }
    const all = join(parts);
    stoneMesh = { data: Array.from(all.data), idx: Array.from(all.idx) };
    return stoneMesh;
  }

  // ---- going down and coming up ----

  const enter = () => {
    const at = origin();
    if (!at) return false;
    build();
    const foot = { x: at.x + R.rope.at[0], z: at.z + R.rope.at[1] };
    const p = S.pool, yaw = Math.atan2(at.x + p.at[0] - foot.x, at.z + p.at[1] - foot.z);
    const ok = o.walk.enterZone({ id: ID, ground, water, bounds: [at.x + S.boundsM[0], at.z + S.boundsM[2], at.x + S.boundsM[3], at.z + S.boundsM[5]], cellM: R.walk.cellM,
      at: { x: foot.x + Math.sin(yaw) * 0.45, z: foot.z + Math.cos(yaw) * 0.45, yaw }, camera: R.view.camera });
    if (!ok) return false;
    if (!(get('journal')?.flags ?? []).includes('setpiece:cairns:below')) dispatch(/** @type {any} */ ({ type: 'journal.flag', flag: 'setpiece:cairns:below' }));
    emitDeferred('island:notice', { text: W.below, showS: 6 });
    return true;
  };
  const leave = () => {
    panning = null;
    o.walk.leaveZone(null);
    emitDeferred('island:notice', { text: W.up, showS: 5 });
  };

  // ---- panning ----

  /** The pans kept in the dig section's spring record. */
  const pans = () => cleanPans(cleanDig(get('dig')).spring?.pans);
  /** @type {{ t: number } | null} */ let panning = null;
  /** Is the old keeper's pan in your kit (taken from beside the pool; the cook section's tools)? */
  const hasPan = () => cleanCook(get('cook')).tools.includes('keepers-pan');
  /** Take the pan from beside the pool: it hangs on your pack from now on (the Keeper book's belt). */
  function takePan() {
    const at = origin();
    if (!at || hasPan() || o.walk.zone !== ID) return;
    o.walk.kneelToward(at.x + panAt.x, at.z + panAt.z, 1.2, 'takeUp');
    update('cook', (c) => recordMade(cleanCook(c), 'keepers-pan', o.hour(), true));
    update('identify', () => null);
    thingsKey = '';
    emitDeferred('island:notice', { text: W.tookPan, showS: 6 });
  }
  function pan() {
    const at = origin();
    if (!at || o.walk.zone !== ID || panning || o.walk.busy()) return;
    if (!hasPan()) { emitDeferred('island:notice', { text: W.needPan, showS: 5 }); return; }
    if (pansLeft(pans(), o.day(), o.hour(), P) <= 0) { emitDeferred('island:notice', { text: W.settled, showS: 6 }); return; }
    update('identify', () => null);
    const p = S.pool;
    o.walk.kneelToward(at.x + p.at[0], at.z + p.at[1], P.panS, 'gather');
    panning = { t: 0 };
  }
  /** The well shrimp in the pan, curling, until it is tipped back (live only). @type {number} */
  let shrimpT = 0;
  /**
   * What the pan turned up: an ore or an earth into the pack; a keepsake, or one of the old keeper's
   * lost things, on a card to keep (the dig's Keep and Leave); the well shrimp, curling in the pan
   * before you tip it back. Seeded by the island, the day and the pan's number (pan.js).
   */
  function panDone() {
    const c = pans(), day = o.day(), i = c.day === day ? c.n : 0, at = /** @type {NonNullable<typeof O>} */ (origin());
    const keeper = keeperDue(c.total, P);
    const find = keeper ? `keeper:${keeper}` : panFind(panSeed, day, i, c.total, P);
    let next = panned(c, day, o.hour());
    /** @type {any} */ let keep = null;
    if (find === 'keepsake' || keeper) {
      const season = Math.floor(day / DAYS_PER_SEASON), form = keeper ?? panKeepsake(panSeed, day, i, c, season, P);
      if (form === 'pearl') next = { ...next, pearl: season };
      if (form === 'gold') next = { ...next, gold: true };
      if (o.K?.spring?.[form]) keep = springNumbers(form, subSeed(panSeed, `${day}:${i}`), o.K);
    }
    update('dig', (d) => { const s = cleanDig(d); return s.spring ? { ...s, spring: { ...s.spring, pans: next } } : s; });
    let line = W.panned[find] ?? '';
    if (['iron-ore', 'copper-ore', 'ochre', 'mica'].includes(find)) {
      if (o.pack.room(find)) o.pack.add(find, 1);
      else { o.pack.heapHere?.(find, 1); line = W.full; }
    }
    if (find === 'shrimp') shrimpT = P.shrimpS;
    if (keeper) dispatch(/** @type {any} */ ({ type: 'journal.flag', flag: `setpiece:cairns:${keeper}` }));
    if (c.total === 0) {
      line = W.first;
      dispatch(/** @type {any} */ ({ type: 'journal.flag', flag: 'setpiece:cairns:panned' }));
    }
    emitDeferred('spring:panned', { find, day, i, hour: o.hour(), keepsake: keep?.form ?? null });
    if (keep) {
      // A thing to keep: its card, with the dig's Keep and Leave (src/world/dig keepIt, leaveIt).
      const p = { x: at.x + panAt.x, z: at.z + panAt.z };
      update('identify', () => ({ sp: 'spring:pool', name: keeper ? W.keeperName : W.keepsakeName, sub: null, icon: 'pan', text: `${keeper ? W.keeperLine : W.keepsakeLine} ${o.K.spring[keep.form].word}`,
        wx: p.x, wz: p.z, r: 0.3, stage: -1, dig: true, digKeepsake: keep, digHole: `pan:${day}:${i}`, canCarry: false, at: performance.now() }));
      return;
    }
    emit('island:notice', { text: line, showS: 6 });
  }

  // ---- cards ----

  const base = { noPage: true, stage: -1, sub: null, canCarry: false };
  const panCard = () => { const at = /** @type {NonNullable<typeof O>} */ (origin());
    return { ...base, sp: 'spring:pan', name: W.panName, icon: 'pan', itemIcon: 'keepers-pan', text: W.pan, wx: at.x + panAt.x, wz: at.z + panAt.z, r: 0.3, reachR: 0.55, springPan: true }; };
  const ropeCard = () => { const at = /** @type {NonNullable<typeof O>} */ (origin());
    return { ...base, sp: 'spring:rope', name: W.ropeName, icon: 'climbup', text: W.rope, wx: at.x + R.rope.at[0], wz: at.z + R.rope.at[1], r: 0.3, reachR: 0.8, springRope: true }; };
  /**
   * The card a tap's ray picks out down here before the floor: the rope (anywhere along it, a
   * generous reach) or the pan lying by the pool. @param {number[]} ro @param {number[]} rd
   */
  function rayCard(ro, rd) {
    const at = origin();
    if (!at || o.walk.zone !== ID) return null;
    const fy = at.y + shape.floorAt(R.rope.at[0], R.rope.at[1]);
    const rope = rayToSegment(ro, rd, [at.x + R.rope.at[0], fy, at.z + R.rope.at[1]], [at.x, at.top, at.z]);
    if (rope.d <= R.rope.tapM) return ropeCard();
    if (!hasPan() && !panning) {
      const px = at.x + panAt.x, pz = at.z + panAt.z, py = at.y + shape.floorAt(panAt.x, panAt.z);
      if (rayToSegment(ro, rd, [px, py, pz], [px, py + 0.06, pz]).d <= P.radiusM + 0.1) return panCard();
    }
    return null;
  }
  /** The card at a point down here: the pan, the rope, the pool. @param {number} x @param {number} z */
  function cardAt(x, z) {
    const at = origin();
    if (!at || o.walk.zone !== ID) return null;
    const a = lx(x), b = lz(z);
    if (!hasPan() && !panning && Math.hypot(a - panAt.x, b - panAt.z) < P.radiusM + 0.12) return panCard();
    if (Math.hypot(a - R.rope.at[0], b - R.rope.at[1]) < 0.4) return ropeCard();
    if (Math.hypot(a - S.pool.at[0], b - S.pool.at[1]) < S.pool.radiusM + 0.2) {
      return { ...base, sp: 'spring:pool', name: W.name, icon: 'pan', text: hasPan() ? W.pool : `${W.pool} ${W.poolNoPan}`, wx: at.x + panStand.x, wz: at.z + panStand.z, r: 0.3, reachR: 0.6, springPool: true };
    }
    return null;
  }

  const offs = [
    registerCardAction({ id: 'springtakepan', icon: 'takeup', order: 9, main: true, label: W.takePan,
      when: (c) => !!c?.springPan && !hasPan() && o.walk.zone === ID, action: () => ({ type: 'spring.takePan' }) }),
    registerCardAction({ id: 'springpan', icon: 'pan', order: 10, main: true, label: W.panAct,
      when: (c) => !!c?.springPool && hasPan() && o.walk.zone === ID, action: () => ({ type: 'spring.pan' }) }),
    registerCardAction({ id: 'springup', icon: 'climbup', order: 11, main: true, label: W.climbUp,
      when: (c) => !!c?.springRope && o.walk.zone === ID, action: () => ({ type: 'spring.climbUp' }) }),
    onAction((/** @type {any} */ a) => {
      if (a.type === 'spring.climbDown') { if (o.dig.springHole() && o.walk.below) { update('identify', () => null); o.zones.go(ID); } }
      else if (a.type === 'spring.climbUp') { update('identify', () => null); o.zones.back(); }
      else if (a.type === 'spring.pan') pan();
      else if (a.type === 'spring.takePan') takePan();
    }),
  ];

  // ---- light, sound and the view ----

  /**
   * This frame's light (CaveUniforms, cave-draw.wgsl) and the walker's (the frame's sun, for the
   * figure), from the day outside. @param {{ sunDir: ArrayLike<number>, sunIlluminance: ArrayLike<number>, cloud: number, time: number }} d
   * @returns {{ uniforms: number[], sunDir: number[], sunIlluminance: number[] }}
   */
  function light(d) {
    const at = /** @type {NonNullable<typeof O>} */ (origin()), L = R.light, K = R.look;
    const sy = Math.max(0, d.sunDir[1]);
    // The outside light on level ground: the sun's share on it and the sky's.
    // The hole is a disc of sky: its radiance is the sky's (the sun's own light comes down the shaft
    // only when it lines up, sunLight in the shader), skyShare of the sun's light on level ground.
    const sky = L.skyShare * Math.min(1, sy * 4) * (1 - L.cloudCut * d.cloud);
    const eOut = [0, 1, 2].map((c) => d.sunIlluminance[c] * sky);
    const eLevel = [0, 1, 2].map((c) => d.sunIlluminance[c] * (sy + sky));
    const hole = [at.x, at.top, at.z, L.holeRadiusM];
    const shaftY = at.y + shape.ceilAt(0, 0) - 0.15;
    // The bounce: what comes in, spread over the cave's walls, carried on by their albedo.
    const area = Math.PI * L.holeRadiusM * L.holeRadiusM, walls = 2 * Math.PI * S.radiusM[0] * S.radiusM[1] + 2 * Math.PI * Math.sqrt(S.radiusM[0] * S.radiusM[1]) * S.ceilingM;
    const alb = (K.rock[0] + K.rock[1] + K.rock[2]) / 3, carry = alb / (1 - alb);
    const sunIn = sy > 0.85 ? 1 : 0;
    // Plus a soft fill of its own (fake, for the look: light.fill of the outside light).
    const bounce = [0, 1, 2].map((c) => ((eOut[c] * area + d.sunIlluminance[c] * area * sunIn) / walls) * carry * L.bounce / Math.PI + (eLevel[c] * (L.fill ?? 0)) / Math.PI);
    const W2 = K.water, p = S.pool;
    const uniforms = [
      ...hole,
      at.x, shaftY, at.z, S.shaft.radiusM,
      ...eOut, L.bounce,
      d.sunDir[0], d.sunDir[1], d.sunDir[2], sunIn,
      d.sunIlluminance[0], d.sunIlluminance[1], d.sunIlluminance[2], L.minNits,
      ...bounce, d.time,
      ...K.rock, K.wetNearM,
      ...K.rockWet, K.roughness[1],
      ...K.floor, K.roughness[0],
      at.x + p.at[0], at.y + p.levelM, at.z + p.at[1], p.radiusM,
      ...W2.absorption, W2.f0,
      ...W2.tint, W2.ripple,
      W2.drips, W2.dripS, L.beam.nits, L.beam.scatter,
      (o.walk.walker?.x ?? at.x), (o.walk.walker?.y ?? at.y) + 0.9, (o.walk.walker?.z ?? at.z), R.view.fadeM,
      ...W2.glow, W2.glowNits * Math.max(0.15, Math.min(1, sy * 3)),
    ];
    // The walker: lit from the hole as a light from its direction, as bright as the hole is there.
    const y = o.walk.walker, wx = y?.x ?? at.x, wz = y?.z ?? at.z, wy = (y?.y ?? at.y) + 0.9;
    const dx = at.x - wx, dy = at.top - wy, dz = at.z - wz, dl = Math.hypot(dx, dy, dz) || 1;
    const rimOff = Math.hypot(dx * ((shaftY - wy) / Math.max(dy, 0.1)), dz * ((shaftY - wy) / Math.max(dy, 0.1)));
    const vis = rimOff < S.shaft.radiusM ? 1 : Math.max(0, 1 - (rimOff - S.shaft.radiusM) / 0.3);
    const k = (area * (dy / dl) / (Math.PI * Math.max(dl * dl, 0.16))) * vis * L.figure.share;
    return { uniforms, sunDir: [dx / dl, dy / dl, dz / dl], sunIlluminance: eOut.map((e) => e * k + 0) };
  }

  /** The sound state's own part down here (recipes/audio/ambience.json under). */
  const sound = () => ({ under: R.sound.under, near: { waterNear: { still: 0, slow: R.sound.waterSlow, running: 0 }, surfaceNear: { water: 1, pads: 0, reeds: 0, grass: 0 }, falls: [] } });

  /**
   * Where a ray from the eye meets the cave's floor (a click), or null. @param {number[]} ro @param {number[]} rd
   * @returns {number[] | null}
   */
  function groundAt(ro, rd) {
    const at = origin();
    if (!at) return null;
    for (let t = 0.05; t < 14; t += 0.04) {
      const x = ro[0] + rd[0] * t, y = ro[1] + rd[1] * t, z = ro[2] + rd[2] * t;
      const a = lx(x), b = lz(z);
      if (shape.inside(a, b) < -0.2) continue;
      const f = at.y + shape.floorAt(a, b);
      if (y <= f) return [x, f, z];
    }
    return null;
  }

  /**
   * How far the view may sit from what it looks at before it would be inside the rock (m).
   * @param {ArrayLike<number>} target @param {ArrayLike<number>} eye
   */
  function viewRoom(target, eye) {
    const at = origin();
    if (!at) return Infinity;
    const dx = eye[0] - target[0], dy = eye[1] - target[1], dz = eye[2] - target[2], d = Math.hypot(dx, dy, dz) || 1;
    // The rock between the eye and you fades out (cave-draw.wgsl), so the view keeps its distance
    // through a wall; only the solid beyond the cave's own box stops it.
    let room = 0.4;
    for (let t = 0.2; t <= 8; t += 0.1) {
      const x = target[0] + (dx / d) * t, y = target[1] + (dy / d) * t, z = target[2] + (dz / d) * t;
      if (shape.air(lx(x), y - at.y, lz(z)) < -R.view.throughM) break;
      room = t;
    }
    return room;
  }

  /** Each frame while down here: the pan's kneel, and the pan in your hands. @param {number} dt */
  function tick(dt) {
    if (shrimpT > 0) shrimpT = Math.max(0, shrimpT - dt);
    if (!panning) { if (built) things(null); return; }
    panning.t += dt;
    // The pan in both hands, held out in front of you over the water (never inside the figure).
    const hr = o.walk.hand('r'), hl = o.walk.hand('l'), w = o.walk.walker, out = P.holdOutM ?? 0.32;
    if (hr && hl && w) things({ x: (hr.x + hl.x) / 2 + Math.sin(w.yaw) * out, y: (hr.y + hl.y) / 2 - 0.05, z: (hr.z + hl.z) / 2 + Math.cos(w.yaw) * out, tilt: Math.sin(panning.t * 2.2) * 0.25 });
    if (panning.t >= P.panS) { panning = null; panDone(); }
  }

  o.zones.register({ id: ID, enter, leave, tick, cardAt, rayCard, light, sound, groundAt, viewRoom, camera: R.camera ?? null, ready: () => !!origin() });

  return {
    id: ID,
    /** Start building the cave as soon as the ground has given way (so climbing down is instant). */
    prepare() { if (origin() && !built) build(); },
    cardAt, ground, water, light, sound, groundAt, viewRoom,
    /** The floor alone (no raised walls), for the view to keep above. @param {number} x @param {number} z */
    floor: (x, z) => (O?.y ?? 0) + shape.floorAt(lx(x), lz(z)),
    /** Tests and the test links. */
    debug: { origin, pans, panDone, shape, panAt, panStand, takePan, hasPan, get built() { return built; } },
    dispose() { for (const off of offs) off(); },
  };
}
