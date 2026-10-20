// @ts-check
// The animals' sounds in the game (doc 17 "Procedural creature voices", doc 25 "Creature voices"):
// the frog agents decide who calls and when (src/world/creatures/agents.js, with the 0.4 s
// answering rule and the hush near a startle, doc 23), and this only listens. A few dozen times a
// second it reads the calls and plops the frogs made since it last looked and plays each one at
// the frog, a moment ahead on the audio clock; ten times a second it moves the ears and tells the
// midge voices where the swarms are. Reads the store slice `creatureSound` (src/app.js).
// Numbers: recipes/audio/game.json `frogs`.

/**
 * @param {import('./mixer.js').Mixer} mixer
 * @param {ReturnType<typeof import('./voices.js').createVoices>} voices
 * @param {{ get: (slice: string) => any }} store
 * @param {any} recipe recipes/audio/game.json `frogs`
 */
export function createCreatureSound(mixer, voices, store, recipe) {
  const R = recipe;
  /** Frog time last read up to; null until the first look, so nothing from before plays. @type {number | null} */
  let since = null;
  /** The last plop played, by its number. */
  let lastPlop = -1;
  const lo = R.intensityFromMood[0], hi = R.intensityFromMood[1];

  /** Play what the frogs did since the last look. */
  function poll() {
    const feed = store.get('creatureSound');
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
    }
    for (const p of heard.plops) {
      if (p.n <= fromPlop) continue;
      const age = heard.now - p.t;
      if (age > R.staleS) continue;
      voices.plop(`plop:${p.n}`, p.pos, t0 + Math.max(0, R.leadS - age));
    }
  }

  return {
    poll,
    /**
     * Ten times a second: the ears, the season, and the midge swarms.
     * @param {number[]} eye @param {number[]} forward @param {number[]} seasonBlend
     */
    update(eye, forward, seasonBlend) {
      voices.setListener(eye, forward);
      voices.setSeason(seasonBlend);
      const feed = store.get('creatureSound');
      voices.setSwarms(feed?.swarms ? feed.swarms() : []);
    },
  };
}
