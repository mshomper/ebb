# Audio: handoff to the next session

> Written at the end of the first audio session (October 19, 2026) so a fresh session can pick up without the old conversation. Read this first, then `CLAUDE.md`, `docs/audio-session-brief.md` (the phase plan), `docs/24-music.md` (music), `docs/25-soundscape-seasons.md` (soundscape) and `docs/audio-future-work.md` (open decisions and merge-time steps).

## Where things stand

Everything below is merged to main: phase 1 in PR #27, phases 2 and 3 in PR #32.

| Phase (brief) | State | What exists |
|---|---|---|
| 0. Plan | Done | The phase plan in `docs/audio-session-brief.md`. |
| 1. Mixer and piano | Done, merged | Mixer, reverb, sampler, Steinway B game set with the Knight's pedal sound, FM piano in code, the instrument bench. |
| 2. Score engine | Done, merged | Score reader, realizer, director, the left-hand textures, Piece and Day tabs, notation and piano roll, pad and bell, the phone piano set. |
| 3. Island theme | Done, merged | Four tides, each set in all four seasons (16 settings of at most 40 s), the support layers, the support kit, the Themes tab, composer names. |
| 4. Development engine | Not started | Next music phase. |
| 5. Spring | Not started | Anchors built on the tides. |
| 6. In the game | Not started | Game hooks, settings, merge-time shared-file edits. |
| 7. Summer, autumn, winter | Not started | |
| Soundscape track (doc 25) | First pass built, waiting on recordings | Procedural sounds, ambience, frog and midge voices, the audio check page. The beds wait on Matt's Freesound picks. |

Preview pages: `https://mshomper.github.io/ebb/tools/music-lab.html` (tabs Instruments, Piece, Day, Themes), `tools/audio-check.html` (island sounds), `tools/freesound-shortlist.html` (sound picks), `tools/unit-tests-audio.html` (106 tests). Branch previews live at `https://mshomper.github.io/ebb/preview/<branch>/...`.

## Update: second session (October 20, 2026)

Read this section first; the rest of the document is the October 19 state and still holds where this section doesn't change it.

### Pull requests, in merge order

All four merge cleanly with main and with each other. None touches shared files.

| PR | Branch | What |
|---|---|---|
| #33 | `audio-handoff` | This document and `tools/audio-prep/` (the sample prep scripts) |
| #52 | `m2-audio-fixes` | The bass floor raised to B1 (62 Hz, doc 24's 60 Hz floor); the future-work notes |
| #51 | `m2-soundscape-beds` | Recorded beds from Matt's Freesound picks: 15 layers, 27 takes, 8.3 MB of Opus, credits, `@layer/name` takes in `takes.json`, the bed prep scripts in `tools/audio-prep/beds/` |
| #49 | `m2-music-develop` | Development engine step 4a (harmony), the lab's Engine tab, `docs/audio-develop-plan.md` |

### Where things stand now

| Track | State |
|---|---|
| Phase 4, development engine | **4a done** (harmony), and Matt approved it by ear. **4b (melody) is next.** Then 4c (the full critic in a worker), 4d (the note-job overlay and Keep), and 4e (the material editor). The plan is `docs/audio-develop-plan.md`. |
| Soundscape beds | Done and waiting for Matt's listen: every bed that had a pick plays a recording. Previews are in the audio check page. |
| Phone sets for the support kit | **Tabled by Matt** ("not focused on the phone at the moment"). |
| Solo cello | Two candidates found; Matt is happy with them, and no audition is built yet. Karoryfer x bigcat Cello (CC0, arco in 4 layers, every minor third, no vibrato) is the first choice. University of Iowa Cello 2012 (free to use without restrictions, every semitone, 3 dynamics) is the second. Check Karoryfer's own page once to confirm CC0 before shipping. |
| Desktop memory | Matt accepts that a piano piece plus a string bed may briefly pass 128 MB. No change. |

### Matt's decisions on October 20 (in the code and recipes; doc 24 to be updated when the engine merges)

- **Length:** grown pieces about half again as long, not double. Templates bring phrases back: a return keeps its source's first bars, then goes its own way to a different cadence. Matt hears returns "like a coda" and likes it. Song averages about 86 s.
- **Rain and mist** templates are 10 percent slower.
- **Endings:** seven ways to close, all approved: amen, borrowed minor iv, flat seven then home, ii to an open I, turn away then home, hold the last chord, and flat six, flat seven, home. The ending seldom repeats the last cadence's kind.
- **Colors Matt likes:**
  - Inversions, and chords that leave the base progression: the borrowed minor iv (the Gm over D ending), the flat six (B-flat maj7 to C to D).
  - The "seconds" chords D2 and G2 (written Dsus2, Gsus2 in the recipes; the lab shows D2).
  - Slow arpeggios, now about a third of the left hand.
