// @ts-check
// Carrier strips for tools/walker-strip.html (P2f): the rush satchel and the willow basket worn on
// the real figure, the baked pack folded away, through Matt's clips (walk, light jog, run, roll),
// sitting and digging, seen from behind and a little to the side, so any clipping shows. The carrier
// is placed by the game's own code (src/world/figure/carry.js) from recipes/world/pack.json wear,
// and drawn in its base colours as the stage's plain shapes. A strip with no carrier shows the
// coat's back with the pack folded away.

import { carriedOn } from '../src/world/figure/carry.js';
import { readGlb } from '../src/render/gltf.js';
import { campModelMesh, baseColorSampler } from '../src/world/pack/draw.js';

/**
 * @param {{ STRIPS: Record<string, any>, stage: any, R: any, W: any, built: any, DT: number,
 *   strideRun: (pace: number, clips?: boolean) => any, rollRun: (clips?: boolean) => any, digRun: () => any,
 *   stridePicks: (rec: any[]) => any[], rollPicks: (rec: any[]) => any[], digPicks: () => any[], createFigureMotion: Function, clips: any }} o
 */
export async function addCarrierStrips(o) {
  const { STRIPS, R, W, built, DT } = o;
  const P = await (await fetch('../recipes/world/pack.json')).json();
  const C = await (await fetch('../recipes/world/camp.json')).json();
  const DS = R.body.displayScale ?? 1;
  /** Each carrier's mesh, loaded once: positions, normals and base colours. @type {Record<string, any>} */
  const meshes = {};
  for (const [id, wear] of Object.entries(P.wear ?? {})) {
    const file = C.props.models[/** @type {any} */ (wear).model]?.file;
    if (!file) continue;
    const glb = readGlb(await (await fetch(`../${file}`)).arrayBuffer());
    meshes[id] = campModelMesh(glb, [0.4, 0.33, 0.2], await baseColorSampler(glb));
  }
  const bone = (/** @type {string} */ n) => built.skeleton.findIndex((/** @type {any} */ b) => b.name === n);

  /**
   * The carrier's triangles where the figure carries it now (stage meters: body m, figure at the
   * origin facing yaw). @param {string} id @param {any} motion @param {number[]} place [x, y, z, yaw]
   */
  function carrierTris(id, motion, place) {
    const wear = P.wear[id], m = meshes[id];
    if (!wear || !m) return null;
    const i = bone(wear.bone);
    const c = carriedOn(motion.bones, i, built.skeleton[i].pivot, wear.at, wear.turnDeg ?? [0, 0, 0], place[3], 1);
    // Ry(yaw) Rx(pitch) Rz(roll), as prop-draw.wgsl turns a prop.
    const s = (wear.scale ?? 1) / DS;
    const turn = (/** @type {number[]} */ v) => {
      const cr = Math.cos(c.roll), sr = Math.sin(c.roll), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch), cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
      const r = [cr * v[0] - sr * v[1], sr * v[0] + cr * v[1], v[2]];
      const p = [r[0], cp * r[1] - sp * r[2], sp * r[1] + cp * r[2]];
      return [cy * p[0] + sy * p[2], p[1], -sy * p[0] + cy * p[2]];
    };
    const out = new Float32Array(m.indices.length * 9);
    for (let t = 0; t < m.indices.length; t++) {
      const v = m.indices[t] * 9, V = m.vertices;
      const q = turn([V[v] * s, V[v + 1] * s, V[v + 2] * s]), n = turn([V[v + 3], V[v + 4], V[v + 5]]);
      out.set([place[0] + c.dx + q[0], place[1] + c.dy + q[1], place[2] + c.dz + q[2], n[0], n[1], n[2], V[v + 6], V[v + 7], V[v + 8]], t * 9);
    }
    return out;
  }

  /** A run with the pack folded away and the carrier worn. @param {() => any} make @param {string | null} id */
  const wearing = (make, id) => () => {
    const run = make();
    run.motion.showPack(id === 'pack');
    return { ...run, props: id && id !== 'pack' ? () => carrierTris(id, run.motion, run.place()) : null };
  };
  /** Sitting down (as resting at the fire): standing a moment, then sitting, held. */
  function sitRun() {
    const motion = o.createFigureMotion(R, built.skeleton, o.clips);
    let t = 0;
    return {
      motion,
      step() {
        t += DT;
        const r = motion.update(DT, { x: 0, z: 0, y: 0, yaw: 0, speed: 0, moving: false, ground: () => 0, depth: () => 0, below: true, posture: t > 0.5 ? 'sit' : 'stand' });
        return { t, r };
      },
      place: () => [0, 0, 0, 0],
    };
  }
  const sitPicks = () => [0.3, 0.9, 1.4, 2.2, 4].map((s) => ({ i: Math.round(s / DT), label: s < 0.5 ? 'standing' : s < 2 ? 'sitting down' : 'sat' }));
  const walk = R.clips ? +(R.clips.paces.find((/** @type {any} */ p) => p.clip === 'walk').speed * DS).toFixed(2) : 1;
  const BEHIND = { yaw: Math.PI + 0.55, pitch: 0.22, dist: 3.4 }, BACK = { yaw: Math.PI, pitch: 0.12, dist: 2.6 };
  const four = (/** @type {any[]} */ rec) => o.stridePicks(rec).filter((_, i) => i % 2 === 0);

  for (const id of ['pack', ...Object.keys(meshes), null]) {
    const name = id ? P.words.carrierNames?.[id] ?? id : 'No carrier';
    const rows = [
      { name: `${name}: walking, ${walk} m/s`, view: BEHIND, run: wearing(() => o.strideRun(walk, true), id), picks: four },
      { name: `${name}: light jog, ${W.pace.strollMps} m/s`, view: BEHIND, run: wearing(() => o.strideRun(W.pace.strollMps, true), id), picks: four },
      { name: `${name}: running, ${W.pace.briskMps} m/s`, view: BEHIND, run: wearing(() => o.strideRun(W.pace.briskMps, true), id), picks: four },
      { name: `${name}: sitting`, view: BEHIND, run: wearing(sitRun, id), picks: sitPicks },
      { name: `${name}: digging`, view: BEHIND, run: wearing(o.digRun, id), picks: o.digPicks, overlay: true },
      { name: `${name}: the roll`, view: { yaw: -Math.PI / 2 + 0.5, pitch: 0.2, dist: 4 }, run: wearing(() => o.rollRun(true), id), picks: (/** @type {any[]} */ rec) => o.rollPicks(rec).filter((_, i) => i % 2 === 1) },
    ];
    STRIPS[`carrier-${id ?? 'none'}`] = { title: id ? `Worn: ${name}` : 'Pack folded away: the coat\'s back', tile: [220, 300], view: BEHIND,
      rows: id ? rows : [{ ...rows[0], view: BACK }, { ...rows[3], view: BACK }] };
  }
}
