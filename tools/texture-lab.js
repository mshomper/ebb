// @ts-check
// Texture lab (docs/22): fetches the CC0 ground scans named in recipes/world/ground-sources.json
// (Poly Haven maps one by one, ambientCG sets as a zip through play.cmd's local server),
// calibrates each albedo to its recipe mean
// (recipes/world/terrain.json materials.albedo*), packs the maps and saves them as WebP.
//
// Output per material and size (three opaque RGB files, because browsers premultiply alpha
// when encoding canvases, which would corrupt data kept in alpha):
//   a.webp  albedo, sRGB, calibrated
//   b.webp  R,G = normal X,Y (OpenGL, as in nor_gl), B = roughness
//   c.webp  R = height (stretched to 0..1), G = cavity (ao), B = 0
// src/render/ground-detail.js repacks these into the two texture arrays at load.

const ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="#5F7F5B" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-6.5"/></svg>';
const ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="#B5654A" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5v.2"/></svg>';
const ICON_WAIT = '<svg viewBox="0 0 24 24" fill="none" stroke="#7B8B84" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6.5V12l3.5 2.5"/></svg>';

// Layer order of the game's texture arrays (moss is layer 4, cliff rock for steep slopes layer 5).
const ORDER = ['grass', 'sand', 'rock', 'soil', 'moss', 'cliff'];
// ambientCG file name endings (lower case) for each map the packer reads. AO is optional.
const ACG_SUFFIX = { diff: '_color.jpg', nor_gl: '_normalgl.jpg', rough: '_roughness.jpg', disp: '_displacement.jpg', ao: '_ambientocclusion.jpg' };
const acgNoServer = (/** @type {string} */ name) => `${name[0].toUpperCase() + name.slice(1)} comes from ambientCG through play.cmd's local server. Double-click play.cmd and open the lab from there.`;
const PHYS_MIN = 0.04;
const PHYS_MAX = 0.9;
const PREVIEW_TILE = 128; // px per 3 m tile in the 24 m preview
const PREVIEW_TILES = 8;
const PREVIEW_TILE_M = 3; // meters per tile, so the preview spans 24 m
// Defaults for the hex tiling and macro tone drift, used where recipes/world/terrain.json
// has no detail.hex or detail.macro yet. Keep in step with that recipe.
const HEX_DEFAULTS = { density: 3.4641016, sharpness: 3 };
const MACRO_DEFAULTS = { scalesM: [40, 12], strength: 0.3, second: 0.4, hue: 0.06 };
/** @typedef {'grid'|'hex'|'hexmacro'} Tiling */
/** @type {Record<Tiling, string>} */
const TILING_CAPTION = {
  grid: '24 m of ground, 8 by 8 tiles of 3 m in a plain grid repeat, lit through the normal map. Drag to move the sun.',
  hex: '24 m of ground in 3 m tiles, hex tiled as the game does on desktop: three offset copies blended by height. Lit through the normal map. Drag to move the sun.',
  hexmacro: '24 m of ground in 3 m tiles, hex tiled, plus the slow macro tone drift (40 m and 12 m noise). Lit through the normal map. Drag to move the sun.',
};
const KINDS = /** @type {const} */ (['a', 'b', 'c']);
const MIME = { webp: 'image/webp', md: 'text/markdown' };

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const statusEl = $('status');
const barEl = $('bar');
const totalsEl = $('totals');
const saveMsgEl = $('save-msg');
const buildAllBtn = /** @type {HTMLButtonElement} */ ($('build-all'));
const saveAllBtn = /** @type {HTMLButtonElement} */ ($('save-all'));
const sunAltIn = /** @type {HTMLInputElement} */ ($('sun-alt'));
const sunAzIn = /** @type {HTMLInputElement} */ ($('sun-az'));

/** @type {any} */ let sources = null;
/** @type {any} */ let terrain = null;
/** Whether the play.cmd server (with its save endpoint) is serving this page. */
let localServer = false;
let downloadedBytes = 0;
let downloadedFiles = 0;
let busy = false;

/**
 * @typedef {{ blob: Blob, url: string, bytes: number, kind: string, err: number[], max: number[] }} PackedFile
 * @typedef {{
 *   name: string, src: any, target: number[], delight: number,
 *   raw: Record<string, Uint8ClampedArray> | null, jpgUrl: string, noAo: boolean,
 *   blur: Float32Array | null, blurMean: number,
 *   files: Record<number, Record<string, PackedFile>> | null,
 *   means: Record<number, number[]>,
 *   prevTile: { alb: Float32Array, n: Float32Array, cav: Float32Array, h: Float32Array } | null,
 *   prevWrap: { alb: Float32Array, n: Float32Array, cav: Float32Array, size: number } | null,
 *   prevHex: { mode: Tiling, src: object, alb: Float32Array, n: Float32Array, cav: Float32Array } | null,
 *   ui: Record<string, HTMLElement>
 * }} Mat
 */
/** @type {Record<string, Mat>} */
const mats = {};

// ---------- color helpers ----------

