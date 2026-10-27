// @ts-check
// The Walker page's portrait (K3): the walker as worn right now, in its own small view
// (src/render/portrait.js), breathing at rest with a slow turn; a drag turns it, and the slow turn
// comes back a moment after. It wears the kit: the carrier on its bone as P2f draws it in the world
// (the satchel at the hip, the basket on the pack's spring, the baked pack folded away). The model and
// clips load the first time the page opens; nothing is drawn while the page is shut, so its cost is
// the page's alone (the frame-time note: window.ebbPortraitMs with ?debug, docs/23).

import { get } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { readGlb, meshesByName } from '../render/gltf.js';
import { createPortraitRenderer, PORTRAIT_BONES } from '../render/portrait.js';
import { loadFigureModel, loadFigureClips, eyeUniforms } from '../world/figure/index.js';
import { buildFigure } from '../world/figure/rig.js';
import { createFigureMotion } from '../world/figure/motion.js';
import { carriedOn } from '../world/figure/carry.js';
import { packMesh } from '../world/creatures/bodies.js';

const DEG = Math.PI / 180;
const debug = new URLSearchParams(location.search).has('debug');

/** A rigid model as portrait vertices on the carrier's bone (20): its UVs for the carrier's map. @param {import('../render/gltf.js').Glb} glb */
function propMesh(glb) {
  const parts = [...meshesByName(glb).values()];
  const count = parts.reduce((s, p) => s + p.attributes.POSITION.length / 3, 0);
  const vertices = new Float32Array(count * 9), indices = new Uint32Array(parts.reduce((s, p) => s + p.indices.length, 0));
  let v0 = 0, i0 = 0;
  for (const p of parts) {
    const P = p.attributes.POSITION, N = p.attributes.NORMAL, UV = p.attributes.TEXCOORD_0, n = P.length / 3;
    for (let i = 0; i < n; i++) {
      vertices.set([P[i * 3], P[i * 3 + 1], P[i * 3 + 2], N ? N[i * 3] : 0, N ? N[i * 3 + 1] : 1, N ? N[i * 3 + 2] : 0,
        UV ? UV[i * 2] : 0.5, UV ? UV[i * 2 + 1] : 0.5, 3], (v0 + i) * 9);
    }
    for (let k = 0; k < p.indices.length; k++) indices[i0 + k] = p.indices[k] + v0;
    v0 += n; i0 += p.indices.length;
  }
  const joints = new Uint8Array(count * 4).fill(0);
  for (let v = 0; v < count; v++) joints[v * 4] = PORTRAIT_BONES - 1;
  return { data: packMesh({ vertices, count }, joints), indices };
}

/** A 4x4 (column-major) from a place, a prop's yaw, pitch and roll (Ry Rx Rz) and a size. */
function placeMatrix(/** @type {number[]} */ t, /** @type {number} */ yaw, /** @type {number} */ pitch, /** @type {number} */ roll, /** @type {number} */ s) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  // Rows of Ry * Rx * Rz.
  const r = [
    [cy * cr + sy * sp * sr, -cy * sr + sy * sp * cr, sy * cp],
    [cp * sr, cp * cr, -sp],
    [-sy * cr + cy * sp * sr, sy * sr + cy * sp * cr, cy * cp],
  ];
  return new Float32Array([r[0][0] * s, r[1][0] * s, r[2][0] * s, 0, r[0][1] * s, r[1][1] * s, r[2][1] * s, 0, r[0][2] * s, r[1][2] * s, r[2][2] * s, 0, t[0], t[1], t[2], 1]);
}

/**
 * @param {HTMLElement} host the page's portrait box
 * @param {{ device: GPUDevice, figure: any, R: any, pack: any }} o
 *   figure: recipes/world/figure.json; R: recipes/world/kit.json; pack: the live pack (its recipe's wear block)
 * @returns {{ start: () => void, stop: () => void }}
 */