- **D2 and G2 rock back and forth:** one chord a bar, or two beats each in 4/4, never two hits of one chord running. Held chords sound on through the bar rather than being struck again.
- **Step 4b requirements from Matt:**
  - **A melody is layered on top about half the time.** The rest stays harmony with the left hand and bed.
  - Distinct melodies can layer back and forth over the D2 and G2 rocking.

### Working notes

- Branch previews are at `https://mshomper.github.io/ebb/preview/<branch>/`. The Engine tab is at `tools/music-lab.html#engine`.
- **Offline WAV render of a grown piece:** a page that grows a seed in the browser, realizes it and renders it through the real instruments with an OfflineAudioContext, then saves 16-bit WAV through Playwright.
  - It works like `tools/audio-prep/render/`, but calls `grow()` first.
  - It isn't committed. Rebuild it from `render/index.html` by adding `grow(material, rules, {slot, weather, seed}, names)` before `realize`.
- **Checks:**
  - `node tools/run-audio-tests.mjs`: 112 tests on the engine branch.
  - `npx -y tsc -p jsconfig.json --noEmit`.
  - Playwright at 390 and 1280 px.

## Matt's decisions so far (all written into doc 24 and approved)

- **Piano:** Steinway B, gentle stretch tuning, blend width 20 with curve 0.5 (mix), key-off -25 dB, the Knight pedal sound on at -20 dB, dampers 0.35 s (bass) to 0.06 s (treble). Game set: 4 s tails, mono below C3, middle five octaves, pedal and no-pedal sets, 10.2 MB.
- **Phone piano:** 17 zones, two layers, mono, 2.5 s tails, no key-off sounds; 1.4 MB, 10 to 15 MB of memory per piece.
- **Levels:** music 0.5, music room 0.30 (headphone reference). Memory about 128 MB on desktop, 20 MB on phones, with per-piece unpacking.
- **Silence:** rests of 2 to 4 real minutes. The default measures about 62 percent silence (56 to 70) over three days.
- **Seasons:**
  - summer mornings and middays lift (70 to 84 BPM), while summer evenings and nights stay still;
  - winter is "lonely and majestic": wide open fifths over three octaves, slow low strings, the tides in augmentation;
  - one signature night per season: spring's first full frog chorus, summer's first full-moon high tide, autumn's first clear night after the reeds turn gold, winter's longest night.
- **Left hand:** mostly struck chords; flowing arpeggios in time, held to the chord change (slower toward night); occasional quick rolls close to the melody; choppy figures rare in this style but kept for other pieces. Matt's words: "most musicians inherently strike the notes together."
- **Style:** mellow, like the calm moments of Stardew Valley, with layered support (strings and pads under a simple lead). The mood references are for feeling only, with no quotation: spring "It's a Big World Outside", summer "Nature's Crescendo", autumn "The Smell of Mushroom", winter "The Wind Can Be Still".
- **The four tides:** all four candidates were kept, each with a home season:
  - First water: spring.
  - Moon pull: summer.
  - Sandbar: autumn.
  - Breath: winter.
  
  The home tide opens its season's first morning and plays the return reveal and the gift bloom. All sixteen settings also play as ordinary pieces at a lower weight.
- **Names:** the composer names the pieces it grows from swappable word lists (`recipes/music/names.json`), deterministic by seed, season and slot. Matt likes the current lists. Hearted pieces (play more often, saved in the island file) come after the vertical slice.
- **Sounds:** CC0 first. One credit-only (CC BY) reed-bed recording is allowed, since Freesound has no CC0 reed bed. No licensed source WAVs in the repo, and nothing loaded from a CDN at runtime.

## How to work with Matt (on top of CLAUDE.md)

