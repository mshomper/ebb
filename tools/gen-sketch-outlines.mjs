// Field sketch outlines from the find models (docs/future/11), so the journal's drawings keep each
// find's true shape. For every subject below: pose the model as the game does, look at it from the
// given side, and trace three things in a small raster: the outline, the creases you can see (ribs,
// whorls, leg joints: edges where the surface turns sharply), and the line where the shadow side
// starts (light from the upper left). Writes src/ui/sketches/outlines.js, which the sketches draw in
// the journal pen. Run with Node from the repo root after a model changes:
//   node tools/gen-sketch-outlines.mjs
// Pure Node: reads the glTF files directly, no packages. The tracing itself is src/ui/sketches/trace.js,
// shared with the keepsakes (docs/future/12), which trace each one in the browser.

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { parseFindModel, joinParts } from '../src/world/finds/models.js';
import { parseRig, posedMesh } from '../src/world/finds/rig.js';
import { musselPair, musselBones } from '../src/world/finds/mussel.js';
import { fungusMeshes } from '../src/world/finds/autumn-meshes.js';
import { bakeBody } from '../src/world/creatures/body-bake.js';
import { skeletonOf, skinWeights } from '../src/world/creatures/bodies.js';
import { poseSkeleton, axisAngle } from '../src/world/creatures/pose.js';
import { posePatrol } from '../src/world/creatures/patrol.js';
import { trace } from '../src/ui/sketches/trace.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const recipe = JSON.parse(readFileSync(join(ROOT, 'recipes/species/finds.json'), 'utf8'));
const K = recipe.kinds;
// Autumn's fungi are built in code (src/world/finds/autumn-meshes.js): traced from those meshes.
const fungi = fungusMeshes(JSON.parse(readFileSync(join(ROOT, 'recipes/species/autumn-finds.json'), 'utf8')).fungi);

/** @param {string} url */
function gltfAt(url) {
  const file = join(ROOT, url);
  const gltf = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const buffers = gltf.buffers.map((/** @type {any} */ b) => { const n = readFileSync(join(dirname(file), b.uri)); return n.buffer.slice(n.byteOffset, n.byteOffset + n.byteLength); });
  return { gltf, buffers };
}
/** @param {any} M a kind's or item's model block @param {(p: number[], k: number) => number[]} [move] */
function meshOf(M, move) {
  const { gltf, buffers } = gltfAt(M.url);
  if (M.rigged) return posedMesh(parseRig(gltf, buffers, M.heightM, M.rotDeg), 0);
  return joinParts(parseFindModel(gltf, buffers), M.heightM, M.rotDeg, move ?? ((p) => p), M.tint);
}
/** The anemone shut, as src/world/finds/index.js shutAnemone draws it. */
function shutMove(/** @type {any} */ A) {
  const parts = parseFindModel(...Object.values(gltfAt(A.url)));
  let top = 0;
  for (let i = 0; i < parts[A.bodyPart].count; i++) top = Math.max(top, parts[A.bodyPart].vertices[i * 9 + 1]);
  const S = A.shut;
  return (/** @type {number[]} */ p, /** @type {number} */ k) => {
    if (k === A.bodyPart) { const t = Math.max(0, Math.min(1, p[1] / top)); const r = S.widen * (1 - S.close * t * t); return [p[0] * r, p[1] * S.sink, p[2] * r]; }
    const r = S.fold * (1 - S.close);
    return [p[0] * r, top * S.sink + (p[1] - top) * S.fold, p[2] * r];
  };
}

const item = (/** @type {string} */ id) => K.shells.items.find((/** @type {any} */ i) => i.id === id).model;
// yaw turns the model about up before looking; pitch tips the view down toward the top (90: from above).
const SUBJECTS = {
  'anemone-open': { mesh: meshOf(K.anemone.model), yaw: 25, pitch: 8 },
  'anemone-shut': { mesh: meshOf(K.anemone.model, shutMove(K.anemone.model)), yaw: 25, pitch: 8 },
  periwinkle: { mesh: meshOf(K.periwinkle.model), yaw: 240, pitch: 20 },
  hermitcrab: { mesh: meshOf(K.hermitcrab.model), yaw: 90, pitch: 10 },
  ediblecrab: { mesh: meshOf(K.ediblecrab.model), yaw: 0, pitch: 75 },
  'shell-periwinkle': { mesh: meshOf(item('periwinkle')), yaw: 240, pitch: 30 },
  'shell-turret': { mesh: meshOf(item('turret')), yaw: 10, pitch: 25 },
  'shell-cockle': { mesh: meshOf(item('cockle')), yaw: 0, pitch: 70 },
  'shell-murex': { mesh: meshOf(item('murex')), yaw: 20, pitch: 25 },
  'shell-nautilus': { mesh: meshOf(item('nautilus')), yaw: 0, pitch: 85 },
  mussel: { mesh: musselOpen(K.mussels.model), yaw: 15, pitch: 12 },
  sanddollar: { mesh: meshOf(K.sanddollars.model), yaw: 0, pitch: 80 },
  'fungus-bracket': { mesh: fungi['bracket-0'], yaw: 0, pitch: 32 },
  'fungus-cap': { mesh: fungi['cap-0'], yaw: 0, pitch: 10 },
  'fungus-cap-lean': { mesh: fungi['cap-2'], yaw: 90, pitch: 10 },
  // Animals with a blended-SDF body (recipes/species), posed as the game poses them at rest.
  damselfly: { mesh: perchedBody('damselfly'), yaw: 90, pitch: 8 },
};

