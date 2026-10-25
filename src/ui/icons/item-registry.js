// @ts-check
// Which glyph each item wears (F7). The pack, its cards, the gather buttons, the piles, the stations
// and the shelf ask here by the ids they already use, and draw with src/ui/icons/items.js:
//
//   itemIconFor('drift-twigs')        'drift-twigs'
//   itemIconFor('watermint.leaves')   'mint'           (plant parts: <species>.<part>)
//   itemIconFor('thrift.seed')        'seed:thrift'    (one per species, built from its chip)
//   itemIconFor('willow.clump')       'clump:willow'
//   driedIconFor('chamomile.flowers') 'dried:chamomile' (a bunch on the drying rack)
//   offeredIconFor('acorns')          'offered:acorns'  (a treat set out)
//   makeIcon('tea-pot'), keepsakeIcon('fossil'), dyeIcon('woad-blue')
//
// The tables also list each thing's tier and build phase (docs/future/13 section 13), which the
// gallery page (tools/icon-sheet.html) shows; the game does not read them.

import { ICON_NAMES } from './icons.js';
import { DYES } from './items-made.js';
import { CAMP_ROWS } from './items-camp.js';

/**
 * @typedef {{ id: string, icon: string, name: string, tier: string, phase: number }} ItemRow
 * phase: 1 in the game now (the first evening), 2 the first season, 3 to 5 later phases.
 */
const row = (/** @type {[string, string, string, string, number]} */ [id, icon, name, tier, phase]) => ({ id, icon, name, tier, phase });

/** Pouch kinds that are not plant parts (recipes/world/pack.json kinds and docs/future/13 4.1). @type {ItemRow[]} */
export const POUCH_KINDS = /** @type {[string, string, string, string, number][]} */ ([
  ['sticks', 'sticks', 'Sticks', 'T1', 1], ['drift-twigs', 'drift-twigs', 'Drift twigs', 'T1', 1], ['charcoal', 'charcoal', 'Charcoal', 'T1', 2],
  ['cakes', 'cakes', "King Alfred's cakes", 'T3', 5], ['hardwood', 'hardwood', 'Hardwood', 'T5', 5],
  ['pebbles', 'pebbles', 'Pebbles', 'T1', 1], ['flat-stones', 'flat-stones', 'Flat stones', 'T1', 1],
  ['rush-cord', 'rush-cord', 'Rush cord', 'T2', 2], ['lichen-twigs', 'lichen-twigs', 'Lichen twigs', 'T4', 4],
  ['sand', 'sand', 'Sand', 'T2', 2], ['clay', 'clay', 'Clay', 'T2', 2], ['ash', 'ash', 'Wood ash', 'T1', 2],
  ['leaves', 'leaves', 'Fallen leaves', 'T2', 2], ['kelp', 'kelp', 'Cast kelp', 'T2', 2], ['wrack', 'wrack', 'Wrack', 'T1', 2],
  ['worms', 'worms', 'Worms', 'T2', 2], ['acorns', 'acorns', 'Acorns', 'T5', 5], ['hazelnuts', 'hazelnuts', 'Hazelnuts', 'T5', 5],
  ['old-comb', 'old-comb', 'Old comb', 'T4', 4], ['chanterelle', 'chanterelle', 'Chanterelle', 'T5', 5],
  ['shells', 'shells', 'Broken shells', 'T2', 2], ['crushed-shell', 'crushed-shell', 'Crushed shell', 'T2', 2],
]).map(row);

