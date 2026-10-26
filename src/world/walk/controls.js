// @ts-check
// Walking with the keys and the mouse (doc 23; WASD, October 26, 2026; Matt: the standard PC
// third-person scheme, nothing invented). On foot: W A S D and the arrows walk relative to the
// camera, Shift held runs, Space dodge-rolls, and a movement key takes over from a click walk (and the
// card it would open). The mouse turns the camera under pointer lock (src/input/mouse-look.js), and a
// left click uses what the dot in the middle rests on, exactly as a click there does; whatever it rests
// on gets the hover outline and name tag. From above, W A S D pan the diorama. Q and E stay unbound.
// Numbers: recipes/world/walker.json steer.

import { attachMoveKeys, worldWay } from '../../input/move-keys.js';
import { attachMouseLook } from '../../input/mouse-look.js';

/**
 * @param {{
 *   canvas: HTMLCanvasElement,
 *   walk: import('./index.js').Walk,
 *   camera: import('../../render/camera.js').OrbitCamera,
 *   recipe: any,
 *   open: () => boolean,
 *   use: (x: number, y: number) => void,
 *   hover: (x: number, y: number) => void,
 *   pan: (dx: number, dy: number) => void,
 * }} o
 *   recipe: recipes/world/walker.json; open: is a card or panel open over the view (keys and mouse
 *   look wait); use: a click at a canvas point (look.tap); hover: the point the dot rests on, a few
 *   times a second; pan: pan the view from above by a drag delta in pixels
 */
export function createWalkControls(o) {
  const { walk, camera } = o, ST = o.recipe.steer;
  /** The camera's way along the ground, turned into the world. @param {number} f @param {number} r */
  const way = (f, r) => worldWay(f, r, camera.yaw);
  const keys = attachMoveKeys(window, {
    active: () => !o.open(),
    onPress(name) {
      if (!walk.below) return false;
      if (name === 'move') { walk.keyTakeover(); return true; }
      const a = keys.axes();
      walk.roll(...way(a.forward, a.right));
      // Space is the roll on foot, always (never a page scroll or a button press).
      return true;
    },
  });
  const look = attachMouseLook(o.canvas, {
    wanted: () => walk.below && !o.open(),
    look: (dx, dy) => camera.look(dx, dy, ST.look.degPerPx, ST.look.halfLifeS),
    use: (x, y) => o.use(x, y),
  });
  let hoverAcc = 0;

  return {
    /** Each frame, before the walk updates. @param {number} dt real seconds */
    update(dt) {
      look.update();
      const a = o.open() ? { forward: 0, right: 0 } : keys.axes();
      if (walk.below) {
        const [x, z] = way(a.forward, a.right);
        walk.steer(x, z, keys.run);
        // The dot names what it rests on, as the pointer's rest does.
        hoverAcc += dt;
        if (look.locked && hoverAcc >= 1 / o.recipe.click.hoverHz) {
          hoverAcc = 0;
          const m = look.middle();
          o.hover(m.x, m.y);
        }
      } else if (a.forward || a.right) {
        // From above: pan as a drag would (a drag down moves the view forward).
        const px = ST.panPxPerS * dt;
        o.pan(-a.right * px, a.forward * px);
      }
    },
    /** Is the pointer captured for mouse look? */
    get looking() { return look.locked; },
    dispose() { keys.dispose(); look.dispose(); },
  };
}

/** @typedef {ReturnType<typeof createWalkControls>} WalkControls */
