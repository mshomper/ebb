// @ts-check
// The keeper's boat at its mooring (docs/future/13 section 3.9, CP-09). A new island opens with the
// walker already standing on the beach and the boat grounded behind them (Matt, October 22: no
// row-in). mooringOf works out where the stake, the boat and the walker's first spot are from the
// camp pad and the ground (pure; nothing saved). createBoat draws the stand-in boat (boat-mesh.js,
// until Matt's model), its stake and its rope with a creature pass of its own, posed every frame from
// the water: afloat it bobs and rocks a little at the surface; at low tide it rests on the sand,
// following the slope and leaning onto one side. Not simulated: the motion is time based.

import { packMesh } from '../creatures/bodies.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { boatMeshes, hullLines } from './boat-mesh.js';
import { readGlb, meshesByName, materialMaps } from '../../render/gltf.js';

/**
 * @typedef {{ x: number, z: number, r: number, fx: number, fz: number }} Pad
 *   the camp pad: centre (m), radius, and (fx, fz) the unit vector toward the sea
 * @typedef {{ stake: { x: number, z: number }, boat: { x: number, z: number, yaw: number }, stand: { x: number, z: number, yaw: number } }} Mooring
 *   yaw: radians, body +z forward (src/world/figure/motion.js); the boat's bow and the walker both face inland
 */

/**
 * Where the boat is moored: from the pad's seaward edge, out along its facing line to the first
 * ground at or below stakeLevelM (within searchM; the search's end if none), the stake; the boat
 * boatOutM beyond it, bow toward the stake; the walker standInM inland of the stake, facing inland.
 * @param {Pad | null} pad @param {(x: number, z: number) => number} ground land height (m; the sea is 0)
 * @param {{ stakeLevelM: number, boatOutM: number, searchM: number, standInM: number, stepM?: number }} M boat.json boat.mooring
 * @returns {Mooring | null}
 */
export function mooringOf(pad, ground, M) {
  if (!pad) return null;
  const l = Math.hypot(pad.fx, pad.fz) || 1, fx = pad.fx / l, fz = pad.fz / l;
  const ex = pad.x + fx * pad.r, ez = pad.z + fz * pad.r;
  const step = M.stepM ?? 0.1;
  let d = M.searchM;
  for (let s = 0; s <= M.searchM; s += step) {
    if (ground(ex + fx * s, ez + fz * s) <= M.stakeLevelM) { d = s; break; }
  }
  const sx = ex + fx * d, sz = ez + fz * d;
  // Facing inland: -f (yaw atan2(x, z), as the walker turns, walker.js).
  const yaw = Math.atan2(-fx, -fz);
  return {
    stake: { x: sx, z: sz },
    boat: { x: sx + fx * M.boatOutM, z: sz + fz * M.boatOutM, yaw },
    stand: { x: sx - fx * M.standInM, z: sz - fz * M.standInM, yaw },
  };
}

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const RAD = Math.PI / 180;

/**
 * A rotation in the hull's own frame (column major, as the creature pass's bones): pitch about x
 * (bow up positive), then roll about z (starboard, +x, up positive). @param {number} pitch @param {number} roll
 */
function tiltMatrix(pitch, roll) {
  const ct = Math.cos(-pitch), st = Math.sin(-pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  // Rx(-pitch) * Rz(roll), its columns the images of x, y, z.
  return new Float32Array([
    cr, ct * sr, st * sr, 0,
    -sr, ct * cr, st * cr, 0,
    0, -st, ct, 0,
    0, 0, 0, 1,
  ]);
}

/** A column-major matrix times a point (no translation). @param {Float32Array} m @param {number[]} p */
const turn = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2], m[1] * p[0] + m[5] * p[1] + m[9] * p[2], m[2] * p[0] + m[6] * p[1] + m[10] * p[2]];

/** sRGB 0..255 to linear 0..1. @param {number} c */
const linear = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };

/**
 * A boat model as one mesh in the creature pass's layout (position, normal, linear albedo): every
 * mesh in the file joined, its base colour map read at each vertex's texture coordinate into the
 * vertex colour, since the camp pieces draw with vertex colours (color where it has no map).
 * @param {ArrayBuffer} buffer @param {number[]} color
 * @returns {Promise<{ vertices: Float32Array, count: number, indices: Uint32Array }>}
 */
