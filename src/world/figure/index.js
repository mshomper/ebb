// @ts-check
// The walker's figure (doc 23, W5): you, on foot. Loads assets/figures/walker.glb (Matt's model,
// coloured per vertex), rigs it (rig.js), moves it gently from the walker's state (motion.js) and
// draws it with the creature pass and the figure shader (eyes that blink and change). Drawing only:
// it reads where the walker is and never changes it. Numbers: recipes/world/figure.json.

import { readGlb } from '../../render/gltf.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { buildFigure } from './rig.js';
import { createFigureMotion } from './motion.js';

const EXTRA = 20;

/** Fetch the model named by the recipe (a path from the repo root). @param {any} R */
export async function loadFigureModel(R) {
  const url = new URL(`../../../${R.model}`, import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`figure model ${R.model}: ${res.status}`);
  return readGlb(await res.arrayBuffer());
}

/**
 * The eye uniforms the figure shader reads (lib-figure-eyes.wgsl FigureEyes).
 * @param {any} E recipes/world/figure.json eyes @param {number} headBone @param {number[]} state from eyes.js
 * @param {Float32Array} [out]
 */
export function eyeUniforms(E, headBone, state, out = new Float32Array(EXTRA)) {
  out.set([E.centre[0], E.centre[1], E.halfSpacing, E.centre[2] + 0.05,
    E.radii[0], E.radii[1], E.glowNits, headBone,
    E.albedo[0], E.albedo[1], E.albedo[2], 0,
    state[0], state[1], state[2], state[3],
    state[4], state[5], 0, 0]);
  return out;
}

/**
 * The figure's draw pass, ready before the model has loaded (the frame graph takes it at boot).
 * @param {any} R recipes/world/figure.json @param {string} [name]
 */
export function createFigurePass(R, name = 'figure') {
  return createCreaturePass({ recipe: R, name, shader: 'figure-draw', maxBones: R.bones.length, extraFloats: EXTRA });
}

/**
 * @param {{ recipe: any, glb: import('../../render/gltf.js').Glb, pass?: ReturnType<typeof createFigurePass> }} o
 *   recipe: recipes/world/figure.json; glb: the model, read (loadFigureModel); pass: one made earlier by createFigurePass
 */
export function createFigure(o) {
  const R = o.recipe;
  const built = buildFigure(o.glb, R);
  const motion = createFigureMotion(R, built.skeleton);
  const headBone = built.skeleton.findIndex((b) => b.name === 'head');
  const pass = o.pass ?? createFigurePass(R);
  pass.setMesh('figure', { data: built.data, indices: built.indices });
  const uniforms = new Float32Array(EXTRA);
  let visible = false;
  return {
    pass,
    motion,
    skeleton: built.skeleton,
    /** Vertices and triangles, for the tools page's cost line. */
    size: { vertices: built.count, triangles: built.indices.length / 3, bytes: built.data.byteLength + built.indices.byteLength },
    /**
     * Each frame: pose from the walker's state and hand the pose to the pass. Returns the footfalls.
     * @param {number} dt @param {import('./motion.js').FigureInput & { placed: boolean }} s
     */
    update(dt, s) {
      visible = s.placed;
      if (!visible) { pass.setBeings([]); return []; }
      const r = motion.update(dt, s);
      pass.setBeings([{ x: s.x, y: s.y, z: s.z, yaw: r.yaw, size: R.body.displayScale ?? 1, bones: motion.bones }]);
      pass.setExtra(eyeUniforms(R.eyes, headBone, r.eyes, uniforms));
      return r.footfalls;
    },
  };
}

/** @typedef {ReturnType<typeof createFigure>} Figure */
