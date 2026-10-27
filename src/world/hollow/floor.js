// @ts-check
// Making a Hollow floor (H1, the floor maker; doc 16, How it is built): plan it (plan.js), dress it
// in its depth's shapes (shapes.js), sample its field (field.js) in slabs across the worker pool,
// mesh it by surface nets in a worker (src/world/mesh/surface-nets.js), and read its walk grid from
// the mesh (walk-grid.js). A floor the walker can't cross from the way in to the way down is made
// again from the next seed (the plan's attempt), and every try is reported. buildFloor does it all
// in one go (tests, and the worker's own path); makeFloor spreads it over the pool so the page
// never blocks. Both give the same floor, bit for bit: the same plan and mesh hash.

import { planFloor } from './plan.js';
import { dressFloor } from './shapes.js';
import { fieldSlab, floorBounds } from './field.js';
import { surfaceNets, gridNormals } from '../mesh/surface-nets.js';
import { walkGridFromMesh, wrapGrid, checkWalkable } from './walk-grid.js';

/** FNV-1a over 32-bit words. @param {ArrayLike<number>} words @param {number} [h] */
function fnv(words, h = 0x811c9dc5) {
  for (let i = 0; i < words.length; i++) {
    const w = words[i] >>> 0;
    for (let b = 0; b < 32; b += 8) { h ^= (w >>> b) & 0xff; h = Math.imul(h, 0x01000193); }
  }
  return h >>> 0;
}

/** A plan's hash: its JSON's characters. @param {any} plan */
export function planHash(plan) {
  const s = JSON.stringify(plan);
  const codes = new Uint32Array(s.length);
  for (let i = 0; i < s.length; i++) codes[i] = s.charCodeAt(i);
  return fnv(codes);
}

/** A mesh's hash: its vertex floats' bits and its indices. @param {{ vertices: Float32Array, indices: Uint32Array }} m */
export function meshHash(m) {
  return fnv(m.indices, fnv(new Uint32Array(m.vertices.buffer, m.vertices.byteOffset, m.vertices.length)));
}

/**
 * Mesh a sampled field: positions and normals (6 floats a vertex) and triangles.
 * @param {Float32Array} field @param {{ min: number[], n: number[], cellM: number }} bounds
 * @returns {{ vertices: Float32Array, indices: Uint32Array, triangles: number }}
 */
export function meshField(field, bounds) {
  const { pos, idx, count } = surfaceNets(field, bounds.n, bounds.min, bounds.cellM);
  const nrm = gridNormals(field, bounds.n, bounds.min, bounds.cellM, pos, count);
  const vertices = new Float32Array(count * 6);
  for (let v = 0; v < count; v++) {
    vertices[v * 6] = pos[v * 3]; vertices[v * 6 + 1] = pos[v * 3 + 1]; vertices[v * 6 + 2] = pos[v * 3 + 2];
    vertices[v * 6 + 3] = nrm[v * 3]; vertices[v * 6 + 4] = nrm[v * 3 + 1]; vertices[v * 6 + 5] = nrm[v * 3 + 2];
  }
  return { vertices, indices: idx, triangles: idx.length / 3 };
}

/**
 * The worker's half: mesh a whole field, read the walk grid and check it.
 * @param {{ field: Float32Array, bounds: any, dressed: any, W: any }} args
 */
export function meshJob({ field, bounds, dressed, W }) {
  const t0 = performance.now();
  const mesh = meshField(field, bounds);
  const t1 = performance.now();
  const g = walkGridFromMesh(mesh, bounds, dressed, W);
  const check = checkWalkable(g, dressed.plan, W);
  const t2 = performance.now();
  const grid = { cellM: g.cellM, w: g.w, h: g.h, minX: g.minX, minZ: g.minZ, height: g.height, steep: g.steep, floor: g.floor, water: g.water, room: g.room };
  return {
    mesh, grid, check, meshMs: t1 - t0, gridMs: t2 - t1,
    __transfer: [mesh.vertices.buffer, mesh.indices.buffer, g.height.buffer, g.steep.buffer, g.floor.buffer, g.water.buffer, g.room.buffer, check.reached.buffer],
  };
}

/**
 * @typedef {Object} FloorTry
 * @property {number} attempt
 * @property {boolean} ok
 * @property {string} reason
 */
