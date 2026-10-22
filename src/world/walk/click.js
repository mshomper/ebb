// @ts-check
// One click walks and uses (Matt, October 22, 2026; the Look button is retired). What a click below
// does depends on what it lands on, read from the card the journal would show there (cardAt):
//   thing       a plant, a find, a keepsake, a log or stone, a net, a pile: walk to it, then its card;
//   creature    a frog, a school, a swarm: its card where you stand, never walking up to it (so a
//               click never startles); further than creatureCardM, walk until that close;
//   everywhere  grass, rushes, sand, shingle, the strandline: with something to gather, its card
//               within nearLookM of you; plain, only right at your feet (thingReachM); else the
//               click just walks there;
//   none        plain walking.
// Pure: no store, no DOM. The app does the walking and the opening (src/app.js).

/** @typedef {'thing' | 'creature' | 'everywhere' | 'none'} ClickKind */
/** @typedef {{ kind: 'walk' } | { kind: 'card' } | { kind: 'approach', reachM: number }} ClickPlan */

/**
 * What kind of thing a card is about.
 * @param {any} card from cardAt, or null
 * @param {Record<string, any>} species words.species (the journal's words)
 * @returns {ClickKind}
 */
export function clickKind(card, species) {
  if (!card) return 'none';
  if (card.ground) return 'everywhere';
  const k = species?.[card.sp]?.kind;
  if (k === 'cover') return 'everywhere';
  if (k === 'creature' || k === 'school' || k === 'swarm' || card.sp === 'frogs') return 'creature';
  return 'thing';
}

/**
 * What one click does, given what it landed on and how far it is from you.
 * @param {ClickKind} kind @param {number} distM from you to the card's spot (wx, wz)
 * @param {number} ringM the card's own ring (how big the thing is)
 * @param {{ thingReachM: number, creatureCardM: number, nearLookM: number }} R recipes/world/walker.json click
 * @param {boolean} [gathers] the ground holds something to gather (its card has Gather): then it
 *   opens within nearLookM; plain grass or sand only right at your feet, so short walks stay walks
 * @returns {ClickPlan}
 */
export function clickPlan(kind, distM, ringM, R, gathers = false) {
  if (kind === 'thing') {
    const reachM = R.thingReachM + Math.max(0, ringM);
    return distM <= reachM ? { kind: 'card' } : { kind: 'approach', reachM };
  }
  if (kind === 'creature') return distM <= R.creatureCardM ? { kind: 'card' } : { kind: 'approach', reachM: R.creatureCardM * 0.9 };
  if (kind === 'everywhere') return distM <= (gathers ? R.nearLookM : R.thingReachM) ? { kind: 'card' } : { kind: 'walk' };
  return { kind: 'walk' };
}
