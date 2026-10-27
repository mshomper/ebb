// @ts-check
// The walker's arms (doc 23, W5; split from motion.js): hanging from the A-pose and swinging with
// the opposite foot, or reaching by IK for a knee, the brim, the ground in front, an act's or a
// gesture's hands, or the pot held in both arms. Matt's clips swing them in place of the code's;
// reaching hands still lead. Live animation only.

import { qmul, qrot, qfromTo, qaxis, qconj, qslerp, matQuat, matPointInv, twoBone, sub, norm, lerp, smooth, DEG, QI } from './kinematics.js';

/**
 * @typedef {Object} ArmFrame
 * @property {any} P the pace (gait.js paceAt) @property {{ fz: number }[]} cyc each foot's place in the stride
 * @property {number} m @property {number} standW @property {number} sitW @property {number} kneelW @property {number} crawlW
 * @property {number} tuck @property {import('./acts.js').ActPose | null} A
 * @property {number} holdE @property {number} reach the feed's reach 0..1 @property {number} tugW the brim tug 0..1
 * @property {{ knee: number[] }[]} legIK @property {number} centre ground under the body (body m)
 * @property {(bx: number, bz: number) => number} gnd ground under a body spot (body m)
 * @property {Float32Array | null} CP the clip pose @property {number} cw how much the clip leads
 * @property {(i: number) => number} [cwOf] how much it leads one bone (a shot's mask leaves the lantern arm to the code)
 */

/**
 * @param {any} R recipes/world/figure.json
 * @param {{ name: string, parent: number, pivot: number[] }[]} skeleton
 * @param {Record<string, number>} I bone indices by name
 * @param {Float32Array} out the bone matrices
 * @param {(i: number, mv: import('../creatures/pose.js').BoneMove | null) => void} set
 * @param {(p: Float32Array, i: number) => number[]} clipQ
 */
export function createArms(R, skeleton, I, out, set, clipQ) {
  const PO = R.poses;
  const SIDE = [1, -1];
  const ARM = [['upperArm.l', 'foreArm.l', 'hand.l'], ['upperArm.r', 'foreArm.r', 'hand.r']].map((n) => n.map((k) => I[k]));
  // The arms hang from the A-pose by one turn at the shoulder; the elbow bends about the axis that
  // brings the hand forward once the arm hangs.
  const HANG = [0, 1].map((i) => {
    const [u, f] = ARM[i];
    const axis = norm(sub(skeleton[f].pivot, skeleton[u].pivot));
    const q0 = qfromTo(axis, [R.hang.dir[0] * SIDE[i], R.hang.dir[1], R.hang.dir[2]]);
    return { q0, flex: qrot(qconj(q0), [-1, 0, 0]) };
  });

  /** Pose both arms (the chest is already set). @param {ArmFrame} F */
  return function poseArms(F) {
    const { P, cyc, m, standW, sitW, kneelW, crawlW, tuck, A, holdE, reach, tugW, legIK, centre, gnd, CP } = F;
    const cwOf = F.cwOf ?? (() => F.cw);
    const C = PO.crawl;
    const chestQ = matQuat(out, I.chest * 16);
    const kneeHand = (/** @type {number} */ k, /** @type {number} */ dx) => [legIK[k].knee[0] + dx, legIK[k].knee[1] + 0.03, legIK[k].knee[2] + 0.06];
    for (let i = 0; i < 2; i++) {
      const [u, f, h] = ARM[i];
      const opp = cyc[1 - i];
      const swing = P.armDeg * DEG * ((opp.fz - 2 * P.stance * P.stepM * ((P.landShare ?? 0.5) - 0.5)) / Math.max(P.stance * P.stepM, 1e-3)) * m * standW;
      // Swinging forward the arm comes a little across the body and the elbow bends more; swinging
      // back it straightens (recipes/world/figure.json arms).
      const AR = R.arms ?? { elbowForward: 0.4, elbowBack: 0, across: 0 };
      const out1 = (P.armOutDeg + 3) * DEG * SIDE[i] - AR.across * Math.max(0, swing) * SIDE[i];
      let qU = qmul(qaxis([1, 0, 0], -swing), qmul(qaxis([0, 0, 1], out1), HANG[i].q0));
      const elbow = ((R.hang.elbowDeg * (1 - m) + P.elbowDeg * m) * DEG + AR.elbowForward * Math.max(0, swing) - AR.elbowBack * Math.max(0, -swing)) * standW + 0.9 * (sitW + kneelW + crawlW);
      let qF = qaxis(HANG[i].flex, elbow);
      // The clip's arms swing in place of the code's; reaching hands (below) still lead.
      if (CP) { qU = qslerp(qU, clipQ(CP, u), cwOf(u)); qF = qslerp(qF, clipQ(CP, f), cwOf(f)); }
      // Hand targets (body m) with a weight. An act's hands lead; the rest give way to them.
      /** @type {{ at: number[], w: number }[]} */ const goals = [];
      const aw = A ? A.arms : 0, keep = 1 - aw;
      if (sitW > 0) goals.push({ at: kneeHand(i, -0.02 * SIDE[i]), w: sitW * keep });
      if (kneelW > 0) goals.push({ at: i === 1 && reach > 0 ? [0, 1, 2].map((k) => lerp(kneeHand(1, 0.03)[k], [PO.feed.hand[0], centre + PO.feed.hand[1], PO.feed.hand[2]][k], reach)) : kneeHand(1, i === 0 ? 0.06 : -0.02), w: kneelW * keep });
      if (crawlW > 0) { const hc = C.hands[i]; goals.push({ at: [hc[0], gnd(hc[0], hc[2]) + hc[1], hc[2]], w: crawlW * keep }); }
      if (i === 0 && tugW > 0) goals.push({ at: PO.arrive.tugHand, w: tugW * keep });
      // Tucked: hands hug the shins.
      if (tuck > 0) goals.push({ at: kneeHand(i, -0.03 * SIDE[i]).map((v, k) => v + (k === 1 ? -0.12 : k === 2 ? 0.04 : 0)), w: tuck * 4 });
      if (A && aw > 0) { const ha = i === 0 ? A.l : A.r; goals.push({ at: [ha[0], centre + ha[1], ha[2]], w: aw }); }
      // The pot in both arms (S5): the hands hold its sides in front of you.
      if (holdE > 0 && PO.hold) { const hh = i === 0 ? PO.hold.l : PO.hold.r; goals.push({ at: [hh[0], centre + hh[1], hh[2]], w: smooth(holdE) * keep }); }
      const w = Math.min(1, goals.reduce((a, g) => a + g.w, 0));
      if (w > 0.001) {
        const at = [0, 1, 2].map((k) => goals.reduce((a, g) => a + g.at[k] * g.w, 0) / goals.reduce((a, g) => a + g.w, 0));
        const T = matPointInv(out, I.chest * 16, at);
        const pole = qrot(qconj(chestQ), norm([0.4 * SIDE[i], -0.3, -1]));
        const r = twoBone(skeleton[u].pivot, skeleton[f].pivot, skeleton[h].pivot, T, pole);
        qU = qslerp(qU, r.q1, w);
        qF = qslerp(qF, r.q2, w);
      }
      set(u, { q: qU });
      set(f, { q: qF });
      set(h, CP && cwOf(h) > 0 ? { q: qslerp(QI, clipQ(CP, h), cwOf(h)) } : null);
    }
  };
}