/**
 * @typedef {Object} Floor
 * @property {import('./plan.js').FloorPlan} plan
 * @property {any} dressed
 * @property {{ min: number[], n: number[], cellM: number }} bounds
 * @property {{ vertices: Float32Array, indices: Uint32Array, triangles: number }} mesh
 * @property {import('./walk-grid.js').HollowGrid} grid
 * @property {ReturnType<typeof checkWalkable>} check
 * @property {FloorTry[]} tries every seed tried, the last the one kept
 * @property {number} planHash
 * @property {number} meshHash
 * @property {{ fieldMs: number, meshMs: number, gridMs: number, totalMs: number }} timing
 */

/** @param {any} F @param {any} inputs @param {number} attempt */
function prepare(F, inputs, attempt) {
  const plan = planFloor({ ...inputs, attempt }, F);
  const dressed = dressFloor(plan, F);
  return { plan, dressed, bounds: floorBounds(dressed, F.mesh) };
}

/**
 * Make a floor in one go (no workers). Tries the next seed while the floor isn't walkable end to end.
 * @param {any} inputs planFloor's inputs @param {any} F recipe floors
 * @returns {Floor}
 */
export function buildFloor(inputs, F) {
  /** @type {FloorTry[]} */ const tries = [];
  const t0 = performance.now();
  for (let attempt = 0; ; attempt++) {
    const { plan, dressed, bounds } = prepare(F, inputs, attempt);
    const tf = performance.now();
    const { field } = fieldSlab({ dressed, bounds, k0: 0, k1: bounds.n[2], clampM: F.mesh.clampM });
    const fieldMs = performance.now() - tf;
    const r = meshJob({ field, bounds, dressed, W: F.walk });
    tries.push({ attempt, ok: r.check.ok, reason: r.check.reason });
    if (r.check.ok || attempt >= F.walk.retries) {
      return { plan, dressed, bounds, mesh: r.mesh, grid: wrapGrid(r.grid), check: r.check, tries, planHash: planHash(plan), meshHash: meshHash(r.mesh), timing: { fieldMs, meshMs: r.meshMs, gridMs: r.gridMs, totalMs: performance.now() - t0 } };
    }
  }
}

/**
 * Make a floor across the worker pool: the field in slabs on every core, then the mesh and walk grid
 * in one worker. The same floor as buildFloor.
 * @param {any} inputs @param {any} F recipe floors
 * @param {{ run: (job: { module: string, fn: string }, args: any, opts?: any) => Promise<any>, slabs?: number, keepField?: boolean }} pool
 *   src/core/workers.js run; keepField keeps the sampled field on the result
 * @returns {Promise<Floor & { field?: Float32Array }>}
 */
export async function makeFloor(inputs, F, pool) {
  /** @type {FloorTry[]} */ const tries = [];
  const t0 = performance.now();
  const slabs = pool.slabs ?? F.mesh.slabs;
  for (let attempt = 0; ; attempt++) {
    const { plan, dressed, bounds } = prepare(F, inputs, attempt);
    const tf = performance.now();
    const nz = bounds.n[2], per = Math.ceil(nz / slabs);
    /** @type {Promise<any>[]} */ const jobs = [];
    for (let k0 = 0; k0 < nz; k0 += per) {
      jobs.push(pool.run({ module: './world/hollow/field.js', fn: 'fieldSlab' }, { dressed, bounds, k0, k1: Math.min(nz, k0 + per), clampM: F.mesh.clampM }, { lane: 'interactive' }));
    }
    const parts = await Promise.all(jobs);
    const plane = bounds.n[0] * bounds.n[1];
    const field = new Float32Array(plane * nz);
    for (const p of parts) field.set(p.field, p.k0 * plane);
    const fieldMs = performance.now() - tf;
    // The cave lab keeps a copy to draw the field's sections; the original goes to the mesh worker.
    const kept = pool.keepField ? field.slice() : undefined;
    const r = await pool.run({ module: './world/hollow/floor.js', fn: 'meshJob' }, { field, bounds, dressed, W: F.walk }, { lane: 'interactive', transfer: [field.buffer] });
    tries.push({ attempt, ok: r.check.ok, reason: r.check.reason });
    if (r.check.ok || attempt >= F.walk.retries) {
      return { plan, dressed, bounds, mesh: r.mesh, grid: wrapGrid(r.grid), check: r.check, tries, planHash: planHash(plan), meshHash: meshHash(r.mesh), timing: { fieldMs, meshMs: r.meshMs, gridMs: r.gridMs, totalMs: performance.now() - t0 }, field: kept };
    }
  }
}

/** A worker job: the one-thread floor's hashes, to check the pool's floor against. @param {{ inputs: any, F: any }} args */
export function floorHashes({ inputs, F }) {
  const f = buildFloor(inputs, F);
  return { planHash: f.planHash, meshHash: f.meshHash, attempts: f.tries.length };
}
