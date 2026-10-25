// @ts-check
// What the pack's world looks like (docs/future/13 sections 3.12, 4.1 and 4.2), drawn near you: the
// stores waiting empty in their slots from the first frame (the wood store, the stone pile's scrape,
// the clay slab; stores.js), the piles
// at camp (Matt's log pile for sticks and drift twigs, paler for drift twigs, his stone pile for
// pebbles and flat stones, small, good or big by how much they hold), the small heaps left when the
// pack was full (K-21), and what lies on the ground to gather today: drift twigs on the strandline,
// sticks under the bushes, pebbles and flat stones (pickup-meshes.js), fewer as a spot is picked
// over and none once it is bare. Reed down needs nothing: it is on the reeds.
//
// Two creature passes (src/render/passes/creatures.js) with baked vertex colours, as the nets and
// finds are drawn. Matt's camp models (assets/models/camp/log-pile.glb and stone-pile.glb) load
// through src/render/gltf.js, their base colour map baked into the vertex colours. A pile builds up
// piece by piece at its real size, bottom first (pile-pieces.js): the full model is only the full
// pile. Until they load, or if they cannot, seeded stand-ins
// at the same footprint are drawn (a low mound
// of crossed sticks, a low cairn of stones). Drawing only: it reads the pieces, the pack and the
// gather spots and never changes them. The lists are built again a few times a second at most,
// and at once when something is gathered, set down or taken up. Numbers: recipes/world/pack.json
// `piles.look` and `pickups`.

import { get } from '../../core/store.js';
import { on } from '../../core/events.js';
import { hash32 } from '../../core/rng.js';
import { readGlb, meshesByName, materialMaps } from '../../render/gltf.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { packMesh } from '../creatures/bodies.js';
import { pileShape } from './piles.js';
import { splitPieces, firstPieces, buildsUp, scaledMesh } from './pile-pieces.js';
import { logStack, stoneHeap, logsShown } from './log-stack.js';
import { pickupMesh, pebbleMesh, stickPileMesh, stonePileMesh, roundLogMesh, woodStoreMesh, scrapeMesh } from './pickup-meshes.js';
import { storeSlots } from './stores.js';
import { campPadNow } from './camp.js';
import { slotWorld } from '../camp/layout.js';

/** @typedef {import('./pickup-meshes.js').Mesh} Mesh */

/** 0..1 from a hash. @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/**
 * A pass recipe for the creature pass: dry, matte, with a contact shadow lengthM long at size 1.
 * @param {{ lengthM: number, shadow: number, roughness?: number, sheen?: number }} P
 */
const passRecipe = (P) => ({ body: { scaleReal: [P.lengthM, P.lengthM], contactShadow: P.shadow, wetSpecular: { roughness: P.roughness ?? 0.85, strength: P.sheen ?? 0 } } });

/** sRGB 0..255 to linear 0..1. @param {number} c */
const toLinear = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };

/**
 * A camp model's base colour map (materialMaps, src/render/gltf.js), decoded so a vertex can read
 * its colour at its UV as linear albedo. Null when the model has no map or the browser cannot decode
 * it. The creature pass draws baked vertex colours, so the map is sampled once per vertex here; its
 * roughness and normal maps are not used yet.
 * @param {import('../../render/gltf.js').Glb} glb
 * @returns {Promise<((u: number, v: number) => number[]) | null>}
 */
