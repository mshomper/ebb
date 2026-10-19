// @ts-check
// Diorama orbit camera: target, yaw, pitch, distance, each with a goal and a damped value (docs/15).

import { mat4, vec3 } from 'wgpu-matrix';

const DEG = Math.PI / 180;

/**
 * @typedef {Object} CameraRecipe
 * @property {number} fovYDeg
 * @property {number} near
 * @property {{yawDeg:number, pitchDeg:number, distance:number, target:number[]}} start
 * @property {[number, number]} pitchSoftDeg
 * @property {[number, number]} pitchHardDeg
 * @property {[number, number|null]} distanceSoft
 * @property {[number, number|null]} distanceHard
 * @property {number} distanceHardMaxFactor
 * @property {number} worldRadius
 * @property {number} targetMargin
 * @property {number} minEyeHeight
 * @property {{ fromM: number, toM: number, minEyeHeight: number }} [close]  the close-up (S6b): below fromM the
 *   view eases to aiming at the ground and a low eye, fully at toM
 * @property {number} halfLifeDirect
 * @property {number} halfLifeGlide
 * @property {number} [halfLifeFocus]  the slower glide of focus() (the journal's Show me)
 * @property {number} softReturnDelay
 * @property {number} orbitDegPerPx
 * @property {number} panScale
 * @property {number} zoomToCursor
 */

/**
 * @param {CameraRecipe} r
 */
