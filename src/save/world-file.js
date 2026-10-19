// @ts-check
// The .ebb world file (doc 18): one small container for saves, backups and shared islands.
//
//   offset  content
//   0       magic "EBB\0"
//   4       container version uint16 (1)
//   6       flags uint16 (bit0 gzip)
//   8       header length uint32
//   12      header JSON: {format, build, seed, island, savedAt, wallHighWater, worldT, worldHash,
//             sections: [{id, offset, length, crc32, codec}]}  (offsets from the end of the header)
//   ...     sections, each packed and gzipped on its own, so one bad section never loses the rest
//   end     crc32 of everything before it
//
// A section is any plain value: objects, arrays, numbers, strings, booleans and typed arrays. The
// typed arrays travel as raw bytes after the JSON (codec 'jb1'). Little-endian throughout. Pure and
// worker-safe (CompressionStream exists in workers).

import { crc32 } from './crc32.js';

export const MAGIC = [0x45, 0x42, 0x42, 0x00];   // "EBB\0"
export const CONTAINER_VERSION = 1;
const CODEC = 'jb1-gzip';
const TYPED = /** @type {const} */ (['Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array', 'Float32Array', 'Float64Array', 'Uint8ClampedArray']);
/** Size limits checked before anything is decoded (an imported file is data only). */
const LIMITS = { headerBytes: 1 << 20, sections: 512, sectionBytes: 64 << 20 };

export class SaveError extends Error {
  /** @param {string} message */
  constructor(message) { super(message); this.name = 'SaveError'; }
}

/** @param {Uint8Array} bytes */
async function gzip(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** @param {Uint8Array} bytes */
async function gunzip(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/**
 * A value as JSON text plus the typed arrays' bytes, in order.
 * @param {any} value @returns {Uint8Array}
 */
export function packValue(value) {
  /** @type {Uint8Array[]} */ const bins = [];
  const json = JSON.stringify(value, function (_k, v) {
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
      const t = v.constructor.name;
      if (!TYPED.includes(/** @type {any} */ (t))) throw new SaveError(`cannot save a ${t}`);
      bins.push(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
      return { $t: t, $i: bins.length - 1 };
    }
    return v;
  });
  const text = new TextEncoder().encode(json);
  let size = 4 + text.length;
  for (const b of bins) size += 4 + b.length;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, text.length, true);
  out.set(text, 4);
  let o = 4 + text.length;
  for (const b of bins) { dv.setUint32(o, b.length, true); out.set(b, o + 4); o += 4 + b.length; }
  return out;
}

/** @param {Uint8Array} bytes @returns {any} */
export function unpackValue(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint32(0, true);
  if (4 + n > bytes.length) throw new SaveError('section text runs past its end');
  const text = new TextDecoder().decode(bytes.subarray(4, 4 + n));
  /** @type {ArrayBuffer[]} */ const bins = [];
  let o = 4 + n;
  while (o < bytes.length) {
    const len = dv.getUint32(o, true);
    if (o + 4 + len > bytes.length) throw new SaveError('section data runs past its end');
    bins.push(bytes.slice(o + 4, o + 4 + len).buffer);
    o += 4 + len;
  }
  return JSON.parse(text, (_k, v) => {
    if (v && typeof v === 'object' && typeof v.$t === 'string' && typeof v.$i === 'number' && Object.keys(v).length === 2) {
      if (!TYPED.includes(v.$t)) throw new SaveError(`unknown array type ${v.$t}`);
      const buf = bins[v.$i];
      if (!buf) throw new SaveError('a typed array is missing its data');
      const C = /** @type {any} */ (globalThis)[v.$t];
      return new C(buf);
    }
    return v;
  });
}

/**
 * Pack a world into .ebb bytes.
 * @param {Record<string, any>} header  everything but `sections` (filled in here)
 * @param {[string, any][]} sections    [id, value] in file order
 * @returns {Promise<Uint8Array>}
 */
export async function encode(header, sections) {
  /** @type {{ id: string, offset: number, length: number, crc32: number, codec: string }[]} */ const table = [];
  /** @type {Uint8Array[]} */ const bodies = [];
  let offset = 0;
  for (const [id, value] of sections) {
    const body = await gzip(packValue(value));
    table.push({ id, offset, length: body.length, crc32: crc32(body), codec: CODEC });
    bodies.push(body);
    offset += body.length;
  }
  const head = new TextEncoder().encode(JSON.stringify({ ...header, sections: table }));
  const out = new Uint8Array(12 + head.length + offset + 4);
  const dv = new DataView(out.buffer);
  out.set(MAGIC, 0);
  dv.setUint16(4, CONTAINER_VERSION, true);
  dv.setUint16(6, 1, true);
  dv.setUint32(8, head.length, true);
  out.set(head, 12);
  let o = 12 + head.length;
  for (const b of bodies) { out.set(b, o); o += b.length; }
  dv.setUint32(o, crc32(out.subarray(0, o)), true);
  return out;
}

/**
 * Read .ebb bytes. A bad header throws a SaveError; a bad section is left out and named in `bad`,
 * so the rest still loads.
 * @param {Uint8Array} bytes
 * @returns {Promise<{ header: any, sections: Record<string, any>, bad: string[], fileOk: boolean }>}
 */
export async function decode(bytes) {
  if (bytes.length < 16 || MAGIC.some((m, i) => bytes[i] !== m)) throw new SaveError('not an ebb island file');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint16(4, true);
  if (version !== CONTAINER_VERSION) throw new SaveError(`island file container ${version} is newer than this build`);
  const headLen = dv.getUint32(8, true);
  if (headLen > LIMITS.headerBytes || 12 + headLen + 4 > bytes.length) throw new SaveError('island file header is damaged');
  /** @type {any} */ let header;
  try { header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + headLen))); }
  catch { throw new SaveError('island file header is damaged'); }
  if (!header || !Array.isArray(header.sections) || header.sections.length > LIMITS.sections) throw new SaveError('island file header is damaged');
  const end = bytes.length - 4;
  const fileOk = crc32(bytes.subarray(0, end)) === dv.getUint32(end, true);
  const base = 12 + headLen;
  /** @type {Record<string, any>} */ const sections = {};
  /** @type {string[]} */ const bad = [];
  for (const s of header.sections) {
    const id = String(s.id);
    try {
      if (s.codec !== CODEC) throw new SaveError(`unknown codec ${s.codec}`);
      if (!(s.offset >= 0 && s.length >= 0 && s.length <= LIMITS.sectionBytes && base + s.offset + s.length <= end)) throw new SaveError('out of range');
      const body = bytes.subarray(base + s.offset, base + s.offset + s.length);
      if (crc32(body) !== s.crc32) throw new SaveError('checksum');
      sections[id] = unpackValue(await gunzip(body));
    } catch {
      bad.push(id);
    }
  }
  return { header, sections, bad, fileOk };
}

/**
 * Worker job (src/core/workers.js): encode in a worker so saving never costs a frame.
 * The header gets the world's fingerprint here too (tick.js hashWorldState), off the main thread.
 * @param {{ header: Record<string, any>, sections: [string, any][] }} args
 */
export async function encodeJob(args) {
  const world = args.sections.find(([id]) => id === 'world')?.[1];
  const header = { ...args.header };
  if (world) header.worldHash = (await import('../sim/tick.js')).hashWorldState(world);
  const bytes = await encode(header, args.sections);
  return { bytes, __transfer: [bytes.buffer] };
}