- **Analyze, then propose, then build.** Keep proposals short and visual: an inline diagram beats a paragraph. Matt approves before code, except for direct "fix it now" requests.
- **Questions** go in a plain bullet list at the end of a message, in plain language, with no symbols or variable names. Never use the button-style question tool.
- **Deliverables** are downloadable files: Markdown for information, self-contained HTML for interactive pages. Send recordings (WAV) whenever something should be heard: Matt reviews by ear, and a number is not a substitute.
- **Branches:** work on a branch and open a PR with a click-test list. Never merge or push to main without Matt's go-ahead. Matt merges on GitHub and pulls in GitHub Desktop; write any local steps as GitHub Desktop actions.
- **Commits:** a Co-Authored-By trailer is fine. Never put claude.ai session links in commits or PR descriptions.
- **Audio branches only add or change audio files** (`src/audio`, `recipes/music`, `recipes/audio*`, `assets/audio`, `tools/music-lab`, `tools/audio-*`, the audio test pages, docs 24 and 25 and the `docs/audio-*` notes). Shared files (`src/ui/icons`, `recipes/index.json`, `src/core/store.js`, `tools/index.html` and the rest) wait for the merge-time steps in `docs/audio-future-work.md`, done only with Matt's approval.
- **Helpers:** split big jobs into small parallel helpers with precise briefs and review what they return; they must not edit shared files. Do the music and engine design yourself.
- Follow the banned-word rule in CLAUDE.md (two words never used in UI copy, docs or messages).

## Code map (music)

