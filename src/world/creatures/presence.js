// @ts-check
// Presence (S6b-4, doc 23): how the player is on the island, as a list of sources that creatures
// react to. In the slice the one source is the camera: its eye, how fast the eye moves, the edits
// made beside a point this frame (a sculpt, pour or plant stroke) and how long the eye has been
// still. Moves the game makes never count: while the camera glides somewhere on its own (a tool's
// Look at; later Follow), its speed reads zero, and any input ends the glide. Creatures
// only ever ask "what sources are there", never "where is the camera". Rebuilt each frame; never saved.

/**
 * @typedef {Object} PresenceSource
 * @property {string} id
 * @property {'camera'|'seat'|'walker'|'camp'} kind   only 'camera' in the slice
 * @property {[number, number, number]} pos           world meters
 * @property {number} speed                           m/s, smoothed; zero during a game glide
 * @property {boolean} editing                        an edit was made this frame
 * @property {{ x: number, z: number }[]} edits       where (ground points)
 * @property {number} stillS                          seconds since it last moved
 */

/**
 * @param {{ camera: { eye: ArrayLike<number>, driven: () => boolean }, smoothS?: number, stillMps?: number }} opts
 *   smoothS: how quickly the speed follows the eye (s); stillMps: slower than this counts as still
 */
export function createPresence(opts) {
  const { camera } = opts;
  const smoothS = opts.smoothS ?? 0.12, stillMps = opts.stillMps ?? 0.02;
  /** @type {PresenceSource} */
  const cam = { id: 'camera', kind: 'camera', pos: [0, 0, 0], speed: 0, editing: false, edits: [], stillS: 0 };
  /** Edits made since the last frame. @type {{ x: number, z: number }[]} */
  let pending = [];
  let started = false;

  return {
    /** Each frame, after the camera has moved. @param {number} realDt seconds */
    update(realDt) {
      const e = camera.eye;
      if (!started) {
        cam.pos = [e[0], e[1], e[2]];
        started = true;
      }
      const moved = Math.hypot(e[0] - cam.pos[0], e[1] - cam.pos[1], e[2] - cam.pos[2]);
      const raw = realDt > 0 ? moved / realDt : 0;
      if (camera.driven()) cam.speed = 0;
      else cam.speed += (raw - cam.speed) * (1 - Math.exp(-realDt / smoothS));
      cam.stillS = raw < stillMps ? cam.stillS + realDt : 0;
      cam.pos = [e[0], e[1], e[2]];
      cam.edits = pending;
      cam.editing = pending.length > 0;
      pending = [];
    },

    /** An edit right here this frame (a sculpt, pour or plant stroke). @param {number} x @param {number} z */
    edit(x, z) {
      if (pending.length < 8) pending.push({ x, z });
    },

    /** The sources now. @returns {PresenceSource[]} */
    sources: () => [cam],
  };
}

/** @typedef {ReturnType<typeof createPresence>} Presence */