/** Plant parts, '<species>.<part>' (docs/future/13 sections 4.1 and 5.3). @type {ItemRow[]} */
export const PLANT_PARTS = /** @type {[string, string, string, string, number][]} */ ([
  ['reeds.down', 'reed-down', 'Reed down', 'T1', 2], ['reeds.leaves', 'reed-leaves', 'Reed leaves', 'T1', 2],
  ['rushes.stems', 'rushes', 'Rushes', 'T2', 2], ['marram.leaves', 'marram', 'Marram leaves', 'T2', 2],
  ['willow.withies', 'withies', 'Willow withies', 'T2', 2], ['willow.bark', 'willow-bark', 'Willow bark', 'T2', 2], ['willow.leaves', 'willow-leaves', 'Willow leaves', 'T2', 2],
  ['gorse.flowers', 'gorse-flowers', 'Gorse flowers', 'T2', 2], ['mint.leaves', 'mint', 'Water mint', 'T2', 2],
  ['meadowsweet.flowers', 'meadowsweet', 'Meadowsweet', 'T2', 2], ['nettle.tops', 'nettle', 'Nettle tops', 'T2', 2], ['chamomile.flowers', 'chamomile', 'Chamomile', 'T2', 2],
  ['myrtle.twigs', 'myrtle', 'Bog myrtle', 'T2', 4], ['myrtle.leaves', 'myrtle', 'Bog myrtle leaves', 'T2', 4],
  ['watercress.leaves', 'watercress', 'Watercress', 'T3', 3], ['seacarrot.flowers', 'seacarrot', 'Sea carrot flowers', 'T3', 3],
  ['elder.flowers', 'elderflower', 'Elderflowers', 'T4', 4], ['clover.flowers', 'clover', 'Red clover', 'T4', 4], ['selfheal.flowers', 'selfheal', 'Self-heal', 'T4', 4],
  ['thyme.tops', 'thyme', 'Wild thyme', 'T4', 4], ['heather.tops', 'heather', 'Heather tops', 'T4', 4], ['woad.leaves', 'woad', 'Woad leaves', 'T4', 4],
  ['bedstraw.roots', 'bedstraw-roots', "Lady's bedstraw roots", 'T4', 4], ['bedstraw.flowers', 'bedstraw', "Lady's bedstraw flowers", 'T4', 4],
  ['yarrow.flowers', 'yarrow', 'Yarrow', 'T4', 4], ['sorrel.leaves', 'sorrel', 'Sorrel leaves', 'T4', 4], ['cuckooflower.flowers', 'cuckooflower', 'Cuckooflower', 'T4', 4],
  ['strawberry.leaves', 'strawberry-leaves', 'Strawberry leaves', 'T5', 5], ['seabeet.leaves', 'seabeet', 'Sea beet', 'T6', 5], ['seakale.leaves', 'seakale', 'Sea kale', 'T6', 5],
  ['seakale.flowers', 'seakale', 'Sea kale flowers', 'T6', 5], ['samphire.leaves', 'samphire', 'Rock samphire', 'T6', 5], ['primrose.flowers', 'primrose', 'Evening primrose', 'T7', 5],
  ['rose.hips', 'hips', 'Rose hips', 'T4', 5], ['elder.berries', 'elderberries', 'Elderberries', 'T4', 5], ['hawthorn.berries', 'haws', 'Haws', 'T4', 4],
  ['bramble.berries', 'blackberries', 'Blackberries', 'T5', 5], ['strawberry.fruit', 'strawberries', 'Wild strawberries', 'T5', 5], ['juniper.berries', 'juniper', 'Juniper berries', 'T6', 5],
  ['hazel.nuts', 'hazelnuts', 'Hazelnuts', 'T5', 5], ['oak.acorns', 'acorns', 'Acorns', 'T5', 5],
  ['lilies.leaf', 'lily-leaf', 'Lily leaf', 'T3', 3], ['pondweed.strands', 'pondweed', 'Pondweed', 'T3', 3],
]).map(row);

/** Species named two ways in the docs (doc 13's pouch table against the flora recipe ids). */
const SPECIES_ALIAS = Object.freeze({ watermint: 'mint', bogmyrtle: 'myrtle', dogrose: 'rose', eveningprimrose: 'primrose' });

/**
 * The drawing a species' seeds and clumps are built from: its chip in icons.js where it has one,
 * else its own part glyph, else the plain seed head.
 */
const SPECIES_BASE = Object.freeze({
  mint: 'mint', meadowsweet: 'meadowsweet', nettle: 'nettle', chamomile: 'chamomile', marram: 'marram', woad: 'woad', myrtle: 'myrtle',
  selfheal: 'selfheal', seacarrot: 'seacarrot', thyme: 'thyme', watercress: 'watercress', juniper: 'juniper', clover: 'clover', yarrow: 'yarrow',
  sorrel: 'sorrel', cuckooflower: 'cuckooflower', bedstraw: 'bedstraw', heather: 'heather', elder: 'elderflower', rose: 'hips', bramble: 'blackberries',
  strawberry: 'strawberries', samphire: 'samphire', seabeet: 'seabeet', seakale: 'seakale', primrose: 'primrose', hawthorn: 'haws', hazel: 'hazelnuts', oak: 'acorns',
});