export async function boatModelMesh(buffer, color) {
  const glb = readGlb(buffer);
  const parts = [...meshesByName(glb).values()];
  if (!parts.length) throw new Error('no meshes');
  const map = materialMaps(glb).baseColor;
  /** @type {{ data: Uint8ClampedArray, w: number, h: number } | null} */ let img = null;
  if (map && typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function') {
    const bmp = await createImageBitmap(new Blob([map.bytes], { type: map.mimeType }));
    const cv = new OffscreenCanvas(bmp.width, bmp.height), g = /** @type {OffscreenCanvasRenderingContext2D} */ (cv.getContext('2d'));
    g.drawImage(bmp, 0, 0);
    img = { data: g.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height };
  }
  const count = parts.reduce((s, p) => s + p.attributes.POSITION.length / 3, 0);
  const vertices = new Float32Array(count * 9);
  const indices = new Uint32Array(parts.reduce((s, p) => s + p.indices.length, 0));
  let v0 = 0, i0 = 0;
  for (const p of parts) {
    const pos = p.attributes.POSITION, nor = p.attributes.NORMAL, uv = p.attributes.TEXCOORD_0;
    const n = pos.length / 3;
    for (let i = 0; i < n; i++) {
      let c = color;
      if (img && uv) {
        const px = Math.min(img.w - 1, Math.max(0, Math.floor((uv[i * 2] - Math.floor(uv[i * 2])) * img.w)));
        const py = Math.min(img.h - 1, Math.max(0, Math.floor((uv[i * 2 + 1] - Math.floor(uv[i * 2 + 1])) * img.h)));
        const k = (py * img.w + px) * 4;
        c = [linear(img.data[k]), linear(img.data[k + 1]), linear(img.data[k + 2])];
      }
      vertices.set([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], nor ? nor[i * 3] : 0, nor ? nor[i * 3 + 1] : 1, nor ? nor[i * 3 + 2] : 0, c[0], c[1], c[2]], (v0 + i) * 9);
    }
    for (let k = 0; k < p.indices.length; k++) indices[i0 + k] = p.indices[k] + v0;
    v0 += n;
    i0 += p.indices.length;
  }
  return { vertices, count, indices };
}

/**
 * @param {{ recipe: any, ground: (x: number, z: number) => number, depthAt?: (x: number, z: number) => number,
 *   water?: { tide?: number, sampleLive?: (x: number, z: number) => { depth: number } | null }, mooring?: Mooring | null }} o
 *   recipe: recipes/world/boat.json (its boat block, or the whole file); ground: land height (m);
 *   depthAt: water over a point now (m); left out, it is read from `water` (the sea at the tide and
 *   the live water, as the pieces read it); mooring: from mooringOf (or setMooring later)
 */
