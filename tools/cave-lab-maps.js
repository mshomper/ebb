// @ts-check
// The cave lab's flat pictures (H1): a floor's map (the chamber graph over its walk grid, each
// chamber kind coloured and labelled), its field cut level at walking height, and its field cut
// upright along the main path. The field pictures show the signed distance itself: air in teal and
// rock in stone, banded every half metre, the surface (zero) as a dark line.

/** Chamber kinds: colour and label. */
export const KINDS = {
  in: { colour: '#2E7D6B', label: 'Way in' },
  fight: { colour: '#B4533A', label: 'Fight' },
  down: { colour: '#3B4A8C', label: 'Way down' },
  quiet: { colour: '#5F8A35', label: 'Quiet' },
  find: { colour: '#B08A1E', label: 'Find' },
  seep: { colour: '#7A4FA0', label: 'Seep' },
};

/** Map cell colours. */
export const CELLS = {
  rock: '#3A3631', steep: '#9C9284', floor: '#EDE3CF', cut: '#E0A090', shallow: '#9CC0D0', deep: '#3F6E8C',
};

/** Size a canvas to its box for sharp drawing; returns the 2D context and the size in CSS pixels. @param {HTMLCanvasElement} c @param {number} aspect height / width */
function fit(c, aspect) {
  const w = c.clientWidth || 400, h = Math.max(120, Math.round(w * aspect));
  c.style.height = `${h}px`;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/** A label with a pale halo. @param {CanvasRenderingContext2D} ctx @param {string} s @param {number} x @param {number} y @param {string} colour */
function label(ctx, s, x, y, colour) {
  ctx.font = '800 15px Nunito, system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(251, 247, 240, 0.95)';
  ctx.strokeText(s, x, y);
  ctx.fillStyle = colour; ctx.fillText(s, x, y);
}

/**
 * The map: walk grid cells under the chamber graph.
 * @param {HTMLCanvasElement} canvas @param {any} floor from makeFloor @param {any} W recipe floors.walk
 */
export function drawMap(canvas, floor, W) {
  const g = floor.grid, chk = floor.check;
  const { ctx, w } = fit(canvas, g.h / g.w);
  const s = w / g.w;
  const img = document.createElement('canvas');
  img.width = g.w; img.height = g.h;
  const ic = /** @type {CanvasRenderingContext2D} */ (img.getContext('2d'));
  const data = ic.createImageData(g.w, g.h);
  const rgb = (/** @type {string} */ hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const col = Object.fromEntries(Object.entries(CELLS).map(([k, v]) => [k, rgb(v)]));
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < g.w * g.h; k++) if (g.floor[k]) { lo = Math.min(lo, g.height[k]); hi = Math.max(hi, g.height[k]); }
  for (let k = 0; k < g.w * g.h; k++) {
    let c;
    if (!g.floor[k]) c = col.rock;
    else if (g.water[k] >= W.wadeM) c = col.deep;
    else if (g.steep[k]) c = col.steep;
    else if (g.water[k] > 0.02) c = col.shallow;
    else if (!chk.reached[k]) c = col.cut;
    else c = col.floor;
    // Lower floor a little darker, so the shape of the ground reads.
    const shade = g.floor[k] && !g.steep[k] ? 0.82 + 0.18 * ((g.height[k] - lo) / Math.max(0.5, hi - lo)) : 1;
    data.data.set([c[0] * shade, c[1] * shade, c[2] * shade, 255], k * 4);
  }
  ic.putImageData(data, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, g.w * s, g.h * s);
  const px = (/** @type {number} */ x) => ((x - g.minX) / g.cellM) * s, pz = (/** @type {number} */ z) => ((z - g.minZ) / g.cellM) * s;
  // Passages, then chambers, then labels on top.
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const p of floor.plan.passages) {
    ctx.beginPath();
    p.pts.forEach((/** @type {number[]} */ q, /** @type {number} */ i) => (i ? ctx.lineTo(px(q[0]), pz(q[2])) : ctx.moveTo(px(q[0]), pz(q[2]))));
    ctx.strokeStyle = 'rgba(30, 38, 36, 0.55)'; ctx.lineWidth = 3; ctx.setLineDash([7, 6]); ctx.stroke(); ctx.setLineDash([]);
  }
  for (const c of floor.plan.chambers) {
    const k = /** @type {any} */ (KINDS)[c.kind];
    ctx.beginPath(); ctx.arc(px(c.x), pz(c.z), (c.r / g.cellM) * s, 0, Math.PI * 2);
    ctx.strokeStyle = k.colour; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.arc(px(c.x), pz(c.z), 7, 0, Math.PI * 2); ctx.fillStyle = k.colour; ctx.fill();
  }
  for (const c of floor.plan.chambers) {
    const k = /** @type {any} */ (KINDS)[c.kind];
    label(ctx, k.label, px(c.x), pz(c.z) - 18, k.colour);
  }
}

