// @ts-check
// The light on the stack (docs/future/19, src/world/stack) for tools/unit-tests.html: where the
// stack stands on every land (offshore on the side away from the islet, its skirt inside the world),
// its shape (its top under the ground's 12 m ceiling, the apron, the cleft and the mouth above every
// tide), the causeway's shape (dry at any tide, gentle to walk), its days (the lights' evenings, the
// road's low water, an older island's days from its load), its save section, the mouth room's shape,
// and its threads, keeper page, hint and make.

import { subSeed } from '../src/core/rng.js';
import { baseSampler, islandCenter } from '../src/world/terrain/landform.js';
import { WORLD_ORIGIN, WORLD_CELLS, CELL, H_MAX } from '../src/world/terrain/grid.js';
import { isletLayout } from '../src/world/islet/layout.js';
import { stackLayout, makeStackShape, makeCauseway, causewayFrom, mouthSolid } from '../src/world/stack/layout.js';
import { startDayOf, lightDays, lightAt, roadH, duskOf } from '../src/world/stack/schedule.js';
import { cleanStack, emptyStack } from '../src/world/stack/model.js';
import { mouthShape } from '../src/world/stack/mouth-field.js';
import { SECTIONS9, clean9 } from '../src/save/migrate-format9.js';
import { tideParams } from '../src/world/tide.js';

const G = 'stack';
/** @param {string} p */
const load = async (p) => (await fetch(new URL(`../recipes/${p}.json`, import.meta.url))).json();
const LANDS = ['starter-island-2', 'starter-island', 'two-ponds'];