/**
 * A flying species' body as it rests on a perch (patrol.js posePatrol: a damselfly's wings folded
 * back along its abdomen), baked from its recipe and skinned to that pose.
 * @param {string} id recipes/species/<id>.json
 */
function perchedBody(id) {
  const rec = JSON.parse(readFileSync(join(ROOT, `recipes/species/${id}.json`), 'utf8'));
  const body = rec.body;
  const mesh = bakeBody(body, rec.bake.cellM);
  const bones = skeletonOf(id, body.prims, body.bones ?? null);
  const skin = skinWeights(body.prims, bones, mesh.vertices, mesh.count, body.skin?.blendM ?? 0.0025);
  const moves = posePatrol(bones, /** @type {any} */ ({ mode: 'perch', phase: 0 }), rec.motion, [0, 0, 0, 1], axisAngle);
  const B = new Float32Array(bones.length * 16);
  poseSkeleton(bones, moves, B, 0);
  const V = mesh.vertices;
  for (let i = 0; i < mesh.count; i++) {
    const p = [V[i * 9], V[i * 9 + 1], V[i * 9 + 2]], n = [V[i * 9 + 3], V[i * 9 + 4], V[i * 9 + 5]];
    const P = [0, 0, 0], N = [0, 0, 0];
    for (let j = 0; j < 4; j++) {
      const w = skin.weights[i * 4 + j] / 255, o = skin.joints[i * 4 + j] * 16;
      if (!w) continue;
      for (let r = 0; r < 3; r++) {
        P[r] += w * (B[o + r] * p[0] + B[o + 4 + r] * p[1] + B[o + 8 + r] * p[2] + B[o + 12 + r]);
        N[r] += w * (B[o + r] * n[0] + B[o + 4 + r] * n[1] + B[o + 8 + r] * n[2]);
      }
    }
    const l = Math.hypot(...N) || 1;
    V.set([...P, N[0] / l, N[1] / l, N[2] / l], i * 9);
  }
  return mesh;
}

/** The mussel's pair, gaping as it does under water (src/world/finds/mussel.js). @param {any} M */
function musselOpen(M) {
  const pr = musselPair(meshOf(M));
  const B = musselBones(pr.hinge, (M.gapeDeg * Math.PI) / 180);
  const V = pr.mesh.vertices, half = pr.mesh.count / 2;
  for (let i = half; i < pr.mesh.count; i++) {
    const p = [V[i * 9], V[i * 9 + 1], V[i * 9 + 2]], n = [V[i * 9 + 3], V[i * 9 + 4], V[i * 9 + 5]];
    for (let r = 0; r < 3; r++) {
      V[i * 9 + r] = B[16 + r] * p[0] + B[20 + r] * p[1] + B[24 + r] * p[2] + B[28 + r];
      V[i * 9 + 3 + r] = B[16 + r] * n[0] + B[20 + r] * n[1] + B[24 + r] * n[2];
    }
  }
  return pr.mesh;
}

const out = {};
// `VIEWS=<subject>` writes that subject from twelve sides instead (<subject>@yaw,pitch), to choose a view.
if (process.env.VIEWS) {
  const base = SUBJECTS[process.env.VIEWS];
  for (const yaw of [0, 60, 120, 180, 240, 300]) for (const pitch of [5, 40]) SUBJECTS[`${process.env.VIEWS}@${yaw},${pitch}`] = { ...base, yaw, pitch };
  for (const k of Object.keys(SUBJECTS)) if (!k.includes('@')) delete SUBJECTS[k];
}
for (const [id, s] of Object.entries(SUBJECTS)) {
  out[id] = trace(s.mesh, s.yaw, s.pitch, process.env.DEBUG ? { debug: (t) => console.log(t) } : {});
  console.log(id, 'outline', out[id].outline.length, 'creases', out[id].creases.length, 'shadow', out[id].shadow.length, 'tone', out[id].tone);
}
const text = `// Generated by tools/gen-sketch-outlines.mjs from the find models; do not edit by hand.
// Each subject: aspect (height over width), outline (one closed loop), creases (visible sharp
// edges) and shadow (where the shadow side starts), as points with x 0..1 across the width and y
// down from 0, and tone (the model's mean color as seen, sRGB).
export const OUTLINES = ${JSON.stringify(out)};
`;
writeFileSync(join(ROOT, process.env.VIEWS ? 'tools/sketch-views.js' : 'src/ui/sketches/outlines.js'), text);
console.log('wrote', process.env.VIEWS ? 'tools/sketch-views.js' : 'src/ui/sketches/outlines.js', Math.round(text.length / 1024), 'KB');
