// @ts-check
// The gathering knife on the walker's belt (the forager's trail, P2k; recipes/world/forager.json
// knife). Once the trail gives it, the knife (assets/models/camp/gathering-knife.glb, made point down
// with its point at the origin) hangs at the hip, carried by the figure's pelvis so it moves with the
// walk. A creature pass with baked vertex colours, as the pack's pickups are drawn. Drawing only.

import { readGlb } from '../render/gltf.js';
import { createCreaturePass } from '../render/passes/creatures.js';
import { packMesh } from './creatures/bodies.js';
import { campModelMesh } from './pack/draw.js';

/**
 * @param {{ recipe: any, figure: any, walk: { pointOn: (bone: string, p: number[]) => { x: number, y: number, z: number, yaw: number } | null },
 *   has: () => boolean }} o recipe: forager.json; figure: figure.json; has: is the knife given
 */
export function createForagerBelt(o) {
  const K = o.recipe.knife, B = K.belt;
  const pass = createCreaturePass({ recipe: { body: { scaleReal: [0.1, 0.1], contactShadow: 0, wetSpecular: { roughness: 0.55, strength: 0.1 } } }, maxBones: 1, name: 'forager-belt' });
  let ready = false;
  fetch(new URL(`../../${K.model}`, import.meta.url))
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
    .then((b) => { const m = campModelMesh(readGlb(b), K.color); pass.setMesh('knife', { data: packMesh(m), indices: m.indices }); ready = true; })
    .catch((e) => console.info(`forager: ${K.model} not loaded, no knife on the belt (${e.message})`));
  const size = (o.figure.body.displayScale ?? 1) * (B.scale ?? 1);
  return {
    pass,
    /** Each frame: the knife at the hip while it is given and the figure is out. */
    update() {
      const at = ready && o.has() ? o.walk.pointOn(B.bone, B.at) : null;
      pass.setBeings(at ? [{ x: at.x, y: at.y, z: at.z, yaw: at.yaw, size, mesh: 'knife' }] : []);
    },
  };
}