/** Made things (docs/future/13 sections 3.12 and 6.4) and the kit; '-' marks an existing icons.js icon. @type {ItemRow[]} */
export const MAKES = /** @type {[string, string, string, string, number][]} */ ([
  ['tent', '-pitch', 'Tent and bedroll', 'T1', 1], ['fire-ring', '-lay', 'Fire ring', 'T1', 1], ['fire-steel', 'fire-steel', 'Fire steel', 'T1', 1], ['lantern', 'lantern', 'Lantern', 'T1', 1],
  ['wood-store', 'wood-store', 'Wood store', 'T1', 2], ['stone-pile', 'stone-pile', 'Stone pile', 'T1', 2], ['clay-slab', 'clay-slab', 'Clay slab', 'T2', 2],
  ['workbench', 'workbench', 'Workbench', 'T2', 2], ['apothecary', 'apothecary', 'Apothecary bench', 'T2', 2], ['shovel', 'shovel', 'Shovel', 'T2', 2],
  ['hearth-stones', 'hearth-stones', 'Hearth stones', 'T2', 2], ['cooking-pot', 'cooking-pot', 'Cooking pot', 'T2', 2], ['tea-pot', 'tea-pot', 'Tea pot', 'T2', 2],
  ['cup', 'cup', 'Clay cup', 'T2', 2], ['bowl', 'bowl', 'Clay bowl', 'T2', 2], ['mortar', 'mortar', 'Mortar and pebble', 'T2', 2], ['drying-rack', 'drying-rack', 'Drying rack', 'T2', 2],
  ['satchel', 'satchel', 'Rush satchel', 'T2', 2], ['basket', 'basket', 'Willow basket', 'T2', 2], ['seed-balls', 'seed-balls', 'Seed balls', 'T2', 2], ['fill-pot', 'fill-pot', 'Fill the pot', 'T2', 2],
  ['keepers-blade', 'keepers-blade', "Keeper's blade", 'T2', 3], ['log-seat', 'log-seat', 'Log seat', 'T3', 3], ['driftwood-frame', 'driftwood-frame', 'Driftwood frame', 'T3', 3],
  ['clam-rake', 'clam-rake', 'Clam rake', 'T3', 3], ['net-stakes', 'net-stakes', 'Net stakes', 'T3', 3], ['mending-coil', 'mending-coil', 'Mending coil', 'T3', 3], ['gift-stone', 'gift-stone', 'Gift stone', 'T3', 3],
  ['dye-pot', 'dye-pot', 'Dye pot', 'T4', 4], ['clay-lamp', 'clay-lamp', 'Clay lamp', 'T4', 4], ['sealed-jar', 'sealed-jar', 'Sealed jar', 'T4', 4], ['candles', 'candles', 'Dipped candles', 'T4', 4],
  ['bird-bath', 'bird-bath', 'Bird-bath stone', 'T4', 4], ['bee-dish', 'bee-dish', 'Bee water dish', 'T4', 4], ['floats', 'floats', 'Driftwood floats', 'T4', 4],
  ['larger-pot', 'larger-pot', 'Larger pot', 'T5', 5], ['hedgehog-house', 'hedgehog-house', 'Hedgehog house', 'T5', 5], ['wind-chime', 'wind-chime', 'Shell wind chime', 'T5', 5],
  ['sinker-stones', 'sinker-stones', 'Grooved sinker stones', 'T6', 5],
  ...CAMP_ROWS,
]).map(row);

/** Treats and offerings (docs/future/13 section 8). @type {ItemRow[]} */
export const TREATS = /** @type {[string, string, string, string, number][]} */ ([
  ['wrack-heap', 'wrack-heap', 'Wrack heap (frogs)', 'T2', 2], ['leaf-pack', 'leaf-pack', 'Leaf pack (minnows)', 'T2', 2], ['dug-worms', 'worms', 'Worms (turtles, the robin)', 'T2', 3],
  ['pondweed-bundle', 'pondweed', 'Pondweed bundle (minnows)', 'T3', 3], ['lily-leaf', 'lily-leaf', 'Lily leaf (turtles)', 'T3', 3], ['perch-stick', 'perch-stick', 'Perch stick (dragonflies)', 'T3', 3],
  ['overripe-fruit', 'offered:strawberries', 'Overripe fruit (butterflies)', 'T4', 4], ['seed-cake', 'seed-cake', 'Seed cake (songbirds)', 'T5', 4],
  ['acorns-stump', 'offered:acorns', 'Acorns on a stump (the jay)', 'T5', 5], ['hazelnuts-stump', 'offered:hazelnuts', 'Hazelnuts in the shell (squirrels)', 'T5', 5],
  ['beetle-bait', 'beetle-bait', 'Beetle bait (hedgehogs)', 'T5', 5], ['chanterelle-branch', 'offered:chanterelle', 'Chanterelle on a branch (squirrels)', 'T5', 5],
  ['spraint-stone', 'spraint-stone', 'Spraint stone (otters)', 'T6', 5],
]).map(row);

