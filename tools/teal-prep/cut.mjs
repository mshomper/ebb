// @ts-check
// The cut for make.py: runs the game's quadric edge collapse (src/world/mesh/decimate.js, as the small
// birds use it) on a welded mesh make.py hands over, with each vertex's colour riding along so colour
// edges (the eye stripe, the wing patch) keep their vertices.
//   node tools/teal-prep/cut.mjs <in.bin> <target triangles> <colour weight> <out.bin>
// in.bin: uint32 n, uint32 m, n*3 float64 positions, m*3 uint32 triangles, n*3 float32 colours.
// out.bin: uint32 n, uint32 m, n*3 float64 positions, m*3 uint32 triangles.
import { readFileSync, writeFileSync } from 'node:fs';
import { decimate } from '../../src/world/mesh/decimate.js';

const [inPath, target, weight, outPath] = process.argv.slice(2);
const buf = readFileSync(inPath);
const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const [n, m] = new Uint32Array(bytes, 0, 2);
const pos = new Float64Array(bytes, 8, n * 3);
const idx = new Uint32Array(bytes, 8 + n * 24, m * 3);
const attr = new Float32Array(bytes.slice(8 + n * 24 + m * 12, 8 + n * 24 + m * 12 + n * 12));
const out = decimate(pos, idx, Number(target), { attr, stride: 3, weight: Number(weight) });
const head = new Uint32Array([out.count, out.idx.length / 3]);
writeFileSync(outPath, Buffer.concat([Buffer.from(head.buffer), Buffer.from(out.pos.buffer), Buffer.from(out.idx.buffer)]));
console.log(`cut ${m} to ${out.idx.length / 3} triangles, ${out.count} vertices`);
