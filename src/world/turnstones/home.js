// @ts-check
// Where the turnstones' home lies (B3 wave 2): the middle of the thickest run of wrack on the
// strand, so the flock lives where most of it is. Pure.

/**
 * The wrack spot with the most others within reachM, and the middle of those, or null when none
 * lies. Ties go to the earlier spot, so the same strand gives the same home.
 * @param {{ x: number, z: number }[]} spots @param {number} reachM
 * @returns {{ x: number, z: number, n: number } | null}
 */
export function wrackMiddle(spots, reachM) {
  let best = -1, bestN = 0;
  for (let i = 0; i < spots.length; i++) {
    let n = 0;
    for (const q of spots) if (Math.hypot(q.x - spots[i].x, q.z - spots[i].z) <= reachM) n++;
    if (n > bestN) { bestN = n; best = i; }
  }
  if (best < 0) return null;
  const c = spots[best];
  let x = 0, z = 0, n = 0;
  for (const q of spots) if (Math.hypot(q.x - c.x, q.z - c.z) <= reachM) { x += q.x; z += q.z; n++; }
  // The middle of a curved strand may fall off it; the spot nearest the middle is on it.
  const mx = x / n, mz = z / n;
  let on = c, onD = Infinity;
  for (const q of spots) { const d = Math.hypot(q.x - mx, q.z - mz); if (Math.hypot(q.x - c.x, q.z - c.z) <= reachM && d < onD) { onD = d; on = q; } }
  return { x: on.x, z: on.z, n };
}

/**
 * Which plumage a bird wears at a point in the year (season position: 0 spring .. 4 the next
 * spring). Each bird turns at its own moment, `u` (0..1, from its id) of the way through a window:
 * from breeding to winter through turn.toWinter (early autumn, as they come back), and from winter
 * to breeding through turn.toBreeding (late winter into spring, before they leave). Pure.
 * @param {number} pos @param {number} u @param {{ toWinter: number[], toBreeding: number[] }} turn
 * @returns {'winter' | 'breeding'}
 */
export function plumageOf(pos, u, turn) {
  const W = turn.toWinter, Bd = turn.toBreeding;
  // The spring months before they leave count as the end of the winter's year.
  const p = pos < W[0] ? pos + 4 : pos;
  if (p < W[0] + u * (W[1] - W[0])) return 'breeding';
  if (p >= Bd[0] + u * (Bd[1] - Bd[0])) return 'breeding';
  return 'winter';
}
