// @ts-check
// Placed pieces keep off the camp ground (docs/future/13 section 3.1; src/world/pieces/camp-clear.js)
// for tools/unit-tests.html: pond stones (a tap, and a drawn line that skips the strides on the pad),
// a flight of Steps (no end on it, no run across it), a reed raft, a carried stone or log set down,
// and the handful of loose stones that come by themselves. With no pad, nothing is refused.

import { onCampGround, crossesCampGround, offCampGround } from '../src/world/pieces/camp-clear.js';

const G = 'camp ground: pieces';
const PAD = { x: 0.6, z: -33.3, r: 4 };

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addCampPieceTests(test, assert, eq) {
  const recipe = () => fetch('../recipes/world/pieces.json').then((r) => r.json());

  test(G, 'pond stones: a tap on the pad is refused; a line across it lays stones only off it', async () => {
    const R = await recipe();
    const reach = R.stepping.apartM / 2;
    assert(onCampGround(PAD, PAD.x, PAD.z, reach), 'a tap at the middle');
    assert(onCampGround(PAD, PAD.x + 3.9, PAD.z, reach), 'a tap just inside the edge');
    assert(!onCampGround(PAD, PAD.x + 5, PAD.z, reach), 'a tap a meter outside is fine');
    eq(R.words.camp, 'The camp ground stays clear.', 'the line the card says');
    // A line of strides from 10 m west to 10 m east of the pad, through its middle.
    const stride = (R.stepping.spacingM[0] + R.stepping.spacingM[1]) / 2;
    const laid = [];
    for (let x = PAD.x - 10; x <= PAD.x + 10; x += stride) if (!onCampGround(PAD, x, PAD.z, reach)) laid.push(x);
    assert(laid.length > 12, `stones on both sides (${laid.length})`);
    assert(laid.every((x) => Math.abs(x - PAD.x) >= PAD.r + reach), 'none on the pad or overhanging it');
    assert(laid.some((x) => x < PAD.x) && laid.some((x) => x > PAD.x), 'the line goes on past the pad');
  });

  test(G, 'Steps: a flight may not start, end or pass over the pad; beside it is fine', async () => {
    const R = await recipe();
    const half = R.steps.widthM / 2;
    const a = (/** @type {number} */ dx, /** @type {number} */ dz) => [PAD.x + dx, PAD.z + dz];
    assert(crossesCampGround(PAD, a(0, 0), a(6, 0), half), 'starting on the pad');
    assert(crossesCampGround(PAD, a(8, 0), a(2, 0), half), 'ending on the pad');
    assert(crossesCampGround(PAD, a(-7, 0.5), a(7, 0.5), half), 'passing over it');
    assert(crossesCampGround(PAD, a(-6, 4.2), a(6, 4.2), half), 'grazing its edge with its width');
    assert(!crossesCampGround(PAD, a(-6, 6), a(6, 6), half), 'two meters beside it');
    assert(!crossesCampGround(PAD, a(6, -3), a(9, 3), half), 'well off to one side');
  });

  test(G, 'a reed raft and a carried stone or log keep off the pad; the arriving stones too', async () => {
    const R = await recipe();
    const raft = R.raft.sizeM[1] / 2;
    assert(onCampGround(PAD, PAD.x + 4.2, PAD.z, raft), 'a raft overhanging the edge');
    assert(!onCampGround(PAD, PAD.x + 6, PAD.z, raft), 'a raft on a pond beside it');
    // A carried log's ring is half its length; set down at 4.6 m it would still reach onto the pad.
    assert(onCampGround(PAD, PAD.x, PAD.z + 4.6, 0.9), 'a 1.8 m log set down with its end on the pad');
    assert(!onCampGround(PAD, PAD.x, PAD.z + 6, 0.9), 'the same log a little further off');
    const came = [{ x: PAD.x + 1, z: PAD.z, size: 0.4 }, { x: PAD.x + 4.1, z: PAD.z, size: 0.4 }, { x: PAD.x + 7, z: PAD.z, size: 0.4 }];
    eq(offCampGround(PAD, came).map((p) => p.x - PAD.x).join(), '7', 'only the stone off the pad stays');
  });

  test(G, 'with no pad yet (an older island before its stamp), nothing is refused', () => {
    assert(!onCampGround(null, 0, 0, 10), 'a tap');
    assert(!crossesCampGround(null, [0, 0], [5, 5], 1), 'a flight');
    eq(offCampGround(null, [{ x: 0, z: 0, size: 1 }]).length, 1, 'the arriving stones');
  });
}