const SRGB_TO_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
/** @param {number} x linear 0..1 */
const linToSrgb = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
const LIN_TO_BYTE = new Uint8ClampedArray(4096);
for (let i = 0; i < 4096; i++) LIN_TO_BYTE[i] = Math.round(linToSrgb(i / 4095) * 255);
/** @param {number[]} rgb linear */
const hex = (rgb) => '#' + rgb.map((v) => Math.round(linToSrgb(Math.min(1, Math.max(0, v))) * 255).toString(16).padStart(2, '0')).join('');
const fmt3 = (/** @type {number[]} */ v) => v.map((x) => x.toFixed(3)).join(', ');
const kb = (/** @type {number} */ n) => (n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${Math.round(n / 1024)} KB`);

// ---------- image io ----------

/** @param {Blob} blob @param {number} size @returns {Promise<Uint8ClampedArray>} RGBA at size x size */
async function decodePixels(blob, size) {
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const cv = new OffscreenCanvas(size, size);
  const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (cv.getContext('2d', { willReadFrequently: true }));
  if (bmp.width !== size || bmp.height !== size) { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; }
  ctx.drawImage(bmp, 0, 0, size, size);
  bmp.close();
  return ctx.getImageData(0, 0, size, size).data;
}

/** @param {Uint8ClampedArray} rgba @param {number} size @param {number} quality */
async function encodeWebp(rgba, size, quality) {
  const cv = new OffscreenCanvas(size, size);
  const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (cv.getContext('2d'));
  ctx.putImageData(new ImageData(/** @type {any} */ (rgba), size, size), 0, 0);
  const blob = await cv.convertToBlob({ type: 'image/webp', quality });
  if (blob.type !== 'image/webp') throw new Error('This browser cannot write WebP files. Use Chrome or Edge.');
  return blob;
}

/** Reads the WebP container to tell lossy (VP8) from lossless (VP8L). @param {Blob} blob */
async function webpKind(blob) {
  // Chrome writes a VP8X header and an ICC profile chunk first, so read well past them.
  const b = new Uint8Array(await blob.slice(0, 16384).arrayBuffer());
  const tag = (/** @type {number} */ o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  let o = 12;
  while (o + 8 <= b.length) {
    const t = tag(o);
    if (t === 'VP8 ') return 'lossy';
    if (t === 'VP8L') return 'lossless';
    const len = b[o + 4] | (b[o + 5] << 8) | (b[o + 6] << 16) | (b[o + 7] << 24);
    o += 8 + len + (len & 1);
  }
  return 'unknown';
}

/**
 * Streams a download, reporting bytes as they arrive.
 * @param {string} url @param {(n: number, total: number) => void} onBytes total is 0 when unknown
 * @param {string} who names the server in errors @param {string} type
 */
async function fetchBytes(url, onBytes, who = 'Poly Haven', type = 'image/jpeg') {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${who} answered ${r.status} for ${decodeURIComponent(url.split(/[/=]/).pop() || url)}`);
  const length = Number(r.headers.get('Content-Length')) || 0;
  const reader = /** @type {ReadableStream<Uint8Array>} */ (r.body).getReader();
  /** @type {Uint8Array[]} */ const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); total += value.length; onBytes(value.length, length);
  }
  return { blob: new Blob(parts, { type }), bytes: total };
}

/**
 * Minimal zip reader for ambientCG sets (no library). Finds the End Of Central Directory
 * record, walks the central directory, and reads each entry's data through its local header.
 * Stored (method 0) entries are copied; deflated (method 8) entries are inflated with the
 * browser's DecompressionStream. No zip64 or encryption: ambientCG 1K sets are about 10 MB.
 * @param {ArrayBuffer} buf @param {string} type MIME type for the returned blobs
 * @returns {Promise<Map<string, Blob>>} entry name (with any folder) -> file contents
 */
async function readZip(buf, type = 'image/jpeg') {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  // The EOCD record is 22 bytes plus a comment of up to 65535 bytes, so search back from the end.
  let eocd = -1;
  for (let o = buf.byteLength - 22; o >= Math.max(0, buf.byteLength - 22 - 65535); o--) {
    if (dv.getUint32(o, true) === 0x06054b50) { eocd = o; break; }
  }
  if (eocd < 0) throw new Error('The download is not a zip file.');
  const count = dv.getUint16(eocd + 10, true); // entries in the central directory
  let o = dv.getUint32(eocd + 16, true); // offset of the central directory
  const utf8 = new TextDecoder();
  /** @type {Map<string, Blob>} */ const out = new Map();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(o, true) !== 0x02014b50) throw new Error('The zip file is damaged (central directory).');
    const flags = dv.getUint16(o + 8, true);
    const method = dv.getUint16(o + 10, true);
    // Sizes come from the central directory: they are exact even when the local header defers
    // them to a data descriptor (flag bit 3).
    const csize = dv.getUint32(o + 20, true);
    const nameLen = dv.getUint16(o + 28, true), extraLen = dv.getUint16(o + 30, true), commentLen = dv.getUint16(o + 32, true);
    const local = dv.getUint32(o + 42, true);
    const name = utf8.decode(u8.subarray(o + 46, o + 46 + nameLen));
    o += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue; // folder entry
    if (flags & 1) throw new Error(`The zip entry ${name} is encrypted.`);
    // Local header: 30 fixed bytes, then its own name and extra field (which can differ in length
    // from the central copy), then the data.
    if (dv.getUint32(local, true) !== 0x04034b50) throw new Error(`The zip file is damaged (${name}).`);
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = u8.subarray(start, start + csize);
    if (method === 0) out.set(name, new Blob([data], { type }));
    else if (method === 8) {
      const inflated = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      out.set(name, new Blob([await new Response(inflated).arrayBuffer()], { type }));
    } else throw new Error(`The zip entry ${name} uses compression method ${method}, which the lab cannot read.`);
  }
  return out;
}

// ---------- processing ----------

/** Box sizes whose three passes approximate a Gaussian (Kovesi). @param {number} sigma */
function boxRadii(sigma) {
  const n = 3;
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return [0, 1, 2].map((i) => ((i < m ? wl : wu) - 1) / 2);
}

/** One wrap-around box blur pass along rows (step 1) or columns (step W). */
function boxPass(/** @type {Float32Array} */ src, /** @type {Float32Array} */ dst, /** @type {number} */ N, /** @type {number} */ r, /** @type {boolean} */ rows) {
  const inv = 1 / (2 * r + 1);
  for (let line = 0; line < N; line++) {
    const base = rows ? line * N : line;
    const step = rows ? 1 : N;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[base + (((k % N) + N) % N) * step];
    for (let i = 0; i < N; i++) {
      dst[base + i * step] = sum * inv;
      sum += src[base + ((i + r + 1) % N) * step] - src[base + (((i - r) % N + N) % N) * step];
    }
  }
}

