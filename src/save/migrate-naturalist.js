// @ts-check
// Save format 2 to 3 (docs/future/11, doc 13): the naturalist's notes. Before format 3 shells
// washed up from the start; now they are the first reward, at three kinds of finds. An island
// saved before keeps everything it had: if it found shells already, or has found three kinds,
// shells are given as earned, quietly (the unlocks note them as given, so no card shows on load).
// A frog group already happy keeps its gift the same way. Pure and deterministic. The numbers are
// the ones format 3 shipped with, written here so a later retune never changes an old upgrade.

/** The finds there were when format 3 began, and the mark that gives shells. */
const FINDS_V3 = ['anemone', 'periwinkle', 'lugworm', 'hermitcrab', 'ediblecrab', 'shells'];
const SHELLS_AT = 3;
/** The species gifts there were: the frogs' lilies (frog.json). */
const GIFTS_V3 = { frogs: 'lilies' };

/**
 * The step itself: sections in, sections out (copies; the input is not changed).
 * @param {Record<string, any>} sections
 */
export function naturalist3(sections) {
  const s = structuredClone(sections);
  const sp = s.journal?.species ?? {};
  const flags = s.journal?.flags ?? [];
  const u = s.unlocks && typeof s.unlocks === 'object' ? s.unlocks : {};
  const found = FINDS_V3.filter((id) => sp[id]?.ever);
  const naturalist = Array.isArray(u.naturalist) ? u.naturalist.slice() : [];
  if ((found.includes('shells') || found.length >= SHELLS_AT) && !naturalist.includes('shells')) {
    naturalist.push('shells');
    u.shells = true;
  }
  if (naturalist.length) u.naturalist = naturalist;
  for (const [species, plant] of Object.entries(GIFTS_V3)) {
    if (!flags.includes(`${species}:happy`) || u.gifts?.[species]) continue;
    u.gifts = { ...(u.gifts ?? {}), [species]: true };
    u.seeds = { ...(u.seeds ?? {}), [plant]: true };
  }
  s.unlocks = u;
  return s;
}
