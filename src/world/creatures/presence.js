// @ts-check
// Presence (S6b-4, doc 23): how the player is on the island, as a list of sources that creatures
// react to. The camera's eye is one: how fast it moves, the edits made beside a point this frame
// (a sculpt, pour or plant stroke) and how long it has been still. Moves the game makes never
// count: while the camera glides somewhere on its own (a tool's Look at, Go down), its speed reads
// zero, and any input ends the glide. Creatures only ever ask "what sources are there", never
// "where is the camera". Rebuilt each frame; never saved.
//
// Two views (W3, approved October 21, 2026): in the game the camera above counts only for its
// edits, never with its body (`cameraBody: false`), and you on foot are the source that counts,
// with your posture (stand, kneel, sit) and your gaze (where the camera looks). Tool pages leave
// the camera's body on, so the frog lab's swoops still startle.

/**
 * @typedef {Object} PresenceSource
 * @property {string} id
 * @property {'camera'|'walker'|'camp'} kind
 * @property {[number, number, number]} pos           world meters
 * @property {number} speed                           m/s, smoothed; zero during a game glide
 * @property {boolean} editing                        an edit was made this frame
 * @property {{ x: number, z: number }[]} edits       where (ground points)
 * @property {number} stillS                          seconds since it last moved
 * @property {boolean} body                           whether creatures feel it (its ring, its pace, quiet watching)
 * @property {'stand'|'kneel'|'sit'} [posture]        the walker
 * @property {[number, number] | null} [gaze]        the walker: unit direction it looks along the ground
 * @property {number} [ringK]                        the walker: a tea's lift on every comfort ring (P2e; 1 without one)
 * @property {{ x: number, z: number, r: number, k: number } | null} [known]  the walker: the camp as a known place (B1 C1,
 *   docs/future/13 C-36): a creature within r of (x, z) has its comfort ring multiplied by k (ringScale)
 */

/**
 * The walker as presence needs it: where you stand, how fast, your posture and where you look.
 * @typedef {{ x: number, y: number, z: number, speed: number, posture: 'stand'|'kneel'|'sit', gaze: [number, number] | null }} WalkerNow
 */

/**
 * @param {{ camera: { eye: ArrayLike<number>, driven: () => boolean }, smoothS?: number, stillMps?: number,
 *   cameraBody?: boolean, walker?: () => WalkerNow | null, heightM?: Record<string, number>, ringK?: () => number,
 *   known?: () => { x: number, z: number, r: number, k: number } | null }} opts
 *   smoothS: how quickly the speed follows the eye (s); stillMps: slower than this counts as still;
 *   cameraBody: whether the camera's own eye is felt (tools: yes; the game: no, only its edits);
 *   walker: you on foot, or null while you are above; heightM: where your body is over your feet, by posture;
 *   ringK: a tea's boon on the comfort rings you meet (P2e: 0.9 lets you 10% closer);
 *   known: the camp's known place (store slice `campKnown`, src/world/camp/gift-stone.js), or null
 */
export function createPresence(opts) {
  const { camera } = opts;
  const smoothS = opts.smoothS ?? 0.12, stillMps = opts.stillMps ?? 0.02;
  const H = opts.heightM ?? { stand: 0.9, kneel: 0.5, sit: 0.4 };
  /** @type {PresenceSource} */
  const cam = { id: 'camera', kind: 'camera', pos: [0, 0, 0], speed: 0, editing: false, edits: [], stillS: 0, body: opts.cameraBody ?? true };
  /** @type {PresenceSource} */
  const you = { id: 'walker', kind: 'walker', pos: [0, 0, 0], speed: 0, editing: false, edits: [], stillS: 0, body: true, posture: 'stand', gaze: null };
  /** Edits made since the last frame. @type {{ x: number, z: number }[]} */
  let pending = [];
  let started = false;
  let walking = false;

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
      // You on foot: the figure's own pace (a walk, not a camera swoop), low when you kneel or sit.
      const w = opts.walker?.() ?? null;
      walking = !!w;
      if (w) {
        you.pos = [w.x, w.y + (H[w.posture] ?? H.stand), w.z];
        you.speed = w.speed;
        you.stillS = w.speed < stillMps ? you.stillS + realDt : 0;
        you.posture = w.posture;
        // Photo mode's free camera turns the view, not you: your gaze stays where it was.
        if (!camera.free) you.gaze = w.gaze;
        you.ringK = opts.ringK?.() ?? 1;
        you.known = opts.known?.() ?? null;
      } else you.stillS = 0;
    },

    /** An edit right here this frame (a sculpt, pour or plant stroke). @param {number} x @param {number} z */
    edit(x, z) {
      if (pending.length < 8) pending.push({ x, z });
    },

    /** The sources now. @returns {PresenceSource[]} */
    sources: () => (walking ? [cam, you] : [cam]),
  };
}

/**
 * How much a source's posture and gaze stretch or shrink a creature's comfort ring (doc 23): lower
 * is smaller, and looking straight at it is larger than looking away. A source with no posture
 * (the camera in a tool page) is 1. Near camp, once it is a known place, the ring shrinks by the
 * source's `known` share for a creature inside its reach (B1 C1).
 * @param {PresenceSource} s @param {number} x @param {number} z the creature
 * @param {{ posture: Record<string, number>, gaze: { watch: number, away: number }, gazeConeDeg: number }} M
 */
export function ringScale(s, x, z, M) {
  if (!s.posture) return 1;
  let k = M.posture[s.posture] ?? 1;
  if (s.gaze) {
    const dx = x - s.pos[0], dz = z - s.pos[2], l = Math.hypot(dx, dz) || 1;
    const cos = (dx * s.gaze[0] + dz * s.gaze[1]) / l;
    k *= cos >= Math.cos((M.gazeConeDeg * Math.PI) / 180) ? M.gaze.watch : M.gaze.away;
  }
  const n = s.known;
  if (n && (x - n.x) ** 2 + (z - n.z) ** 2 <= n.r * n.r) k *= n.k;
  return k;
}

/** @typedef {ReturnType<typeof createPresence>} Presence */