/** Gaussian blur with wrap-around edges (the scans tile). @param {Float32Array} img @param {number} N @param {number} sigma */
function blurWrap(img, N, sigma) {
  let a = Float32Array.from(img);
  let b = new Float32Array(img.length);
  for (const r0 of boxRadii(sigma)) {
    const r = Math.min(Math.round(r0), Math.floor((N - 1) / 2));
    boxPass(a, b, N, r, true); boxPass(b, a, N, r, false);
  }
  return a;
}

/** Linear albedo with baked shading divided out and its mean moved to the recipe target. @param {Mat} m @param {number} N */
function calibrate(m, N) {
  const diff = /** @type {Record<string, Uint8ClampedArray>} */ (m.raw).diff;
  const px = N * N;
  if (!m.blur) {
    const lum = new Float32Array(px);
    for (let i = 0; i < px; i++) lum[i] = 0.2126 * SRGB_TO_LIN[diff[i * 4]] + 0.7152 * SRGB_TO_LIN[diff[i * 4 + 1]] + 0.0722 * SRGB_TO_LIN[diff[i * 4 + 2]];
    m.blur = blurWrap(lum, N, N / 6);
    let s = 0; for (let i = 0; i < px; i++) s += m.blur[i];
    m.blurMean = s / px;
  }
  const lin = new Float32Array(px * 3);
  for (let i = 0; i < px; i++) {
    const shade = 1 + m.delight * (m.blur[i] / Math.max(1e-6, m.blurMean) - 1);
    const f = 1 / Math.max(0.05, shade);
    for (let c = 0; c < 3; c++) lin[i * 3 + c] = SRGB_TO_LIN[diff[i * 4 + c]] * f;
  }
  // Scale each channel so the clamped image's mean lands on the target (a few fixed-point steps,
  // since the clamp to the physical range moves the mean a little).
  const scale = [1, 1, 1];
  for (let it = 0; it < 10; it++) {
    const sum = [0, 0, 0];
    for (let i = 0; i < px; i++) for (let c = 0; c < 3; c++) sum[c] += Math.min(PHYS_MAX, Math.max(PHYS_MIN, lin[i * 3 + c] * scale[c]));
    for (let c = 0; c < 3; c++) scale[c] *= m.target[c] / Math.max(1e-6, sum[c] / px);
  }
  for (let i = 0; i < px * 3; i++) lin[i] = Math.min(PHYS_MAX, Math.max(PHYS_MIN, lin[i] * scale[i % 3]));
  return lin;
}

/** Height from disp, stretched so the 0.5th..99.5th percentiles fill 0..1. @param {Uint8ClampedArray} disp @param {number} px */
function stretchHeight(disp, px) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < px; i++) hist[disp[i * 4]]++;
  const pick = (/** @type {number} */ q) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= q * px) return v; } return 255; };
  const lo = pick(0.005), hi = pick(0.995);
  const h = new Float32Array(px);
  const span = hi > lo ? hi - lo : 255;
  const base = hi > lo ? lo : 0;
  for (let i = 0; i < px; i++) h[i] = Math.min(1, Math.max(0, (disp[i * 4] - base) / span));
  return h;
}

/** Box-average a float image by an integer factor. @param {Float32Array} src @param {number} N @param {number} ch @param {number} f */
function shrink(src, N, ch, f) {
  if (f === 1) return src;
  const S = N / f, out = new Float32Array(S * S * ch), w = 1 / (f * f);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) for (let c = 0; c < ch; c++) {
    let s = 0;
    for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) s += src[((y * f + dy) * N + x * f + dx) * ch + c];
    out[(y * S + x) * ch + c] = s * w;
  }
  return out;
}