| File | What it does |
|---|---|
| `src/audio/mixer.js`, `reverb.js` | Buses, music bus tone (lowpass, chorus EQ), seeded convolution rooms, limiter, unlock, visibility fade. |
| `src/audio/music/sampler.js` (+ `sampler-math.js`) | Sampled instruments: nearest zone, layer crossfade, leveling (attack loudness, or the loop's steady level for held notes), velocity curve and filter, tuning policies (stretch or equal), dampers, pedal, key-off sounds, round robins, voice stealing, baked loops (`layer.loop`), envelope (`attackS`, `releaseS`), articulations, the phone set, per-piece unpacking (`filesFor`, `loadFiles`), memory trimming. |
| `src/audio/music/ensemble.js` | Several samplers played as one instrument, split by register (the string section). |
| `src/audio/music/instruments.js` | Builds every instrument by palette name: the piano, the code-built `fm-piano`, `pad` and `bell`, and the support kit from `recipes/music/roster.json`. Shares one memory budget across them. |
| `src/audio/music/synth.js` + `synth/` | FM piano, pad, bell, built in code. |
| `src/audio/music/score.js`, `chords.js` | The ABC notation subset (480 ticks per quarter) and chord symbols. |
| `src/audio/music/voicing.js` | Voice-leading search for chord voicings (styles open, warm, sparse, low). |
| `src/audio/music/realize.js` | Turns a piece and a seed into a performance: form, key, melody octave, instruments, textures, layers, tempo map with rubato and fermatas, humanizing (one timing wiggle per hand per chord), legato pedaling, and the assembled notation for display. |
| `src/audio/music/texture.js` | The left-hand textures and how each phrase chooses them. |
| `src/audio/music/layers.js` | The bed (warm three voices under the melody, or open fifths; out, in, swell, steady, thin; common tones held over) and the cadence touches. |
| `src/audio/music/perform.js` | Plays a performance on the audio clock (150 ms look-ahead), "finish gently" via the coda, playhead position. |
| `src/audio/music/director.js` | When music plays: slots by sun height, chances, rests, grace while resting, history and freshness, key drift, weather pools, the home tide on a season's first morning (`homeTide()` for the reveal and the bloom). |
| `src/audio/music/daycolor.js` | Day color: register, density, tempo, room and brightness blended by sun height, with the palette's keys. |
| `src/audio/music/names.js` | Composer names. |
| `recipes/music/` | `sampler.json` (defaults plus `byInstrument`), `roster.json`, `realize.json` (rubato, humanize, dynamics, pedal, textures, layers), `voicing.json`, `director.json` (slots, rests, frequency, history, day color, tides), `synth.json`, `names.json`, `seasons/spring.json`, `instruments/*.json`, `pieces/` (the test piece and `themes/`). |
| `tools/music-lab.html` + `tools/music-lab/` | The lab: Instruments (bench), Piece, Day (director simulator), Themes. `perform-ui.js` is shared by Piece and Themes. |
| `tools/music-render.html` + `tools/music-render/` | Renders a grown piece (season, slot, weather, seed, sun) offline through the music chain and downloads a finished WAV (trimmed, -18 LUFS, peaks under -1.5 dBFS). `finish.js` is tested in `tools/unit-tests-music-render.js`. |
| `tools/audio-prep/` | Offline scripts that built every sample set and the theme pieces, plus an offline render-to-WAV page. Read its README. |

Checks, which run fast in the cloud workspace:
- `node tools/run-audio-tests.mjs`: 106 tests.
- `npx -y tsc -p jsconfig.json --noEmit`: no errors in `src/audio` or `tools/`.
- Playwright Chromium for page checks: serve the repo with `python3 -m http.server 8731`, then check 390 and 1280 px for no console errors and no sideways scroll.
- Offline renders: `tools/audio-prep/render/`.

## What to do next, in order

### 1. Things waiting on Matt (ask early; they block other work)

- **Sound picks.** Matt was choosing recordings on `tools/freesound-shortlist.html` (110 candidates, `docs/audio-freesound-shortlist.md`). His downloads go to `C:\Users\mshom\Music\Ebb` on his computer.
  - When he's ready, link the session to his computer and request access to that folder.
  - Process the files into seasonal beds and `assets/audio/beds/takes.json`, and credit them (the CC BY reed bed listed separately).
  - This blocks the soundscape beds.
- **Solo cello.** Neither CC0 library has one; the autumn cello line uses the cello section. The options are in `docs/audio-future-work.md`.
- **Desktop memory.** A full piano piece plus a string bed can briefly pass 128 MB. Either accept it, or decode string notes in mono and shorten the soft layers' settling time.

### 2. Phone versions of the support kit (small, can start now)

No phone sets exist yet for strings, harp, flute, vibraphone or glass, so phones would unpack the desktop files.
- **Strings:** soft layer only, mono, core ranges (about 22 MB for all strings).
- **Harp and vibraphone:** mono, with shorter tails.

Add `mobile` blocks to the instrument recipes, the same way the piano has one; the sampler already swaps them in on phones. Measure each piece's memory against the 20 MB phone line with the tides as the test.

### 3. Phase 4: the development engine (doc 24, "The development engine")

`develop.js` in a worker (`src/core/workers.js`):
- a form template, a harmony walk over the season's chord grammar, motif development (sequence, inversion, augmentation, fragmentation and so on), accompaniment by the same voicing search, and a critic choosing among 24 candidates;
- **material:** the spring motif bank should include fragments of the four tides (Matt's wish: grown pieces should feel related to them);
- **names:** grown pieces get composer names (`names.js`) and must regenerate exactly from seed, season and slot, so hearted pieces work later;
- **lab:** an engine panel with sliders, a note-job overlay, Keep, and a material editor.

This is Matt's phase as much as yours: he tunes the rules by ear until grown seeds sound composed. Start with a short visual plan.

### 4. Phase 5: spring

- **Anchors:** 5 in batches (morning 3, nocturne 2), built on the tides: full-length home-tide pieces for the first morning, plus others.
- **Stand-ins:** for the grown slots until the engine passes its gate (about 20 seeds per slot).
- **Spring's signature night:** the first full frog chorus.
- **Instruments:** kalimba, plus clarinet when frogs settle (doc 24, "The score grows").
- **Review:** each batch bar by bar.

### 5. Phase 6: in the game

The director runs live on a branch. Settings: music volume and music frequency (Often, Now and then, Rarely, Off). Also:
- the reveal plays the home tide;
- the gift bloom;
- frog window silence;
- ducking near calling frogs;
- the hands-off hour (doc 24's acceptance checks).

The game must announce the events listed in `docs/audio-future-work.md`, and the merge-time shared-file edits happen here, with Matt's approval: `recipes/index.json`, the frog and midge voice recipes, `tools/index.html`, `unit-tests.html`, `docs/README.md`, doc 17's amendments and `store.js`.

### 6. Phase 7: summer, autumn, winter

Anchors and material for each season, with its instruments and season-edge blending. Summer's lift and winter's breadth are already specified.

## Known issues and loose ends

- **Nocturnes across dawn.** At 1x a piece of a few real minutes covers a few game hours, so a nocturne that starts late can run past dawn and push the morning back. The first morning of a season waits up to five game hours; ordinary mornings may be skipped. Consider the slot's close when choosing a nocturne's length or short form.
- **Low bass.** The voicing allows the bass down to A1 (55 Hz), below doc 24's "no sub-bass below 60 Hz". Raise the bass range floor to B1 (MIDI 35) or add a 60 Hz high-pass on the music bus.
- **Long notation titles** are clipped on phones (the Themes tab hides the title; the Piece tab would clip a long one).
- **The phone set's first audition** has not been done on a phone.
- **Thin recordings:**
  - bowed vibraphone has only six notes, so a note can be up to 3.5 semitones from its recording;
  - harp tails are capped at 4 s while low notes still ring;
  - the glasses are untuned household glasses placed at their nearest notes.
- **Soft strings** take 1 to 4.6 s to settle before their loop. Leveling now uses the steady level (`loopRmsDb`); if soft beds still feel slow to arrive, shorten the attack or start soft notes later into the file.
- **Doc 24's original instrument table** lists clarinet, kalimba, marimba, glockenspiel and a nylon guitar. These aren't prepared yet (another session is searching for a guitar).
