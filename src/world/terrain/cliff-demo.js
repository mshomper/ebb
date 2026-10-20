// @ts-check
// `?cliffs` (testing, unsaved; docs/08 M2): builds a small cliff scene through the real Terrace
// and Cut strokes, so the Cliff tool can be checked without drawing it by hand. Two stacked
// terraces with a spring on the upper shelf near its edge, so its water falls over both faces,
// and a carved channel. Every stroke goes on the undo stack like a drawn one.
// `?cliffs=nospring` leaves the spring out.

/**
 * @param {{ terrain: import('./index.js').Terrain, history: { push: (c: any) => void },
 *   tapSpring: (p: number[], rate: string) => void, focus: (x: number, z: number, distance: number, pitchDeg: number) => void,
 *   spring: boolean }} o
 */
export async function buildCliffDemo(o) {
  const { terrain } = o;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));
  /** @param {number} x @param {number} z */
  const ground = (x, z) => [x, terrain.sampleHeight(x, z), z];

  /**
   * One stroke along a path, a little each frame, as a drag would.
   * @param {'terrace'|'cut'} kind @param {number} radius @param {number} height @param {number[][]} path
   */
  async function stroke(kind, radius, height, path) {
    while (terrain.isBusy()) await frame();
    const brush = { kind, radius, strength: 1, height, sea: false };
    if (!terrain.beginStroke(brush, ground(path[0][0], path[0][1]))) return;
    for (let i = 1; i < path.length; i++) {
      const [x0, z0] = path[i - 1], [x1, z1] = path[i];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / radius));
      for (let k = 1; k <= n; k++) {
        terrain.strokeTo(ground(x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n));
        await frame();
      }
    }
    const cmd = await terrain.endStroke();
    if (cmd) o.history.push(cmd);
  }

  // The scene sits on the meadow north-west of the island's middle.
  await stroke('terrace', 3.5, 1.5, [[-17, -11], [-7, -11]]);
  await stroke('terrace', 2, 1.5, [[-15, -12.5], [-9, -12.5]]);
  await stroke('cut', 1.4, 1, [[5, -16], [12, -9]]);
  while (terrain.isBusy()) await frame();
  // A spring on the upper shelf, a little back from its front edge: the water runs to the edge
  // and falls over the upper face, crosses the lower shelf, and falls again.
  if (o.spring) o.tapSpring(ground(-12, -12.2), 'stream');
  o.focus(-12, -10, 22, 28);
}
