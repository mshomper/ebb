// @ts-check
// The web copies of Matt's models (tools/assets/build-models.mjs) for tools/unit-tests.html: each one
// in tools/assets/models.json reads with the game's own small GLB reader, has its three paint maps,
// stands on the ground at its real size with its base centered, and is well under 2 MB.

import { readGlb, meshesByName, materialMaps } from '../src/render/gltf.js';

const G = 'web models';

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addAssetTests(test, assert, eq) {
  test(G, 'every web copy reads, has its paint maps, and stands on the ground at its real size', async () => {
    const list = await fetch('./assets/models.json').then((r) => r.json());
    const lines = [];
    for (const m of list.models) {
      const r = await fetch(`../${list.outDir}/${m.out}.glb`);
      assert(r.ok, `${m.out}.glb is there (run tools/assets/build-models.mjs)`);
      const buf = await r.arrayBuffer();
      assert(buf.byteLength < 2 * 1024 * 1024, `${m.out}: ${(buf.byteLength / 1048576).toFixed(2)} MB, under 2 MB`);
      const glb = readGlb(buf);
      const mesh = [...meshesByName(glb).values()][0];
      for (const a of ['POSITION', 'NORMAL', 'TEXCOORD_0']) assert(mesh.attributes[a], `${m.out}: ${a}`);
      const maps = materialMaps(glb);
      for (const k of /** @type {const} */ (['baseColor', 'metallicRoughness', 'normal'])) eq(maps[k]?.mimeType, 'image/webp', `${m.out}: ${k} map`);
      const p = mesh.attributes.POSITION;
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[i + a]); hi[a] = Math.max(hi[a], p[i + a]); }
      assert(Math.abs(lo[1]) < 0.005, `${m.out}: on the ground (lowest point ${lo[1].toFixed(3)} m)`);
      assert(Math.abs(lo[0] + hi[0]) < 0.01 && Math.abs(lo[2] + hi[2]) < 0.01, `${m.out}: base centered`);
      const span = m.along === 'height' ? hi[1] - lo[1] : Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
      assert(Math.abs(span - m.sizeM) < 0.01 * m.sizeM + 0.005, `${m.out}: ${span.toFixed(2)} m, wants ${m.sizeM} m`);
      lines.push(`${m.out} ${(buf.byteLength / 1048576).toFixed(2)} MB`);
    }
    return lines.join(', ');
  });
}
