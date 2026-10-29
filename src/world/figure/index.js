// @ts-check
// The walker's figure (doc 23, W5): you, on foot. Loads assets/figures/walker.glb (Matt's model,
// coloured per vertex), rigs it (rig.js), moves it gently from the walker's state (motion.js) and
// draws it with the creature pass and the figure shader (eyes that blink and change). Drawing only:
// it reads where the walker is and never changes it. Numbers: recipes/world/figure.json.

import { readGlb } from '../../render/gltf.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { buildFigure } from './rig.js';
import { createFigureMotion } from './motion.js';
import { carriedOn, partIndices } from './carry.js';

export { loadFigureClips } from './clips.js';

/** The eyes' 20 floats, the painted straps' 12 (figure-draw.wgsl FigureStraps), then the hat band's 12 (lib-figure-band.wgsl). */
const EXTRA = 44;

/** Fetch the model named by the recipe (a path from the repo root). @param {any} R */
export async function loadFigureModel(R) {
  const url = new URL(`../../../${R.model}`, import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`figure model ${R.model}: ${res.status}`);
  return readGlb(await res.arrayBuffer());
}

/**
 * The eye uniforms the figure shader reads (lib-figure-eyes.wgsl FigureEyes).
 * @param {any} E recipes/world/figure.json eyes @param {number} headBone
 * @param {number[]} state from eyes.js, then the look's shift across the face (look.js, m: x left, y up)
 * @param {Float32Array} [out]
 */
export function eyeUniforms(E, headBone, state, out = new Float32Array(EXTRA)) {
  out.set([E.centre[0], E.centre[1], E.halfSpacing, E.centre[2] + 0.05,
    E.radii[0], E.radii[1], E.glowNits, headBone,
    E.albedo[0], E.albedo[1], E.albedo[2], 0,
    state[0], state[1], state[2], state[3],
    state[4], state[5], state[6] ?? 0, state[7] ?? 0]);
  return out;
}

/**
 * The painted straps' uniforms (figure-draw.wgsl FigureStraps), after the eyes' 20 floats: the
 * left strap's top and foot (rest m, x and y), on (0 or 1), half width, back z and top y, colour.
 * @param {any} S recipes/world/figure.json straps @param {boolean} on @param {Float32Array} out
 */
export function strapUniforms(S, on, out) {
  if (!S) return out;
  out.set([S.from[0], S.from[1], S.to[0], S.to[1], on ? 1 : 0, S.halfWidthM, S.backZ, S.topY, S.colour[0], S.colour[1], S.colour[2], S.edgeShade ?? 1], 20);
  return out;
}

/**
 * The hat band's uniforms (lib-figure-band.wgsl FigureHatBand), after the straps: on, foot and top
 * (rest y), the least distance from the crown's axis, the axis (x, z), feathers round, bar shade,
 * colour and quill. @param {any} B recipes/world/figure.json hatBand @param {boolean} on
 * @param {Float32Array} out @param {number} [at] where its 12 floats start
 */
export function hatBandUniforms(B, on, out, at = 32) {
  if (!B) return out;
  out.set([on ? 1 : 0, B.footY, B.topY, B.minR, B.crown[0], B.crown[1], B.feathers, B.barShade, B.colour[0], B.colour[1], B.colour[2], B.quill], at);
  return out;
}

/**
 * The figure's draw pass, ready before the model has loaded (the frame graph takes it at boot).
 * @param {any} R recipes/world/figure.json @param {string} [name]
 */
export function createFigurePass(R, name = 'figure') {
  return createCreaturePass({ recipe: R, name, shader: 'figure-draw', maxBones: R.bones.length, extraFloats: EXTRA, maps: true });
}

/**
 * @param {{ recipe: any, glb: import('../../render/gltf.js').Glb, clips?: import('./clips.js').ClipFile | null, pass?: ReturnType<typeof createFigurePass> }} o
 *   recipe: recipes/world/figure.json; glb: the model, read (loadFigureModel); clips: Matt's clips
 *   (loadFigureClips; without them the code's own stride and roll play); pass: one made earlier by createFigurePass
 */