/** Keepsake families (src/world/keepsakes/families, docs/future/12; sherd from docs/future/13 10.6.3). @type {ItemRow[]} */
export const KEEPSAKES = /** @type {[string, string, string, string, number][]} */ ([
  ['shell', 'shell', 'Shell', 'M2', 1], ['driftwood', 'keep-driftwood', 'Driftwood', 'M2', 1], ['stone', 'keep-stone', 'Stone', 'M2', 1], ['fossil', 'fossil', 'Fossil', 'M2', 1],
  ['feather', 'feather', 'Feather', 'M2', 1], ['bottle', 'bottle', 'Bottle', 'M2', 1], ['seedpod', 'drift-seed', 'Drift seed', 'M2', 1], ['starfish', 'starfish', 'Starfish', 'M2', 1],
  ['urchin', 'urchin', 'Urchin', 'M2', 1], ['purse', 'purse', "Mermaid's purse", 'M2', 1], ['bivalve', 'bivalve', 'Bivalve', 'M2', 1], ['coral', 'coral', 'Coral', 'M2', 1],
  ['cuttlebone', 'cuttlebone', 'Cuttlebone', 'M2', 1], ['artifact', 'artifact', 'Artifact', 'M2', 1], ['sherd', 'sherd', 'Sherd', 'T2', 3],
]).map(row);

/** The dyes (docs/future/13 section 9.2); the ids are items-made.js DYES'. @type {ItemRow[]} */
export const DYE_ROWS = DYES.map(([id, name]) => row([id, `dye-${id}`, name, id.startsWith('slip') ? 'T2' : 'T4', 4]));

const BY_ID = new Map([...POUCH_KINDS, ...PLANT_PARTS].map((r) => [r.id, r.icon]));
const MAKE_BY_ID = new Map(MAKES.map((r) => [r.id, r.icon]));
const TREAT_BY_ID = new Map(TREATS.map((r) => [r.id, r.icon]));
const KEEP_BY_ID = new Map(KEEPSAKES.map((r) => [r.id, r.icon]));

/** A species id in either spelling, as this registry keys it. @param {string} sp */
const species = (sp) => /** @type {Record<string, string>} */ (SPECIES_ALIAS)[sp] ?? sp;

/** The drawing a species' seeds and clumps are built on. @param {string} sp */
function speciesBase(sp) {
  const s = species(sp);
  return /** @type {Record<string, string>} */ (SPECIES_BASE)[s] ?? (ICON_NAMES.includes(s) ? s : 'seedhead');
}

/**
 * The glyph for a pouch kind or plant part: 'sticks', 'mint.leaves', 'watermint.leaves',
 * 'thrift.seed', 'willow.clump'. An unknown kind gets the plain seed head for a seed and null
 * otherwise, so a caller can fall back to its own drawing.
 * @param {string} kind @returns {string | null}
 */
export function itemIconFor(kind) {
  const direct = BY_ID.get(kind);
  if (direct) return direct;
  const dotAt = kind.lastIndexOf('.');
  if (dotAt < 0) return null;
  const sp = kind.slice(0, dotAt), part = kind.slice(dotAt + 1);
  if (part === 'seed') return `seed:${speciesBase(sp)}`;
  if (part === 'clump') return `clump:${speciesBase(sp)}`;
  return BY_ID.get(`${species(sp)}.${part}`) ?? null;
}

/** The glyph for a herb's dried bunch on the rack (docs/future/13 7.7). @param {string} kind */
export function driedIconFor(kind) {
  const icon = itemIconFor(kind);
  return icon && !icon.includes(':') ? `dried:${icon}` : icon;
}

/** The glyph for a kind set out as a treat: its own treat glyph if it has one, else the kind on the offering stone. @param {string} kind */
export function offeredIconFor(kind) {
  const treat = TREAT_BY_ID.get(kind);
  if (treat) return treat;
  const icon = itemIconFor(kind);
  return icon && !icon.includes(':') ? `offered:${icon}` : icon;
}

/** The glyph for a made thing or a treat by its id ('tea-pot', 'leaf-pack'); '-name' is an icons.js icon. @param {string} id */
export const makeIcon = (id) => MAKE_BY_ID.get(id) ?? TREAT_BY_ID.get(id) ?? null;
/** The glyph for a keepsake family ('fossil', 'seedpod'). @param {string} family */
export const keepsakeIcon = (family) => KEEP_BY_ID.get(family) ?? null;
/** The glyph for a dye colour ('woad-blue'). @param {string} id */
export const dyeIcon = (id) => (DYES.some(([d]) => d === id) ? `dye-${id}` : null);