/** @param {Float32Array} n xyz normals, renormalized in place */
function renormalize(n) {
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

/** Builds every packed file for one material. @param {Mat} m */
async function pack(m) {
  const sizes = /** @type {number[]} */ (sources.sizes);
  const N = Math.max(...sizes);
  const raw = /** @type {Record<string, Uint8ClampedArray>} */ (m.raw);
  const px = N * N;
  const lin = calibrate(m, N);
  const nrm = new Float32Array(px * 3);
  const rough = new Float32Array(px), cav = new Float32Array(px);
  for (let i = 0; i < px; i++) {
    for (let c = 0; c < 3; c++) nrm[i * 3 + c] = (raw.nor_gl[i * 4 + c] / 255) * 2 - 1;
    rough[i] = raw.rough[i * 4] / 255;
    cav[i] = raw.ao[i * 4] / 255;
  }
  const height = stretchHeight(raw.disp, px);

  /** @type {Record<number, Record<string, PackedFile>>} */ const files = {};
  for (const size of sizes) {
    const f = N / size;
    if (!Number.isInteger(f)) throw new Error(`Size ${size} must divide ${N} evenly.`);
    const L = shrink(lin, N, 3, f), R = shrink(rough, N, 1, f), H = shrink(height, N, 1, f), C = shrink(cav, N, 1, f);
    const Nn = f === 1 ? nrm : renormalize(shrink(nrm, N, 3, f));
    const sp = size * size;
    const a = new Uint8ClampedArray(sp * 4), b = new Uint8ClampedArray(sp * 4), c = new Uint8ClampedArray(sp * 4);
    for (let i = 0; i < sp; i++) {
      for (let k = 0; k < 3; k++) a[i * 4 + k] = LIN_TO_BYTE[Math.round(L[i * 3 + k] * 4095)];
      b[i * 4] = Math.round((Nn[i * 3] * 0.5 + 0.5) * 255);
      b[i * 4 + 1] = Math.round((Nn[i * 3 + 1] * 0.5 + 0.5) * 255);
      b[i * 4 + 2] = Math.round(R[i] * 255);
      c[i * 4] = Math.round(H[i] * 255);
      c[i * 4 + 1] = Math.round(C[i] * 255);
      a[i * 4 + 3] = b[i * 4 + 3] = c[i * 4 + 3] = 255;
    }
    files[size] = {};
    const packed = { a, b, c };
    for (const k of KINDS) {
      const blob = await encodeWebp(packed[k], size, sources.webpQuality[k]);
      const back = await decodePixels(blob, size);
      const err = [0, 0, 0], max = [0, 0, 0];
      for (let i = 0; i < sp; i++) for (let ch = 0; ch < 3; ch++) {
        const d = Math.abs(back[i * 4 + ch] - packed[k][i * 4 + ch]);
        err[ch] += d; if (d > max[ch]) max[ch] = d;
      }
      files[size][k] = { blob, url: URL.createObjectURL(blob), bytes: blob.size, kind: await webpKind(blob), err: err.map((e) => e / sp), max };
      if (k === 'a') {
        const mean = [0, 0, 0];
        for (let i = 0; i < sp; i++) for (let ch = 0; ch < 3; ch++) mean[ch] += SRGB_TO_LIN[back[i * 4 + ch]];
        m.means[size] = mean.map((v) => v / sp);
      }
    }
    if (size === Math.min(...sizes)) m.prevWrap = { alb: L, n: Nn, cav: C, size };
  }
  const tf = N / PREVIEW_TILE;
  m.prevTile = { alb: shrink(lin, N, 3, tf), n: renormalize(shrink(nrm, N, 3, tf)), cav: shrink(cav, N, 1, tf), h: shrink(height, N, 1, tf) };
  if (m.files) for (const s in m.files) for (const k in m.files[s]) URL.revokeObjectURL(m.files[s][k].url);
  m.files = files;
}

// ---------- previews ----------

function sunDir() {
  const alt = (Number(sunAltIn.value) * Math.PI) / 180, az = (Number(sunAzIn.value) * Math.PI) / 180;
  // Image frame: x right, y up (OpenGL normal maps), z out of the ground.
  return [Math.cos(alt) * Math.sin(az), Math.cos(alt) * Math.cos(az), Math.sin(alt)];
}

/** Lambert sun plus cavity-weighted sky, exposed so flat ground shows its albedo. */
function shade(/** @type {{alb: Float32Array, n: Float32Array, cav: Float32Array}} */ src, /** @type {number} */ S, /** @type {number} */ shift) {
  const [lx, ly, lz] = sunDir();
  const amb = 0.35, expo = 1 / (amb + lz);
  const img = new ImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = ((y + shift) % S) * S + ((x + shift) % S), o = (y * S + x) * 4;
    const ndl = Math.max(0, src.n[i * 3] * lx + src.n[i * 3 + 1] * ly + src.n[i * 3 + 2] * lz);
    const light = (amb * src.cav[i] + ndl) * expo;
    for (let c = 0; c < 3; c++) img.data[o + c] = LIN_TO_BYTE[Math.min(4095, Math.round(src.alb[i * 3 + c] * light * 4095))];
    img.data[o + 3] = 255;
  }
  return img;
}

/** Integer lattice hash to [0,1); s picks an independent stream. Deterministic. @param {number} x @param {number} y @param {number} s */
function hash01(x, y, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smoothstep-interpolated value noise on the integer lattice, 0..1. @param {number} x @param {number} y */
function valueNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash01(ix, iy, 7), b = hash01(ix + 1, iy, 7), c = hash01(ix, iy + 1, 7), d = hash01(ix + 1, iy + 1, 7);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/**
 * Lays the 3 m tile over the 24 m preview the way the game shader does on desktop tiers:
 * Mikkelsen's triangle-grid hex tiling (offsets only, no rotation), three samples per pixel
 * blended by barycentric weight and height, optionally with the macro tone drift on albedo.
 * Returns unlit maps at preview size; shade() lights them, so a sun drag skips this step.
 * @param {{alb: Float32Array, n: Float32Array, cav: Float32Array, h: Float32Array}} src @param {boolean} withMacro
 */
function blendHex(src, withMacro) {
  const T = PREVIEW_TILE, S = PREVIEW_TILE * PREVIEW_TILES;
  const hx = { ...HEX_DEFAULTS, ...(terrain?.detail?.hex || {}) };
  const mc = { ...MACRO_DEFAULTS, ...(terrain?.detail?.macro || {}) };
  const D = hx.density, sharp = hx.sharpness;
  const alb = new Float32Array(S * S * 3), n = new Float32Array(S * S * 3), cav = new Float32Array(S * S);
  // Height term of the blend weight, once per texel: (h + 0.25)^4.
  const hw = new Float32Array(T * T);
  for (let i = 0; i < T * T; i++) { const t = (src.h[i] + 0.25) * (src.h[i] + 0.25); hw[i] = t * t; }
  // Per-pixel scratch, allocated once: the three vertices and their barycentric weights.
  const VX = new Int32Array(3), VY = new Int32Array(3), VW = new Float64Array(3);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / T, v = y / T;
    const qx = u * D, qy = v * D;
    const gx = qx - 0.57735027 * qy, gy = 1.15470054 * qy;
    const bx = Math.floor(gx), by = Math.floor(gy), fx = gx - bx, fy = gy - by, z = 1 - fx - fy;
    const s = z < 0 ? 1 : 0, s2 = 2 * s - 1;
    VW[0] = -z * s2; VW[1] = s - fy * s2; VW[2] = s - fx * s2;
    VX[0] = bx + s; VY[0] = by + s;
    VX[1] = bx + s; VY[1] = by + 1 - s;
    VX[2] = bx + 1 - s; VY[2] = by + s;
    let sw = 0, r = 0, g = 0, b = 0, nx = 0, ny = 0, nz = 0, cv = 0;
    for (let k = 0; k < 3; k++) {
      // Each vertex shifts the tile by its own random offset, wrapped into the tile.
      const tx = (x + Math.floor(hash01(VX[k], VY[k], 1) * T)) % T;
      const ty = (y + Math.floor(hash01(VX[k], VY[k], 2) * T)) % T;
      const i = ty * T + tx;
      const W = Math.pow(Math.max(VW[k], 0), sharp) * hw[i];
      sw += W;
      r += W * src.alb[i * 3]; g += W * src.alb[i * 3 + 1]; b += W * src.alb[i * 3 + 2];
      nx += W * src.n[i * 3]; ny += W * src.n[i * 3 + 1]; nz += W * src.n[i * 3 + 2];
      cv += W * src.cav[i];
    }
    const inv = sw > 0 ? 1 / sw : 0, o = y * S + x;
    if (withMacro) {
      // Macro drift in world meters: a slow and a mid noise darken or lift the tone, nudging hue warm or cool.
      const xm = u * PREVIEW_TILE_M, ym = v * PREVIEW_TILE_M;
      const m1 = valueNoise(xm / mc.scalesM[0], ym / mc.scalesM[0]) - 0.5;
      const m2 = valueNoise(xm / mc.scalesM[1] + 17.3, ym / mc.scalesM[1] + 17.3) - 0.5;
      const mm = m1 + mc.second * m2, tone = 1 + mc.strength * mm;
      r *= tone * (1 + mc.hue * mm); g *= tone; b *= tone * (1 - mc.hue * mm);
    }
    alb[o * 3] = r * inv; alb[o * 3 + 1] = g * inv; alb[o * 3 + 2] = b * inv;
    const nl = Math.hypot(nx, ny, nz) || 1;
    n[o * 3] = nx / nl; n[o * 3 + 1] = ny / nl; n[o * 3 + 2] = nz / nl;
    cav[o] = cv * inv;
  }
  return { alb, n, cav };
}

