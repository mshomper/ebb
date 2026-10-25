// The camp pieces sessions make in code (docs/future/13 section 3.12 "Models": the hearth stones,
// the camp store and the forager's trail things), read into glTF documents for build-models.mjs as
// if they were sources: a models.json entry with `made: '<name>'` in place of a file. Each is one
// mesh painted in linear vertex colours (COLOR_0), like the single log and stone, so it draws in the
// game's baked-colour passes. The builders are in made/pieces.mjs, their kit in made/kit.mjs.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Document } from '@gltf-transform/core';
import { readGlb, meshesByName } from '../../src/render/gltf.js';
import { hearthStones, campStore, campStoreGrown, gatheringKnife, seedScoop, teaCaddy, walkingStick, pressingFrame, clayBowl, clayCup } from './made/pieces.mjs';

/**
 * The single shore stone's colours (assets/models/camp/stone.glb, painted from Matt's stone pile):
 * the mean of its darker half, its middle and its palest few, linear.
 * @param {string} repo
 */
function stoneColours(repo) {
  const b = readFileSync(join(repo, 'assets/models/camp/stone.glb'));
  const glb = readGlb(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const col = [...meshesByName(glb).values()][0].attributes.COLOR_0;
  const n = col.length / 4, px = [];
  for (let i = 0; i < n; i++) px.push([col[i * 4], col[i * 4 + 1], col[i * 4 + 2]]);
  px.sort((a, c) => (0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]) - (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]));
  const mean = (/** @type {number} */ a, /** @type {number} */ z) => {
    const s = px.slice(Math.floor(n * a), Math.max(Math.floor(n * a) + 1, Math.floor(n * z)));
    return [0, 1, 2].map((k) => s.reduce((t, p) => t + p[k], 0) / s.length);
  };
  return { dark: mean(0.1, 0.5), mid: mean(0.5, 0.9), pale: mean(0.96, 1) };
}

/** @type {Record<string, (repo: string) => import('./made/pieces.mjs').Piece>} */
const PIECES = {
  'hearth-stones': (repo) => hearthStones(stoneColours(repo)),
  'camp-store': () => campStore(),
  'camp-store-grown': () => campStoreGrown(),
  'gathering-knife': () => gatheringKnife(),
  'seed-scoop': () => seedScoop(),
  'tea-caddy': () => teaCaddy(),
  'walking-stick': () => walkingStick(),
  'pressing-frame': () => pressingFrame(),
  'clay-bowl': () => clayBowl(),
  'clay-cup': () => clayCup(),
};

/** The names the builders answer to. */
export const MADE_NAMES = Object.keys(PIECES);

/**
 * A made piece as a glTF document: one node, one mesh, one primitive (position, normal, COLOR_0,
 * indices) and one plain material (its roughness and metal as numbers, no maps).
 * @param {string} name @param {string} repo the repo's root
 */
export function makePiece(name, repo) {
  const build = PIECES[name];
  if (!build) throw new Error(`no made piece "${name}" (made-pieces.mjs knows ${MADE_NAMES.join(', ')})`);
  const { mesh: m, material } = build(repo);
  const n = m.P.length / 3, colors = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { colors.set(m.C.slice(i * 3, i * 3 + 3).map((c) => Math.min(1, Math.max(0, c))), i * 4); colors[i * 4 + 3] = 1; }
  const doc = new Document();
  const buf = doc.createBuffer();
  const acc = (/** @type {string} */ type, /** @type {any} */ arr) => doc.createAccessor().setType(/** @type {any} */ (type)).setArray(arr).setBuffer(buf);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', Float32Array.from(m.P)))
    .setAttribute('NORMAL', acc('VEC3', Float32Array.from(m.N)))
    .setAttribute('COLOR_0', acc('VEC4', colors))
    .setIndices(acc('SCALAR', Uint32Array.from(m.T)))
    .setMaterial(doc.createMaterial(material.name).setRoughnessFactor(material.roughness).setMetallicFactor(material.metallic));
  doc.createScene('scene').addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  return doc;
}