export function createFigure(o) {
  const R = o.recipe;
  // The baked texture (prep.py): the colour slot carries each vertex's UV, and the pass the maps.
  const built = buildFigure(o.glb, R, { textured: true });
  const motion = createFigureMotion(R, built.skeleton, o.clips ?? null);
  const headBone = built.skeleton.findIndex((b) => b.name === 'head');
  const pass = o.pass ?? createFigurePass(R);
  if (built.textured) pass.setMaps(o.glb).catch((err) => console.error('The walker maps did not load:', err));
  pass.setMesh('figure', { data: built.data, indices: built.indices });
  // The pack alone, to hang at camp while another carrier is worn (P2f): its own triangles of the
  // same vertices, drawn unposed.
  const packPart = built.parts.pack, packPivot = built.skeleton.find((b) => b.name === 'pack')?.pivot ?? [0, 1, 0];
  if (packPart !== undefined) pass.setMesh('pack', { data: built.data, indices: partIndices(built.indices, built.partOf, packPart) });
  const packLow = packPart !== undefined ? built.partLow[packPart] ?? packPivot[1] : packPivot[1];
  /** Where the pack stands at camp (the ground under its pivot, world m, and the way its back faces), or null. @type {{ x: number, y: number, z: number, yaw: number } | null} */
  let hung = null;
  const uniforms = new Float32Array(EXTRA);
  let visible = false, straps = false, hatBand = false;
  /** Where the figure stood and faced last frame, for hand(). */
  let at = { x: 0, y: 0, z: 0, yaw: 0 };
  const hands = { l: built.skeleton.findIndex((b) => b.name === 'hand.l'), r: built.skeleton.findIndex((b) => b.name === 'hand.r') };
  /** A point of the rest model (m) as bone i holds it now, in the world, and the way the figure faces. @param {number} i @param {number[]} p */
  function pointOf(i, p) {
    if (!visible || i < 0) return null;
    const m = motion.bones.subarray(i * 16, i * 16 + 16), k = R.body.displayScale ?? 1;
    const bx = (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) * k;
    const by = (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) * k;
    const bz = (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]) * k;
    const c = Math.cos(at.yaw), s = Math.sin(at.yaw);
    return { x: at.x + c * bx + s * bz, y: at.y + by, z: at.z - s * bx + c * bz, yaw: at.yaw };
  }
  return {
    pass,
    motion,
    skeleton: built.skeleton,
    /**
     * Where a hand is now in the world (its wrist pivot as posed, m), and the way the figure faces,
     * for what it holds (the lantern, the fire steel). Null before the first frame.
     * @param {'l' | 'r'} side @returns {{ x: number, y: number, z: number, yaw: number } | null}
     */
    hand(side) {
      const i = hands[side];
      return i < 0 ? null : pointOf(i, built.skeleton[i].pivot);
    },
    /**
     * Where a point of the rest model is now, carried by a bone (the knife on the belt, by the
     * pelvis), in the world, and the way the figure faces. Null before the first frame or for a bone
     * the rig does not have. @param {string} bone @param {number[]} p rest model meters
     */
    pointOn: (bone, p) => pointOf(built.skeleton.findIndex((b) => b.name === bone), p),
    /**
     * A thing carried on a bone (P2f: a carrier), as a camp prop's place now: where its origin is and
     * how it is turned (carry.js). Null before the first frame or for a bone the rig does not have.
     * @param {string} bone @param {number[]} p its origin, rest model meters @param {number[]} turnDeg its pitch, yaw and roll on the bone
     */
    carried(bone, p, turnDeg) {
      const i = built.skeleton.findIndex((b) => b.name === bone);
      if (!visible || i < 0) return null;
      const c = carriedOn(motion.bones, i, built.skeleton[i].pivot, p, turnDeg, at.yaw, R.body.displayScale ?? 1);
      return { x: at.x + c.dx, y: at.y + c.dy, z: at.z + c.dz, yaw: c.yaw, pitch: c.pitch, roll: c.roll };
    },
    /** Set the baked pack down at camp, standing on a spot (world m), or take it up (null; P2f). @param {{ x: number, y: number, z: number, yaw: number } | null} place */
    hangPack(place) { hung = place; },
    /** Paint the carrier's straps on the coat, or not (October 29, 2026). @param {boolean} on */
    wearStraps(on) { straps = on; },
    /** Paint the hen-feather band round the hat's crown, or not (docs/future/15 slice 2b). @param {boolean} on */
    wearHatBand(on) { hatBand = on; },
    /** Vertices and triangles, for the tools page's cost line. */
    size: { vertices: built.count, triangles: built.indices.length / 3, bytes: built.data.byteLength + built.indices.byteLength },
    /**
     * Each frame: pose from the walker's state and hand the pose to the pass. Returns the footfalls.
     * @param {number} dt @param {import('./motion.js').FigureInput & { placed: boolean }} s
     */
    update(dt, s) {
      visible = s.placed;
      const k = R.body.displayScale ?? 1;
      // The pack set down at camp: drawn unposed, its pivot over the spot and its base on the ground.
      const hangs = hung && packPart !== undefined ? (({ x, y, z, yaw }) => {
        const c = Math.cos(yaw), sn = Math.sin(yaw), px = packPivot[0] * k, pz = packPivot[2] * k;
        return [{ x: x - (c * px + sn * pz), y: y - packLow * k, z: z - (-sn * px + c * pz), yaw, size: k, mesh: 'pack', bones: null }];
      })(hung) : [];
      if (!visible) { pass.setBeings(hangs); return []; }
      const r = motion.update(dt, s);
      at = { x: s.x, y: s.y, z: s.z, yaw: r.yaw };
      pass.setBeings([{ x: s.x, y: s.y, z: s.z, yaw: r.yaw, size: k, bones: motion.bones }, ...hangs]);
      pass.setExtra(hatBandUniforms(R.hatBand, hatBand, strapUniforms(R.straps, straps, eyeUniforms(R.eyes, headBone, r.eyes, uniforms))));
      return r.footfalls;
    },
  };
}

/** @typedef {ReturnType<typeof createFigure>} Figure */
