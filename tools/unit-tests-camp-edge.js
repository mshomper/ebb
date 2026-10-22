// @ts-check
// The camp pad's dashed edge and trodden look (docs/future/13 section 3.1, CP-01, CP-02), for
// tools/unit-tests.html: when the edge shows, how it fades, its mark, and the wear falloff.

import { isBrushTool, edgeTarget, stepEdge, edgeMark, padWear } from '../src/world/camp/edge.js';

const G = 'camp edge';

/** A pad as padOf gives it (the starter island's numbers). */
const pad = () => /** @type {any} */ ({ x: 0.6, z: -33.3, r: 4, h: 1.3, blend: 2.5, fx: 1, fz: 0, lockFadeM: 1,
  dash: { dashM: 0.35, gapM: 0.25, widthM: 0.06, opacity: 0.55, showWithinM: 4, fadeS: 0.3 },
  wear: 0.55, edgeWearM: 1, grassScale: 0.35, camp: {} });

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addCampEdgeTests(test, assert, eq) {
  test(G, 'brushes show the edge; taps and other tools do not', () => {
    for (const t of [{ tool: 'sculpt', sculptMode: 'raise' }, { tool: 'sculpt', sculptMode: 'terrace' }, { tool: 'sculpt', sculptMode: 'cut' },
      { tool: 'sculpt', sculptMode: 'stone' }, { tool: 'paint' }, { tool: 'smooth' }, { tool: 'water' }, { tool: 'water', waterMode: 'pour' }]) {
      assert(isBrushTool(t), `${JSON.stringify(t)} is a brush`);
    }
    for (const t of [null, { tool: null }, { tool: 'plant' }, { tool: 'feed' }, { tool: 'sculpt', sculptMode: 'loosestone' },
      { tool: 'sculpt', sculptMode: 'pondstones' }, { tool: 'sculpt', sculptMode: 'steps' }, { tool: 'water', waterMode: 'spring' },
      { tool: 'water', waterMode: 'net' }, { tool: 'water', waterMode: 'raft' }]) {
      assert(!isBrushTool(t), `${JSON.stringify(t)} is not a brush`);
    }
  });

  test(G, 'the edge shows while the ring is within its radius plus 4 m of the pad center', () => {
    const p = pad();
    const brush = { tool: 'sculpt', sculptMode: 'raise' };
    eq(edgeTarget(p, { x: p.x, z: p.z, radius: 2, visible: true }, brush), 0.55, 'on the pad');
    eq(edgeTarget(p, { x: p.x + 5.9, z: p.z, radius: 2, visible: true }, brush), 0.55, 'ring just touching (5.9 < 2 + 4)');
    eq(edgeTarget(p, { x: p.x + 6.1, z: p.z, radius: 2, visible: true }, brush), 0, 'ring just clear');
    eq(edgeTarget(p, { x: p.x, z: p.z, radius: 2, visible: false }, brush), 0, 'no ring on screen');
    eq(edgeTarget(p, { x: p.x, z: p.z, radius: 2, visible: true }, { tool: 'plant' }), 0, 'not a brush');
    eq(edgeTarget(null, { x: 0, z: 0, radius: 2, visible: true }, brush), 0, 'no pad (an older island before its stamp)');
  });

  test(G, 'it fades in and out over fadeS, never past its target', () => {
    let a = 0;
    for (let i = 0; i < 9; i++) a = stepEdge(a, 0.55, 1 / 60, 0.55, 0.3);
    assert(a > 0.25 && a < 0.35, `half way after 0.15 s (${a.toFixed(3)})`);
    for (let i = 0; i < 30; i++) a = stepEdge(a, 0.55, 1 / 60, 0.55, 0.3);
    eq(a, 0.55, 'holds at the target');
    a = stepEdge(a, 0, 0.31, 0.55, 0.3);
    eq(a, 0, 'gone after fadeS');
    eq(stepEdge(0.2, 0.55, 0, 0.55, 0.3), 0.2, 'no time, no change');
  });

  test(G, 'the mark is the pad circle with a negative radius, left out at 0', () => {
    const p = pad();
    eq(JSON.stringify(edgeMark(p, 0.4)), JSON.stringify([0.6, -33.3, -4, 0.4]), 'x, z, -r, opacity');
    eq(edgeMark(p, 0), null, 'an opacity of 0 would end the mark list');
    eq(edgeMark(null, 0.5), null, 'no pad');
  });

  test(G, 'wear is full on the pad and fades to nothing over edgeWearM', () => {
    const p = pad();
    eq(padWear(p, p.x, p.z), 0.55, 'center');
    eq(padWear(p, p.x + 4, p.z), 0.55, 'at the edge');
    const mid = padWear(p, p.x + 4.5, p.z);
    assert(Math.abs(mid - 0.275) < 1e-9, `half way out (${mid})`);
    eq(padWear(p, p.x + 5, p.z), 0, 'edgeWearM past the edge');
    eq(padWear(null, 0, 0), 0, 'no pad');
    eq(padWear({ ...p, wear: 0 }, p.x, p.z), 0, 'no wear');
  });
}
