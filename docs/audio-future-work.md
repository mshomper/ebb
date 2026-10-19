# Audio: decisions to reconcile, and future work

> A running list kept by the audio session (docs 17, 24, 25). It records decisions Matt made after the specs were written that the specs do not yet reflect, merge-time steps, and anything that could not be finished. Nothing here is lost: each item names what has to happen and when.

## Must be reconciled with the specs

These are Matt's decisions (October 19, 2026) that disagree with, or add to, the docs on main. Each must be written into the doc, and approved by Matt, before the work it affects is built.

| Decision | Disagrees with | What changes | Before |
|---|---|---|---|
| Summer mornings and middays get more lift and motion: a quicker tempo band and gently rhythmic mallet and guitar patterns. Summer evenings and nights stay still and restful. | Doc 24, "The four seasons": summer is "long warm days, stillness", tempo 58 to 72 BPM all day. | Doc 24's summer column: feeling, tempo band split by slot (morning and interlude higher, evening and nocturne as now), summer palette notes. Doc 25's summer soundscape (the island's warm stillness) is unaffected: the lift is in the music only. | Any summer music is written (phase 7) |
| One rare signature night piece per season, tied to something real on the island (for example the first full-moon spring tide night, or the first night the whole frog chorus sings). Heard at most once a season. | Not in doc 24. | Add to doc 24's "Special moments": trigger per season, chance, how it sits with the frog window, and its place in the anchor pool. | That season's anchors are written (phase 5 for spring) |
| Winter gets breadth for "lonely and majestic": wide open fifths across three octaves, slow low strings, the island theme in augmentation. | Doc 24 has the colors but not the emphasis. | A line in doc 24's winter column. | Winter music (phase 7) |
| Music and island sounds start together. | The brief's phase table runs the soundscape "in parallel from phase 1", which matches. | None. | n/a |

## Merge-time steps (kept out of the branch so it never conflicts with main)

The audio branches only add new files. These shared files are edited only when an audio branch merges, with Matt's approval:

- `recipes/index.json`: add the audio recipe ids, currently listed in `recipes/audio-index.json`, then retire that file.
- `recipes/species/frog.json` and `recipes/species/midge.json`: doc 25 puts their voice settings in the species recipes. Until the frog work (S6) settles, they live in `recipes/audio/voices/frog.json` and `recipes/audio/voices/midge.json`; move them in at merge.
- `tools/index.html`: link the music lab and the audio check page.
- `tools/unit-tests.html`: fold in the audio tests, which run on their own page (`tools/unit-tests-audio.html`) until then.
- `docs/README.md`: list docs 24 and 25.
- `docs/17-audio.md`: apply doc 25's "Proposed amendments to doc 17", and point here.

## Waiting on game systems that do not exist yet

Built and heard in the lab now; wired into the game when the system lands.

- Return reveal (`reveal:started`, `reveal:ended`): theme statement, bed fade-in order.
- Gifts (`progress:gifted`): the bloom chord and paper rustle.
- Photo mode (`photo:entered`, `photo:exited`): tool and UI mute, shutter.
- Time and season preview (`preview:started`, `preview:ended`): no new piece starts during a preview.
- Events the director needs that the game does not announce yet: `season:changed`, `weather:changed`, `creature:settled`, `creature:woke`, `creature:dormant`, `species:happy`. Until they exist, the director derives season and weather changes from the clock and weather state; the creature events are added as small hooks in phase 6.

## Soundscape first pass: what the game still has to supply (phase 6)

The ambience, voices and `tools/audio-check.html` run on a simulated island. To run in the game:

- The game passes the sound state each tenth of a second: `surfaceNear` (water, pads, reeds, grass near the camera, for the rain mix), `listener`, `eye` and `forward` (camera), `afterRain` (from the weather; the page uses a 120 s timer), wetness and frost under the brush.
- Frog voices follow the frog agents' call timeline (`calls()` in `src/world/creatures/agents.js`), so each call sounds as its throat swells.
- Still to build: distant visitors (the hook is in place, waiting on recordings), mist's extra reverb send (needs a small mixer hook), the few slow first calls after the frogs wake in spring, and the startle hush near the player (doc 23).
- `tools/index.html` gets links to the music lab, the audio check page and the sound picks page at merge.

## Waiting on other work

- Nylon guitar: the instrument slot is built empty; another session is searching for a sample set.
- Future species (songbirds, owls, herons and the rest): instruments, motifs and voices wait until each species is designed (doc 24, "The score grows with the island").

## Could not be finished here

### No clean CC0 recording found on Freesound (October 19, 2026)

From the shortlist search (`docs/audio-freesound-shortlist.md`, "Gaps"). Each needs a decision: a procedural stand-in, a fallback library under doc 25's rules, or a license exception Matt approves.

| Sound | What exists | Likely answer |
|---|---|---|
| Wind in reeds, all four seasons | Only Attribution or Noncommercial reed beds (best fit: YleArkisto 326445, Attribution) | The island's main voice, so the most important gap. Dry-grass stand-ins meanwhile; a free royalty-free bundle (Sonniss GDC) next; or allow Attribution for this one sound, with credit |
| Rain on open water | Nothing | Procedural sizzle and drops over a general light-rain take |
| Rain on dry grass (autumn crackle) | Nothing clean | Procedural crackle layered on a dry-grass take |
| Clean summer rain on grass | Only generic light-rain takes | Light rain, filtered |
| Seasonal air tone, rural and windless | Every rural night take has crickets, dogs or traffic | Procedural shaped noise (built) |
| Midge or gnat swarm reference | One indoor mosquito take | Tune the procedural hum by ear |
| Seed-head rattle | Only a hand-through-grass stand-in | Procedural rattle (built) |
| Aeolian stalk whistle | Three vintage film effects | Procedural whistle (built) |
| Frog swim kick, lily pad landing | Nothing specific | Procedural or soft foley stand-ins |

Freesound's search pages can't be read from the cloud workspace (robots rules), so the CC0 filter was applied by reading each sound page; a second pass by Matt in his browser, with the CC0 filter on, may find what web search missed.
