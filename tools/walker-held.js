// @ts-check
// What the walker holds, drawn on the tool pages' stage (C2, October 27, 2026; shared by
// tools/walker-strip.html and tools/walker-figure.html): the lantern hanging from the left hand as the
// game hangs it (src/world/camp/frame.js), and the driftwood staff carried on the right hand as a
// carrier is (src/world/figure/carry.js, recipes/world/staff.json), both in their base colours as the
// stage's plain shapes, in the stage's own meters (body m).

import { readGlb } from '../src/render/gltf.js';
import { campModelMesh, baseColorSampler } from '../src/world/pack/draw.js';
import { carriedOn } from '../src/world/figure/carry.js';

/** Ry(yaw) Rx(pitch) Rz(roll), as prop-draw.wgsl turns a prop. @param {{ yaw: number, pitch: number, roll: number }} c @param {number[]} v */
const turn = (c, v) => {
  const cr = Math.cos(c.roll), sr = Math.sin(c.roll), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch), cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  const r = [cr * v[0] - sr * v[1], sr * v[0] + cr * v[1], v[2]];
  const p = [r[0], cp * r[1] - sp * r[2], sp * r[1] + cp * r[2]];
  return [cy * p[0] + sy * p[2], p[1], -sy * p[0] + cy * p[2]];
};

/** The turn taking unit a onto unit b (Rodrigues), as a function. @param {number[]} a @param {number[]} b */
function fromTo(a, b) {
  const v = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], cs = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (cs > 0.99999) return (/** @type {number[]} */ p) => p;
  const k = 1 / (1 + cs);
  return (/** @type {number[]} */ p) => {
    const vp = [v[1] * p[2] - v[2] * p[1], v[2] * p[0] - v[0] * p[2], v[0] * p[1] - v[1] * p[0]];
    const vvp = [v[1] * vp[2] - v[2] * vp[1], v[2] * vp[0] - v[0] * vp[2], v[0] * vp[1] - v[1] * vp[0]];
    return [0, 1, 2].map((i) => p[i] + vp[i] + vvp[i] * k);
  };
}

/** A mesh's triangles moved: each point (its own m) through at(), each normal through nt(). @param {any} m @param {(v: number[]) => number[]} at @param {(n: number[]) => number[]} nt */
function tris(m, at, nt) {
  const out = new Float32Array(m.indices.length * 9), V = m.vertices;
  for (let t = 0; t < m.indices.length; t++) {
    const v = m.indices[t] * 9, q = at([V[v], V[v + 1], V[v + 2]]), n = nt([V[v + 3], V[v + 4], V[v + 5]]);
    out.set([q[0], q[1], q[2], n[0], n[1], n[2], V[v + 6], V[v + 7], V[v + 8]], t * 9);
  }
  return out;
}

/** @param {Float32Array[]} parts */
const join = (parts) => { const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let k = 0; for (const p of parts) { out.set(p, k); k += p.length; } return out; };

/**
 * Load the lantern and both staff looks. @param {any} R recipes/world/figure.json @param {any} built the figure (rig.js)
 * @returns {Promise<{ SR: any, held: (motion: any, o: { lantern: boolean, look: string | null }, place: number[]) => Float32Array | null }>}
 */
export async function createHeld(R, built) {
  const json = async (/** @type {string} */ p) => (await fetch(p)).json();
  const SR = await json('../recipes/world/staff.json'), C = await json('../recipes/world/camp.json');
  const DS = R.body.displayScale ?? 1;
  /** @param {string} file */
  const meshOf = async (file) => { const glb = readGlb(await (await fetch(`../${file}`)).arrayBuffer()); return campModelMesh(glb, [0.4, 0.33, 0.2], await baseColorSampler(glb)); };
  const lantern = await meshOf(C.props.models.lantern.file);
  /** @type {Record<string, any>} */ const staves = {};
  for (const l of SR.looks) staves[l.id] = await meshOf(l.model);
  const bone = (/** @type {string} */ n) => built.skeleton.findIndex((/** @type {any} */ b) => b.name === n);
  const HL = bone('hand.l'), HOLD = bone(SR.hold.bone);

  /** The lantern hanging from the left hand, turned with the figure. @param {any} motion @param {number[]} place [x, y, z, yaw] */
  function lanternTris(motion, place) {
    const m = motion.bones.subarray(HL * 16, HL * 16 + 16), p = built.skeleton[HL].pivot;
    const b = [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
    const c = Math.cos(place[3]), sn = Math.sin(place[3]), yawed = (/** @type {number[]} */ v) => [c * v[0] + sn * v[2], v[1], -sn * v[0] + c * v[2]];
    const h = yawed(b), drop = (C.lantern.carryDropM ?? 0) / DS, s = 1 / DS;
    return tris(lantern, (v) => { const q = yawed(v); return [place[0] + h[0] + q[0] * s, place[1] + h[1] - drop + q[1] * s, place[2] + h[2] + q[2] * s]; }, yawed);
  }
  /** The staff in the right hand: its grip at the hold, turned with the hand. @param {any} motion @param {string} look @param {number[]} place */
  function staffTris(motion, look, place) {
    const c = carriedOn(motion.bones, HOLD, built.skeleton[HOLD].pivot, SR.hold.at, SR.hold.turnDeg, place[3], 1);
    const s = SR.lengthM / DS;
    // Walking or standing it stays this share upright (leaning tiltDeg forward); a swing (a shot) moves it with the hand alone.
    const a = turn(c, [0, 1, 0]), tilt = (SR.hold.tiltDeg ?? 0) * Math.PI / 180, u = motion.shooting ? 0 : SR.hold.upright ?? 0;
    const want = [Math.sin(place[3]) * Math.sin(tilt), Math.cos(tilt), Math.cos(place[3]) * Math.sin(tilt)];
    const b = a.map((v, k) => v + (want[k] - v) * u), bl = Math.hypot(...b) || 1;
    const fix = fromTo(a, b.map((v) => v / bl));
    const go = (/** @type {number[]} */ v) => fix(turn(c, v));
    return tris(staves[look], (v) => { const q = go([v[0] * s, (v[1] - SR.gripM) * s, v[2] * s]); return [place[0] + c.dx + q[0], place[1] + c.dy + q[1], place[2] + c.dz + q[2]]; }, go);
  }
  return {
    SR,
    held(motion, o, place) {
      const parts = [...(o.lantern ? [lanternTris(motion, place)] : []), ...(o.look ? [staffTris(motion, o.look, place)] : [])];
      return parts.length ? join(parts) : null;
    },
  };
}
