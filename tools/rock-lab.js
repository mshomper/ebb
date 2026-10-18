// @ts-check
// Rock lab: painted rock on flat ground, three tilings of the shipped scan, or (with ?scans=)
// Poly Haven candidate scans beside it (docs/22, G4). A CPU port of
// lib-ground.wgsl's hex tiling for one material, lit with a simple sun and sky, so the options
// can be compared side by side before any shader changes. Not the game renderer: no shadows,
// palette or tonemap curve; just the same maps, tiling and detail normal.

const ROCK = '../assets/textures/ground/rock/512/';
const GRASS = [0.16, 0.26, 0.12];
const PATCH = { x: 7, z: 5 };       // half extents of the rock patch (m)
const W = 800, H = 450;

/** @typedef {{ name: string, note: string, tile: number, density: number, sharp: number,
 *   spreadDeg: number, spreadLenM: number, jitterDeg: number, scaleJitter: number,
 *   warpM: number, warpLenM: number, reliefM: number, reliefLenM: number, normal: number }} Variant */
/** @type {Variant[]} */
const VARIANTS = [
  { name: 'Plain hex', note: 'Hex tiling with offsets only (the tiling before G4): one direction everywhere, so a scan with joints lines them up into paving.',
    tile: 1.2, density: 2, sharp: 6, spreadDeg: 0, spreadLenM: 8, jitterDeg: 0, scaleJitter: 0, warpM: 0, warpLenM: 1, reliefM: 0, reliefLenM: 1, normal: 1 },
  { name: 'A. Drifting grain', note: 'The cracks\' direction drifts slowly across the ground (up to 90 degrees over a few meters), stone sizes vary, and straight joints bend gently. Same scan, no grid.',
    tile: 1.2, density: 2, sharp: 6, spreadDeg: 90, spreadLenM: 7, jitterDeg: 12, scaleJitter: 0.2, warpM: 0.14, warpLenM: 1.4, reliefM: 0, reliefLenM: 1, normal: 1 },
  { name: 'B. Bedrock outcrop', note: 'Drifting grain, plus on flat ground only: slabs about twice as big, shallower cracks, and low rounded swells of bedrock. Steep slopes keep today\'s cliff look.',
    tile: 2.2, density: 1.6, sharp: 6, spreadDeg: 90, spreadLenM: 7, jitterDeg: 12, scaleJitter: 0.2, warpM: 0.2, warpLenM: 1.8, reliefM: 0.16, reliefLenM: 2.6, normal: 0.7 },
];

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

// ---------- maps and mips ----------

/** @typedef {{ s: number, alb: Float32Array, h: Float32Array, nx: Float32Array, ny: Float32Array, cav: Float32Array }} Level */

