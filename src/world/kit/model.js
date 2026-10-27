// @ts-check
// The walker's kit, pure (the Walker page, K1; Matt, October 26, 2026). What the walker wears and
// holds in five slots, and what is owned for each:
//   hat       the walker's own hat now; dyed ones in Phase 4, Hollow hats later
//   lantern   the hand lantern (carried off the pad after dark) or none (it stays on the tent pole)
//   hand      what is in hand: the hazel walking stick once the forager's trail gives it, or nothing
//   coat      the walker's own coat now; dyed ones in Phase 4, Hollow coats later
//   carrier   the carrier on the back: null is the starting pack, or a made one (P2f: satchel, basket)
// Owned things live with the kit, never in a pouch. The save's `kit` section:
//   { version, hat, lantern, hand, coat, carrier, owned: { hat, lantern, hand, coat, carrier } }
// A save without it reads as the walker's own things (as the sketchbook section did). P2f's carrier
// choice lives here: the pack keeps using its own copy for its pouch rules (src/world/pack/model.js),
// the save keeps the kit's (joinCarriers on load, packForSave on save), so carriers behave as before.

/** The four kit slots down the page's left, in order; the carrier is the strap above the pouches. */
export const SLOTS = /** @type {const} */ (['hat', 'lantern', 'hand', 'coat']);
/** Every slot the kit keeps. */
export const ALL = /** @type {const} */ ([...SLOTS, 'carrier']);

/** @typedef {typeof ALL[number]} Slot */
/**
 * @typedef {{ version: 1, hat: string, lantern: string | null, hand: string | null, coat: string, carrier: string | null,
 *   owned: Record<Slot, string[]> }} Kit
 *   hat and coat are always worn (one choice each until Phase 4); lantern and hand may be empty; carrier null: the starting pack
 */

/** What the walker owns from the start, and always keeps. @type {Record<Slot, string[]>} */
const OWN = { hat: ['own'], lantern: ['hand'], hand: [], coat: ['own'], carrier: [] };

/** A new walker's kit: their own hat, coat and hand lantern, the starting pack. @returns {Kit} */
export const emptyKit = () => ({ version: 1, hat: 'own', lantern: 'hand', hand: null, coat: 'own', carrier: null,
  owned: { hat: ['own'], lantern: ['hand'], hand: [], coat: ['own'], carrier: [] } });

/** Strings, each once, in order. @param {any} a @returns {string[]} */
const ids = (a) => (Array.isArray(a) ? a.filter((v, i) => typeof v === 'string' && a.indexOf(v) === i) : []);

/**
 * A saved kit section made safe. Missing or unreadable: the walker's own things. What is always owned
 * comes back owned; a worn thing that is not owned falls back (hat and coat to their own, the rest to none).
 * @param {any} v @returns {Kit}
 */
export function cleanKit(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return emptyKit();
  const o = v.owned && typeof v.owned === 'object' ? v.owned : {};
  /** @type {Record<Slot, string[]>} */ const owned = /** @type {any} */ ({});
  for (const s of ALL) owned[s] = [...OWN[s], ...ids(o[s]).filter((id) => !OWN[s].includes(id))];
  const pick = (/** @type {Slot} */ s, /** @type {string | null} */ d) => (typeof v[s] === 'string' && owned[s].includes(v[s]) ? v[s] : d);
  return { version: 1, hat: /** @type {string} */ (pick('hat', 'own')), lantern: v.lantern === null ? null : pick('lantern', 'hand'),
    hand: pick('hand', null), coat: /** @type {string} */ (pick('coat', 'own')), carrier: pick('carrier', null), owned };
}

/** Is this owned for the slot? @param {Kit} k @param {Slot} slot @param {string | null} id */
export const owns = (k, slot, id) => id === null ? slot === 'lantern' || slot === 'hand' || slot === 'carrier' : k.owned[slot].includes(id);

/**
 * Something new owned (a gift, a made carrier), added once, last. @param {Kit} k @param {Slot} slot
 * @param {string} id @returns {Kit}
 */
export function own(k, slot, id) {
  if (k.owned[slot].includes(id)) return k;
  return { ...k, owned: { ...k.owned, [slot]: [...k.owned[slot], id] } };
}

/**
 * Wear something owned in a slot (null: nothing, where a slot may be empty). ok: worn now.
 * @param {Kit} k @param {Slot} slot @param {string | null} id @returns {{ kit: Kit, ok: boolean }}
 */
export function wearKit(k, slot, id) {
  if (!owns(k, slot, id)) return { kit: k, ok: false };
  return { kit: { ...k, [slot]: id }, ok: true };
}

/**
 * The carriers as the kit and the pack each keep them, made one: every carrier either knows is
 * owned (the pack's first, then the kit's), and the one worn is the pack's (a save from before the
 * kit kept it there) or else the kit's. Both come back agreeing; neither input is changed.
 * @param {Kit} kit @param {import('../pack/model.js').Pack} pack
 * @returns {{ kit: Kit, pack: import('../pack/model.js').Pack }}
 */
export function joinCarriers(kit, pack) {
  const made = [...pack.carriers, ...kit.owned.carrier.filter((c) => !pack.carriers.includes(c))];
  const worn = pack.worn && made.includes(pack.worn) ? pack.worn : kit.carrier && made.includes(kit.carrier) ? kit.carrier : null;
  const nextPack = { ...pack, carriers: made };
  if (worn) nextPack.worn = worn; else delete nextPack.worn;
  return { kit: { ...kit, carrier: worn, owned: { ...kit.owned, carrier: made } }, pack: nextPack };
}

/**
 * The pack as the save keeps it: its carriers are the kit's to keep. @param {import('../pack/model.js').Pack} pack
 * @returns {import('../pack/model.js').Pack}
 */
export function packForSave(pack) {
  if (!pack || typeof pack !== 'object') return pack;
  const out = { ...pack, carriers: [] };
  delete out.worn;
  return out;
}