/** @type {Tiling} */ let tiling = 'hex';

let previewQueued = false;
function queuePreviews() {
  $('sun-alt-out').textContent = `${sunAltIn.value} deg`;
  $('sun-az-out').textContent = `${sunAzIn.value} deg`;
  if (previewQueued) return;
  previewQueued = true;
  requestAnimationFrame(() => {
    previewQueued = false;
    for (const name of ORDER) {
      const m = mats[name];
      if (!m) continue;
      m.ui.tiledcap.textContent = TILING_CAPTION[tiling];
      if (!m.prevTile || !m.prevWrap) continue;
      const cv = /** @type {HTMLCanvasElement} */ (m.ui.tiled);
      const ctx = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
      if (tiling === 'grid') {
        const tile = new OffscreenCanvas(PREVIEW_TILE, PREVIEW_TILE);
        /** @type {OffscreenCanvasRenderingContext2D} */ (tile.getContext('2d')).putImageData(shade(m.prevTile, PREVIEW_TILE, 0), 0, 0);
        ctx.fillStyle = /** @type {CanvasPattern} */ (ctx.createPattern(tile, 'repeat'));
        ctx.fillRect(0, 0, cv.width, cv.height);
      } else {
        // The blend depends only on the maps and the mode, so it is kept until either changes.
        if (!m.prevHex || m.prevHex.mode !== tiling || m.prevHex.src !== m.prevTile) {
          m.prevHex = { mode: tiling, src: m.prevTile, ...blendHex(m.prevTile, tiling === 'hexmacro') };
        }
        ctx.putImageData(shade(m.prevHex, cv.width, 0), 0, 0);
      }
      const wcv = /** @type {HTMLCanvasElement} */ (m.ui.wrap);
      const S = m.prevWrap.size;
      wcv.width = wcv.height = S;
      /** @type {CanvasRenderingContext2D} */ (wcv.getContext('2d')).putImageData(shade(m.prevWrap, S, S / 2), 0, 0);
    }
  });
}

/** Dragging across a preview swings the sun around its center. @param {HTMLCanvasElement} cv */
function bindSunDrag(cv) {
  let down = false;
  const move = (/** @type {PointerEvent} */ e) => {
    if (!down) return;
    const r = cv.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    sunAzIn.value = String(Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360));
    queuePreviews();
  };
  cv.addEventListener('pointerdown', (e) => { down = true; cv.setPointerCapture(e.pointerId); move(e); });
  cv.addEventListener('pointermove', move);
  const up = () => { down = false; };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
}

// ---------- ui ----------

function setStatus(/** @type {'ok'|'warn'|'wait'} */ kind, /** @type {string} */ text) {
  statusEl.innerHTML = (kind === 'ok' ? ICON_OK : kind === 'warn' ? ICON_WARN : ICON_WAIT) + '<span></span>';
  /** @type {HTMLElement} */ (statusEl.lastElementChild).textContent = text;
}
function setMsg(/** @type {HTMLElement} */ el, /** @type {string} */ text, /** @type {''|'ok'|'err'} */ kind = '') {
  el.textContent = text; el.className = 'msg' + (kind ? ' ' + kind : '');
}
function showTotals() {
  totalsEl.textContent = downloadedFiles ? `Downloaded ${downloadedFiles} scan files or zips, ${kb(downloadedBytes)} in all.` : 'Nothing downloaded yet.';
}
const cap = (/** @type {string} */ s) => s[0].toUpperCase() + s.slice(1);

