// @ts-check
// Kit tests (the Walker page, K1): a new walker wears their own things; an older save with no kit
// reads the same; wearing only what is owned; the carriers made one between the kit and the pack
// (a save from before the kit, and one after); the pack's save section leaves its carriers to the
// kit; the section round trip; and the recipe names every slot, item and belt tool with a drawn icon.

import { emptyKit, cleanKit, own, wearKit, joinCarriers, packForSave, looksOf, SLOTS, ALL } from '../src/world/kit/model.js';
import { clean9, empty9, SECTIONS9 } from '../src/save/migrate-format9.js';
import { cleanPack, emptyPack } from '../src/world/pack/model.js';
import { ICON_NAMES } from '../src/ui/icons/icons.js';
import { hasItemIcon } from '../src/ui/icons/items.js';
import { staffLook } from '../src/world/kit/staff.js';

const G = 'kit';
const js = (/** @type {any} */ v) => JSON.stringify(v);

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addKitTests(test, assert, eq) {
  test(G, 'the driftwood staff (C2): each island draws one of its two looks from the seed, the same every time, both drawn across islands; 1.0 m, models on disk', async () => {
    const SR = await (await fetch('../recipes/world/staff.json')).json();
    eq(SR.lengthM, 1.0, 'one meter long');
    assert(SR.gripM > 0 && SR.gripM < SR.lengthM, 'held along its length');
    const seen = new Set();
    for (let seed = 1; seed <= 40; seed++) {
      eq(staffLook(seed, SR).id, staffLook(seed, SR).id, `seed ${seed} draws the same twice`);
      seen.add(staffLook(seed, SR).id);
    }
    eq([...seen].sort().join(), SR.looks.map((/** @type {any} */ l) => l.id).sort().join(), 'both looks drawn');
    for (const l of SR.looks) assert((await fetch(`../${l.model}`, { method: 'HEAD' })).ok, `${l.model} is there`);
    return [...seen].join(' and ');
  });

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

  test(G, 'hat and coat looks for Phase 4: as made for the walker\'s own, a tint once a dyed one is worn', () => {
    const R = { figure: { hat: { own: null, woad: [0.2, 0.3, 0.5] }, coat: { own: null } } };
    eq(js(looksOf(emptyKit(), R)), js({ hat: null, coat: null }), 'the walker\'s own: as made');
    const dyed = wearKit(own(emptyKit(), 'hat', 'woad'), 'hat', 'woad').kit;
    eq(js(looksOf(dyed, R).hat), js([0.2, 0.3, 0.5]), 'a dyed hat tints the hat');
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
    eq(R.belt.map((/** @type {any} */ t) => t.id).join(), 'shovel,knife,steel,sketchbook,net,line', 'the belt in order');
    for (const t of R.belt) assert(drawn(t.icon), `belt ${t.id}'s icon ${t.icon} is drawn`);
    for (const n of ['hat', 'coat', 'pack']) assert(hasItemIcon(n), `the ${n} glyph is in the item family`);
    assert(ICON_NAMES.includes('walker'), 'the walker button is drawn');
  });
}
