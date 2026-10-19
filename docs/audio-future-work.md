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

## Waiting on other work

- Nylon guitar: the instrument slot is built empty; another session is searching for a sample set.
- Future species (songbirds, owls, herons and the rest): instruments, motifs and voices wait until each species is designed (doc 24, "The score grows with the island").

## Could not be finished here

(None yet. Anything that cannot be sourced under CC0, or built in this session, is listed here with its fallback options under doc 25's rules.)
