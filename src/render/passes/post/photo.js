// @ts-check
// Photo mode's shot (B2 P1): the frame drawn offscreen at up to twice the window (the tonemap
// draws into a texture of its own, so no button is ever in it), read back, cut to the frame shape,
// its edge given to the paper margin when that is on (the picture inside it, exactly as the guide
// on screen shows), then saved as a PNG. Numbers: recipes/world/photo.json export, frame.

/**
 * The size a photo is drawn at (pure): the window times scale, no larger than maxSide on its
 * longer side nor than the device's largest texture.
 * @param {number} w @param {number} h window pixels @param {number} scale @param {number} maxSide @param {number} maxTex
 * @returns {[number, number]}
 */
export function photoSize(w, h, scale, maxSide, maxTex) {
  const k = Math.max(0.1, Math.min(scale, maxSide / Math.max(w, h), maxTex / Math.max(w, h)));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

/**
 * The largest rectangle of a frame shape centred in a w by h image (pure); `screen` (no w, h) is
 * the whole image.
 * @param {number} w @param {number} h @param {{ w?: number, h?: number } | null | undefined} aspect
 */
export function cropRect(w, h, aspect) {
  if (!aspect?.w || !aspect?.h) return { x: 0, y: 0, w, h };
  const a = aspect.w / aspect.h;
  const cw = Math.min(w, Math.round(h * a)), ch = Math.min(h, Math.round(w / a));
  return { x: Math.floor((w - cw) / 2), y: Math.floor((h - ch) / 2), w: cw, h: ch };
}

/** The paper margin inside a frame, in pixels (pure). @param {{ w: number, h: number }} crop @param {number} marginK */
export const marginPx = (crop, marginK) => Math.round(Math.min(crop.w, crop.h) * Math.max(0, marginK));

/**
 * @param {GPUDevice} device
 * @param {GPUTextureFormat} format the canvas format (the tonemap's pipeline draws in it)
 */
export function createPhotoCapture(device, format) {
  const bgra = format.startsWith('bgra');
  /** @type {GPUTexture | null} */ let tex = null;
  /** @type {{ buffer: GPUBuffer, w: number, h: number, bytesPerRow: number } | null} */ let job = null;

  return {
    /** A target of this size for the tonemap to draw the photo into. @param {number} w @param {number} h */
    target(w, h) {
      if (!tex || tex.width !== w || tex.height !== h) {
        tex?.destroy();
        tex = device.createTexture({ label: 'photo', size: [w, h], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      }
      return tex;
    },
    /** After the photo's frame is recorded: copy it out for reading. @param {GPUCommandEncoder} encoder */
    copy(encoder) {
      if (!tex) return;
      const bytesPerRow = Math.ceil((tex.width * 4) / 256) * 256;
      const buffer = device.createBuffer({ label: 'photo-read', size: bytesPerRow * tex.height, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      encoder.copyTextureToBuffer({ texture: tex }, { buffer, bytesPerRow }, [tex.width, tex.height]);
      job = { buffer, w: tex.width, h: tex.height, bytesPerRow };
    },
    /**
     * After submit: read the photo back, cut and margin it, and resolve its PNG.
     * @param {{ aspect: any, marginK: number, paperHex: string }} look
     * @returns {Promise<Blob> | null}
     */
    finish(look) {
      const j = job;
      job = null;
      if (!j) return null;
      return j.buffer.mapAsync(GPUMapMode.READ).then(() => {
        const src = new Uint8Array(j.buffer.getMappedRange());
        const img = new ImageData(j.w, j.h);
        for (let y = 0; y < j.h; y++) {
          const row = y * j.bytesPerRow, o = y * j.w * 4;
          for (let x = 0; x < j.w; x++) {
            const i = row + x * 4, k = o + x * 4;
            img.data[k] = src[i + (bgra ? 2 : 0)]; img.data[k + 1] = src[i + 1]; img.data[k + 2] = src[i + (bgra ? 0 : 2)]; img.data[k + 3] = 255;
          }
        }
        j.buffer.unmap();
        j.buffer.destroy();
        tex?.destroy();
        tex = null;
        const crop = cropRect(j.w, j.h, look.aspect);
        const m = marginPx(crop, look.marginK);
        const full = document.createElement('canvas');
        full.width = j.w; full.height = j.h;
        /** @type {CanvasRenderingContext2D} */ (full.getContext('2d')).putImageData(img, 0, 0);
        const out = document.createElement('canvas');
        out.width = crop.w; out.height = crop.h;
        const g = /** @type {CanvasRenderingContext2D} */ (out.getContext('2d'));
        g.fillStyle = look.paperHex;
        g.fillRect(0, 0, out.width, out.height);
        g.drawImage(full, crop.x + m, crop.y + m, crop.w - 2 * m, crop.h - 2 * m, m, m, crop.w - 2 * m, crop.h - 2 * m);
        return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('photo: no PNG'))), 'image/png'));
      });
    },
  };
}

/**
 * Save a PNG to the player's downloads, named by the stem and the time.
 * @param {Blob} blob @param {string} stem
 */
export function savePng(blob, stem) {
  const d = new Date(), p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${stem}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
