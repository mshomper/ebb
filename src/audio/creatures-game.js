// @ts-check
// The animals' sounds in the game (doc 17 "Procedural creature voices", doc 25 "Creature voices"):
// the frog agents decide who calls and when (src/world/creatures/agents.js, with the 0.4 s
// answering rule and the hush near a startle, doc 23), and this only listens. A few dozen times a
// second it reads the calls and plops the frogs made since it last looked, and the minnows' rises
// to the surface, and plays each one where it happened, a moment ahead on the audio clock; ten
// times a second it moves the ears and tells the midge voices where the swarms are and the wing
// voices where the dragonflies fly. Reads the store slice `creatureSound` (src/app.js).
// Numbers: recipes/audio/game.json `frogs` and `pond`.

/**
 * @param {import('./mixer.js').Mixer} mixer
 * @param {ReturnType<typeof import('./voices.js').createVoices>} voices
 * @param {{ get: (slice: string) => any }} store
 * @param {any} recipe recipes/audio/game.json `frogs`
 * @param {any} [pond] recipes/audio/game.json `pond`: which school species sip and which have wings
 */
export function createCreatureSound(mixer, voices, store, recipe, pond) {
  const R = recipe;
  /** Frog time last read up to; null until the first look, so nothing from before plays. @type {number | null} */
  let since = null;
  /** The last plop played, by its number. */
  let lastPlop = -1;
  /** The last rise played, by species, by its number; absent until the first look at that species. @type {Map<string, number>} */
  const lastRise = new Map();
  /** Where the ears are, and when (performance.now) a frog last called close to them. */
  let eye = [0, 10, 0];
  let nearCallAt = -Infinity;
  const lo = R.intensityFromMood[0], hi = R.intensityFromMood[1];

  /** Play what the frogs did since the last look. */
  function poll() {
    const feed = store.get('creatureSound');
    if (feed?.schools && pond) pollRises(feed.schools());
    if (!feed?.frogs) return;
    const heard = feed.frogs(since ?? Infinity);
    const first = since === null;
    since = heard.now;
    const newest = heard.plops.length ? heard.plops[heard.plops.length - 1].n : lastPlop;
    const fromPlop = lastPlop;
    lastPlop = Math.max(lastPlop, newest);
    // Before the first touch nothing can sound; let those go rather than pile them up.
    if (first || mixer.ctx.state !== 'running') return;
    const t0 = mixer.ctx.currentTime;
    for (const c of heard.calls) {
      const age = heard.now - c.t;
      if (age > R.staleS) continue;
      const mood = Math.max(0, Math.min(1, c.mood));
      voices.call(c.id, 'frog', c.pos, lo + (hi - lo) * mood, t0 + Math.max(0, R.leadS - age));
      if (Math.hypot(c.pos[0] - eye[0], c.pos[1] - eye[1], c.pos[2] - eye[2]) <= R.duckNearM) nearCallAt = performance.now();
    }
    for (const p of heard.plops) {
      if (p.n <= fromPlop) continue;
      const age = heard.now - p.t;
      if (age > R.staleS) continue;
      voices.plop(`plop:${p.n}`, p.pos, t0 + Math.max(0, R.leadS - age));
    }
  }

  /**
   * The minnows' rises to the surface since the last look: a sip at each ring; and a turtle sliding
   * into the water: a plop (pond.plops). As the frogs' plops: the first look plays nothing, nothing
   * plays before the first touch, and a late one is let go.
   * @param {{ species: string, now?: number, rises?: { n: number, t: number, pos: number[] }[] }[]} schools
   */
  function pollRises(schools) {
    const running = mixer.ctx.state === 'running';
    for (const s of schools) {
      const plops = (pond.plops ?? []).includes(s.species);
      if (!plops && !pond.sips.includes(s.species)) continue;
      const rises = s.rises ?? [];
      const first = !lastRise.has(s.species);
      const from = lastRise.get(s.species) ?? -1;
      lastRise.set(s.species, rises.length ? Math.max(from, rises[rises.length - 1].n) : from);
      if (first || !running) continue;
      const t0 = mixer.ctx.currentTime;
      for (const r of rises) {
        if (r.n <= from) continue;
        const age = (s.now ?? r.t) - r.t;
        if (age > pond.staleS) continue;
        if (plops) voices.plop(`${s.species}:${r.n}`, r.pos, t0 + Math.max(0, pond.leadS - age));
        else voices.sip(r.pos, t0 + Math.max(0, pond.leadS - age));
      }
    }
  }

  return {
    poll,
    /** A frog called within duckNearM of the ears in the last duckHoldS: the music dips (doc 24). */
    nearCall: () => performance.now() - nearCallAt < R.duckHoldS * 1000,
    /**
     * Ten times a second: the ears, the season, the midge swarms and the dragonflies on the wing.
     * @param {number[]} ears @param {number[]} forward @param {number[]} seasonBlend
     */
    update(ears, forward, seasonBlend) {
      eye = ears;
      voices.setListener(ears, forward);
      voices.setSeason(seasonBlend);
      const feed = store.get('creatureSound');
      voices.setSwarms(feed?.swarms ? feed.swarms() : []);
      if (!pond) return;
      /** @type {{ id: string, pos: number[], speed: number, flying: boolean }[]} */
      const flyers = [];
      for (const s of feed?.schools ? feed.schools() : []) {
        if (!pond.wings.includes(s.species)) continue;
        s.each.forEach((/** @type {number[]} */ e, /** @type {number} */ i) => flyers.push({ id: `${s.species}:${s.id}:${i}`, pos: [e[0], e[1], e[2]], speed: e[4] ?? 0, flying: e[3] > 0 }));
      }
      voices.setFlyers(flyers);
    },
  };
}