/** @param {string} name */
function makeCard(name) {
  const m = mats[name];
  const card = document.createElement('section');
  card.className = 'card';
  card.innerHTML = `
    <div class="head"><h2>${cap(name)}: ${m.src.name}</h2>
      <div class="actions"><button type="button" data-k="build" class="primary">Build</button><button type="button" data-k="save" disabled>Save to repo</button></div></div>
    <p class="muted">Source <a href="${m.src.page}" target="_blank" rel="noopener">${m.src.page}</a>, CC0 1.0.</p>
    <p class="msg" data-k="msg">Not built yet.</p>
    <div class="field"><div class="row"><label for="dl-${name}">Delight strength</label><output data-k="dlout"></output></div>
      <input id="dl-${name}" data-k="delight" type="range" min="0" max="1" step="0.05" value="${m.delight}">
      <p class="muted" data-k="dlnote">Recipe value ${m.src.delight}.</p></div>
    <div data-k="body" hidden style="display:flex;flex-direction:column;gap:16px">
      <div><h3>Average color</h3><div class="swatches" data-k="sw"></div></div>
      <div class="grid">
        <figure><img data-k="img-src" alt="Scan albedo as downloaded"><figcaption>Scan as downloaded</figcaption></figure>
        <figure><img data-k="img-a" alt="Calibrated albedo"><figcaption>a: calibrated albedo</figcaption></figure>
        <figure><img data-k="img-b" alt="Normal and roughness"><figcaption>b: normal X, Y and roughness</figcaption></figure>
        <figure><img data-k="img-c" alt="Height and cavity"><figcaption>c: height and cavity</figcaption></figure>
      </div>
      <div class="grid2">
        <figure><canvas class="preview" data-k="tiled" width="${PREVIEW_TILE * PREVIEW_TILES}" height="${PREVIEW_TILE * PREVIEW_TILES}" aria-label="24 meters of tiled ground"></canvas>
          <figcaption data-k="tiledcap">${TILING_CAPTION[tiling]}</figcaption></figure>
        <figure><canvas class="preview" data-k="wrap" aria-label="Wrap check"></canvas>
          <figcaption>Wrap check: one tile shifted by half, so its edges meet in a cross through the middle. A visible cross is a seam.</figcaption></figure>
      </div>
      <div class="table-wrap"><h3>Files</h3><table data-k="sizes"></table></div>
      <div><h3>Round trip through WebP</h3><p class="muted" data-k="err"></p></div>
      <div><h3>Download</h3><div class="downloads" data-k="dl"></div></div>
    </div>`;
  card.querySelectorAll('[data-k]').forEach((el) => { m.ui[/** @type {HTMLElement} */ (el).dataset.k || ''] = /** @type {HTMLElement} */ (el); });
  const dlIn = /** @type {HTMLInputElement} */ (m.ui.delight);
  const showDelight = () => {
    m.ui.dlout.textContent = Number(dlIn.value).toFixed(2);
    m.ui.dlnote.textContent = m.delight === m.src.delight ? `Recipe value ${m.src.delight}.`
      : `Recipe value ${m.src.delight}. To keep ${m.delight}, put it in recipes/world/ground-sources.json.`;
  };
  dlIn.addEventListener('input', () => { m.ui.dlout.textContent = Number(dlIn.value).toFixed(2); });
  dlIn.addEventListener('change', () => { m.delight = Number(dlIn.value); showDelight(); if (m.raw) run(() => build(name)); });
  showDelight();
  m.ui.build.addEventListener('click', () => run(() => build(name)));
  m.ui.save.addEventListener('click', () => run(() => saveMaterials([name])));
  bindSunDrag(/** @type {HTMLCanvasElement} */ (m.ui.tiled));
  bindSunDrag(/** @type {HTMLCanvasElement} */ (m.ui.wrap));
  $('materials').append(card);
}

/** @param {string} name */
function showResult(name) {
  const m = mats[name];
  if (!m.files) return;
  m.ui.body.hidden = false;
  const sizes = /** @type {number[]} */ (sources.sizes);
  const big = Math.max(...sizes);
  /** @type {HTMLImageElement} */ (m.ui['img-src']).src = m.jpgUrl;
  for (const k of KINDS) /** @type {HTMLImageElement} */ (m.ui['img-' + k]).src = m.files[big][k].url;
  const sw = [`<div class="sw"><i style="background:${hex(m.target)}"></i><span>Target (recipe)<br>${fmt3(m.target)}</span></div>`];
  for (const s of sizes) sw.push(`<div class="sw"><i style="background:${hex(m.means[s])}"></i><span>Measured, ${s}<br>${fmt3(m.means[s])}</span></div>`);
  m.ui.sw.innerHTML = sw.join('');
  const rows = ['<tr><th>Size</th><th>a</th><th>b</th><th>c</th><th>All</th></tr>'];
  for (const s of sizes) {
    const f = m.files[s];
    rows.push(`<tr><td>${s}</td>${KINDS.map((k) => `<td>${kb(f[k].bytes)}</td>`).join('')}<td>${kb(KINDS.reduce((t, k) => t + f[k].bytes, 0))}</td></tr>`);
  }
  m.ui.sizes.innerHTML = rows.join('');
  const names = { a: ['red', 'green', 'blue'], b: ['normal X', 'normal Y', 'roughness'], c: ['height', 'cavity', 'unused'] };
  m.ui.err.innerHTML = sizes.map((s) => KINDS.map((k) => {
    const f = m.files?.[s][k];
    if (!f) return '';
    const parts = [0, 1, 2].filter((ch) => !(k === 'c' && ch === 2)).map((ch) => `${names[k][ch]} ${f.err[ch].toFixed(2)} (max ${f.max[ch]})`);
    return `${k} ${s}, ${f.kind}: ${parts.join(', ')}`;
  }).join('<br>')).join('<br>') + '<br>Average and largest change per pixel, in steps of 1/255.';
  m.ui.dl.innerHTML = '';
  for (const s of sizes) for (const k of KINDS) {
    const a = document.createElement('a');
    a.href = m.files[s][k].url; a.download = `${name}-${s}-${k}.webp`;
    a.textContent = `${name}/${s}/${k}.webp`;
    m.ui.dl.append(a);
  }
  /** @type {HTMLButtonElement} */ (m.ui.save).disabled = false;
  saveAllBtn.disabled = false;
  queuePreviews();
}

/** Runs one job at a time and keeps the buttons in step. @param {() => Promise<void>} job */
async function run(job) {
  if (busy) return;
  busy = true;
  const btns = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('button'));
  btns.forEach((b) => { b.dataset.was = b.disabled ? '1' : ''; b.disabled = true; });
  try { await job(); } catch (e) { setStatus('warn', /** @type {Error} */ (e).message || String(e)); console.error(e); }
  btns.forEach((b) => { b.disabled = b.dataset.was === '1'; });
  for (const n of ORDER) if (mats[n]?.files) /** @type {HTMLButtonElement} */ (mats[n].ui.save).disabled = false;
  if (ORDER.some((n) => mats[n]?.files)) saveAllBtn.disabled = false;
  busy = false;
}

