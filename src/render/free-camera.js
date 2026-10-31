// @ts-check
// Photo mode's free camera (B2 P1): an eye you fly with W A S D, Q and E, and turn with a drag.
// Below (on foot) it stays within belowRadiusM of the walker; above it may go anywhere over the
// island, up to maxHeightM; never lower than minHeightM over the ground or the water. It only
// moves the view: the orbit camera (src/render/camera.js) takes its pose while photo mode is open
// and reports itself driven, so nothing it does startles a creature. Numbers: recipes/world/photo.json camera.
//
// Yaw is the orbit camera's (the view looks along -sin(yaw), -cos(yaw)); pitch is the look's angle
// above the horizon, in radians.

const DEG = Math.PI / 180;

/** The way the view looks for a yaw and pitch (unit vector). Pure. @param {number} yaw @param {number} pitch */
export function lookDir(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

/**
 * Keep an eye inside photo mode's room (pure, for tests): within `radius` of `center` on the ground
 * plane, no lower than the floor and no higher than the ceiling.
 * @param {number[]} eye world meters, changed in place and returned
 * @param {{ center: number[], radius: number, floor: number, ceiling: number }} room center: x, z
 */
export function keepInRoom(eye, room) {
  const dx = eye[0] - room.center[0], dz = eye[2] - room.center[1];
  const d = Math.hypot(dx, dz);
  if (d > room.radius && d > 0) {
    eye[0] = room.center[0] + (dx * room.radius) / d;
    eye[2] = room.center[1] + (dz * room.radius) / d;
  }
  eye[1] = Math.min(Math.max(eye[1], room.floor), Math.max(room.floor, room.ceiling));
  return eye;
}

/**
 * @param {any} R recipes/world/photo.json camera
 * @param {{ ground: (x: number, z: number) => number, island: { center: number[], radius: number } }} o
 *   ground: the ground or the water's surface under a point (m); island: where the view above may go
 */
export function createFreeCamera(R, o) {
  const goal = { eye: [0, 0, 0], yaw: 0, pitch: 0 };
  const cur = { eye: [0, 0, 0], yaw: 0, pitch: 0 };
  /** Below: the walker's feet (x, z), the middle of the room. @type {number[] | null} */
  let anchor = null;

  /** The room the eye may be in now. @param {number[]} e */
  const room = (e) => ({
    center: anchor ?? o.island.center,
    radius: anchor ? R.belowRadiusM : o.island.radius,
    floor: o.ground(e[0], e[2]) + R.minHeightM,
    ceiling: R.maxHeightM,
  });

  return {
    /**
     * Start where the view is now, a little back and up so the first frame matches.
     * @param {ArrayLike<number>} eye @param {ArrayLike<number>} target @param {number[] | null} walker x, z below; null above
     */
    start(eye, target, walker) {
      anchor = walker ? [walker[0], walker[1]] : null;
      const dx = target[0] - eye[0], dy = target[1] - eye[1], dz = target[2] - eye[2];
      goal.yaw = Math.atan2(-dx, -dz);
      goal.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      goal.eye = keepInRoom([eye[0], eye[1], eye[2]], room(eye));
      cur.eye = [...goal.eye]; cur.yaw = goal.yaw; cur.pitch = goal.pitch;
    },
    /** Turn by a drag in pixels (a drag down looks down, as mouse look on foot). @param {number} dx @param {number} dy */
    look(dx, dy) {
      goal.yaw -= dx * R.lookDegPerPx * DEG;
      goal.pitch = Math.min(R.pitchDeg[1] * DEG, Math.max(R.pitchDeg[0] * DEG, goal.pitch - dy * R.lookDegPerPx * DEG));
    },
    /**
     * Fly: forward and right along the ground, up, in meters this frame; `step` meters along the look
     * (the wheel).
     * @param {number} forward @param {number} right @param {number} up @param {number} [step]
     */
    move(forward, right, up, step = 0) {
      const s = Math.sin(goal.yaw), c = Math.cos(goal.yaw);
      const d = lookDir(goal.yaw, goal.pitch);
      goal.eye[0] += -s * forward + c * right + d[0] * step;
      goal.eye[1] += up + d[1] * step;
      goal.eye[2] += -c * forward - s * right + d[2] * step;
      keepInRoom(goal.eye, room(goal.eye));
    },
    /** Each frame: ease toward the goal. @param {number} dt real seconds */
    update(dt) {
      const k = 1 - 2 ** (-dt / Math.max(1e-3, R.halfLifeS));
      for (let i = 0; i < 3; i++) cur.eye[i] += (goal.eye[i] - cur.eye[i]) * k;
      cur.yaw += (goal.yaw - cur.yaw) * k;
      cur.pitch += (goal.pitch - cur.pitch) * k;
      // The ground may rise under a still eye (a wave, the tide): keep above it.
      keepInRoom(cur.eye, room(cur.eye));
    },
    /** Is the view from above (anywhere over the island)? */
    get above() { return !anchor; },
    /** The pose now: eye, yaw, pitch. */
    pose: () => ({ eye: [...cur.eye], yaw: cur.yaw, pitch: cur.pitch }),
    /** How fast the keys fly here (m/s): quicker above, where the island is large. */
    get pace() { return R.moveMps * (anchor ? 1 : R.aboveMoveK); },
  };
}

/** @typedef {ReturnType<typeof createFreeCamera>} FreeCamera */
