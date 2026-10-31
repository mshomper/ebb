// @ts-check
// The line's small made pieces for the props pass (docs/future/17): the withy rod, a slim tapering
// stick along +y from its butt (0) to its tip (lengthM), with a slight bow; and the float, a small
// cork bead in two halves (a pale body and a red cap), its middle at the origin. 8 floats a vertex
// (position, normal, uv), as the props pass's addMesh takes them. Pure.

/**
 * The rod. @param {number} lengthM @param {number} butt radius at the hand (m) @param {number} tip radius at the tip (m)
 * @returns {{ data: Float32Array, indices: Uint32Array }}
 */
export function rodMesh(lengthM, butt = 0.009, tip = 0.0025) {
  const along = 10, round = 6, data = [], idx = [];
  for (let i = 0; i <= along; i++) {
    const t = i / along, r = butt + (tip - butt) * t, y = t * lengthM, bow = 0.04 * lengthM * Math.sin(Math.PI * t) * t;
    for (let k = 0; k <= round; k++) {
      const a = (k / round) * Math.PI * 2, nx = Math.cos(a), nz = Math.sin(a);
      data.push(nx * r, y, nz * r + bow, nx, 0, nz, k / round, t);
    }
  }
  for (let i = 0; i < along; i++) for (let k = 0; k < round; k++) {
    const a = i * (round + 1) + k, b = a + 1, c = a + round + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  return { data: new Float32Array(data), indices: new Uint32Array(idx) };
}

/**
 * Half the float: the upper cap (top true) or the lower body, a squashed sphere of radius r.
 * @param {number} r @param {boolean} top @returns {{ data: Float32Array, indices: Uint32Array }}
 */
export function floatHalf(r, top) {
  const rows = 5, round = 10, data = [], idx = [];
  for (let j = 0; j <= rows; j++) {
    const ph = (top ? 0 : Math.PI / 2) + (j / rows) * (Math.PI / 2);
    for (let k = 0; k <= round; k++) {
      const a = (k / round) * Math.PI * 2, n = [Math.sin(ph) * Math.cos(a), Math.cos(ph), Math.sin(ph) * Math.sin(a)];
      data.push(n[0] * r, n[1] * r * (top ? 1.6 : 1.1), n[2] * r, n[0], n[1], n[2], k / round, j / rows);
    }
  }
  for (let j = 0; j < rows; j++) for (let k = 0; k < round; k++) {
    const a = j * (round + 1) + k, b = a + 1, c = a + round + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  return { data: new Float32Array(data), indices: new Uint32Array(idx) };
}