export async function baseColorSampler(glb) {
  const map = materialMaps(glb).baseColor;
  if (!map || typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return null;
  const bmp = await createImageBitmap(new Blob([map.bytes], { type: map.mimeType }));
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (cv.getContext('2d'));
  ctx.drawImage(bmp, 0, 0);
  const { data, width: W, height: H } = ctx.getImageData(0, 0, bmp.width, bmp.height);
  return (u, v) => {
    // glTF UVs: (0, 0) is the top left; wrap, as the default sampler repeats.
    const x = Math.min(W - 1, Math.floor((u - Math.floor(u)) * W)), y = Math.min(H - 1, Math.floor((v - Math.floor(v)) * H));
    const k = (y * W + x) * 4;
    return [toLinear(data[k]), toLinear(data[k + 1]), toLinear(data[k + 2])];
  };
}

/**
 * A camp model as one mesh in the creature pass's layout: every mesh in the file joined, each
 * vertex's colour from its own COLOR_0, else the base colour map at its UV (sample), else color.
 * Pure apart from the sampler.
 * @param {ArrayBuffer | import('../../render/gltf.js').Glb} source @param {number[]} color
 * @param {((u: number, v: number) => number[]) | null} [sample]
 * @returns {Mesh}
 */
export function campModelMesh(source, color, sample = null) {
  const parts = [...meshesByName(source instanceof ArrayBuffer ? readGlb(source) : source).values()];
  if (!parts.length) throw new Error('no meshes');
  const count = parts.reduce((s, p) => s + p.attributes.POSITION.length / 3, 0);
  const vertices = new Float32Array(count * 9);
  const indices = new Uint32Array(parts.reduce((s, p) => s + p.indices.length, 0));
  let v0 = 0, i0 = 0;
  for (const p of parts) {
    const pos = p.attributes.POSITION, nor = p.attributes.NORMAL, col = p.attributes.COLOR_0, uv = p.attributes.TEXCOORD_0;
    const n = pos.length / 3;
    // A colour is 3 or 4 numbers a vertex, as floats or normalized integers.
    const cn = col ? col.length / n : 0;
    const norm = col instanceof Uint8Array ? 255 : col instanceof Uint16Array ? 65535 : 1;
    for (let i = 0; i < n; i++) {
      const c = col ? [col[i * cn] / norm, col[i * cn + 1] / norm, col[i * cn + 2] / norm]
        : sample && uv ? sample(uv[i * 2], uv[i * 2 + 1]) : color;
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
  // Each lifted as its own group (src/render/lift.js, F5): a ground spot's card lifts only its pickups.
  const pilePass = createCreaturePass({ recipe: passRecipe(L.pass), maxBones: 1, name: 'pack-piles', liftGroup: 'piles' });
  const pickupPass = createCreaturePass({ recipe: passRecipe(P.pass), maxBones: 1, name: 'pack-pickups', liftGroup: 'pickups' });
  const put = (/** @type {any} */ pass, /** @type {string} */ key, /** @type {Mesh} */ m) => pass.setMesh(key, { data: packMesh(m), indices: m.indices });

  // The stand-ins first, so there is always something to draw; the models replace them as they load.
  // Each model in its stages (pile-pieces.js): its pieces bottom up, the small, good and big heap
  // showing their first share of them (stageShares), the full pile all of them, and a K-21 heap its
  // first few (heapShare). Keys are '<model>:<stage>'.
  // A model fused into one surface cannot build up that way (buildsUp): it is drawn whole at a
  // size for each stage instead (fusedScales, fusedHeapScale), until it comes with separate pieces.
  const shares = /** @type {[string, number][]} */ ([...(L.stageShares ?? [0.3, 0.6, 0.85, 1]).map((s, i) => [String(i), s]), ['heap', L.heapShare ?? 0.15]]);
  const fused = /** @type {[string, number][]} */ ([...(L.fusedScales ?? [0.5, 0.7, 0.9, 1]).map((s, i) => [String(i), s]), ['heap', L.fusedHeapScale ?? 0.3]]);
  /** @param {string} model @param {Mesh} m */
  function setPileMesh(model, m) {
    const split = splitPieces(m);
    const pale = model === 'stick' ? paler(m, L.pale) : null;
    const pieces = buildsUp(split, L.mostPieceShare ?? 0.5);
    for (const [stage, v] of pieces ? shares : fused) {
      /** @param {Mesh} q */
      const at = (q) => (pieces ? firstPieces(q, split, v) : scaledMesh(q, v));
      put(pilePass, `${model}:${stage}`, at(m));
      if (pale) put(pilePass, `stick-pale:${stage}`, at(pale));
    }
  }
  setPileMesh('stick', stickPileMesh(0x571c, L.standIn.stick, L.footprintM.stick));

  // The stick pile from one log (log-stack.js): a round stand-in log until Matt's single log loads
  // (stack.model), in a few shades, and paler for drift twigs. Keys 'log:<shade>' and 'log-pale:<shade>'.
  const ST = L.stack;
  let logRadius = ST?.radiusM ?? 0.13;
  /** Each pile's logs or stones, by its seed (the layout never changes for a pile). @type {Map<string, import('./log-stack.js').StackedLog[]>} */
  const stacks = new Map();
  // The stone pile from one stone the same way (stoneHeap): a lumpy stand-in until Matt's single
  // stone loads (stones.model). Keys 'stone1:<shade>'.
  const SN = L.stones;
  let stoneHalf = { w: (SN?.halfWM ?? 0.15), h: (SN?.halfHM ?? 0.12) };
  /** @param {Mesh} m */
  function setStoneMesh(m) {
    let top = 0, wide = 0;
    for (let i = 0; i < m.count; i++) { top = Math.max(top, m.vertices[i * 9 + 1]); wide = Math.max(wide, Math.abs(m.vertices[i * 9]), Math.abs(m.vertices[i * 9 + 2])); }
    stoneHalf = { w: wide * 0.9, h: top / 2 };
    [...stacks.keys()].filter((k) => k.startsWith('s')).forEach((k) => stacks.delete(k));
    (SN.shades ?? ST?.shades ?? [1]).forEach((/** @type {number} */ k, /** @type {number} */ i) => put(pilePass, `stone1:${i}`, paler(m, { mix: 1 - k, toward: [0, 0, 0] })));
  }
  if (SN) {
    setStoneMesh(pebbleMesh(0x570e, [SN.halfWM ?? 0.15, SN.halfHM ?? 0.12, SN.halfWM ?? 0.15], 0.12, SN.color ?? [0.3, 0.29, 0.27], 0));
    if (SN.model) {
      fetch(new URL(`../../../${SN.model}`, import.meta.url))
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
        .then((b) => setStoneMesh(campModelMesh(readGlb(b), SN.color ?? [0.3, 0.29, 0.27])))
        .catch((e) => console.info(`pack: ${SN.model} not loaded, drawing the stand-in stone (${e.message})`));
    }
  }
  /** @param {Mesh} m */
  function setLogMesh(m) {
    // A split log is not quite round: rest it on the mean of its half height and half width.
    let top = 0, side = 0;
    for (let i = 0; i < m.count; i++) { top = Math.max(top, m.vertices[i * 9 + 1]); side = Math.max(side, Math.abs(m.vertices[i * 9 + 2])); }
    logRadius = (top / 2 + side) / 2;
    stacks.clear();
    (ST.shades ?? [1]).forEach((/** @type {number} */ k, /** @type {number} */ i) => {
      const t = paler(m, { mix: 1 - k, toward: [0, 0, 0] });
      put(pilePass, `log:${i}`, t);
      put(pilePass, `log-pale:${i}`, paler(t, L.pale));
    });
  }
  if (ST) {
    setLogMesh(roundLogMesh(0x109, ST.lenM, ST.radiusM, ST.bark, ST.end));
    if (ST.model) {
      fetch(new URL(`../../../${ST.model}`, import.meta.url))
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
        .then((b) => setLogMesh(campModelMesh(readGlb(b), ST.bark)))
        .catch((e) => console.info(`pack: ${ST.model} not loaded, drawing the stand-in log (${e.message})`));
    }
  }
  setPileMesh('stone', stonePileMesh(0x5701, L.standIn.stone, L.footprintM.stone));
  for (const [model, path] of Object.entries(L.models3d ?? {})) {
    fetch(new URL(`../../../${path}`, import.meta.url))
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then(async (b) => {
        const glb = readGlb(b);
        const sample = await baseColorSampler(glb).catch(() => null);
        setPileMesh(model, campModelMesh(glb, L.standIn[model]?.color ?? [0.3, 0.25, 0.2], sample));
      })
      .catch((e) => console.info(`pack: ${path} not loaded, drawing the stand-in (${e.message})`));
  }
  // The stores, empty and waiting (section 3.12; stores.js): the wood store's stakes, bar and floor
  // stones, the stone pile's scrape (its edging stones are the pile's own stone, 'stone1:<shade>'),
  // and the clay slab. Keys 'store:<id>'.
  const SR = R.stores;
  if (SR) {
    put(pilePass, 'store:sticks', woodStoreMesh(0x5701e, SR.sticks.look));
    put(pilePass, 'store:stones', scrapeMesh(SR.stones.look));
    put(pilePass, 'store:clay', pebbleMesh(0xc1a7, SR.clay.look.radii, 0.06, SR.clay.look.color, 0.3));
  }
  // The hamper (P2j): the rush hamper made in code, painted in vertex colours, and the stacked pair.
  // Keys 'hamper:1' and 'hamper:2'; drawn once the camp's store slot holds one.
  const HL = R.store?.look;
  (HL?.models ?? []).forEach((/** @type {string} */ path, /** @type {number} */ i) => {
    fetch(new URL(`../../../${path}`, import.meta.url))
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then((b) => { put(pilePass, `hamper:${i + 1}`, campModelMesh(readGlb(b), HL.color ?? [0.4, 0.33, 0.2])); dirty = true; })
      .catch((e) => console.info(`pack: ${path} not loaded (${e.message})`));
  });
  // A few seeded shapes of each ground kind.
  for (const [kind, K] of Object.entries(P.kinds)) {
    for (let v = 0; v < P.variants; v++) put(pickupPass, `${kind}-${v}`, pickupMesh(kind, hash32(0x9c4b, v, kind.length), K));
  }

  let dirty = true, clock = 0, since = 0;
  /** @type {number[] | null} */ let lastAt = null;
  const offs = ['gather:done', 'pack:changed', 'pack:set-down', 'pile:changed', 'camp:stamped', 'camp:placed'].map((ev) => on(ev, () => { dirty = true; }));

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
    const stores = SR ? storeSlots().filter((s) => (s.x - f[0]) ** 2 + (s.z - f[1]) ** 2 <= near2) : [];
    for (const p of get('pieces')?.list ?? []) {
      if (p.kind !== 'pile' || (p.x - f[0]) ** 2 + (p.z - f[1]) ** 2 > near2) continue;
      const sh = pileShape(p.holds ?? '', p.handfuls ?? 0, R);
      // A pile in a store lies square in it (the slot's own turn), the wood store's on its floor stones.
      const st = stores.find((s) => s.id === p.slot);
      const yaw = st ? st.yaw : p.yaw, lift = st?.id === 'sticks' ? SR.sticks.look.floorLiftM : 0;
      if (!addLogs(out, sh, p.x, p.z, yaw, p.seed >>> 0, lift)) {
        out.push({ x: p.x, y: ground(p.x, p.z) - L.sinkM + lift, z: p.z, yaw, size: sh.scale, mesh: `${sh.model}:${sh.stage}` });
      }
    }
    for (const s of stores) {
      const y = ground(s.x, s.z);
      out.push({ x: s.x, y, z: s.z, yaw: s.yaw, size: 1, mesh: `store:${s.id}` });
      // The scrape's edging stones: the pile's own stone, evenly round with a seeded wobble.
      if (s.id === 'stones' && SN) {
        const E = SR.stones.look, shades = (SN.shades ?? [1]).length;
        for (let i = 0; i < E.edging; i++) {
          const h = hash32(0x5ed9, i), a = s.yaw + ((i + 0.3 * u01(h)) / E.edging) * 2 * Math.PI, d = E.edgeAtM * (0.95 + 0.1 * u01(hash32(h, 1)));
          const x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d;
          out.push({ x, y: ground(x, z) - L.sinkM, z, yaw: u01(hash32(h, 2)) * 2 * Math.PI, size: E.edgeSize * (0.9 + 0.2 * u01(hash32(h, 3))), mesh: `stone1:${i % shades}` });
        }
      }
    }
    // The hamper in the store slot, facing the fire (P2j); the stacked pair once it has grown.
    const hamper = (get('camp')?.slots ?? []).find((/** @type {any} */ s) => s.slot === 'store' && s.kind === 'hamper');
    const pad = hamper ? campPadNow() : null;
    const hs = pad ? (pad.camp?.slots ?? []).find((/** @type {any} */ s) => s.id === 'store') : null;
    if (hamper && pad && hs) {
      const at = slotWorld(pad, hs), rs = (pad.camp?.slots ?? []).find((/** @type {any} */ s) => s.id === 'ring');
      const ring = rs ? slotWorld(pad, rs) : null;
      if ((at.x - f[0]) ** 2 + (at.z - f[1]) ** 2 <= near2) {
        out.push({ x: at.x, y: ground(at.x, at.z), z: at.z, yaw: ring ? Math.atan2(ring.x - at.x, ring.z - at.z) : at.yaw, size: 1, mesh: `hamper:${hamper.stack === 2 ? 2 : 1}` });
      }
    }
    for (const h of o.pack?.heaps?.() ?? []) {
      const [kind, x, z, , n] = h;
      if ((x - f[0]) ** 2 + (z - f[1]) ** 2 > near2) continue;
      const sh = pileShape(kind, n, R, true);
      const seed = hash32(Math.round(x * 100), Math.round(z * 100), 0x4ea9);
      const yaw = u01(seed) * 2 * Math.PI;
      if (!addLogs(out, sh, x, z, yaw, seed)) out.push({ x, y: ground(x, z) - L.sinkM, z, yaw, size: sh.scale, mesh: `${sh.model}:${sh.stage}` });
    }
    return out.slice(0, L.logMax ?? 160);
  }

  /**
   * A stick pile (or heap) as stacked logs, bottom up, as many as its stage shows. False for a
   * stone pile, which is still drawn as its model.
   * @param {import('../../render/passes/creatures.js').Being[]} out @param {{ model: string, stage: number | string }} sh
   * @param {number} x @param {number} z @param {number} yaw @param {number} seed @param {number} [lift] raised this much (on a store's floor)
   */
  function addLogs(out, sh, x, z, yaw, seed, lift = 0) {
    const stones = sh.model === 'stone';
    if (stones ? !SN : (!ST || (sh.model !== 'stick' && sh.model !== 'stick-pale'))) return false;
    const key = `${stones ? 's' : 'l'}${seed}`;
    let logs = stacks.get(key);
    if (!logs) { logs = stones ? stoneHeap(seed, stoneHalf.w, stoneHalf.h, SN) : logStack(seed, logRadius, ST); stacks.set(key, logs); }
    const share = sh.stage === 'heap' ? (L.heapShare ?? 0.15) : (L.stageShares ?? [0.3, 0.6, 0.85, 1])[/** @type {number} */ (sh.stage)] ?? 1;
    const n = logsShown(logs.length, share);
    const c = Math.cos(yaw), s = Math.sin(yaw), y0 = ground(x, z) - L.sinkM + lift;
    const pale = stones ? 'stone1' : sh.model === 'stick-pale' ? 'log-pale' : 'log';
    const shades = ((stones ? SN.shades : ST.shades) ?? ST?.shades ?? [1]).length;
    const jitter = (stones ? SN.tintJitter : ST.tintJitter) || 1;
    for (let i = 0; i < n; i++) {
      const g = logs[i];
      // The pile's frame turned by its yaw (as the creature pass turns a mesh: x toward +x, z toward +z).
      const wx = x + g.x * c + g.z * s, wz = z - g.x * s + g.z * c;
      const shade = Math.min(shades - 1, Math.max(0, Math.round(((g.tint - 1) / (2 * jitter) + 0.5) * (shades - 1))));
      out.push({ x: wx, y: y0 + g.y, z: wz, yaw: yaw + g.yaw, size: g.size, mesh: `${pale}:${shade}` });
    }
    return true;
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
        // Drawn larger than life (pickups.scale), as creatures are, so they can be found.
        out.push({ x, y: ground(x, z), z, yaw: u(3) * 2 * Math.PI, size: (P.scale ?? 1) * (0.85 + 0.3 * u(4)), mesh: `${s.kind}-${Math.floor(u(5) * P.variants)}` });
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
