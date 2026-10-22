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
 * @property {[number, number]} [worldCenter]  the island's center (x, z), default the origin
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

  /**
   * True while gliding to a point the game asked to show (focus(): a tool's Look at; later Follow);
   * any input ends it. Presence reads it as `driven`: a move the game makes never startles a creature.
   */
  let focusing = false;
  /**
   * Close-up limits (the frog size preview, ?frogscale): a nearer zoom and a lower eye; while set,
   * the target sits on the ground (or at the height a focus asked for) instead of half way down.
   * @type {{ minDistance: number, minEyeHeight: number } | null}
   */
  let close = null;
  /** A focus's exact target height (m), kept until the next pan. @type {number | null} */
  let targetY = null;
  /**
   * The low view below (doc 23, the walker): while set, the camera follows you from behind and
   * close (`follow` each frame), with its own zoom and look limits and no panning; null above.
   * @type {{ minDistance: number, maxDistance: number, pitchMin: number, pitchMax: number, minEyeHeight: number } | null}
   */
  let ground = null;
  /** The view above you left when you went down, so Go up rises to the same height and angle. */
  let above = { distance: r.start.distance, pitch: r.start.pitchDeg * DEG };
  const minSoft = () => ground?.minDistance ?? close?.minDistance ?? r.distanceSoft[0];
  const minHard = () => ground?.minDistance ?? close?.minDistance ?? r.distanceHard[0];
  const maxSoft = () => ground?.maxDistance ?? softMaxDistance();
  const maxHard = () => ground?.maxDistance ?? hardMaxDistance();
  /** @returns {[number, number]} radians */
  const pitchSoft = () => (ground ? [ground.pitchMin, ground.pitchMax] : [r.pitchSoftDeg[0] * DEG, r.pitchSoftDeg[1] * DEG]);
  /** @returns {[number, number]} radians */
  const pitchHard = () => (ground ? [ground.pitchMin, ground.pitchMax] : [r.pitchHardDeg[0] * DEG, r.pitchHardDeg[1] * DEG]);

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
    goal.distance = clamp(distance, minSoft(), maxSoft());
    goal.pitch = clamp(pitchDeg * DEG, ...pitchSoft());
    focusing = true;
  }

  /** Orbit by a pointer delta in CSS pixels. @param {number} dx @param {number} dy */
  function orbit(dx, dy) {
    goal.yaw -= dx * r.orbitDegPerPx * DEG;
    goal.pitch = clamp(goal.pitch + dy * r.orbitDegPerPx * DEG, ...pitchHard());
    touched();
  }

  /** Twist the yaw by an angle in radians. @param {number} angle */
  function twist(angle) {
    goal.yaw += angle;
    touched();
  }

  /** Slide the target across the ground by a pointer delta in CSS pixels. @param {number} dx @param {number} dy */
  function pan(dx, dy) {
    if (ground) return;   // below, you move by walking
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
    const next = clamp(old * factor, minHard(), maxHard());
    if (x !== undefined && y !== undefined && !ground) {
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
    // Around the island's center (the larger island's is not the world origin).
    const max = worldRadius + r.targetMargin;
    const [ox, oz] = r.worldCenter ?? [0, 0];
    const d = Math.hypot(goal.target[0] - ox, goal.target[2] - oz);
    if (d > max) {
      goal.target[0] = ox + (goal.target[0] - ox) * max / d;
      goal.target[2] = oz + (goal.target[2] - oz) * max / d;
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
      goal.pitch = clamp(goal.pitch, ...pitchSoft());
      goal.distance = clamp(goal.distance, minSoft(), maxSoft());
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
    if (close && !ground) goal.target[1] = targetY ?? Math.max(groundProbe(goal.target[0], goal.target[2]), 0);
    vec3.lerp(cur.target, goal.target, kd, cur.target);

    const h = groundProbe(cur.target[0], cur.target[2]);
    // Zoomed in (recipe `close`), the view eases from aiming half way down the slope to aiming at
    // the ground itself, and the eye may come down near it. Below, it aims at you.
    const near = nearness(cur.distance);
    if (!close && !ground) cur.target[1] = h * 0.5 + (Math.max(h, 0) - h * 0.5) * near;
    const eyeMin = ground?.minEyeHeight ?? close?.minEyeHeight ?? r.minEyeHeight + ((r.close?.minEyeHeight ?? r.minEyeHeight) - r.minEyeHeight) * near;

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
    /** Is the game gliding the camera (not the player moving it)? */
    driven: () => focusing,
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
    /**
     * Where the camera is headed, for saving the view (doc 18). Below, the view above where you
     * stand: a save always opens above.
     */
    pose: () => ({ target: [goal.target[0], goal.target[1], goal.target[2]], yaw: goal.yaw,
      pitch: ground ? above.pitch : goal.pitch, distance: ground ? above.distance : goal.distance }),
    /**
     * Go down to the low view behind you, or (null) back up above where you stand. Both are glides
     * the game makes (`driven`), so they never startle anything; any input ends the glide.
     * @param {{ distanceM: number[], startM: number, pitchDeg: number[], startPitchDeg: number, minEyeHeightM: number } | null} g
     *   recipes/world/walker.json camera
     * @param {ArrayLike<number>} at where you are (the point the view aims at), world meters
     */
    setGround(g, at) {
      if (g) {
        if (!ground) above = { distance: goal.distance, pitch: goal.pitch };
        ground = { minDistance: g.distanceM[0], maxDistance: g.distanceM[1], pitchMin: g.pitchDeg[0] * DEG, pitchMax: g.pitchDeg[1] * DEG, minEyeHeight: g.minEyeHeightM };
        goal.distance = g.startM;
        goal.pitch = g.startPitchDeg * DEG;
      } else {
        ground = null;
        // At least a little way up, even if you went down from a close-up.
        goal.distance = Math.max(above.distance, 12);
        goal.pitch = above.pitch;
      }
      vec3.set(at[0], at[1], at[2], goal.target);
      targetY = g ? at[1] : null;
      clampTarget();
      focusing = true;
    },
    /** Below: keep aiming at you as you walk (each frame). @param {ArrayLike<number>} at world meters */
    follow(at) {
      if (!ground) return;
      vec3.set(at[0], at[1], at[2], goal.target);
      targetY = at[1];
    },
    /** Is the camera down with you? */
    get below() { return !!ground; },
    /**
     * Come back to a saved view at once (no glide, and no portrait widening on top of it).
     * @param {{ target: number[], yaw: number, pitch: number, distance: number }} p
     */
    setPose(p) {
      if (!p || !Array.isArray(p.target) || ![p.yaw, p.pitch, p.distance, ...p.target].every(Number.isFinite)) return;
      vec3.set(p.target[0], p.target[1], p.target[2], goal.target);
      vec3.copy(goal.target, cur.target);
      cur.yaw = goal.yaw = p.yaw;
      cur.pitch = goal.pitch = clamp(p.pitch, r.pitchHardDeg[0] * DEG, r.pitchHardDeg[1] * DEG);
      cur.distance = goal.distance = Math.max(p.distance, 0.05);
      fitted = true;
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