export function createBoat(o) {
  const B = o.recipe.boat ?? o.recipe;
  const H = B.hull, F = B.float, S = B.sand;
  const ground = o.ground;
  const depthAt = o.depthAt ?? ((/** @type {number} */ x, /** @type {number} */ z) =>
    Math.max(0, (o.water?.tide ?? -Infinity) - ground(x, z), o.water?.sampleLive?.(x, z)?.depth ?? 0));
  const pass = createCreaturePass({
    recipe: { body: { wetSpecular: B.look.wetSpecular, contactShadow: 0, scaleReal: [H.lengthM, H.lengthM] } }, name: 'boat', maxBones: 1 });
  const meshes = boatMeshes(B);
  for (const key of /** @type {const} */ (['hull', 'stake', 'rope'])) pass.setMesh(key, { data: packMesh(meshes[key]), indices: meshes[key].indices });
  // Matt's boat (assets/models/camp/boat.glb: meters, Y up, origin at the keel's middle on the
  // ground, bow +Z) replaces the stand-in hull once it loads; the stake and rope stay.
  if (B.model?.file && typeof fetch === 'function') {
    fetch(new URL(`../../../${B.model.file}`, import.meta.url))
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then((b) => boatModelMesh(b, B.albedo.hull))
      .then((m) => { pass.setMesh('hull', { data: packMesh(m), indices: m.indices }); meshes.bow = B.model.bowTieM ?? meshes.bow; })
      .catch((e) => console.info(`boat: ${B.model.file} not loaded, drawing the stand-in (${e.message})`));
  }
  // A few points on the hull's outside, for how low it reaches when tilted on the sand.
  /** @type {number[][]} */ const under = [];
  for (let i = 0; i <= 8; i++) {
    const L = hullLines(H, i / 8);
    for (let j = 0; j <= 6; j++) {
      const a = (j / 6 - 0.5) * Math.PI, s = Math.sin(a);
      under.push([L.half * Math.sign(s) * Math.abs(s) ** 0.7, L.keel + (L.gun - L.keel) * (1 - Math.cos(a)), L.z]);
    }
  }

  /** @type {Mooring | null} */ let mooring = o.mooring ?? null;
  let visible = true;
  /** The pose as drawn, eased toward where it rests; afloat 0..1 scales the bob and rock. */
  /** @type {{ y: number, pitch: number, roll: number, afloat: number } | null} */ let pose = null;

  /** Where the hull rests now, before the bob: its keel's height, pitch, roll, and whether it floats. */
  function rest() {
    const m = /** @type {Mooring} */ (mooring);
    const { x, z, yaw } = m.boat;
    const g = ground(x, z), d = depthAt(x, z);
    if (d > F.draftM) return { y: g + d - F.draftM, pitch: 0, roll: 0, afloat: 1 };
    // On the sand: along the slope under it, leaning onto one side, its lowest point sunk a little.
    const ax = Math.sin(yaw), az = Math.cos(yaw), bx = Math.cos(yaw), bz = -Math.sin(yaw);
    const l = H.lengthM * 0.4, w = H.beamM * 0.4;
    const pitch = Math.atan2(ground(x + ax * l, z + az * l) - ground(x - ax * l, z - az * l), 2 * l);
    const roll = Math.atan2(ground(x + bx * w, z + bz * w) - ground(x - bx * w, z - bz * w), 2 * w) + S.tiltDeg * RAD;
    // Raised until no point of its outside is under the ground there, then sunk sinkM.
    const R = tiltMatrix(pitch, roll);
    let y = -Infinity;
    for (const p of under) {
      const q = turn(R, p);
      y = Math.max(y, ground(x + bx * q[0] + ax * q[2], z + bz * q[0] + az * q[2]) - q[1]);
    }
    return { y: y - S.sinkM, pitch, roll, afloat: 0 };
  }

  function hide() { pass.setBeings([]); }

  return {
    /** The boat's draw pass, for the frame graph (with the other creature-style passes, before the water). */
    pass,
    /** Where it is moored (mooringOf), or null to take it away. @param {Mooring | null} m */
    setMooring(m) { mooring = m; pose = null; if (!m) hide(); },
    get mooring() { return mooring; },
    get visible() { return visible; },
    set visible(v) { visible = !!v; if (!visible) hide(); },
    /** Is it afloat now (0..1, eased)? */
    get afloat() { return pose?.afloat ?? 0; },

    /**
     * Pose and draw it for this frame. @param {number} dt real seconds since the last frame
     * @param {number} t a running clock in seconds (the bob and rock)
     */
    update(dt, t) {
      if (!visible || !mooring) return;
      const r = rest();
      if (!pose) pose = { ...r };
      else {
        const k = 1 - Math.exp(-Math.max(0, dt) / B.settleS);
        pose.y += (r.y - pose.y) * k;
        pose.pitch += (r.pitch - pose.pitch) * k;
        pose.roll += (r.roll - pose.roll) * k;
        pose.afloat += (r.afloat - pose.afloat) * k;
      }
      const tau = 2 * Math.PI, f = pose.afloat;
      const y = pose.y + f * F.bobM * Math.sin((t / F.bobS) * tau);
      const pitch = pose.pitch + f * F.pitchDeg * RAD * Math.sin((t / F.pitchS) * tau + 1.3);
      const roll = pose.roll + f * F.rockDeg * RAD * Math.sin((t / F.rockS) * tau + 0.4);
      const { x, z, yaw } = mooring.boat;
      const bone = tiltMatrix(pitch, roll);

      // The rope: from the stake, just under its top, to the bow's ring.
      const K = B.stake, s = mooring.stake, sg = ground(s.x, s.z);
      const tie = [s.x, sg + K.lengthM - K.buriedM - B.rope.tieBelowTopM, s.z];
      const q = turn(bone, meshes.bow), c = Math.cos(yaw), sn = Math.sin(yaw);
      const bow = [c * q[0] + sn * q[2] + x, q[1] + y, -sn * q[0] + c * q[2] + z];
      const e = [bow[0] - tie[0], bow[1] - tie[1], bow[2] - tie[2]], el = Math.hypot(e[0], e[1], e[2]) || 1;
      const d = [e[0] / el, e[1] / el, e[2] / el];
      const xl = Math.hypot(d[2], d[0]) || 1, ex = [d[2] / xl, 0, -d[0] / xl];
      const ey = [d[1] * ex[2] - d[2] * ex[1], d[2] * ex[0] - d[0] * ex[2], d[0] * ex[1] - d[1] * ex[0]];
      const ropeBone = new Float32Array([...ex, 0, ...ey, 0, ...e, 0, 0, 0, 0, 1]);

      pass.setBeings([
        { x, y, z, yaw, size: 1, mesh: 'hull', bones: bone },
        { x: s.x, y: sg, z: s.z, yaw: 0, size: 1, mesh: 'stake', bones: IDENTITY },
        { x: tie[0], y: tie[1], z: tie[2], yaw: 0, size: 1, mesh: 'rope', bones: ropeBone },
      ]);
    },

    dispose() { hide(); mooring = null; },
  };
}