/** @param {string} url @param {number} [size] square size to draw at (default: the image's) */
async function pixels(url, size) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} (${res.status})`);
  const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const n = size ?? bmp.width;
  const c = new OffscreenCanvas(n, n);
  const g = /** @type {OffscreenCanvasRenderingContext2D} */ (c.getContext('2d'));
  g.drawImage(bmp, 0, 0, n, n);
  return { n, d: g.getImageData(0, 0, n, n).data };
}

const srgbToLinear = (/** @type {number} */ c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** @param {number} n @returns {Level} */
const emptyLevel = (n) => ({ s: n, alb: new Float32Array(n * n * 3), h: new Float32Array(n * n), nx: new Float32Array(n * n), ny: new Float32Array(n * n), cav: new Float32Array(n * n) });

/** The shipped rock maps (texture lab output). */
async function loadShipped() {
  const [a, b, c] = await Promise.all(['a', 'b', 'c'].map((f) => pixels(`${ROCK}${f}.webp`)));
  const n = a.n;
  const base = emptyLevel(n);
  for (let i = 0; i < n * n; i++) {
    for (let k = 0; k < 3; k++) base.alb[i * 3 + k] = srgbToLinear(a.d[i * 4 + k] / 255);
    base.h[i] = c.d[i * 4] / 255;
    base.cav[i] = c.d[i * 4 + 1] / 255;
    base.nx[i] = b.d[i * 4] / 255 * 2 - 1;
    base.ny[i] = b.d[i * 4 + 1] / 255 * 2 - 1;
  }
  return mips(base);
}

/**
 * A Poly Haven candidate straight from its 1k JPEGs (not delit), drawn at 512 like the shipped set,
 * albedo scaled so its mean is the recipe rock color, height stretched to 0..1.
 * @param {string} id
 */
async function loadPolyHaven(id) {
  const url = (/** @type {string} */ m) => `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/${id}/${id}_${m}_1k.jpg`;
  const [a, b, h, ao] = await Promise.all([
    pixels(url('diff'), 512), pixels(url('nor_gl'), 512), pixels(url('disp'), 512),
    pixels(url('ao'), 512).catch(() => null),
  ]);
  const n = 512;
  const base = emptyLevel(n);
  const mean = [0, 0, 0];
  let lo = 1, hi = 0;
  for (let i = 0; i < n * n; i++) {
    for (let k = 0; k < 3; k++) { base.alb[i * 3 + k] = srgbToLinear(a.d[i * 4 + k] / 255); mean[k] += base.alb[i * 3 + k] / (n * n); }
    base.h[i] = h.d[i * 4] / 255; lo = Math.min(lo, base.h[i]); hi = Math.max(hi, base.h[i]);
    base.cav[i] = ao ? ao.d[i * 4] / 255 : 1;
    base.nx[i] = b.d[i * 4] / 255 * 2 - 1;
    base.ny[i] = b.d[i * 4 + 1] / 255 * 2 - 1;
  }
  const target = [0.36, 0.34, 0.31];
  for (let i = 0; i < n * n; i++) {
    for (let k = 0; k < 3; k++) base.alb[i * 3 + k] *= target[k] / Math.max(mean[k], 1e-4);
    base.h[i] = (base.h[i] - lo) / Math.max(hi - lo, 1e-4);
  }
  return mips(base);
}

/** @param {Level} base */
function mips(base) {
  const levels = [base];
  while (levels[levels.length - 1].s > 1) {
    const p = levels[levels.length - 1], s = p.s >> 1;
    /** @type {Level} */
    const q = { s, alb: new Float32Array(s * s * 3), h: new Float32Array(s * s), nx: new Float32Array(s * s), ny: new Float32Array(s * s), cav: new Float32Array(s * s) };
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const o = y * s + x;
      const ids = [(2 * y) * p.s + 2 * x, (2 * y) * p.s + 2 * x + 1, (2 * y + 1) * p.s + 2 * x, (2 * y + 1) * p.s + 2 * x + 1];
      for (const i of ids) {
        for (let k = 0; k < 3; k++) q.alb[o * 3 + k] += p.alb[i * 3 + k] / 4;
        q.h[o] += p.h[i] / 4; q.nx[o] += p.nx[i] / 4; q.ny[o] += p.ny[i] / 4; q.cav[o] += p.cav[i] / 4;
      }
    }
    levels.push(q);
  }
  return levels;
}

// ---------- sampling (lib-ground.wgsl, one layer) ----------

/** Bilinear, wrapped, at one mip level. @param {Level} L @param {number} u @param {number} v @param {number[]} o */
function bilinear(L, u, v, o) {
  const s = L.s;
  const x = u * s - 0.5, y = v * s - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const m = (/** @type {number} */ i) => ((i % s) + s) % s;
  const xa = m(x0), xb = m(x0 + 1), ya = m(y0), yb = m(y0 + 1);
  const i00 = ya * s + xa, i10 = ya * s + xb, i01 = yb * s + xa, i11 = yb * s + xb;
  const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
  const mix = (/** @type {Float32Array} */ a, /** @type {number} */ k, /** @type {number} */ st) =>
    a[i00 * st + k] * w00 + a[i10 * st + k] * w10 + a[i01 * st + k] * w01 + a[i11 * st + k] * w11;
  o[0] = mix(L.alb, 0, 3); o[1] = mix(L.alb, 1, 3); o[2] = mix(L.alb, 2, 3);
  o[3] = mix(L.h, 0, 1); o[4] = mix(L.nx, 0, 1); o[5] = mix(L.ny, 0, 1); o[6] = mix(L.cav, 0, 1);
}

/** @param {number} a @param {number} b @param {number} c */
function hash3(a, b, c) {
  let h = (Math.imul(a | 0, 0x8da6b343) ^ Math.imul(b | 0, 0xd8163841) ^ Math.imul(c | 0, 0xcb1ab31f)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
const h01 = (/** @type {number} */ h) => h / 4294967296;

/** Smooth value noise 0..1. @param {number} x @param {number} y @param {number} seed */
function vnoise(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const r = (/** @type {number} */ i, /** @type {number} */ j) => h01(hash3(x0 + i, y0 + j, seed));
  const a = r(0, 0) + (r(1, 0) - r(0, 0)) * sx;
  const b = r(0, 1) + (r(1, 1) - r(0, 1)) * sx;
  return a + (b - a) * sy;
}

/**
 * One hex-tiled read at world (x, z). Returns albedo, height, world height gradient (gx, gz), cavity.
 * @param {Level[]} levels @param {Variant} V @param {number} x @param {number} z @param {number} footM
 */
function rockAt(levels, V, x, z, footM) {
  const N = levels[0].s;
  // Bent joints: a slow warp of the point the scan is read at.
  if (V.warpM > 0) {
    const f = 1 / V.warpLenM;
    x += V.warpM * (vnoise(x * f, z * f, 71) * 2 - 1);
    z += V.warpM * (vnoise(x * f + 9.1, z * f + 3.7, 72) * 2 - 1);
  }
  const k = 1 / V.tile;
  const qx = x * k * V.density, qy = z * k * V.density;
  const gx = qx - 0.57735027 * qy, gy = 1.15470054 * qy;
  const bx = Math.floor(gx), by = Math.floor(gy);
  const fx = gx - bx, fy = gy - by, zz = 1 - fx - fy;
  const s = zz < 0 ? 1 : 0, s2 = 2 * s - 1;
  const bw = [Math.max(-zz * s2, 0), Math.max(s - fy * s2, 0), Math.max(s - fx * s2, 0)];
  const verts = [[bx + s, by + s], [bx + s, by + 1 - s], [bx + 1 - s, by + s]];
  const smp = [0, 0, 0, 0, 0, 0, 0];
  const acc = { alb: [0, 0, 0], h: 0, gx: 0, gz: 0, cav: 0 };
  const reads = [];
  let wsum = 0;
  for (let i = 0; i < 3; i++) {
    const hv = hash3(verts[i][0] + (1 << 20), verts[i][1] + (1 << 20), 0x51ed + 2);
    const ox = h01(hv), oy = h01(hash3(hv, 1, 2));
    // Grain direction: a slow field read at the vertex's world spot, plus a little per-vertex jitter.
    const vy = verts[i][1] / 1.15470054, vx = verts[i][0] + 0.57735027 * vy;
    const wx = vx / (k * V.density), wz = vy / (k * V.density);
    const field = vnoise(wx / V.spreadLenM, wz / V.spreadLenM, 31) * 2 - 1;
    const th = (V.spreadDeg * field + V.jitterDeg * (h01(hash3(hv, 3, 4)) * 2 - 1)) * Math.PI / 180;
    const sc = 1 + V.scaleJitter * (h01(hash3(hv, 5, 6)) * 2 - 1);
    const c = Math.cos(th), sn = Math.sin(th);
    // Image axes in world xz: u = (c, sn), v = (-sn, c).
    const ku = k / sc;
    const u = (x * c + z * sn) * ku + ox, v = (-x * sn + z * c) * ku + oy;
    const lvl = Math.max(0, Math.min(levels.length - 1, Math.log2(Math.max(footM * ku * N, 1e-6))));
    const l0 = Math.floor(lvl), lf = lvl - l0;
    bilinear(levels[l0], u, v, smp);
    const r = smp.slice();
    if (lf > 0 && l0 + 1 < levels.length) {
      bilinear(levels[l0 + 1], u, v, smp);
      for (let j = 0; j < 7; j++) r[j] += (smp[j] - r[j]) * lf;
    }
    // OpenGL normal: +X along +u, +Y image-up (-v). Slope in world, divided by the size jitter.
    const tx = r[4], ty = r[5];
    const tz = Math.sqrt(Math.max(1 - tx * tx - ty * ty, 1e-4));
    const su = -tx / tz, sv = ty / tz;
    const st = V.normal / sc;
    const w = bw[i] ** V.sharp * (r[3] + 0.25) ** 4;
    reads.push({ r, w, gx: (c * su - sn * sv) * st, gz: (sn * su + c * sv) * st });
    wsum += w;
  }
  for (const q of reads) {
    const w = q.w / Math.max(wsum, 1e-6);
    acc.alb[0] += q.r[0] * w; acc.alb[1] += q.r[1] * w; acc.alb[2] += q.r[2] * w;
    acc.h += q.r[3] * w; acc.cav += q.r[6] * w; acc.gx += q.gx * w; acc.gz += q.gz * w;
  }
  // Rounded bedrock swells: the slope of a slow height field, added to the detail slope.
  if (V.reliefM > 0) {
    const f = 1 / V.reliefLenM, e = 0.05;
    const hf = (/** @type {number} */ a, /** @type {number} */ b) => V.reliefM * (vnoise(a * f, b * f, 91) + 0.5 * vnoise(a * f * 2.1, b * f * 2.1, 92));
    acc.gx += (hf(x + e, z) - hf(x - e, z)) / (2 * e);
    acc.gz += (hf(x, z + e) - hf(x, z - e)) / (2 * e);
  }
  return acc;
}

/** Slow tone drift (groundMacro, terrain.json detail.macro). @param {number} x @param {number} z */
function macro(x, z) {
  const m = (vnoise(x / 40, z / 40, 11) - 0.5) + 0.4 * (vnoise(x / 12 + 17.3, z / 12 + 5.9, 12) - 0.5);
  const hue = 0.06 * m;
  return [(1 + 0.3 * m) * (1 + hue), 1 + 0.3 * m, (1 + 0.3 * m) * (1 - hue)];
}

// ---------- render ----------

const LIGHTS = {
  day: { alt: 16, sun: [3.2, 2.9, 2.5], sky: [0.42, 0.5, 0.62], exposure: 1.0 },
  noon: { alt: 70, sun: [3.2, 3.1, 2.9], sky: [0.45, 0.52, 0.62], exposure: 0.8 },
  night: { alt: 28, sun: [0.05, 0.06, 0.08], sky: [0.008, 0.01, 0.016], exposure: 14 },
};
const CAMS = {
  far: { eye: [0, 6.5, -10.5], at: [0, 0, 1], fov: 50 },
  near: { eye: [0, 2.4, -3.6], at: [0, 0, 0.6], fov: 50 },
};

/** @param {number[]} a @param {number[]} b */ const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** @param {number[]} a */ const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
/** @param {number[]} a @param {number[]} b */ const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const toSrgb = (/** @type {number} */ c) => { c = Math.max(0, Math.min(1, c)); return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055; };

/**
 * @param {Level[]} levels @param {Variant} V @param {HTMLCanvasElement} cv
 * @param {{ light: keyof typeof LIGHTS, cam: keyof typeof CAMS, az: number }} st
 */
function render(levels, V, cv, st) {
  const Lc = LIGHTS[st.light], C = CAMS[st.cam];
  const alt = Lc.alt * Math.PI / 180, az = st.az * Math.PI / 180;
  const Ld = [Math.cos(alt) * Math.sin(az), Math.sin(alt), Math.cos(alt) * Math.cos(az)];
  const fw = norm(sub(C.at, C.eye)), rt = norm(cross([0, 1, 0], fw)), up = cross(fw, rt);
  const th = Math.tan(C.fov * Math.PI / 360), pxAng = 2 * th / H;
  const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  const img = g.createImageData(W, H);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const sx = ((px + 0.5) / W * 2 - 1) * th * (W / H), sy = (1 - (py + 0.5) / H * 2) * th;
      const d = norm([fw[0] + rt[0] * sx + up[0] * sy, fw[1] + rt[1] * sx + up[1] * sy, fw[2] + rt[2] * sx + up[2] * sy]);
      let col = [0.5, 0.6, 0.75];
      if (d[1] < -1e-4) {
        const t = -C.eye[1] / d[1];
        const x = C.eye[0] + d[0] * t, z = C.eye[2] + d[2] * t;
        const foot = t * pxAng * 1.3;
        let alb = GRASS, gx = 0, gz = 0, cav = 1;
        if (Math.abs(x) < PATCH.x && Math.abs(z) < PATCH.z) {
          const r = rockAt(levels, V, x, z, foot);
          alb = r.alb; gx = r.gx; gz = r.gz; cav = r.cav;
        }
        const n = norm([-gx, 1, -gz]);
        const ndl = Math.max(0, n[0] * Ld[0] + n[1] * Ld[1] + n[2] * Ld[2]);
        const sky = cav * (0.5 + 0.5 * n[1]);
        const m = macro(x, z);
        col = [0, 1, 2].map((k) => alb[k] * m[k] * (Lc.sun[k] * ndl + Lc.sky[k] * sky) * Lc.exposure);
        // Gentle shoulder so highlights do not clip.
        col = col.map((c) => c / (1 + c * 0.35));
      } else if (st.light === 'night') col = [0.01, 0.014, 0.03];
      const o = (py * W + px) * 4;
      img.data[o] = toSrgb(col[0]) * 255; img.data[o + 1] = toSrgb(col[1]) * 255; img.data[o + 2] = toSrgb(col[2]) * 255; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

// ---------- page ----------

// `?scans=id1,id2` compares Poly Haven candidates (laid with drifting grain at `?tile=` meters)
// against today's scan and tiling, instead of the three tiling options.
const params = new URLSearchParams(location.search);
const scanIds = (params.get('scans') ?? '').split(',').filter((s) => /^[a-z0-9_]+$/.test(s));
const scanTile = Number(params.get('tile') ?? 2) || 2;
/** @typedef {{ name: string, note: string, V: Variant, load: () => Promise<Level[]>, levels?: Level[], cv?: HTMLCanvasElement }} Panel */
const shipped = (() => { /** @type {Promise<Level[]> | null} */ let p = null; return () => (p ??= loadShipped()); })();
/** @type {Panel[]} */
const PANELS = scanIds.length
  ? [{ name: 'Shipped', note: 'The rock scan in assets/textures/ground/rock, with drifting grain.', V: { ...VARIANTS[1], tile: scanTile }, load: shipped },
    ...scanIds.map((id) => ({ name: id.replace(/_/g, ' '), note: `Poly Haven "${id}", ${scanTile} m tile, drifting grain.`,
      V: { ...VARIANTS[1], tile: scanTile }, load: () => loadPolyHaven(id) }))]
  : VARIANTS.map((V) => ({ name: V.name, note: V.note, V, load: shipped }));

const panels = $('panels');
for (const P of PANELS) {
  const fig = document.createElement('figure');
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const cap = document.createElement('figcaption');
  const b = document.createElement('b'); b.textContent = P.name;
  cap.append(b, P.note);
  fig.append(cv, cap);
  panels.append(fig);
  P.cv = cv;
}

const state = { light: /** @type {keyof typeof LIGHTS} */ ('day'), cam: /** @type {keyof typeof CAMS} */ ('far'), az: 210 };
let token = 0;
async function draw() {
  const my = ++token;
  const status = $('status');
  status.dataset.ready = '';
  $('az-out').textContent = `${state.az} deg`;
  status.textContent = 'Drawing';
  for (const P of PANELS) {
    await new Promise((r) => setTimeout(r, 0));
    if (my !== token) return;
    if (!P.levels) {
      try { P.levels = await P.load(); } catch (err) { status.textContent = `Could not load ${P.name}: ${/** @type {Error} */ (err).message}`; continue; }
    }
    render(P.levels, P.V, /** @type {HTMLCanvasElement} */ (P.cv), state);
  }
  status.textContent = scanIds.length
    ? 'Same color, same light in every panel. Candidates are raw scans (not yet cleaned up by the texture lab).'
    : 'Same rock scan, same color, same light in all three. Only how the scan is laid on the ground changes.';
  status.dataset.ready = '1';
}

document.querySelectorAll('input[name=light]').forEach((el) => el.addEventListener('change', (e) => { state.light = /** @type {any} */ (e.target).value; draw(); }));
document.querySelectorAll('input[name=cam]').forEach((el) => el.addEventListener('change', (e) => { state.cam = /** @type {any} */ (e.target).value; draw(); }));
$('az').addEventListener('change', (e) => { state.az = Number(/** @type {HTMLInputElement} */ (e.target).value); draw(); });
$('az').addEventListener('input', (e) => { $('az-out').textContent = `${/** @type {HTMLInputElement} */ (e.target).value} deg`; });

draw();