/** Downloads the 1k JPEG maps from Poly Haven one by one. @param {Mat} m @returns {Promise<Record<string, Blob>>} */
async function downloadPolyHaven(m) {
  /** @type {Record<string, Blob>} */ const blobs = {};
  const maps = /** @type {string[]} */ (sources.maps);
  let mine = 0;
  for (let i = 0; i < maps.length; i++) {
    const map = maps[i];
    setMsg(m.ui.msg, `Downloading ${map} (${i + 1} of ${maps.length}), ${kb(mine)} so far`);
    setStatus('wait', `Downloading ${cap(m.name)}`);
    barEl.style.width = `${(i / maps.length) * 100}%`;
    const url = `${sources.baseUrl}${m.src.id}/${m.src.id}_${map}_1k.jpg`;
    try {
      blobs[map] = (await fetchBytes(url, (n) => { mine += n; downloadedBytes += n; showTotals(); })).blob;
    } catch (e) {
      throw new Error(e instanceof TypeError ? 'Could not reach dl.polyhaven.org. Check the internet connection and try again.' : /** @type {Error} */ (e).message);
    }
    downloadedFiles++; showTotals();
  }
  return blobs;
}

/**
 * Downloads an ambientCG zip through play.cmd's local server (ambientCG blocks cross-origin
 * downloads) and picks the maps out of it by file name ending. @param {Mat} m
 * @returns {Promise<Record<string, Blob>>}
 */
async function downloadAmbientcg(m) {
  if (!localServer) throw new Error(acgNoServer(m.name));
  const file = /** @type {string} */ (m.src.zip);
  setMsg(m.ui.msg, `Downloading ${file}`);
  setStatus('wait', `Downloading ${cap(m.name)}`);
  barEl.style.width = '0%';
  let mine = 0;
  /** @type {Blob} */ let zip;
  try {
    zip = (await fetchBytes(`../__fetch/ambientcg?file=${encodeURIComponent(file)}`, (n, total) => {
      mine += n; downloadedBytes += n; showTotals();
      if (total) barEl.style.width = `${Math.min(100, (mine / total) * 100)}%`;
      setMsg(m.ui.msg, `Downloading ${file}, ${kb(mine)}${total ? ` of ${kb(total)}` : ' so far'}`);
    }, "ambientCG (through play.cmd's server)", 'application/zip')).blob;
  } catch (e) {
    throw new Error(e instanceof TypeError ? "Could not reach play.cmd's local server. Check that play.cmd is still running and try again." : /** @type {Error} */ (e).message);
  }
  downloadedFiles++; showTotals();
  setMsg(m.ui.msg, `Unpacking ${file}`);
  /** @type {Map<string, Blob>} */ let entries;
  try { entries = await readZip(await zip.arrayBuffer()); } catch (e) { throw new Error(`${file}: ${/** @type {Error} */ (e).message}`); }
  /** @type {Record<string, Blob>} */ const blobs = {};
  for (const [entry, blob] of entries) {
    const low = entry.toLowerCase();
    for (const [map, suffix] of Object.entries(ACG_SUFFIX)) if (low.endsWith(suffix)) blobs[map] = blob;
  }
  const missing = Object.keys(ACG_SUFFIX).filter((map) => map !== 'ao' && !blobs[map]);
  if (missing.length) throw new Error(`${file} has no ${missing.map((map) => ACG_SUFFIX[/** @type {keyof typeof ACG_SUFFIX} */ (map)]).join(', ')} file.`);
  return blobs;
}

/** Downloads (once) and builds one material. @param {string} name */
async function build(name) {
  const m = mats[name];
  const N = Math.max(...sources.sizes);
  try {
    if (!m.raw) {
      const blobs = m.src.source === 'ambientcg' ? await downloadAmbientcg(m) : await downloadPolyHaven(m);
      // Same decode path for both sources from here on.
      /** @type {Record<string, Uint8ClampedArray>} */ const raw = {};
      for (const map of /** @type {string[]} */ (sources.maps)) if (blobs[map]) raw[map] = await decodePixels(blobs[map], N);
      // A set without AO gets white cavity (all 1), which leaves the sky light unshadowed.
      m.noAo = !raw.ao;
      if (!raw.ao) raw.ao = new Uint8ClampedArray(N * N * 4).fill(255);
      if (m.jpgUrl) URL.revokeObjectURL(m.jpgUrl);
      m.jpgUrl = URL.createObjectURL(blobs.diff);
      barEl.style.width = '100%';
      m.raw = raw;
      m.blur = null;
    }
    setMsg(m.ui.msg, 'Calibrating and packing');
    setStatus('wait', `Packing ${cap(name)}`);
    await new Promise((r) => setTimeout(r, 30));
    const t0 = performance.now();
    await pack(m);
    const big = Math.max(...sources.sizes);
    const off = m.means[big].map((v, c) => Math.abs(v / m.target[c] - 1));
    setMsg(m.ui.msg, `Built in ${((performance.now() - t0) / 1000).toFixed(1)} s. Mean is within ${(Math.max(...off) * 100).toFixed(1)}% of the recipe.`, 'ok');
    setStatus('ok', `${cap(name)} is built.`);
    showResult(name);
  } catch (e) {
    setMsg(m.ui.msg, /** @type {Error} */ (e).message || String(e), 'err');
    throw e;
  }
}

