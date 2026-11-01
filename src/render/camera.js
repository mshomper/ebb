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
 * @property {number} [halfLifeGoDown]  the glide of Go down and Go up (setGround)
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
  /** Further ground the view may roam over: capsules from a to b, r wide (new land, src/world/islet; addReach). @type {{ ax: number, az: number, bx: number, bz: number, r: number }[]} */
  const reaches = [];
  /** How far back the view may sit (setRoom), and the lowest the ground can be (the sea, 0; a zone's floor below it). */
  let room = Infinity, floor0 = 0;
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
  /** The mouse look's half life while it turns the view (0: a drag's own). */
  let lookHalfLife = 0;
  /** The glide under way: Show me's, or the quicker one of Go down and Go up. */
  let focusHalfLife = r.halfLifeFocus ?? 0.5;
  /**
   * Close-up limits (the frog size preview, ?frogscale): a nearer zoom and a lower eye; while set,
   * the target sits on the ground (or at the height a focus asked for) instead of half way down.
   * @type {{ minDistance: number, minEyeHeight: number } | null}
   */
  let close = null;
  /** A focus's exact target height (m), kept until the next pan. @type {number | null} */
  let targetY = null;
  /** A focus's own target height, held above until the next input (the keepsake shelf's look), or null. @type {number | null} */
  let heldY = null;
  /**
   * The low view below (doc 23, the walker): while set, the camera follows you from behind and
   * close (`follow` each frame), with its own zoom and look limits and no panning; null above.
   * @type {{ minDistance: number, maxDistance: number, pitchMin: number, pitchMax: number, minEyeHeight: number } | null}
   */
  let ground = null;
  /**
   * Photo mode's free camera (src/render/free-camera.js): while set, the view is this eye and look
   * and the orbit's own pose waits untouched underneath, so closing photo mode returns to it.
   * @type {{ eye: number[], yaw: number, pitch: number } | null}
   */
  let free = null;
  /** The point a free view looks at, a couple of meters ahead (what follows the camera's target). */
  const freeTarget = vec3.create();
  const FREE_AHEAD_M = 2;
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
    heldY = null;
  }

  /**
   * Glide to look at a ground point from a set distance and pitch (the journal's Show me).
   * @param {number} x @param {number} z world meters @param {number} distance meters @param {number} pitchDeg
   * @param {number} [y] the target's height (m); left out, it follows the ground
   * @param {number} [yaw] the view's turn as well (radians; the keepsake shelf, seen from its front),
   *   the short way round; left out, the view keeps its turn
   * @param {boolean} [holdY] above, aim at height y itself until the next input, instead of half way
   *   down the slope (the keepsake shelf, looked at from its front)
   */
  function focus(x, z, distance, pitchDeg, y, yaw, holdY = false) {
    goal.target[0] = x;
    goal.target[2] = z;
    targetY = y ?? null;
    heldY = holdY && Number.isFinite(y) ? /** @type {number} */ (y) : null;
    if (heldY !== null) goal.target[1] = heldY;
    clampTarget();
    goal.distance = clamp(distance, minSoft(), maxSoft());
    goal.pitch = clamp(pitchDeg * DEG, ...pitchSoft());
    if (Number.isFinite(yaw)) goal.yaw = cur.yaw + Math.atan2(Math.sin(/** @type {number} */ (yaw) - cur.yaw), Math.cos(/** @type {number} */ (yaw) - cur.yaw));
    focusing = true;
    focusHalfLife = r.halfLifeFocus ?? 0.5;
  }

  /** Orbit by a pointer delta in CSS pixels. @param {number} dx @param {number} dy */
  function orbit(dx, dy) {
    // Below, the view turns at the walker's own, gentler rate (recipes/world/walker.json camera).
    const rate = (ground?.orbitDegPerPx ?? r.orbitDegPerPx) * DEG;
    goal.yaw -= dx * rate;
    goal.pitch = clamp(goal.pitch + dy * rate, ...pitchHard());
    lookHalfLife = 0;
    touched();
  }

  /**
   * Mouse look below (pointer lock, recipes/world/walker.json steer.look): turn by a mouse delta in
   * pixels at degPerPx, eased over halfLifeS, much quicker than a drag's soft turn.
   * @param {number} dx @param {number} dy @param {number} degPerPx @param {number} halfLifeS
   */
  function look(dx, dy, degPerPx, halfLifeS) {
    goal.yaw -= dx * degPerPx * DEG;
    goal.pitch = clamp(goal.pitch + dy * degPerPx * DEG, ...pitchHard());
    lookHalfLife = halfLifeS;
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
    // Around the island's center (the larger island's is not the world origin), or over new land
    // risen beside it (each reach a capsule): to the nearest of them when outside them all.
    const max = worldRadius + r.targetMargin;
    const [ox, oz] = r.worldCenter ?? [0, 0];
    const px = goal.target[0], pz = goal.target[2];
    let best = null, bestOut = Infinity;
    for (const c of [{ ax: ox, az: oz, bx: ox, bz: oz, r: max }, ...reaches]) {
      const vx = c.bx - c.ax, vz = c.bz - c.az, l2 = vx * vx + vz * vz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - c.ax) * vx + (pz - c.az) * vz) / l2)) : 0;
      const qx = c.ax + vx * t, qz = c.az + vz * t, d = Math.hypot(px - qx, pz - qz);
      if (d <= c.r) return;
      if (d - c.r < bestOut) { bestOut = d - c.r; best = { qx, qz, d, r: c.r }; }
    }
    if (!best) return;
    goal.target[0] = best.qx + (px - best.qx) * best.r / best.d;
    goal.target[2] = best.qz + (pz - best.qz) * best.r / best.d;
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
    if (free) { updateFree(free); return; }
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
      k = kd = 1 - 2 ** (-dt / focusHalfLife);
      const far = Math.hypot(goal.target[0] - cur.target[0], goal.target[2] - cur.target[2]) + Math.abs(goal.distance - cur.distance);
      if (far < 0.02) focusing = false;
    }
    // Below, a drag's turn eases in over the walker's turnHalfLifeS, so the view swings softly.
    // Mouse look eases over its own, much shorter half life.
    const turnHL = lookHalfLife || ground?.turnHalfLife;
    const ky = ground && turnHL && !focusing ? 1 - 2 ** (-dt / turnHL) : kd;
    cur.yaw += (goal.yaw - cur.yaw) * ky;
    cur.pitch += (goal.pitch - cur.pitch) * (ground && turnHL && !focusing ? ky : k);
    cur.distance += (goal.distance - cur.distance) * k;
    // A zone's walls (src/world/zones viewRoom): the view never sits further back than there is room.
    cur.distance = Math.min(cur.distance, room);
    // Close-ups aim at the ground itself (or the height a focus asked for); otherwise the target
    // sits half way down, as it always has.
    if (close && !ground) goal.target[1] = targetY ?? Math.max(groundProbe(goal.target[0], goal.target[2]), floor0);
    vec3.lerp(cur.target, goal.target, kd, cur.target);

    const h = groundProbe(cur.target[0], cur.target[2]);
    // Zoomed in (recipe `close`), the view eases from aiming half way down the slope to aiming at
    // the ground itself, and the eye may come down near it. Below, it aims at you.
    const near = nearness(cur.distance);
    if (!close && !ground) cur.target[1] = heldY !== null ? cur.target[1] + (heldY - cur.target[1]) * kd : h * 0.5 + (Math.max(h, floor0) - h * 0.5) * near;
    const eyeMin = ground?.minEyeHeight ?? close?.minEyeHeight ?? r.minEyeHeight + ((r.close?.minEyeHeight ?? r.minEyeHeight) - r.minEyeHeight) * near;

    let pitch = cur.pitch;
    for (let i = 0; i < 2; i++) {
      placeEye(pitch);
      const floor = Math.max(groundProbe(eye[0], eye[2]), floor0) + eyeMin;
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

  /** Build the matrices from photo mode's eye and look. @param {{ eye: number[], yaw: number, pitch: number }} f */
  function updateFree(f) {
    const cp = Math.cos(f.pitch);
    vec3.set(f.eye[0], f.eye[1], f.eye[2], eye);
    vec3.set(f.eye[0] - Math.sin(f.yaw) * cp * FREE_AHEAD_M, f.eye[1] + Math.sin(f.pitch) * FREE_AHEAD_M,
      f.eye[2] - Math.cos(f.yaw) * cp * FREE_AHEAD_M, freeTarget);
    mat4.lookAt(eye, freeTarget, [0, 1, 0], view);
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
    orbit, pan, zoom, twist, update, ray, focus, look,
    /** The yaw the view is turning to (radians; the eye sits at +sin, +cos from the target). */
    get yaw() { return free ? free.yaw : goal.yaw; },
    /** Is the game gliding the camera (not the player moving it)? Photo mode's free view counts: it never startles. */
    driven: () => focusing || !!free,
    /**
     * Photo mode's free view (src/render/free-camera.js), set each frame, or null to give the view
     * back to the orbit as it was.
     * @param {{ eye: number[], yaw: number, pitch: number } | null} f
     */
    setFree(f) { free = f; },
    /** Is photo mode's free view in charge? */
    get free() { return !!free; },
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
     * @param {{ distanceM: number[], startM: number, pitchDeg: number[], startPitchDeg: number, minEyeHeightM: number, orbitDegPerPx?: number, turnHalfLifeS?: number } | null} g
     *   recipes/world/walker.json camera
     * @param {ArrayLike<number>} at where you are (the point the view aims at), world meters
     */
    setGround(g, at) {
      if (g) {
        if (!ground) above = { distance: goal.distance, pitch: goal.pitch };
        ground = { minDistance: g.distanceM[0], maxDistance: g.distanceM[1], pitchMin: g.pitchDeg[0] * DEG, pitchMax: g.pitchDeg[1] * DEG, minEyeHeight: g.minEyeHeightM,
          orbitDegPerPx: g.orbitDegPerPx, turnHalfLife: g.turnHalfLifeS };
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
      heldY = null;
      clampTarget();
      focusing = true;
      focusHalfLife = r.halfLifeGoDown ?? r.halfLifeFocus ?? 0.5;
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
    /** Turn the view at once to look from this yaw (no glide): going into a zone, while the screen is dark. @param {number} yaw */
    setYaw(yaw) { cur.yaw = goal.yaw = yaw; },
    /** @param {(x: number, z: number) => number} fn */
    setGroundProbe(fn) { groundProbe = fn; },
    /** How far back the view may sit this frame (m; Infinity on the island): a zone's walls. @param {number} m */
    setRoom(m) { room = Math.max(0.3, m); },
    /** The lowest ground the view keeps above (m): the sea's level on the island, -Infinity in a zone below it. @param {number} y */
    setFloor(y) { floor0 = y; },
    /**
     * Allow close-ups (the frog size preview), or null for the recipe's limits.
     * @param {{ minDistance: number, minEyeHeight: number } | null} limits
     */
    setClose(limits) { close = limits; },
    /** @param {number} radius */
    setWorldRadius(radius) { worldRadius = radius; },
    /**
     * Let the view roam over more ground: a capsule from (ax, az) to (bx, bz), r wide (the meadow
     * islet and the water out to it, src/world/islet). @param {{ ax: number, az: number, bx: number, bz: number, r: number }} c
     */
    addReach(c) { reaches.push({ ...c }); },
    get eye() { return eye; },
    get view() { return view; },
    get proj() { return proj; },
    get viewProj() { return viewProj; },
    get invViewProj() { return invViewProj; },
    get near() { return r.near; },
    /** Current distance from the eye to the orbit target, meters. */
    get distance() { return free ? FREE_AHEAD_M : cur.distance; },
    /** The point the camera orbits around (world meters, on the ground); a free view's point ahead. */
    get target() { return free ? freeTarget : cur.target; },
  };
}

/** @typedef {ReturnType<typeof createOrbitCamera>} OrbitCamera */
