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
 * @property {number} halfLifeDirect
 * @property {number} halfLifeGlide
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

  function touched() {
    sinceInput = 0;
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
    clampTarget();
    touched();
  }

  /**
   * Zoom by a distance factor (< 1 moves closer), toward the ground point under (x, y) in CSS pixels.
   * @param {number} factor @param {number} [x] @param {number} [y]
   */
  function zoom(factor, x, y) {
    const old = goal.distance;
    const next = clamp(old * factor, r.distanceHard[0], hardMaxDistance());
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
      goal.distance = clamp(goal.distance, r.distanceSoft[0], softMaxDistance());
    }
    const halfLife = returning ? r.halfLifeGlide : r.halfLifeDirect;
    const k = 1 - 2 ** (-dt / halfLife);
    const kd = 1 - 2 ** (-dt / r.halfLifeDirect);
    cur.yaw += (goal.yaw - cur.yaw) * kd;
    cur.pitch += (goal.pitch - cur.pitch) * k;
    cur.distance += (goal.distance - cur.distance) * k;
    vec3.lerp(cur.target, goal.target, kd, cur.target);

    const ground = groundProbe(cur.target[0], cur.target[2]);
    cur.target[1] = ground * 0.5;

    let pitch = cur.pitch;
    for (let i = 0; i < 2; i++) {
      placeEye(pitch);
      const floor = Math.max(groundProbe(eye[0], eye[2]), 0) + r.minEyeHeight;
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
    orbit, pan, zoom, twist, update, ray,
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
  };
}

/** @typedef {ReturnType<typeof createOrbitCamera>} OrbitCamera */
