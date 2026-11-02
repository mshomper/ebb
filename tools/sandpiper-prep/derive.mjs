// Derive recipes/birds/purple-sandpiper.json from the turnstone's (run from the repo root).
import fs from 'node:fs';
const T = JSON.parse(fs.readFileSync('recipes/birds/turnstone.json', 'utf8'));
const S = structuredClone(T.shape);
const r4 = (v) => Math.round(v * 10000) / 10000;
const dn = (p, d) => { p[1] = r4(p[1] + d); return p; };
const DY = -0.006;
dn(S.body.c, DY); dn(S.breast.c, DY); dn(S.neck.base, DY); dn(S.neck.top, DY); dn(S.head.c, DY); dn(S.eye.c, DY); dn(S.tail.c, DY);
dn(S.wing.shoulder, DY); dn(S.wing.tip, DY); dn(S.leg.hip, DY); dn(S.leg.ankle, -0.0045);
S.body.r = [0.037, 0.034, 0.068];
S.head.r = [0.0178, 0.0172, 0.0215];
S.bill = { base: [0, 0.1012, 0.1035], mid: [0, 0.1004, 0.124], tip: [0, 0.0972, 0.1395], r: [0.0048, 0.0013], flat: 0.85 };
S.leg.tarsusR = 0.0034;
const P = {
  winter: {
    parts: {
      upper: [0.075, 0.07, 0.092], under: [0.66, 0.66, 0.64], head: [0.095, 0.09, 0.105], throat: [0.42, 0.42, 0.42],
      bib: [0.15, 0.145, 0.16], wingUpper: [0.07, 0.066, 0.086], wingUnder: [0.68, 0.68, 0.66], wingBar: [0.6, 0.6, 0.58],
      tail: [0.045, 0.042, 0.05], rump: [0.05, 0.047, 0.058], bill: [0.022, 0.02, 0.02], billBase: [0.6, 0.36, 0.06],
      leg: [0.64, 0.4, 0.06], eye: [0.012, 0.009, 0.008], eyeRing: [0.66, 0.66, 0.64]
    },
    billBaseShare: 0.38,
    mottle: { scale: 230, amount: 0.3, color: [0.035, 0.033, 0.045], pale: [0.2, 0.19, 0.23], paleShare: 0.22 },
    marks: [
      { on: ['body', 'breast', 'neck'], c: [0, 0.064, 0.05], r: [0.05, 0.026, 0.036], color: 'bib', patchy: 0.55 },
      { on: ['neck', 'head'], c: [0, 0.088, 0.08], r: [0.012, 0.011, 0.02], color: 'throat', below: true },
      { on: ['head'], c: [0.0152, 0.1095, 0.0955], r: [0.006, 0.0058, 0.0058], color: 'eyeRing' }
    ]
  }
};
const motion = structuredClone(T.motion);
motion.walk = { strideM: 0.045, duty: 0.62, liftM: 0.01, bobM: 0.0022, mps: 0.18 };
motion.run = { ...motion.run, mps: 0.5 };
motion.creep = { strideM: 0.032, duty: 0.72, liftM: 0.007, bobM: 0.0016, mps: 0.09, leanDeg: 14, crouchM: 0.007, neckDeg: -16 };
motion.peck = { s: 0.42, reachDeg: 28, neckDeg: 46 };
motion.bob = { s: 0.8, n: 2, dipDeg: 11, dropM: 0.005, tailDeg: 14 };
motion.roost = { dropM: 0.02, neckYawDeg: 150, neckPitchDeg: 18, settleS: 1.2 };
const out = {
  id: 'purple-sandpiper',
  rig: 'small-bird',
  note: "The purple sandpiper on the small-bird rig (B3 wave 3; src/world/creatures/bird-rig.js, bird-motion.js, bird-model.js), made from the turnstone's recipe (recipes/birds/turnstone.json, by tools/sandpiper-prep/derive.mjs) with these changes: the body a little lower on shorter legs (everything above the feet 6 mm down, the ankle 4.5 mm), a longer bill drooping slightly toward the tip (bill.mid: a second segment from mid to tip), and its winter plumage: slate grey with a purple cast above with pale scaly fringes (mottle), a grey streaked breast fading into a pale belly (the bib mark, patchy), a pale eye ring, a dark bill with a yellow-orange base (billBase over billBaseShare of its length from the base) and short yellow-orange legs. Winter plumage only: they leave before their brown breeding plumage would show. A real purple sandpiper is about 0.21 m long; displayScale 2.8 draws it about 0.59 m. BAKE: the turnstone's budget, 3,000 triangles for a single bird, 1,196 for a flock bird. MOTION: the turnstone's clips plus creep (a low, slow, crouched walk over wet rock: leanDeg forward, crouchM lower, neckDeg the neck drawn forward), bob (n quick dips of the body and a flick of the tail over s seconds), and roost (tucked: the body lowered dropM onto bent legs, the head turned back over the shoulder with the bill in the back feathers, eased in over settleS). Lengths in real metres, times in real seconds.",
  realLengthM: 0.21,
  displayScale: 2.8,
  drawnLengthM: 0.59,
  bake: { ...T.bake, maxTris: 3000, flockTris: 1196 },
  shape: S,
  plumage: P,
  wingPattern: { ...T.wingPattern, barAcross: [0.45, 0.8], tipColor: [0.025, 0.023, 0.03] },
  motion
};
// Arrays of plain values on one line, as the turnstone's recipe has them.
const text = JSON.stringify(out, null, 2).replace(/\[\s+([^[\]{}]*?)\s+\]/g, (m, inner) => `[${inner.split(/,\s*/).join(', ')}]`);
fs.writeFileSync('recipes/birds/purple-sandpiper.json', text + '\n');
console.log('wrote recipes/birds/purple-sandpiper.json');