/** The field sample nearest a point. @param {any} floor @param {number} x @param {number} y @param {number} z */
function sample(floor, x, y, z) {
  const b = floor.bounds;
  const i = Math.round((x - b.min[0]) / b.cellM), j = Math.round((y - b.min[1]) / b.cellM), k = Math.round((z - b.min[2]) / b.cellM);
  if (i < 0 || j < 0 || k < 0 || i >= b.n[0] || j >= b.n[1] || k >= b.n[2]) return -2;
  return floor.field[(k * b.n[1] + j) * b.n[0] + i];
}

/** Air teal, rock stone, banded every half metre, the surface dark. @param {number} v the field (air positive) */
function fieldColour(v) {
  if (Math.abs(v) < 0.06) return [30, 38, 36];
  const band = Math.floor(Math.abs(v) / 0.5) % 2 === 0 ? 1 : 0.9;
  const t = Math.min(1, Math.abs(v) / 2);
  const c = v > 0 ? [200 - 90 * t, 228 - 60 * t, 220 - 40 * t] : [196 - 60 * t, 176 - 60 * t, 150 - 55 * t];
  return c.map((x) => x * band);
}

/**
 * The field cut level, 1 m over the floor of the chamber nearest each point.
 * @param {HTMLCanvasElement} canvas @param {any} floor
 */
export function drawFieldLevel(canvas, floor) {
  const b = floor.bounds, ch = floor.plan.chambers;
  const nx = b.n[0], nz = b.n[2];
  const { ctx, w } = fit(canvas, nz / nx);
  const img = document.createElement('canvas');
  img.width = nx; img.height = nz;
  const ic = /** @type {CanvasRenderingContext2D} */ (img.getContext('2d'));
  const data = ic.createImageData(nx, nz);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const x = b.min[0] + i * b.cellM, z = b.min[2] + k * b.cellM;
    let near = ch[0], best = Infinity;
    for (const c of ch) { const d = Math.hypot(c.x - x, c.z - z) - c.r; if (d < best) { best = d; near = c; } }
    data.data.set([...fieldColour(sample(floor, x, near.y + 1, z)), 255], (k * nx + i) * 4);
  }
  ic.putImageData(data, 0, 0);
  ctx.drawImage(img, 0, 0, w, (nz / nx) * w);
  const s = w / ((nx - 1) * b.cellM);
  for (const c of ch) label(ctx, /** @type {any} */ (KINDS)[c.kind].label, (c.x - b.min[0]) * s, (c.z - b.min[2]) * s, /** @type {any} */ (KINDS)[c.kind].colour);
}

/**
 * The field cut upright along the main path: through each main chamber's centre and the passage
 * between, unrolled flat; the walk grid's floor drawn over it.
 * @param {HTMLCanvasElement} canvas @param {any} floor
 */
export function drawFieldSection(canvas, floor) {
  const b = floor.bounds, plan = floor.plan;
  /** @type {number[][]} */ const line = [];
  const main = plan.chambers.filter((/** @type {any} */ c) => c.main);
  main.forEach((/** @type {any} */ c, /** @type {number} */ i) => {
    line.push([c.x, c.z]);
    const next = main[i + 1];
    if (!next) return;
    const p = plan.passages.find((/** @type {any} */ q) => q.a === c.id && q.b === next.id);
    if (p) for (const q of p.pts) line.push([q[0], q[2]]);
  });
  /** @type {number[][]} */ const pts = [];
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1], [bx, bz] = line[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / b.cellM));
    for (let s = 0; s < n; s++) pts.push([ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n]);
  }
  const ny = b.n[1];
  // Heights drawn twice as tall as lengths, so a low room still reads.
  const { ctx, w, h } = fit(canvas, Math.min(0.7, (2 * ny) / pts.length));
  const img = document.createElement('canvas');
  img.width = pts.length; img.height = ny;
  const ic = /** @type {CanvasRenderingContext2D} */ (img.getContext('2d'));
  const data = ic.createImageData(pts.length, ny);
  pts.forEach(([x, z], s) => {
    for (let j = 0; j < ny; j++) data.data.set([...fieldColour(sample(floor, x, b.min[1] + j * b.cellM, z)), 255], ((ny - 1 - j) * pts.length + s) * 4);
  });
  ic.putImageData(data, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, w, h);
  // The walk grid's floor along the same line, where there is one.
  const g = floor.grid;
  ctx.strokeStyle = '#D9622B'; ctx.lineWidth = 3; ctx.beginPath();
  let pen = false;
  pts.forEach(([x, z], s) => {
    const k = g.cellAt(x, z);
    if (k < 0 || !g.floor[k]) { pen = false; return; }
    const X = (s / pts.length) * w, Y = h - ((g.height[k] - b.min[1]) / ((ny - 1) * b.cellM)) * h;
    if (pen) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
    pen = true;
  });
  ctx.stroke();
}