export function createWalkerPortrait(host, o) {
  const PR = o.R.portrait, FR = o.figure, WR = o.pack.recipe.wear ?? {};
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);
  /** @type {Awaited<ReturnType<typeof createPortraitRenderer>> | null} */ let gpu = null;
  /** @type {ReturnType<typeof createFigureMotion> | null} */ let motion = null;
  /** @type {any} */ let built = null;
  let headBone = -1, loading = /** @type {Promise<void> | null} */ (null);
  let running = false, raf = 0, last = 0, yaw = 0, settle = 0;
  const bones = new Float32Array(PORTRAIT_BONES * 16);
  const eyes = new Float32Array(20);
  /** The carrier drawn now, and its models as they load. @type {string | null} */ let propKey = null;
  /** @type {Map<string, Promise<void>>} */ const props = new Map();
  /** @type {Map<string, import('../render/gltf.js').Glb>} */ const glbs = new Map();
  let campR = /** @type {any} */ (null);
  let msAvg = 0;

  async function load() {
    const [glb, clips] = await Promise.all([loadFigureModel(FR), loadFigureClips(FR).catch(() => null)]);
    gpu = await createPortraitRenderer({ device: o.device, canvas });
    built = buildFigure(glb, FR, { textured: true });
    motion = createFigureMotion(FR, built.skeleton, clips);
    headBone = built.skeleton.findIndex((/** @type {any} */ b) => b.name === 'head');
    gpu.setMesh('figure', { data: built.data, indices: built.indices });
    if (built.textured) await gpu.setFigureMaps(glb);
    campR = await loadRecipe('world/camp');
  }

  /** The carrier worn's model, loaded once. @param {string} id */
  function carrierModel(id) {
    if (!props.has(id)) {
      const file = campR?.props?.models?.[WR[id]?.model]?.file;
      props.set(id, !file || !gpu ? Promise.resolve() : fetch(new URL(`../../${file}`, import.meta.url)).then((r) => r.arrayBuffer()).then(async (b) => {
        const glb = readGlb(b);
        glbs.set(id, glb);
        gpu?.setMesh(`carrier:${id}`, propMesh(glb));
        if (propKey === id) await gpu?.setPropMap(glb);
      }).catch((e) => console.info(`portrait: the ${id} did not load (${e.message})`)));
    }
    return props.get(id);
  }

  function size() {
    // The box's own pixels, its longer side capped at the recipe's px.
    const r = host.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    const k = Math.min(dpr, PR.px / Math.max(r.width, r.height, 1));
    const w = Math.max(2, Math.round(r.width * k)), h = Math.max(2, Math.round(r.height * k));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  function frame(/** @type {number} */ now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (!gpu || !motion || !built) return;
    const t0 = performance.now();
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if ((settle -= dt) <= 0) yaw += PR.idleTurnDegS * DEG * dt;
    // The kit: the carrier worn (null: the baked pack shows).
    const carrier = get('kit')?.carrier ?? null;
    motion.showPack(!carrier);
    const r = motion.update(dt, { x: 0, y: 0, z: 0, yaw: 0, speed: 0, moving: false, ground: () => 0, below: true, posture: 'stand' });
    bones.set(motion.bones.subarray(0, (PORTRAIT_BONES - 1) * 16));
    const draw = ['figure'];
    const W = carrier ? WR[carrier] : null;
    if (W && carrier) {
      carrierModel(carrier);
      // One carrier map at a time: the one worn's.
      if (propKey !== carrier) { propKey = carrier; const g = glbs.get(carrier); if (g) gpu.setPropMap(g); }
      const i = built.skeleton.findIndex((/** @type {any} */ b) => b.name === W.bone);
      if (i >= 0) {
        const c = carriedOn(motion.bones, i, built.skeleton[i].pivot, W.at, W.turnDeg ?? [0, 0, 0], 0, 1);
        bones.set(placeMatrix([c.dx, c.dy, c.dz], c.yaw, c.pitch, c.roll, (W.scale ?? 1) / (FR.body.displayScale ?? 1)), (PORTRAIT_BONES - 1) * 16);
        draw.push(`carrier:${carrier}`);
      }
    }
    size();
    gpu.draw({ bones, draw, yaw, R: PR, eyes: eyeUniforms(FR.eyes, headBone, r.eyes, eyes), scale: FR.body.displayScale ?? 1 });
    // The frame-time note: the portrait's own work each frame, smoothed.
    msAvg = msAvg * 0.95 + (performance.now() - t0) * 0.05;
    if (debug) /** @type {any} */ (window).ebbPortraitMs = msAvg;
  }

  // Drag to turn.
  let dragX = null;
  host.addEventListener('pointerdown', (e) => { dragX = e.clientX; host.setPointerCapture(e.pointerId); host.classList.add('is-dragging'); });
  host.addEventListener('pointermove', (e) => {
    if (dragX === null) return;
    yaw += (e.clientX - dragX) * PR.dragDegPerPx * DEG;
    dragX = e.clientX;
    settle = PR.settleS;
  });
  const end = () => { dragX = null; host.classList.remove('is-dragging'); };
  host.addEventListener('pointerup', end);
  host.addEventListener('pointercancel', end);

  return {
    start() {
      if (running) return;
      running = true; last = 0;
      loading ??= load().catch((err) => { console.error('The walker portrait did not load:', err); });
      raf = requestAnimationFrame(frame);
    },
    stop() { running = false; cancelAnimationFrame(raf); },
  };
}
