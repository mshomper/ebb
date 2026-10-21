// @ts-check
// A small GLB reader (doc 03: small code over a library): the header, the JSON chunk and the binary
// chunk, and accessors as typed arrays. Enough for our own assets (assets/figures/*.glb, made by
// tools/figure-prep/prep.py): meshes with plain, tightly packed attributes and no textures.
// Pure: no DOM, no GPU; safe in workers and tests.

const COMPONENTS = /** @type {Record<number, any>} */ ({
  5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
});
const SIZES = /** @type {Record<string, number>} */ ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 });

/**
 * @typedef {Object} Glb
 * @property {any} json                       the glTF JSON
 * @property {(i: number) => ArrayLike<number> & { length: number }} accessor   accessor i as a typed array (a copy, so it owns its buffer)
 */

/**
 * Read a GLB file. Throws on anything that is not a version 2 GLB with a JSON chunk.
 * @param {ArrayBuffer} buffer
 * @returns {Glb}
 */
export function readGlb(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file');
  if (view.getUint32(4, true) !== 2) throw new Error(`GLB version ${view.getUint32(4, true)}, want 2`);
  const total = Math.min(view.getUint32(8, true), buffer.byteLength);
  let at = 12;
  /** @type {any} */ let json = null;
  /** @type {Uint8Array | null} */ let bin = null;
  while (at + 8 <= total) {
    const len = view.getUint32(at, true), type = view.getUint32(at + 4, true);
    const body = new Uint8Array(buffer, at + 8, len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body));
    else if (type === 0x004e4942) bin = body;
    at += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return {
    json,
    accessor(i) {
      const a = json.accessors[i];
      const Type = COMPONENTS[a.componentType], n = SIZES[a.type];
      if (!Type || !n) throw new Error(`accessor ${i}: unsupported ${a.componentType} ${a.type}`);
      if (!bin) throw new Error('GLB has no binary chunk');
      const bv = json.bufferViews[a.bufferView];
      if (bv.byteStride && bv.byteStride !== n * Type.BYTES_PER_ELEMENT) throw new Error(`accessor ${i}: interleaved data is not supported`);
      const start = bin.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
      return new Type(bin.buffer.slice(start, start + a.count * n * Type.BYTES_PER_ELEMENT));
    },
  };
}

/**
 * Every mesh's first primitive by node name: its attributes (by glTF name) and indices.
 * @param {Glb} glb
 * @returns {Map<string, { attributes: Record<string, ArrayLike<number>>, indices: Uint32Array }>}
 */
export function meshesByName(glb) {
  const out = new Map();
  for (const node of glb.json.nodes ?? []) {
    if (node.mesh === undefined) continue;
    const prim = glb.json.meshes[node.mesh].primitives[0];
    /** @type {Record<string, ArrayLike<number>>} */ const attributes = {};
    for (const [k, i] of Object.entries(prim.attributes)) attributes[k] = glb.accessor(/** @type {number} */ (i));
    const idx = glb.accessor(prim.indices);
    out.set(node.name ?? `mesh${node.mesh}`, { attributes, indices: idx instanceof Uint32Array ? idx : Uint32Array.from(idx) });
  }
  return out;
}
