// @ts-check
// Creature tests for tools/unit-tests.html: the frog body bakes to the same clean mesh every time,
// at its real size, and the frog size preview finds its spots around a pond.

import { bakeBody } from '../src/world/creatures/body-bake.js';
import { previewSpots } from '../src/world/creatures/preview-spots.js';
import { bakeVariant, bodyFor, VERTEX_BYTES, MAX_BONES } from '../src/world/creatures/bodies.js';
import { FROG_BONES, FROG_SHAPE_KEYS, shapeFrogPrims } from '../src/world/creatures/rigs/frog.js';
import { poseSkeleton } from '../src/world/creatures/pose.js';
import { shoreline } from './unit-tests-growth.js';
import { valueSpans, changedPaths, patchText } from './recipe-text.js';

const CREATURES = 'creatures';

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addCreatureTests(test, assert, eq) {
  test(CREATURES, 'the frog body bakes to the same clean mesh twice, at real size', async () => {
    const r = await fetch('../recipes/species/frog.json').then((x) => x.json());
    const a = bakeBody(r.body, r.bake.cellM);
    const b = bakeBody(r.body, r.bake.cellM);
    eq(a.vertices.length, b.vertices.length, 'vertex floats');
    let same = true;
    for (let i = 0; i < a.vertices.length; i++) if (a.vertices[i] !== b.vertices[i]) { same = false; break; }
    assert(same, 'identical vertices');
    assert(a.vertices.every(Number.isFinite), 'every number finite');
    let maxIdx = 0;
    for (const i of a.indices) maxIdx = Math.max(maxIdx, i);
    assert(maxIdx < a.count, 'indices in range');
    // Real size: the mesh's length (z) and height sit inside a common frog's.
    let z0 = Infinity, z1 = -Infinity, y1 = -Infinity;
    for (let v = 0; v < a.count; v++) { z0 = Math.min(z0, a.vertices[v * 9 + 2]); z1 = Math.max(z1, a.vertices[v * 9 + 2]); y1 = Math.max(y1, a.vertices[v * 9 + 1]); }
    const len = z1 - z0;
    assert(len > 0.06 && len < 0.1, `length ${(len * 100).toFixed(1)} cm`);
    assert(y1 > 0.03 && y1 < 0.06, `height ${(y1 * 100).toFixed(1)} cm`);
    return `${a.count} vertices, ${a.indices.length / 3} triangles; ${(len * 100).toFixed(1)} cm long, ${(y1 * 100).toFixed(1)} cm tall`;
  });

  test(CREATURES, 'the frog rig at every proportion 1 gives exactly the recipe body; proportions reshape it', async () => {
    const r = await fetch('../recipes/species/frog.json').then((x) => x.json());
    const ones = Object.fromEntries(FROG_SHAPE_KEYS.map((k) => [k, 1]));
    eq(JSON.stringify(shapeFrogPrims(r.body.prims, ones)), JSON.stringify(r.body.prims), 'prims at all 1');
    eq(JSON.stringify(bodyFor('frog', r.body, -1).prims), JSON.stringify(r.body.prims), 'the plain body (variant -1)');
    const big = shapeFrogPrims(r.body.prims, { ...ones, headSize: 1.2 });
    const head = (/** @type {any[]} */ p) => p.find((q) => q.bone === 'head');
    const eye = (/** @type {any[]} */ p) => p.find((q) => q.bone === 'eye.l');
    assert(head(big).ra > head(r.body.prims).ra && eye(big).r > eye(r.body.prims).r, 'a bigger head carries bigger eyes');
    const tall = shapeFrogPrims(r.body.prims, { ...ones, torsoHgt: 1.15 });
    const foot = (/** @type {any[]} */ p) => p.find((q) => q.bone === 'foot.l');
    assert(Math.abs(foot(tall).b[1] - foot(r.body.prims).b[1]) < 0.001, 'a taller body keeps its feet on the ground');
    return `${FROG_SHAPE_KEYS.length} proportions; at 1 the body is unchanged`;
  });

  test(CREATURES, 'body variants bake the same twice, differ from each other, and carry a skeleton read from the pieces', async () => {
    const r = await fetch('../recipes/species/frog.json').then((x) => x.json());
    const cellM = 0.0033;
    const a = bakeVariant({ id: 'frog', body: r.body, variant: 2, cellM });
    const b = bakeVariant({ id: 'frog', body: r.body, variant: 2, cellM });
    const c = bakeVariant({ id: 'frog', body: r.body, variant: 3, cellM });
    const same = (/** @type {ArrayBuffer} */ x, /** @type {ArrayBuffer} */ y) => x.byteLength === y.byteLength && new Uint8Array(x).every((v, i) => v === new Uint8Array(y)[i]);
    assert(same(a.data, b.data), 'the same variant twice');
    assert(!same(a.data, c.data), 'two variants are the same');
    eq(a.bones.length, FROG_BONES.length, 'bones');
    a.bones.forEach((bone, i) => assert(bone.parent < i, `${bone.name} comes before its parent`));
    const thigh = a.bones.find((bone) => bone.name === 'thigh.l');
    const prims = bodyFor('frog', r.body, 2).prims;
    eq(JSON.stringify(thigh?.pivot), JSON.stringify(prims.find((q) => q.bone === 'thigh.l').a), 'the hip is where the thigh begins');
    // Every vertex's weights sum to a whole.
    const u = new Uint8Array(a.data);
    for (let v = 0; v < a.count; v++) {
      const s = u[v * VERTEX_BYTES + 40] + u[v * VERTEX_BYTES + 41] + u[v * VERTEX_BYTES + 42] + u[v * VERTEX_BYTES + 43];
      if (s !== 255) throw new Error(`vertex ${v} weights sum to ${s}`);
    }
    return `${a.count} vertices at ${cellM * 1000} mm, ${a.bones.length} bones`;
  });

  test(CREATURES, 'the creature studio saves only the numbers you moved, in the recipe file\'s own layout', async () => {
    const text = await fetch('../recipes/species/frog.json').then((x) => x.text());
    const base = JSON.parse(text);
    eq(patchText(text, base, changedPaths(base, base)), text, 'nothing moved: the file as it was');
    const next = JSON.parse(text);
    next.body.shape.headSize = 1.08;
    next.body.albedo.back = [0.1, 0.17, 0.08];
    next.motion.breath.hz = 1.3;
    const paths = changedPaths(base, next);
    eq(paths.join(','), 'body.albedo.back,body.shape.headSize,motion.breath.hz', 'changed paths');
    const out = patchText(text, next, paths);
    eq(JSON.stringify(JSON.parse(out)), JSON.stringify(next), 'the saved file reads back as the edited recipe');
    const a = text.split('\n'), b = out.split('\n');
    eq(a.length, b.length, 'lines in the file');
    const moved = a.filter((l, i) => l !== b[i]).length;
    eq(moved, 3, 'lines changed for three edits');
    return `three edits change three lines; ${valueSpans(text).size} values found in the file`;
  });

  test(CREATURES, 'a still skeleton draws the body as baked; a blink moves only the eyes', async () => {
    const r = await fetch('../recipes/species/frog.json').then((x) => x.json());
    const a = bakeVariant({ id: 'frog', body: r.body, variant: 0, cellM: 0.0033 });
    const f = new Float32Array(a.data), u = new Uint8Array(a.data);
    const mats = new Float32Array(MAX_BONES * 16);
    /** Skin vertex v on the CPU the way the shader does. @param {number} v */
    const skin = (v) => {
      const p = [f[v * 11], f[v * 11 + 1], f[v * 11 + 2], 1], out = [0, 0, 0];
      for (let i = 0; i < 4; i++) {
        const w = u[v * VERTEX_BYTES + 40 + i] / 255, m = u[v * VERTEX_BYTES + 36 + i] * 16;
        for (let r2 = 0; r2 < 3; r2++) out[r2] += w * (mats[m + r2] * p[0] + mats[m + 4 + r2] * p[1] + mats[m + 8 + r2] * p[2] + mats[m + 12 + r2] * p[3]);
      }
      return out;
    };
    poseSkeleton(a.bones, a.bones.map(() => null), mats, 0);
    let worst = 0;
    for (let v = 0; v < a.count; v++) { const s = skin(v); worst = Math.max(worst, Math.hypot(s[0] - f[v * 11], s[1] - f[v * 11 + 1], s[2] - f[v * 11 + 2])); }
    assert(worst < 1e-6, `a still skeleton moved a vertex ${worst} m`);
    // A blink, fully closed: the eyes sink under their lids, a little flattened; the feet do not move.
    const K = r.motion.blink;
    const blink = a.bones.map((bone) => (bone.name.startsWith('eye') ? { s: [1, K.squash, 1], t: [0, -K.retractM, 0] } : null));
    poseSkeleton(a.bones, blink, mats, 0);
    let eyeMove = 0, footMove = 0;
    for (let v = 0; v < a.count; v++) {
      const s = skin(v), d = Math.hypot(s[0] - f[v * 11], s[1] - f[v * 11 + 1], s[2] - f[v * 11 + 2]);
      if (f[v * 11 + 1] > 0.035) eyeMove = Math.max(eyeMove, d);
      if (f[v * 11 + 1] < 0.004 && f[v * 11 + 2] < -0.02) footMove = Math.max(footMove, d);
    }
    assert(eyeMove > 0.002, `the eyes moved only ${(eyeMove * 1000).toFixed(2)} mm in a blink`);
    assert(footMove < 1e-6, `the hind feet moved ${(footMove * 1000).toFixed(3)} mm in a blink`);
    return `eyes ${(eyeMove * 1000).toFixed(1)} mm in a blink, feet still`;
  });

  test(CREATURES, 'the size preview sets frogs on the bank and in the shallows of a pond', () => {
    const hab = shoreline();
    const found = previewSpots(hab, { plants: [] }, { ground: () => 1, surface: () => 1.1, from: [0, 60] });
    assert(found, 'spots found on the shoreline');
    const f = /** @type {NonNullable<typeof found>} */ (found);
    eq(f.spots.filter((s) => s.where === 'bank').length, 4, 'frogs on the bank');
    assert(f.edgeM > 0 && f.pondM2 > 0, `pond edge ${f.edgeM} m, area ${f.pondM2} m2`);
    return `pond edge about ${f.edgeM} m; ${f.spots.map((s) => s.where).join(', ')}`;
  });
}