/** @param {any} land @param {number} seed @param {any} IR the islet recipe */
function placed(land, seed, IR) {
  const ts = subSeed(seed, 'terrain'), b = baseSampler(land, ts), base = (/** @type {number} */ x, /** @type {number} */ z) => b(x, z)[0];
  const il = isletLayout(IR, land, ts, subSeed(seed, 'islet'), base);
  const L = stackLayout(land.stack, land, ts, subSeed(seed, 'stack'), base, il ? il.sideDeg : null);
  return { L, il, base, shape: L ? makeStackShape(L, land.stack, subSeed(seed, 'stack'), land.seabedDepth ?? -3) : null };
}
/** @param {number} a @param {number} b */
const apart = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addStackTests(test, assert, eq) {
  test(G, 'every land has a stack offshore, its skirt inside the world, on the side away from the meadow islet', async () => {
    const IR = await load('land/meadow-islet');
    for (const name of LANDS) {
      const land = await load(`land/${name}`), c = islandCenter(land);
      assert(land.stack && land.stack.noBuildM >= 20 && land.stack.noBuildM <= 30, `${name}: a stack block, its ring 20 to 30 m (Matt)`);
      for (const seed of [1, 2, 42, 777, 12345]) {
        const { L, il, base } = placed(land, seed, IR);
        assert(L, `${name} seed ${seed}: a stack fits`);
        if (!L) continue;
        const end = WORLD_ORIGIN + WORLD_CELLS * CELL;
        assert(L.box.x0 >= WORLD_ORIGIN && L.box.z0 >= WORLD_ORIGIN && L.box.x1 <= end && L.box.z1 <= end, 'inside the world');
        if (il) assert(apart(L.sideDeg, il.sideDeg) >= 60, `${name} seed ${seed}: away from the islet's side`);
        const off = Math.hypot(L.x - L.shore[0], L.z - L.shore[1]);
        assert(off >= 30 && off <= 56, `${name} seed ${seed}: 30 to 56 m off the shore (${off.toFixed(1)})`);
        assert(base(L.x, L.z) < -1, 'it stands in water too deep to wade');
        assert(Math.hypot(L.x - c.x, L.z - c.z) > Math.hypot(L.shore[0] - c.x, L.shore[1] - c.z), 'out beyond the shore');
      }
    }
  });

  test(G, 'its shape: a top under the 12 m ceiling, ledges, the apron and the cleft above every tide', async () => {
    const IR = await load('land/meadow-islet'), W = await load('world/water'), A = W.tide.amplitudeM * (1 + (W.tide.springNeap ?? 0));
    const land = await load('land/starter-island-2'), { L, shape } = placed(land, 7, IR);
    if (!L || !shape) { assert(false, 'it fits'); return; }
    let top = -9, levels = new Set();
    for (let x = L.box.x0; x < L.box.x1; x += 0.25) for (let z = L.box.z0; z < L.box.z1; z += 0.25) {
      const h = shape.heightAt(x, z);
      if (h > top) top = h;
      if (h > 1.5) levels.add(Math.round(h / 0.5));
    }
    assert(top <= H_MAX && top > 11, `its top just under the ceiling (${top.toFixed(2)} m)`);
    assert(levels.size >= 4, 'stepped: several levels of shelf');
    for (const [n, p] of /** @type {[string, [number, number]][]} */ ([['the mouth', L.mouth], ['where you stand at it', L.stand], ['the foot', L.foot]])) {
      const h = shape.heightAt(p[0], p[1]);
      assert(h > A + 0.2 && h < 1.4, `${n} above every tide (${h.toFixed(2)} m)`);
    }
    assert(shape.onRock(L.x, L.z) && shape.onRock(L.mouth[0], L.mouth[1]) && !shape.onRock(L.shore[0], L.shore[1]), 'onRock: its middle and mouth, not the shore');
    assert(shape.heightAt(L.shore[0], L.shore[1]) === -Infinity, 'it leaves the island alone');
  });

  test(G, "Matt's cave mouth: its walls stand on raised ground hidden in the rock, its chamber floor is the apron", async () => {
    const IR = await load('land/meadow-islet'), fp = await (await fetch(new URL('../assets/models/stack/cave-mouth-footprint.json', import.meta.url))).json();
    const land = await load('land/starter-island-2'), { L } = placed(land, 7, IR);
    if (!L) return;
    const shape = makeStackShape(L, land.stack, subSeed(7, 'stack'), -3, fp), solid = mouthSolid(L, fp);
    const yaw = Math.atan2(-L.ux, -L.uz), c = Math.cos(yaw), sn = Math.sin(yaw);
    /** The model frame to the world (as the pieces pass turns it). @param {number} x @param {number} z */
    const world = (x, z) => [L.front[0] + x * c + z * sn, L.front[1] - x * sn + z * c];
    let walls = 0, raised = 0;
    for (let j = 0; j < fp.h; j++) for (let i = 0; i < fp.w; i++) if (fp.rows[j][i] === '1') {
      const [x, z] = world(fp.x0 + (i + 0.5) * fp.cellM, fp.z0 + (j + 0.5) * fp.cellM);
      walls++; if (solid(x, z) && shape.heightAt(x, z) >= L.apronM + land.stack.porch.wallRaiseM - 0.01) raised++;
    }
    assert(walls > 50 && raised === walls, `every wall cell raised (${raised} of ${walls})`);
    const [cx, cz] = world(0, -3);
    assert(!solid(cx, cz) && Math.abs(shape.heightAt(cx, cz) - L.apronM) < 0.05, 'the chamber floor three meters in is the apron');
    const head = new Uint32Array(await (await fetch(new URL('../assets/models/stack/cave-mouth.bin', import.meta.url))).arrayBuffer(), 0, 3);
    eq(head[0], 0x324d4245, 'the model file is EBM2'); assert(head[2] / 3 <= 15000, `thinned (${head[2] / 3} triangles)`);
  });

  test(G, 'the causeway: dry at any tide, gentle to walk, from the land nearest the stack to its foot', async () => {
    const IR = await load('land/meadow-islet'), R = await load('setpieces/stack'), W = await load('world/water');
    const A = W.tide.amplitudeM * (1 + (W.tide.springNeap ?? 0));
    const land = await load('land/starter-island-2'), { L, base } = placed(land, 3, IR);
    if (!L) return;
    const from = causewayFrom(L, islandCenter(land), base, R.road.topM - 0.15);
    assert(base(from[0], from[1]) >= R.road.topM - 0.15, 'it leaves the land at the land');
    assert(Math.hypot(from[0] - L.x, from[1] - L.z) > L.noBuildM - 5, 'from the island, not from inside the ring');
    const road = makeCauseway(from, L.foot, R.road, subSeed(3, 'stack'), -3);
    let low = Infinity, steep = 0;
    for (let t = 0.05; t <= 0.95; t += 0.01) {
      const x = from[0] + (L.foot[0] - from[0]) * t, z = from[1] + (L.foot[1] - from[1]) * t;
      const h = road.heightAt(x, z), h2 = road.heightAt(x + 0.25 * (L.foot[0] - from[0]) / Math.hypot(L.foot[0] - from[0], L.foot[1] - from[1]), z + 0.25 * (L.foot[1] - from[1]) / Math.hypot(L.foot[0] - from[0], L.foot[1] - from[1]));
      low = Math.min(low, h);
      steep = Math.max(steep, Math.abs(h2 - h) / 0.25);
      assert(road.onTop(x, z), 'its middle line is its top');
    }
    assert(low > A + 0.1, `its top stays above the highest tide (${low.toFixed(2)} m over ${A.toFixed(2)})`);
    assert(steep < Math.tan(25 * Math.PI / 180), `gentle along its line (${steep.toFixed(2)})`);
    assert(road.along(from[0], from[1]) < 0.01 && road.along(L.foot[0], L.foot[1]) > 0.99, 'the rise sweeps from the land out to the stack');
  });

  test(G, 'its days: two or three evenings of lights in days 1 to 6, the road at the first low water of day 7; an older island counts from its load', async () => {
    const R = await load('setpieces/stack'), W = await load('world/water'), tide = tideParams(W.tide);
    for (const seed of [1, 5, 99, 2024]) {
      const d = lightDays(seed, 0, R);
      assert(d.length >= 2 && d.length <= 3, `seed ${seed}: two or three evenings`);
      assert(d.every((v) => v >= 1 && v <= 6) && new Set(d).size === d.length, 'distinct days of the first six');
      eq(JSON.stringify(lightDays(seed, 0, R)), JSON.stringify(d), 'the same every time');
      const dusk = duskOf(12), day = d[0];
      assert(lightAt(day * 24 + dusk + R.lights.afterDuskH + R.lights.forH / 2, d, dusk, R) === 1, 'on its evening, a while after dusk: lit');
      assert(lightAt(day * 24 + 12, d, dusk, R) === 0, 'not at noon');
      const off = [1, 2, 3, 4, 5, 6].find((v) => !d.includes(v)) ?? 0;
      assert(lightAt(off * 24 + dusk + 0.5, d, dusk, R) === 0, 'not on the other evenings');
    }
    const h = roadH(0, tide, R);
    assert(h >= 7 * 24 && h < 7 * 24 + tide.periodH, `the road on day 7, at its first low water (hour ${h.toFixed(2)})`);
    eq(startDayOf(0, R), 0, 'a new island counts from day 0');
    eq(startDayOf(4, R), 0, 'an island in its first week keeps the calendar');
    eq(startDayOf(40, R), 40, 'an older island counts from its load');
    assert(roadH(40, tide, R) >= 47 * 24, 'and its road comes 7 days after that load');
    assert(lightDays(1, 40, R).every((v) => v > 40 && v <= 46), 'its lights the evenings after the load');
  });

  test(G, 'its save section: empty reads as not yet; a stood causeway, the lantern and the rubble come back', () => {
    assert(SECTIONS9.includes('stack'), 'in format 9\'s list');
    eq(JSON.stringify(clean9('stack', undefined)), JSON.stringify(emptyStack()), 'a save from before the stack: not yet');
    const s = { version: 1, startDay: 40, cleared: true, risen: true, from: [10, -2], shown: true, lantern: 'hung', rubble: 2, dugDay: 51 };
    eq(JSON.stringify(cleanStack(JSON.parse(JSON.stringify(s)))), JSON.stringify(s), 'comes back exactly');
    eq(cleanStack({ ...s, from: null }).risen, false, 'risen needs a land end');
    eq(cleanStack({ ...s, lantern: 'floating' }).lantern, 'floor', 'an unknown lantern state is on the floor');
  });

  test(G, 'the mouth room: you come in under the cleft; the lantern, the note, the pool and both passages are inside', async () => {
    const R = await load('world/stack-mouth'), S = R.shape, s = mouthShape(S, R.seed);
    for (const [n, p] of [['the way in', [0, 0]], ['where you arrive', [R.view.arriveM, 0]], ['the lantern', R.things.lantern.at], ['the note', R.things.note.at], ['the pool', S.pool.at]]) {
      assert(s.inside(p[0], p[1]) > 0.5, `${n} is well inside`);
    }
    for (const P of [S.arch, S.rubble]) {
      const end = [P.at[0] + P.dir[0] * (P.lengthM - 0.4), P.at[1] + P.dir[1] * (P.lengthM - 0.4)];
      assert(s.inside(end[0], end[1]) > 0.2 && s.ceilAt(0, 0) > 2, 'each passage runs on into the rock');
    }
    assert(s.air(0, 1, 0) > 0 && s.air(0, 1, 20) < 0, 'air in the room, rock beyond');
  });

  test(G, "the cave pass's light: the shader's struct, the buffer and the mouth's values all the same size", async () => {
    const wgsl = await (await fetch(new URL('../src/shaders/cave-draw.wgsl', import.meta.url))).text();
    const pass = await (await fetch(new URL('../src/render/passes/cave.js', import.meta.url))).text();
    const mouth = await (await fetch(new URL('../src/world/stack/mouth.js', import.meta.url))).text();
    const struct = wgsl.slice(wgsl.indexOf('struct CaveUniforms'), wgsl.indexOf('};', wgsl.indexOf('struct CaveUniforms')));
    const floats = (struct.match(/: vec4f,/g) ?? []).length * 4;
    const F = Number(/const FLOATS = (\d+);/.exec(pass)?.[1]);
    eq(F, floats, `the buffer holds the struct (${floats} floats)`);
    // The mouth's uniforms: count the values it lists, a spread of 3 for each ...array.
    const list = mouth.slice(mouth.indexOf('const uniforms = ['), mouth.indexOf('];', mouth.indexOf('const uniforms = [')));
    const n = list.split(String.fromCharCode(10)).slice(1).join(' ').split(',').map((t) => t.trim()).filter(Boolean)
      .reduce((s, t) => s + (t.startsWith('...') ? 3 : 1), 0);
    eq(n, F, `the mouth gives every value (${n})`);
  });

  test(G, 'its story: two threads with tests, the note a keeper page, the hint, the staff a unique make, the zone listed', async () => {
    const T = await load('world/threads'), K = await load('world/keeper-pages'), H = await load('world/morning-hints'), C = await load('world/cook');
    const Z = await load('world/zones'), I = await load('index');
    for (const id of ['stack', 'stack-passage']) {
      const t = T.threads.find((/** @type {any} */ x) => x.id === id);
      assert(t && t.pencil && t.lines.every((/** @type {any} */ l) => T.tests[l.test]), `thread ${id}: its lines' tests exist`);
    }
    const page = K.pages.find((/** @type {any} */ p) => p.id === 'lamplighter-1');
    assert(page && page.body.join(' ').split(/\s+/).length < 60, 'the first note: a keeper page under 60 words');
    const hint = H.hints.find((/** @type {any} */ h) => h.id === 'stack-road');
    assert(hint && H.tests[hint.when] && H.tests[hint.done], 'the morning after the road, until you cross it');
    const key = (/** @type {any} */ m) => m.parts.map((/** @type {any} */ p) => JSON.stringify(p)).sort().join('|');
    const staff = C.makes['driftwood-staff'];
    assert(staff && staff.unlock === 'staff', 'the staff waits for the arch');
    eq(Object.entries(C.makes).filter(([id, m]) => id !== 'driftwood-staff' && key(m) === key(staff)).length, 0, 'its parts are unique');
    assert(Z.list['stack-mouth'] && I.recipes?.['world/stack-mouth'] !== undefined || JSON.stringify(I).includes('world/stack-mouth'), 'the zone is listed');
    assert(JSON.stringify(I).includes('setpieces/stack'), 'its recipe is listed');
  });
}
