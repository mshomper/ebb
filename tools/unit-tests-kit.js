// @ts-check
// Kit tests (the Walker page, K1): a new walker wears their own things; an older save with no kit
// reads the same; wearing only what is owned; the carriers made one between the kit and the pack
// (a save from before the kit, and one after); the pack's save section leaves its carriers to the
// kit; the section round trip; and the recipe names every slot, item and belt tool with a drawn icon.

import { emptyKit, cleanKit, own, wearKit, joinCarriers, packForSave, SLOTS, ALL } from '../src/world/kit/model.js';
import { clean9, empty9, SECTIONS9 } from '../src/save/migrate-format9.js';
import { cleanPack, emptyPack } from '../src/world/pack/model.js';
import { ICON_NAMES } from '../src/ui/icons/icons.js';
import { hasItemIcon } from '../src/ui/icons/items.js';

const G = 'kit';
const js = (/** @type {any} */ v) => JSON.stringify(v);

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addKitTests(test, assert, eq) {
  test(G, "a new walker wears their own hat, coat and hand lantern; an older save reads the same", () => {
    const k = emptyKit();
    eq(js([k.hat, k.lantern, k.hand, k.coat, k.carrier]), js(['own', 'hand', null, 'own', null]));
    eq(js(SLOTS), js(['hat', 'lantern', 'hand', 'coat']), 'four slots down the left');
    for (const bad of [undefined, null, 7, [], 'x']) eq(js(cleanKit(bad)), js(emptyKit()), `unreadable ${js(bad)}: the walker's own things`);
    assert(SECTIONS9.includes('kit'), 'written with the camp sections');
    eq(js(clean9('kit', undefined)), js(emptyKit()), 'missing: the walker\'s own things');
    eq(js(empty9('kit')), js(emptyKit()), 'a new island: the same');
  });

  test(G, 'only what is owned is worn; hat and coat always; lantern and hand may be empty', () => {
    let k = emptyKit();
    eq(wearKit(k, 'hand', 'stick').ok, false, 'no stick yet');
    k = own(k, 'hand', 'stick');
    eq(js(own(k, 'hand', 'stick').owned.hand), js(['stick']), 'owned once');
    let r = wearKit(k, 'hand', 'stick');
    assert(r.ok && r.kit.hand === 'stick', 'the stick in hand');
    r = wearKit(r.kit, 'lantern', null);
    assert(r.ok && r.kit.lantern === null, 'the lantern left on the pole');
    eq(wearKit(k, 'hat', null).ok, false, 'the hat stays on');
    eq(wearKit(k, 'coat', 'woad').ok, false, 'no dyed coat yet');
    const odd = cleanKit({ hat: 'crown', lantern: null, hand: 'stick', coat: 'own', carrier: 'basket',
      owned: { hat: [], lantern: [3], hand: ['stick', 'stick'], carrier: ['satchel'] } });
    eq(js([odd.hat, odd.lantern, odd.hand, odd.carrier]), js(['own', null, 'stick', null]), 'what is not owned falls back');
    eq(js(odd.owned), js({ hat: ['own'], lantern: ['hand'], hand: ['stick'], coat: ['own'], carrier: ['satchel'] }), 'the walker\'s own always kept');
  });

  test(G, 'the carriers made one: a save from before the kit, and one after', () => {
    // Before the kit: the pack held the carriers and the one worn.
    const oldPack = cleanPack({ version: 1, carriers: ['satchel', 'basket'], worn: 'basket', pouches: [['sticks', 3]], heaps: [], holding: null });
    let j = joinCarriers(cleanKit(undefined), oldPack);
    eq(js(j.kit.owned.carrier), js(['satchel', 'basket']), 'the kit owns them');
    eq(j.kit.carrier, 'basket', 'and wears the basket');
    eq(j.pack.worn, 'basket', 'the pack still wears it (its pouch rules)');
    // Saved now: the pack's section leaves them to the kit, and they come back.
    const saved = packForSave(j.pack);
    eq(js(saved.carriers), '[]', 'the pack section keeps no carriers');
    assert(!('worn' in saved), 'nor which is worn');
    eq(js(saved.pouches), js(j.pack.pouches), 'the pouches stay');
    j = joinCarriers(cleanKit(j.kit), cleanPack(saved));
    eq(js([j.pack.carriers, j.pack.worn, j.kit.carrier]), js([['satchel', 'basket'], 'basket', 'basket']), 'back from the kit');
    // The starting pack worn: nothing worn anywhere.
    j = joinCarriers(cleanKit({ ...emptyKit(), owned: { ...emptyKit().owned, carrier: ['satchel'] } }), emptyPack());
    assert(!('worn' in j.pack) && j.kit.carrier === null, 'the starting pack');
    eq(js(j.pack.carriers), js(['satchel']), 'the satchel hangs at camp');
  });

  test(G, 'the recipe names every slot, item and belt tool, each with a drawn icon', async () => {
    const R = await (await fetch(new URL('../recipes/world/kit.json', import.meta.url))).json();
    eq(js(R.slots), js(SLOTS), 'the slots in order');
    const drawn = (/** @type {string} */ n) => ICON_NAMES.includes(n) || hasItemIcon(n);
    for (const s of ALL) for (const [id, it] of Object.entries(R.items[s] ?? {})) {
      const t = /** @type {any} */ (it);
      assert(t.name && t.line, `${s} ${id} has a name and words`);
      assert(drawn(t.icon), `${s} ${id}'s icon ${t.icon} is drawn`);
    }
    for (const id of emptyKit().owned.hat) assert(R.items.hat[id], `the own hat ${id} has words`);
    for (const id of emptyKit().owned.coat) assert(R.items.coat[id], `the own coat ${id} has words`);
    eq(R.belt.map((/** @type {any} */ t) => t.id).join(), 'shovel,knife,steel,sketchbook,net', 'the belt in order');
    for (const t of R.belt) assert(drawn(t.icon), `belt ${t.id}'s icon ${t.icon} is drawn`);
    for (const n of ['hat', 'coat', 'pack']) assert(hasItemIcon(n), `the ${n} glyph is in the item family`);
    assert(ICON_NAMES.includes('walker'), 'the walker button is drawn');
  });
}
