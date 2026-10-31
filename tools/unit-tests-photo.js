// @ts-check
// Photo mode tests (B2 P1): the free camera's room (8 m round the walker below, the island above, never
// under the ground or the water), the way it looks, the thin lens (focal length from the field of view,
// a blur circle that grows away from focus and with a wider aperture, none at the focus), the shot's
// size (twice the window, held under the cap and the device's texture limit), the frame shape and its
// paper margin, the slice photo mode starts with, and the recipe's choices with a drawn icon each.

import { keepInRoom, lookDir, createFreeCamera } from '../src/render/free-camera.js';
import { lensOf, cocRadiusPx } from '../src/render/passes/post/dof.js';
import { photoSize, cropRect, marginPx } from '../src/render/passes/post/photo.js';
import { photoDefaults } from '../src/render/photo-mode.js';
import { ICON_NAMES } from '../src/ui/icons/icons.js';

const G = 'photo';
const near = (/** @type {number} */ a, /** @type {number} */ b, e = 1e-6) => Math.abs(a - b) <= e;

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addPhotoTests(test, assert, eq) {
  test(G, 'the free camera stays within 8 m of the walker below, over the island above, and never under the ground or the water', async () => {
    const R = await (await fetch('../recipes/world/photo.json')).json();
    eq(R.camera.belowRadiusM, 8, 'below: 8 m (call 3, October 30, 2026)');
    eq(R.camera.minHeightM, 0.15, 'down to 15 cm off the ground');
    const e = keepInRoom([20, 1, 0], { center: [0, 0], radius: 8, floor: 0.15, ceiling: 70 });
    assert(near(Math.hypot(e[0], e[2]), 8), 'pulled back to 8 m');
    eq(keepInRoom([1, -3, 1], { center: [0, 0], radius: 8, floor: 0.4, ceiling: 70 })[1], 0.4, 'lifted to the floor');
    eq(keepInRoom([1, 99, 1], { center: [0, 0], radius: 8, floor: 0.4, ceiling: 70 })[1], 70, 'held under the ceiling');
    // A camera flown far from the walker, and from above, through the module itself.
    const ground = () => 0.5;
    const below = createFreeCamera(R.camera, { ground, island: { center: [0, 0], radius: 40 } });
    below.start([3, 2, 3], [3, 1.5, 0], [3, 3]);
    for (let i = 0; i < 100; i++) below.move(1, 0, -1);
    for (let i = 0; i < 200; i++) below.update(1 / 60);
    const p = below.pose().eye;
    assert(Math.hypot(p[0] - 3, p[2] - 3) <= 8 + 1e-6, `below: ${Math.hypot(p[0] - 3, p[2] - 3).toFixed(2)} m from the walker`);
    assert(near(p[1], 0.5 + R.camera.minHeightM, 1e-6), 'below: 15 cm over the ground');
    const above = createFreeCamera(R.camera, { ground, island: { center: [0, 0], radius: 40 } });
    above.start([0, 30, 30], [0, 0, 0], null);
    assert(above.above, 'above with no walker');
    for (let i = 0; i < 100; i++) above.move(2, 0, 0);
    for (let i = 0; i < 200; i++) above.update(1 / 60);
    const q = above.pose().eye;
    assert(Math.hypot(q[0], q[2]) > 8 && Math.hypot(q[0], q[2]) <= 40 + 1e-6, 'above: far from any walker, inside the island');
    return `below ${Math.hypot(p[0] - 3, p[2] - 3).toFixed(2)} m, above ${Math.hypot(q[0], q[2]).toFixed(1)} m`;
  });

  test(G, 'the free camera starts looking where the view looked, and its yaw is the orbit camera\'s', () => {
    const d = lookDir(0, 0);
    assert(near(d[0], 0) && near(d[1], 0) && near(d[2], -1), 'yaw 0 looks along -z, as the orbit camera');
    const up = lookDir(0.7, 0.4);
    assert(near(Math.hypot(...up), 1), 'a unit way');
    assert(up[1] > 0, 'positive pitch looks up');
    const cam = createFreeCamera({ belowRadiusM: 8, minHeightM: 0.15, maxHeightM: 70, moveMps: 2, aboveMoveK: 6, lookDegPerPx: 0.2, halfLifeS: 0.1, pitchDeg: [-85, 85] },
      { ground: () => 0, island: { center: [0, 0], radius: 40 } });
    cam.start([0, 2, 5], [0, 1, 0], null);
    const at = lookDir(cam.pose().yaw, cam.pose().pitch), want = [0, -1, -5].map((v) => v / Math.hypot(1, 5));
    assert(at.every((v, i) => near(v, want[i], 1e-6)), 'looks at the old target');
  });

  test(G, 'the thin lens: the focal length from the field of view, no blur at the focus, more away from it and with a wider aperture', async () => {
    const R = await (await fetch('../recipes/world/photo.json')).json();
    const C = await (await fetch('../recipes/world/camera.json')).json();
    const wide = lensOf(C.fovYDeg, 1.4, R.dof.sensorHeightMm, 1440), narrow = lensOf(C.fovYDeg, 16, R.dof.sensorHeightMm, 1440);
    assert(wide.focalM > 0.03 && wide.focalM < 0.036, `40 degrees on full frame is about 33 mm (${(wide.focalM * 1000).toFixed(1)} mm)`);
    assert(near(cocRadiusPx(wide, 2, 2), 0), 'sharp at the focus');
    assert(cocRadiusPx(wide, 20, 2) > cocRadiusPx(wide, 4, 2), 'farther behind is softer');
    assert(cocRadiusPx(wide, 0.5, 2) > cocRadiusPx(wide, 1.5, 2), 'nearer in front is softer');
    assert(cocRadiusPx(wide, 20, 2) > 5 * cocRadiusPx(narrow, 20, 2), 'f/1.4 blurs far more than f/16');
    const stops = R.dof.fStops;
    assert(stops.every((/** @type {number} */ s, /** @type {number} */ i) => i === 0 || s > stops[i - 1]), 'stops widen to narrow in order');
    assert(R.dof.startStop >= 0 && R.dof.startStop < stops.length, 'the first stop is one of them');
    return `f/1.4 at 2 m: ${cocRadiusPx(wide, 20, 2).toFixed(1)} px at 20 m`;
  });

  test(G, 'the shot: twice the window, under the cap and the device limit; the frame shape centred; the paper margin inside it', async () => {
    const R = await (await fetch('../recipes/world/photo.json')).json();
    eq(photoSize(1600, 900, 2, 5120, 8192).join('x'), '3200x1800', 'twice the window');
    eq(photoSize(3840, 2160, 2, 5120, 8192).join('x'), '5120x2880', 'held under the cap');
    eq(photoSize(3000, 2000, 2, 9999, 4096).join('x'), '4096x2731', 'held under the device');
    const all = cropRect(1600, 900, null);
    eq(`${all.x},${all.y},${all.w},${all.h}`, '0,0,1600,900', 'the window shape is the whole image');
    const sq = cropRect(1600, 900, { w: 1, h: 1 });
    eq(`${sq.x},${sq.y},${sq.w},${sq.h}`, '350,0,900,900', 'a square in the middle');
    const tall = cropRect(1600, 900, { w: 4, h: 5 });
    assert(near(tall.w / tall.h, 0.8, 0.01) && tall.h === 900, '4 by 5 as tall as the window');
    eq(marginPx(sq, R.frame.marginK), Math.round(900 * R.frame.marginK), 'the margin a share of the shorter side');
    eq(marginPx(sq, 0), 0, 'none when off');
    for (const a of R.frame.aspects) assert(a.id === 'screen' || (a.w > 0 && a.h > 0), `${a.id} has a shape`);
  });

  test(G, 'photo mode starts closed, at the first stop, with no filter, and its bar draws only drawn icons', async () => {
    const R = await (await fetch('../recipes/world/photo.json')).json();
    const s = photoDefaults(R);
    eq(s.open, false, 'closed');
    eq(s.stop, R.dof.startStop, 'the first stop');
    eq(s.filter, 'none', 'no filter');
    eq(s.hour, null, 'the paused world\'s own hour');
    eq(R.filters.list.join(), 'none,soft,pencil', 'Soft and Pencil first (call 6)');
    for (const f of R.filters.list) assert(typeof R.words.filter[f] === 'string', `${f} has a word`);
    const icons = ['photo', 'shot', 'aperture', 'thirds', 'aspect', 'margin', 'exposure', 'filter-soft', 'filter-pencil', 'picture', 'time', 'close'];
    for (const i of icons) assert(ICON_NAMES.includes(i), `drawn icon ${i}`);
    eq(R.key, 'KeyP', 'P opens it');
  });
}
