// @ts-check
// What the pack's world looks like (docs/future/13 sections 4.1 and 4.2), drawn near you: the piles
// at camp (Matt's log pile for sticks and drift twigs, paler for drift twigs, his stone pile for
// pebbles and flat stones, small, good or big by how much they hold), the small heaps left when the
// pack was full (K-21), and what lies on the ground to gather today: drift twigs on the strandline,
// sticks under the bushes, pebbles and flat stones (pickup-meshes.js), fewer as a spot is picked
// over and none once it is bare. Reed down needs nothing: it is on the reeds.
//
// Two creature passes (src/render/passes/creatures.js) with baked vertex colours, as the nets and
// finds are drawn. The camp models load from assets/models/camp/ through src/render/gltf.js; until
// they load, or if they are missing, seeded stand-ins at the same footprint are drawn (a low mound
// of crossed sticks, a low cairn of stones). Drawing only: it reads the pieces, the pack and the
// gather spots and never changes them. The lists are built again a few times a second at most,
// and at once when something is gathered, set down or taken up. Numbers: recipes/world/pack.json
// `piles.look` and `pickups`.

import { get } from '../../core/store.js';
import { on } from '../../core/events.js';
import { hash32 } from '../../core/rng.js';
import { readGlb, meshesByName } from '../../render/gltf.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { packMesh } from '../creatures/bodies.js';
import { pileShape } from './piles.js';
import { pickupMesh, stickPileMesh, stonePileMesh } from './pickup-meshes.js';

/** @typedef {import('./pickup-meshes.js').Mesh} Mesh */

/** 0..1 from a hash. @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/**
 * A pass recipe for the creature pass: dry, matte, with a contact shadow lengthM long at size 1.
 * @param {{ lengthM: number, shadow: number, roughness?: number, sheen?: number }} P
 */
const passRecipe = (P) => ({ body: { scaleReal: [P.lengthM, P.lengthM], contactShadow: P.shadow, wetSpecular: { roughness: P.roughness ?? 0.85, strength: P.sheen ?? 0 } } });

/**
 * A camp model as one mesh in the creature pass's layout: every mesh in the file joined, its vertex
 * colours read as linear albedo (color, when it has none). Pure.
 * @param {ArrayBuffer} buffer @param {number[]} color @returns {Mesh}
 */
export function campModelMesh(buffer, color) {
  const parts = [...meshesByName(readGlb(buffer)).values()];
  if (!parts.length) throw new Error('no meshes');
  const count = parts.reduce((s, p) => s + p.attributes.POSITION.length / 3, 0);
  const vertices = new Float32Array(count * 9);
  const indices = new Uint32Array(parts.reduce((s, p) => s + p.indices.length, 0));
  let v0 = 0, i0 = 0;
  for (const p of parts) {
    const pos = p.attributes.POSITION, nor = p.attributes.NORMAL, col = p.attributes.COLOR_0;
    const n = pos.length / 3;
    // A colour is 3 or 4 numbers a vertex, as floats or normalized integers.
    const cn = col ? col.length / n : 0;
    const norm = col instanceof Uint8Array ? 255 : col instanceof Uint16Array ? 65535 : 1;
    for (let i = 0; i < n; i++) {
      const c = col ? [col[i * cn] / norm, col[i * cn + 1] / norm, col[i * cn + 2] / norm] : color;
      vertices.set([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], nor ? nor[i * 3] : 0, nor ? nor[i * 3 + 1] : 1, nor ? nor[i * 3 + 2] : 0, c[0], c[1], c[2]], (v0 + i) * 9);
    }
    for (let k = 0; k < p.indices.length; k++) indices[i0 + k] = p.indices[k] + v0;
    v0 += n;
    i0 += p.indices.length;
  }
  return { vertices, count, indices };
}

/**
 * The same mesh paler (drift twigs: salt-grey), its colours mixed toward a grey. Pure.
 * @param {Mesh} m @param {{ mix: number, toward: number[] }} T @returns {Mesh}
 */
export function paler(m, T) {
  const vertices = m.vertices.slice();
  for (let i = 0; i < m.count; i++) for (let c = 0; c < 3; c++) {
    const k = i * 9 + 6 + c;
    vertices[k] = vertices[k] * (1 - T.mix) + T.toward[c] * T.mix;
  }
  return { vertices, count: m.count, indices: m.indices };
}

/**
 * How many shapes lie at a gather spot: a seeded number in the kind's range when the spot is full,
 * fewer as it is picked over, none when nothing is left. Pure.
 * @param {number} key the spot's key @param {number} left @param {number} share @param {number[]} range [least, most] when full
 */
export function pickupCount(key, left, share, range) {
  if (!(left > 0) || !(share > 0)) return 0;
  const full = range[0] + Math.floor(u01(hash32(key, 0xc0)) * (range[1] - range[0] + 1));
  return Math.max(1, Math.ceil((full * Math.min(left, share)) / share));
}

/**
 * @param {{ terrain: any, camera: any, recipe: any, gather?: any, pack?: any, you?: () => number[] | null }} o
 *   recipe: recipes/world/pack.json; gather: src/world/gather (near); pack: src/world/pack (heaps);
 *   you: where you stand below ([x, y, z]) or null above (the view's middle is used then)
 */
