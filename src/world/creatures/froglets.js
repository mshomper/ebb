// @ts-check
// Froglets hopping out of the pond (doc 13; the creature rigging rule): each one is the frog's own
// body and rig (rigs/frog.js), drawn small, posed by the frog's motion (motion.js frogMoves): it
// sits between hops breathing, its throat pulsing and its eyes blinking; it hops, the hind legs
// reaching out by IK and folding back, the body pitching up then down; and it lands with the frog's
// squash spring. Where it is along its way out comes from game time (spring-live.js, the same on
// every device); each hop itself takes hopS real seconds, so it stays quick at any speed of time.
// Pure; live animation only.

/**
 * Where a froglet is in its hops: which hop (0 = the first), the hop's phase (0..1, or -1 while it
 * sits), and how long it has sat since it last landed (real seconds).
 * @param {number} along hops done so far, fractional (game time)
 * @param {number} intervalS real seconds one hop's share of the way takes now
 * @param {any} FL frogspawn.json body.froglet
 * @returns {{ n: number, hopT: number, sitS: number }}
 */
export function frogletHop(along, intervalS, FL) {
  const n = Math.floor(along), f = along - n;
  // The hop is the start of each share, never more than hopShareMost of it (when time runs fast).
  const hopShare = Math.min(FL.hopShareMost, FL.hopS / Math.max(1e-6, intervalS));
  if (f < hopShare) return { n, hopT: f / hopShare, sitS: -1 };
  return { n, hopT: -1, sitS: (f - hopShare) * intervalS };
}

/**
 * The landing squash: the frog's spring (frog.json motion.squash: amount, k, d), struck at landing
 * and ringing down; positive squashes it flat. @param {number} sinceS real seconds since landing @param {any} S
 */
export function landSquash(sinceS, S) {
  if (sinceS < 0) return 0;
  const wd = Math.sqrt(Math.max(1e-6, S.k - (S.d * S.d) / 4));
  const v0 = S.amount * Math.sqrt(S.k);
  return (v0 / wd) * Math.exp((-S.d / 2) * sinceS) * Math.sin(wd * sinceS);
}