export function createOrbitCamera(r) {
  const fovY = r.fovYDeg * DEG;
  const goal = {
    target: vec3.fromValues(r.start.target[0], r.start.target[1], r.start.target[2]),
    yaw: r.start.yawDeg * DEG,
    pitch: r.start.pitchDeg * DEG,
    distance: r.start.distance,
  };
  const cur = { target: vec3.copy(goal.target), yaw: goal.yaw, pitch: goal.pitch, distance: goal.distance };

  let viewW = 1;
  let viewH = 1;
  let sinceInput = Infinity;
  let worldRadius = r.worldRadius;
  /** @type {(x: number, z: number) => number} */
  let groundProbe = () => 0;

  const eye = vec3.create();
  const view = mat4.identity();
  const proj = mat4.identity();
  const viewProj = mat4.identity();
  const invViewProj = mat4.identity();

  let fitted = false;
  /** Tangent of the half angle of the narrower field of view (horizontal on a portrait phone). */
  const tanNarrow = () => Math.tan(fovY / 2) * Math.min(1, viewW / viewH);
  const softMaxDistance = () => r.distanceSoft[1] ?? (1.4 * worldRadius) / tanNarrow();
  const hardMaxDistance = () => r.distanceHard[1] ?? softMaxDistance() * r.distanceHardMaxFactor;
  const clamp = (/** @type {number} */ x, /** @type {number} */ a, /** @type {number} */ b) => Math.min(b, Math.max(a, x));

  /** True while gliding to a point the journal asked to show; any input ends it. */
  let focusing = false;
  /**
   * Close-up limits (the frog size preview, ?frogscale): a nearer zoom and a lower eye; while set,
   * the target sits on the ground (or at the height a focus asked for) instead of half way down.
   * @type {{ minDistance: number, minEyeHeight: number } | null}
   */
  let close = null;
  /** A focus's exact target height (m), kept until the next pan. @type {number | null} */
  let targetY = null;
  const minSoft = () => close?.minDistance ?? r.distanceSoft[0];
  const minHard = () => close?.minDistance ?? r.distanceHard[0];

  /** 0 at or beyond close.fromM, 1 at or inside close.toM, smooth between. @param {number} d */
  function nearness(d) {
    const C = r.close;
    if (!C) return 0;
    const t = Math.min(1, Math.max(0, (C.fromM - d) / (C.fromM - C.toM)));
    return t * t * (3 - 2 * t);
  }

  function touched() {
    sinceInput = 0;
    focusing = false;
  }

  /**
   * Glide to look at a ground point from a set distance and pitch (the journal's Show me).
   * @param {number} x @param {number} z world meters @param {number} distance meters @param {number} pitchDeg
   * @param {number} [y] the target's height (m); left out, it follows the ground
   */
  function focus(x, z, distance, pitchDeg, y) {
    goal.target[0] = x;
    goal.target[2] = z;
    targetY = y ?? null;
    clampTarget();
    goal.distance = clamp(distance, minSoft(), softMaxDistance());
    goal.pitch = clamp(pitchDeg * DEG, r.pitchSoftDeg[0] * DEG, r.pitchSoftDeg[1] * DEG);
    focusing = true;
  }

  /** Orbit by a pointer delta in CSS pixels. @param {number} dx @param {number} dy */
  function orbit(dx, dy) {
    goal.yaw -= dx * r.orbitDegPerPx * DEG;
    goal.pitch = clamp(goal.pitch + dy * r.orbitDegPerPx * DEG, r.pitchHardDeg[0] * DEG, r.pitchHardDeg[1] * DEG);
    touched();
  }

  /** Twist the yaw by an angle in radians. @param {number} angle */
  function twist(angle) {
    goal.yaw += angle;
    touched();
  }

  /** Slide the target across the ground by a pointer delta in CSS pixels. @param {number} dx @param {number} dy */
  function pan(dx, dy) {
    const metersPerPx = (2 * goal.distance * Math.tan(fovY / 2)) / viewH * r.panScale;
    const sy = Math.sin(goal.yaw);
    const cy = Math.cos(goal.yaw);
    // Camera right is (cos yaw, 0, -sin yaw); forward along the ground is (-sin yaw, 0, -cos yaw).
    goal.target[0] += (-dx * cy - dy * sy) * metersPerPx;
    goal.target[2] += (dx * sy - dy * cy) * metersPerPx;
    targetY = null;
    clampTarget();
    touched();
  }

  /**
   * Zoom by a distance factor (< 1 moves closer), toward the ground point under (x, y) in CSS pixels.
   * @param {number} factor @param {number} [x] @param {number} [y]
   */
  function zoom(factor, x, y) {
    const old = goal.distance;
    const next = clamp(old * factor, minHard(), hardMaxDistance());
    if (x !== undefined && y !== undefined) {
      const hit = groundHit(x, y);
      if (hit) {
        const k = (1 - next / old) * r.zoomToCursor;
        goal.target[0] += (hit[0] - goal.target[0]) * k;
        goal.target[2] += (hit[2] - goal.target[2]) * k;
        clampTarget();
      }
    }
    goal.distance = next;
    touched();
  }

  function clampTarget() {
    const max = worldRadius + r.targetMargin;
    const d = Math.hypot(goal.target[0], goal.target[2]);
    if (d > max) {
      goal.target[0] *= max / d;
      goal.target[2] *= max / d;
    }
  }

  /** Ray from the current camera through a CSS pixel, hit with the plane y = target height. */
  function groundHit(/** @type {number} */ x, /** @type {number} */ y) {
    const ndcX = (x / viewW) * 2 - 1;
    const ndcY = 1 - (y / viewH) * 2;
    const p = vec3.transformMat4([ndcX, ndcY, 0.5], invViewProj);
    const dir = vec3.normalize(vec3.subtract(p, eye));
    const planeY = cur.target[1];
    if (Math.abs(dir[1]) < 1e-4) return null;
    const t = (planeY - eye[1]) / dir[1];
    if (t <= 0) return null;
    return vec3.addScaled(eye, dir, t);
  }

  /** Advance damping and rebuild matrices. @param {number} dt real seconds */
  function update(dt) {
    sinceInput += dt;
    const returning = sinceInput > r.softReturnDelay;
    if (returning) {
      goal.pitch = clamp(goal.pitch, r.pitchSoftDeg[0] * DEG, r.pitchSoftDeg[1] * DEG);
      goal.distance = clamp(goal.distance, minSoft(), softMaxDistance());
    }
    const halfLife = returning ? r.halfLifeGlide : r.halfLifeDirect;
    let k = 1 - 2 ** (-dt / halfLife);
    let kd = 1 - 2 ** (-dt / r.halfLifeDirect);
    if (focusing) {
      // A slow, even glide for Show me; it ends on arrival.
      k = kd = 1 - 2 ** (-dt / (r.halfLifeFocus ?? 0.5));
      const far = Math.hypot(goal.target[0] - cur.target[0], goal.target[2] - cur.target[2]) + Math.abs(goal.distance - cur.distance);
      if (far < 0.02) focusing = false;
    }
    cur.yaw += (goal.yaw - cur.yaw) * kd;
    cur.pitch += (goal.pitch - cur.pitch) * k;
    cur.distance += (goal.distance - cur.distance) * k;
    // Close-ups aim at the ground itself (or the height a focus asked for); otherwise the target
    // sits half way down, as it always has.
    if (close) goal.target[1] = targetY ?? Math.max(groundProbe(goal.target[0], goal.target[2]), 0);
    vec3.lerp(cur.target, goal.target, kd, cur.target);

    const ground = groundProbe(cur.target[0], cur.target[2]);
    // Zoomed in (recipe `close`), the view eases from aiming half way down the slope to aiming at
    // the ground itself, and the eye may come down near it.
    const near = nearness(cur.distance);
    if (!close) cur.target[1] = ground * 0.5 + (Math.max(ground, 0) - ground * 0.5) * near;
    const eyeMin = close?.minEyeHeight ?? r.minEyeHeight + ((r.close?.minEyeHeight ?? r.minEyeHeight) - r.minEyeHeight) * near;

    let pitch = cur.pitch;
    for (let i = 0; i < 2; i++) {
      placeEye(pitch);
      const floor = Math.max(groundProbe(eye[0], eye[2]), 0) + eyeMin;
      if (eye[1] >= floor) break;
      pitch = Math.asin(clamp((floor - cur.target[1]) / cur.distance, -1, 1));
      cur.pitch = Math.max(cur.pitch, pitch);
      goal.pitch = Math.max(goal.pitch, pitch);
    }

    mat4.lookAt(eye, cur.target, [0, 1, 0], view);
    mat4.perspectiveReverseZ(fovY, viewW / viewH, r.near, Infinity, proj);
    mat4.multiply(proj, view, viewProj);
    mat4.inverse(viewProj, invViewProj);
  }

  /** @param {number} pitch */
  function placeEye(pitch) {
    const cp = Math.cos(pitch);
    eye[0] = cur.target[0] + cur.distance * cp * Math.sin(cur.yaw);
    eye[1] = cur.target[1] + cur.distance * Math.sin(pitch);
    eye[2] = cur.target[2] + cur.distance * cp * Math.cos(cur.yaw);
  }

  /**
   * World ray from the eye through a CSS pixel (for picking and brushes).
   * @param {number} x @param {number} y
   * @returns {{ o: Float32Array, d: Float32Array }}
   */
  function ray(x, y) {
    const ndcX = (x / viewW) * 2 - 1;
    const ndcY = 1 - (y / viewH) * 2;
    const p = vec3.transformMat4([ndcX, ndcY, 0.5], invViewProj);
    return { o: vec3.copy(eye), d: vec3.normalize(vec3.subtract(p, eye)) };
  }

  return {
    orbit, pan, zoom, twist, update, ray, focus,
    /** @param {number} w CSS px @param {number} h CSS px */
    setViewport(w, h) {
      viewW = Math.max(1, w);
      viewH = Math.max(1, h);
      if (!fitted && w > 1 && h > 1) {
        // The start distance frames the island in landscape; widen it in portrait so the island still fits.
        fitted = true;
        const k = Math.tan(fovY / 2) / tanNarrow();
        goal.distance *= k;
        cur.distance *= k;
      }
    },
    /** @param {(x: number, z: number) => number} fn */
    setGroundProbe(fn) { groundProbe = fn; },
    /**
     * Allow close-ups (the frog size preview), or null for the recipe's limits.
     * @param {{ minDistance: number, minEyeHeight: number } | null} limits
     */
    setClose(limits) { close = limits; },
    /** @param {number} radius */
    setWorldRadius(radius) { worldRadius = radius; },
    get eye() { return eye; },
    get view() { return view; },
    get proj() { return proj; },
    get viewProj() { return viewProj; },
    get invViewProj() { return invViewProj; },
    get near() { return r.near; },
    /** Current distance from the eye to the orbit target, meters. */
    get distance() { return cur.distance; },
    /** The point the camera orbits around (world meters, on the ground). */
    get target() { return cur.target; },
  };
}

/** @typedef {ReturnType<typeof createOrbitCamera>} OrbitCamera */