export function createPackDraw(o) {
  const R = o.recipe, L = R.piles.look, P = R.pickups;
  const ground = (/** @type {number} */ x, /** @type {number} */ z) => o.terrain.sampleHeight(x, z);
  const pilePass = createCreaturePass({ recipe: passRecipe(L.pass), maxBones: 1, name: 'pack-piles' });
  const pickupPass = createCreaturePass({ recipe: passRecipe(P.pass), maxBones: 1, name: 'pack-pickups' });
  const put = (/** @type {any} */ pass, /** @type {string} */ key, /** @type {Mesh} */ m) => pass.setMesh(key, { data: packMesh(m), indices: m.indices });

  // The stand-ins first, so there is always something to draw; the models replace them as they load.
  /** @param {string} model @param {Mesh} m */
  function setPileMesh(model, m) {
    put(pilePass, model, m);
    if (model === 'stick') put(pilePass, 'stick-pale', paler(m, L.pale));
  }
  setPileMesh('stick', stickPileMesh(0x571c, L.standIn.stick, L.footprintM.stick));
  setPileMesh('stone', stonePileMesh(0x5701, L.standIn.stone, L.footprintM.stone));
  for (const [model, path] of Object.entries(L.models3d ?? {})) {
    fetch(new URL(`../../../${path}`, import.meta.url))
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then((b) => setPileMesh(model, campModelMesh(b, L.standIn[model]?.color ?? [0.3, 0.25, 0.2])))
      .catch((e) => console.info(`pack: ${path} not loaded, drawing the stand-in (${e.message})`));
  }
  // A few seeded shapes of each ground kind.
  for (const [kind, K] of Object.entries(P.kinds)) {
    for (let v = 0; v < P.variants; v++) put(pickupPass, `${kind}-${v}`, pickupMesh(kind, hash32(0x9c4b, v, kind.length), K));
  }

  let dirty = true, clock = 0, since = 0;
  /** @type {number[] | null} */ let lastAt = null;
  const offs = ['gather:done', 'pack:changed', 'pack:set-down', 'pile:changed'].map((ev) => on(ev, () => { dirty = true; }));

  /** Where to draw near: you, below; else the view's middle. */
  function focus() {
    const y = o.you?.();
    if (y) return [y[0], y[2]];
    const t = o.camera.target;
    return [t[0], t[2]];
  }

  /** The piles and heaps near f. @param {number[]} f */
  function pileBeings(f) {
    const near2 = L.nearM * L.nearM;
    /** @type {import('../../render/passes/creatures.js').Being[]} */ const out = [];
    for (const p of get('pieces')?.list ?? []) {
      if (p.kind !== 'pile' || (p.x - f[0]) ** 2 + (p.z - f[1]) ** 2 > near2) continue;
      const sh = pileShape(p.holds ?? '', p.handfuls ?? 0, R);
      out.push({ x: p.x, y: ground(p.x, p.z) - L.sinkM, z: p.z, yaw: p.yaw, size: sh.scale, mesh: sh.model });
    }
    for (const h of o.pack?.heaps?.() ?? []) {
      const [kind, x, z, , n] = h;
      if ((x - f[0]) ** 2 + (z - f[1]) ** 2 > near2) continue;
      const sh = pileShape(kind, n, R, true);
      const yaw = u01(hash32(Math.round(x * 100), Math.round(z * 100), 0x4ea9)) * 2 * Math.PI;
      out.push({ x, y: ground(x, z) - L.sinkM * sh.scale, z, yaw, size: sh.scale, mesh: sh.model });
    }
    return out.slice(0, L.max);
  }

  /** What lies on the ground to gather near f, nearest spots first, up to the cap. @param {number[]} f */
  function pickupBeings(f) {
    /** @type {import('../../render/passes/creatures.js').Being[]} */ const out = [];
    if (!o.gather?.near) return out;
    const spots = o.gather.near(f[0], f[1], P.nearM).filter((/** @type {any} */ s) => s.left > 0 && P.kinds[s.kind]);
    spots.sort((/** @type {any} */ a, /** @type {any} */ b) => ((a.x - f[0]) ** 2 + (a.z - f[1]) ** 2) - ((b.x - f[0]) ** 2 + (b.z - f[1]) ** 2));
    for (const s of spots) {
      const K = P.kinds[s.kind];
      const key = (s.key ?? hash32(Math.round(s.x * 100), Math.round(s.z * 100))) >>> 0;
      const n = pickupCount(key, s.left, s.share, K.count);
      for (let i = 0; i < n && out.length < P.max; i++) {
        const u = (/** @type {number} */ k) => u01(hash32(key, i, k));
        // Scattered round the spot, each its own turn, shape and size.
        const r = K.spreadM * Math.sqrt(u(1)), a = u(2) * 2 * Math.PI;
        const x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r;
        out.push({ x, y: ground(x, z), z, yaw: u(3) * 2 * Math.PI, size: 0.85 + 0.3 * u(4), mesh: `${s.kind}-${Math.floor(u(5) * P.variants)}` });
      }
      if (out.length >= P.max) break;
    }
    return out;
  }

  return {
    id: 'pack-draw',
    /** Both passes, for the frame graph (after the nets, before the pieces). */
    passes: [pilePass, pickupPass],

    /** Each frame: the lists again when something changed, or now and then as you move. @param {import('../../sim/live-sim.js').FrameInfo} f */
    tick(f) {
      clock += f.realDt;
      since += f.realDt;
      if (clock < L.rebuildS) return;
      const at = focus();
      const moved = !lastAt || (at[0] - lastAt[0]) ** 2 + (at[1] - lastAt[1]) ** 2 > L.moveM * L.moveM;
      // Spots change with the tide and the day too, so look again every refreshS anyway.
      if (!dirty && !moved && since < L.refreshS) return;
      clock = 0; since = 0; dirty = false; lastAt = at;
      pilePass.setBeings(pileBeings(at));
      pickupPass.setBeings(pickupBeings(at));
    },

    dispose() { for (const off of offs) off(); },
  };
}

/** @typedef {ReturnType<typeof createPackDraw>} PackDraw */