function creditsText() {
  const lines = ['# Texture credits', '',
    'Ground detail maps for ebb (docs/22-ground-detail.md), made with tools/texture-lab.html from CC0 1.0 photo scans on Poly Haven and ambientCG. CC0 asks for no credit; this file thanks the authors and records what we changed.', ''];
  for (const name of ORDER) {
    const m = mats[name];
    if (!m) continue;
    const acg = m.src.source === 'ambientcg';
    lines.push(`## ${cap(name)}: ${m.src.name}`, '',
      `- Source page: ${m.src.page}`,
      acg ? `- Original asset: ${m.src.name} (\`${m.src.id}\`), ${m.src.zip}: maps Color, NormalGL, Roughness, Displacement${m.noAo ? '' : ', AmbientOcclusion'} at 1K`
        : `- Original asset: ${m.src.name} (\`${m.src.id}\`), maps ${sources.maps.join(', ')} at 1k`,
      `- License: ${acg ? 'ambientCG, CC0 1.0' : sources.license}`,
      `- Changes: albedo delit (heavily blurred luminance divided out at strength ${m.delight}), recalibrated so its linear mean equals the recipe albedo [${m.target.join(', ')}] from recipes/world/terrain.json and clamped to ${PHYS_MIN}..${PHYS_MAX}; height stretched to 0..1 (0.5th to 99.5th percentile); repacked into a.webp (albedo), b.webp (normal X, Y and roughness), c.webp (height and cavity); resized to 512 for the low tier.${m.noAo ? ' The set has no ambient occlusion map, so cavity is white.' : ''}`,
      `- Files: assets/textures/ground/${name}/`, '');
  }
  return lines.join('\n');
}

class SaveMissing extends Error {}

/** @param {string} rel repo-relative path @param {Blob} body */
async function putFile(rel, body) {
  /** @type {Response} */ let r;
  try {
    r = await fetch(`../__save/${rel}`, { method: 'PUT', body, headers: { 'Content-Type': body.type || 'application/octet-stream' } });
  } catch { throw new SaveMissing(); }
  /** @type {any} */ let j = null;
  try { j = await r.json(); } catch { /* not the save endpoint */ }
  if (!j || typeof j.ok !== 'boolean') throw new SaveMissing();
  if (!r.ok || !j.ok) throw new Error(`The server refused ${rel}: ${j.error || r.status}`);
  return j;
}

/** @param {string[]} names */
async function saveMaterials(names) {
  setMsg(saveMsgEl, '');
  let count = 0, bytes = 0;
  try {
    for (const name of names) {
      const m = mats[name];
      if (!m.files) await build(name);
      setMsg(m.ui.msg, 'Saving');
      setStatus('wait', `Saving ${cap(name)}`);
      for (const s of sources.sizes) for (const k of KINDS) {
        const f = /** @type {Record<number, Record<string, PackedFile>>} */ (m.files)[s][k];
        const j = await putFile(`assets/textures/ground/${name}/${s}/${k}.webp`, f.blob);
        count++; bytes += j.bytes;
      }
      setMsg(m.ui.msg, `Saved to assets/textures/ground/${name}/ (1024 and 512).`, 'ok');
    }
    await putFile('assets/textures/CREDITS.md', new Blob([creditsText()], { type: MIME.md }));
    const text = `Saved ${count} files (${kb(bytes)}) and assets/textures/CREDITS.md. Commit them in GitHub Desktop.`;
    setMsg(saveMsgEl, text, 'ok');
    setStatus('ok', text);
  } catch (e) {
    if (e instanceof SaveMissing) {
      const text = 'Saving into the repo needs the local server that play.cmd starts, and this page is not running on it. The files are ready under Download in each material; put them in assets/textures/ground/<material>/<size>/ named a.webp, b.webp and c.webp.';
      setMsg(saveMsgEl, text);
      setStatus('warn', 'Save is not available here; use the Download links.');
      for (const name of names) if (mats[name].files) setMsg(mats[name].ui.msg, 'Not saved. Use the Download links below.');
      return;
    }
    setMsg(saveMsgEl, /** @type {Error} */ (e).message, 'err');
    throw e;
  }
}

// ---------- boot ----------

async function boot() {
  setStatus('wait', 'Loading recipes');
  try {
    const [s, t] = await Promise.all([
      fetch('../recipes/world/ground-sources.json', { cache: 'no-store' }).then((r) => r.json()),
      fetch('../recipes/world/terrain.json', { cache: 'no-store' }).then((r) => r.json()),
    ]);
    sources = s; terrain = t;
  } catch {
    setStatus('warn', 'Could not read recipes/world/ground-sources.json or terrain.json.');
    return;
  }
  for (const name of ORDER) {
    const src = sources.materials[name];
    // A scan can borrow another material's recipe color (cliff rock uses albedoRock).
    const target = terrain.materials['albedo' + cap(src?.albedoFrom ?? name)];
    if (!src || !target) continue;
    mats[name] = { name, src, target, delight: src.delight, raw: null, jpgUrl: '', noAo: false, blur: null, blurMean: 1, files: null, means: {}, prevTile: null, prevWrap: null, prevHex: null, ui: {} };
    makeCard(name);
  }
  try { const j = await (await fetch('../__local.json', { cache: 'no-store' })).json(); localServer = !!j.local; } catch { localServer = false; }
  let webpOk = true;
  try { await encodeWebp(new Uint8ClampedArray([0, 0, 0, 255]), 1, 0.9); } catch { webpOk = false; }
  if (!webpOk) { setStatus('warn', 'This browser cannot write WebP files. Open this page in Chrome or Edge.'); return; }
  setStatus(localServer ? 'ok' : 'warn', localServer
    ? 'Ready. Build a material to download its scans from Poly Haven or ambientCG; Save writes into the repo.'
    : 'Ready. This page is not on the play.cmd server, so saving into the repo and ambientCG materials are off; Download links will appear after a build.');
  buildAllBtn.disabled = false;
  saveAllBtn.disabled = false;
  buildAllBtn.addEventListener('click', () => run(async () => { for (const n of ORDER) if (mats[n]) await build(n); }));
  saveAllBtn.addEventListener('click', () => run(() => saveMaterials(ORDER.filter((n) => mats[n]))));
  sunAltIn.addEventListener('input', queuePreviews);
  sunAzIn.addEventListener('input', queuePreviews);
  queuePreviews();
}

// The tiling switch works from the first paint, before the recipes load.
for (const el of /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll('input[name=tiling]'))) {
  if (el.checked) tiling = /** @type {Tiling} */ (el.value);
  el.addEventListener('change', () => { if (el.checked) { tiling = /** @type {Tiling} */ (el.value); queuePreviews(); } });
}

boot();

// A module (the page loads it with type="module"), not a script sharing names with the others.
export {};
