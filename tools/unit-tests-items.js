// @ts-check
// Item icon tests for tools/unit-tests.html (F7, docs/future/13 section 4): every pouch kind the
// pack knows has a glyph, every plant part and seed resolves, every drawing is well formed and
// stays on the 24 px grid, and every family has its tint.

import { ITEM_ICON_NAMES, FAMILIES, itemFamily, itemIconBody, hasItemIcon, CHIP_FOR, CHIP_NAMES } from '../src/ui/icons/items.js';
import { POUCH_KINDS, PLANT_PARTS, MAKES, TREATS, KEEPSAKES, DYE_ROWS, itemIconFor, driedIconFor, offeredIconFor, makeIcon, keepsakeIcon, dyeIcon } from '../src/ui/icons/item-registry.js';
import { ICON_NAMES } from '../src/ui/icons/icons.js';

const G = 'item icons';

/**
 * Every number in a drawing's path data, circles and rects that sits outside the grid. Arcs' radii
 * and flags, and drawings placed under a transform, are skipped (their own numbers are local).
 * @param {string} body
 */
function offGrid(body) {
  const out = [];
  const flat = body.replace(/<g transform[^>]*>[\s\S]*?<\/g>/g, '');
  for (const m of flat.matchAll(/\bd="([^"]+)"/g)) {
    if (/[Aa]/.test(m[1])) continue;
    for (const n of m[1].match(/-?\d*\.?\d+/g) ?? []) if (+n < 0 || +n > 24) out.push(n);
  }
  for (const m of flat.matchAll(/\b(?:cx|cy|x|y)="(-?[\d.]+)"/g)) if (+m[1] < 0 || +m[1] > 24) out.push(m[1]);
  return out;
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addItemTests(test, assert, eq) {
  test(G, 'every kind in the pack recipe has a glyph', async () => {
    const pack = await (await fetch(new URL('../recipes/world/pack.json', import.meta.url))).json();
    const kinds = pack.kinds.map((/** @type {any} */ k) => k.id);
    const missing = kinds.filter((/** @type {string} */ k) => !itemIconFor(k) || !hasItemIcon(/** @type {string} */ (itemIconFor(k))));
    eq(missing.join(', '), '', 'kinds with no glyph:');
    return `${kinds.length} kinds`;
  });

  test(G, 'every registry row points at a glyph that can be drawn', () => {
    const rows = [...POUCH_KINDS, ...PLANT_PARTS, ...MAKES, ...TREATS, ...KEEPSAKES, ...DYE_ROWS];
    const bad = rows.filter((r) => (r.icon.startsWith('-') ? !ICON_NAMES.includes(r.icon.slice(1)) : !hasItemIcon(r.icon)));
    eq(bad.map((r) => r.id).join(', '), '', 'rows with no glyph:');
    const ids = new Set();
    for (const list of [[...POUCH_KINDS, ...PLANT_PARTS], MAKES, TREATS, KEEPSAKES, DYE_ROWS]) {
      ids.clear();
      for (const r of list) { assert(!ids.has(r.id), `duplicate id ${r.id}`); ids.add(r.id); }
    }
    return `${rows.length} rows`;
  });

  test(G, 'plant parts, seeds, clumps, dried bunches and treats resolve by either spelling', () => {
    eq(itemIconFor('mint.leaves'), 'mint');
    eq(itemIconFor('watermint.leaves'), 'mint', 'the flora recipe id');
    eq(itemIconFor('eveningprimrose.flowers'), 'primrose');
    eq(itemIconFor('thrift.seed'), 'seed:thrift', 'a species with a chip');
    eq(itemIconFor('chamomile.seed'), 'seed:chamomile', 'a species with only a part glyph');
    eq(itemIconFor('cherry.seed'), 'seed:seedhead', 'a species with neither');
    eq(itemIconFor('willow.clump'), 'clump:willow');
    eq(driedIconFor('chamomile.flowers'), 'dried:chamomile');
    eq(offeredIconFor('acorns'), 'offered:acorns');
    eq(offeredIconFor('leaf-pack'), 'leaf-pack', 'a made treat keeps its own glyph');
    eq(itemIconFor('no-such-thing'), null);
    eq(makeIcon('tea-pot'), 'tea-pot');
    eq(keepsakeIcon('seedpod'), 'drift-seed');
    eq(dyeIcon('woad-blue'), 'dye-woad-blue');
    for (const n of ['seed:thrift', 'seed:chamomile', 'clump:willow', 'dried:mint', 'offered:acorns']) assert(itemIconBody(n).length > 100, `${n} draws`);
  });

  test(G, 'every glyph is well formed, on the grid, and in a family with a tint', () => {
    for (const n of ITEM_ICON_NAMES) {
      const body = itemIconBody(n);
      assert(body.trim().length > 40, `${n} has a drawing`);
      assert(!/undefined|NaN/.test(body), `${n} has no undefined or NaN`);
      const open = (body.match(/<g\b/g) ?? []).length, close = (body.match(/<\/g>/g) ?? []).length;
      eq(open, close, `${n} groups balanced:`);
      eq(offGrid(body).join(' '), '', `${n} off the grid:`);
      const fam = itemFamily(n);
      assert(fam in FAMILIES, `${n} family ${fam}`);
      assert(fam === 'dyes' || /^#[0-9A-F]{6}$/i.test(FAMILIES[fam].tint ?? ''), `${fam} has a tint`);
    }
    for (const c of Object.values(CHIP_FOR)) assert(CHIP_NAMES.includes(c), `chip ${c}`);
    return `${ITEM_ICON_NAMES.length} glyphs`;
  });
}
