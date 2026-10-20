# Session start: bringing the sounds and music into the game

> A start document for a fresh Claude Code session on Matt's desktop (written October 20, 2026). The audio so far lives in labs and test pages. This session wires it into the game itself: brief phase 6 ("In the game"), plus doc 17's first ambience pass, which M2 calls for. Read this whole page before touching code.

## 0. Before anything else

1. **Check the four audio pull requests are merged**, in this order: #33 (handoff and prep scripts), #52 (bass floor), #51 (recorded beds), #49 (development engine 4a). Then pull main. If any is still open, ask Matt; don't start on top of unmerged branches.
2. **Make a new branch from main**, for example `m2-audio-ingame`. Never push to main.
3. **Check the milestone:** doc 20 records the slice as signed off on October 20, 2026, and M2 as the current target. M2 includes "First audio pass: water bed, wind bed, frog voice with chorus (doc 17)", so this work is in scope.
4. **Git on Matt's side:** git isn't on his PowerShell path. Matt merges on GitHub and pulls with GitHub Desktop, so write any steps he takes himself as GitHub Desktop actions. If this session can't run git itself, say so at the start and agree on a way with Matt.

## 1. Read, in this order

| Read | Why |
|---|---|
| `CLAUDE.md` | The working rules: analyze, propose, then build; branches; UI rules; code conventions. |
| `docs/audio-handoff.md`, starting with its "Update: second session" section | Where audio stands, Matt's decisions, how he likes to work. |
| `docs/17-audio.md` | The mixer, buses, unlock, the 10 Hz sound state, voices. This is the integration spec. |
| `docs/25-soundscape-seasons.md`, then its "Proposed amendments to doc 17" | The seasonal soundscape and what it adds to the sound state. |
| `docs/24-music.md`: "The shape of a day", "Special moments", "Module API", "Acceptance checks" | What the music does in the game. |
| `docs/audio-future-work.md`: "Merge-time steps" and "Waiting on game systems" | Shared-file edits that need Matt's approval, and the game events that don't exist yet. |
| `docs/03-tech-stack-and-module-map.md` (audio row), `docs/23-presence.md` (the hush) | Who owns what; how creatures react to the player. |

## 2. What already exists

**Audio side.** All of it is built and tested, but runs only in the lab pages.

| Piece | File | Entry point |
|---|---|---|
| Mixer: buses, unlock, visibility fade, music bus tone | `src/audio/mixer.js` | `createMixer(recipe, opts)`, recipe `recipes/audio/mixer.json` |
| Ambience: beds (recorded, with made-in-code stand-ins), one-shots | `src/audio/ambience.js` (+ `ambience/`, `procedural/`) | `createAmbience(mixer, recipe, procRecipe, seed, opts)`, then `update(soundState)` at 10 Hz |
| Frog and midge voices | `src/audio/voices.js` (+ `voices/`) | `createVoices(mixer, voiceRecipes, seed, opts)` |
| Music director: decides what plays and when | `src/audio/music/director.js` | `createDirector(recipes, pieces, opts)`, then `update(state)`. It only decides and never plays. |
| Instruments and performer | `src/audio/music/instruments.js`, `perform.js` | `createInstruments(ctx, output)`, `createPerformer(ctx, instruments)` |
| Realizer, score, voicing, textures, layers | `src/audio/music/realize.js` and neighbors | `realize(piece, ctx, recipes)` |
| Development engine (harmony) | `src/audio/music/develop/` | `grow(material, rules, {slot, weather, seed}, names)` returns a piece file |
| Recorded beds | `assets/audio/beds/` + `takes.json` | Loaded by `src/audio/ambience/slot.js` |

**The two test pages show the wiring to copy:**
- `tools/audio-check/main.js` builds a sound state from a simulated island and drives the ambience and voices.
- `tools/music-lab/perform-ui.js` shows how instruments and the performer are made once and play a performance.

**Not built yet:**
- `src/audio/index.js` (the game's audio entry).
- `src/audio/music/index.js` (doc 24's module API: `init`, `update`, `setFrequency`, `stop`).
- Any call from the game into audio.

## 3. Where the game provides what audio needs

The game starts in `src/main.js`, then `src/app.js` (`startApp`). The frame loop is `frame()` in `src/app.js`, around line 657. Display time, season, sun and weather are all computed there each frame.

| Sound state field | Where the game has it |
|---|---|
| `hour`, `season`, `seasonPhase` | `clock.display()` and `clock.seasonOf(display)` (`src/core/clock.js`). Use display time so a time preview moves the sound. |
| sun height, sunrise and sunset | `day.sm.sunAlt` from `daylight.update(...)` in `frame()`. The game already emits `sky:sun-crossed` there, and the director needs it. |
| `weather`, `rain`, `mist`, `wind`, `gust` | `day.weather` in `frame()`, plus `weatherAt(world.state.weather, t, seasonsRecipe)` (`src/world/weather.js`); wind direction is in `world.state.weather.today.windDir`. |
| `tidePhase`, low tide | `src/world/tide.js` (`state(tHours, p)`, `level`, `moonPhase`). The moon cycle drives summer's signature night. |
| `listener`, `eye`, `forward`, `camHeight` | `camera.target`, `camera.eye` (`src/render/camera.js`, orbit camera made in `app.js`) |
| `waterNear`, `surfaceNear` (water, pads, reeds, grass) | The water world (`ww`, `water.sampleLive`) and flora around `camera.target`. Sample a few points within 12 m, not every frame. |
| `residents`, frogs calling | `src/world/creatures/agents.js`: `calls()` returns the recent calls (agent id and time), so each call sounds as the throat swells |
| `frost`, ground state under the tool | The season look (frost input) and the active tool (`src/ui/tools.js`) |
| `life` | No single value exists yet. Propose one, for example settled creatures and flora cover around the camera, and get Matt's approval |

**Events, from `src/core/events.js`:**

| Event | Exists? |
|---|---|
| `sky:sun-crossed` | Yes |
| `reveal:started`, `reveal:ended` | Yes |
| `clock:hour` | Yes |
| `creature:settled`, `creature:found`, `creature:arrived` | Yes |
| `world:caught-up` | Yes |
| `season:changed`, `weather:changed`, `creature:woke`, `creature:dormant`, `species:happy`, `progress:gifted`, `photo:entered`, `photo:exited`, `preview:started`, `preview:ended` | Not yet. The director can derive season and weather changes from the clock and weather state meanwhile. Add the creature ones as small hooks only with Matt's approval. |

**Settings:**
- `src/core/store.js` has `settings.audio` (`master`, `ambience`, `creatures`, `tools`, `ui`, `muteInBackground`), with no music level and no music frequency yet.
- `src/ui/settings.js` has a Sound section with one Volume slider and the hint "The island has no sounds yet."

## 4. Proposed shape, for Matt's approval before code

```
main.js ─ startApp ─ frame()                     src/audio/index.js (new)
   │  (each frame: clock, day, camera)              │  created on the first tap or key (unlock)
   └─ publishes a small 'sound' store slice ──────► │  every 0.1 s: build SoundState from the slice
      (or calls audio.update(state) at 10 Hz)       ├─► ambience.update(state)   beds + one-shots
                                                    ├─► voices.update(state)     frogs, midges
                                                    └─► music (src/audio/music/index.js, new)
events: sky:sun-crossed, reveal:*, creature:* ─────►      director.update at 2 Hz; realize; perform
settings.audio (store) ────────────────────────────► mixer levels; music volume and frequency
```

- **Audio stays out of the frame loop's critical path.** The frame publishes a few numbers; audio reads them at 10 Hz. Modules talk through events and the store (`CLAUDE.md`).
- **Loading:** after first paint and the first gesture. The piano and beds load after the ambience (doc 24's budget). The music unpacks per piece.
- **Determinism:** music and ambience use their own seeded streams (`src/core/rng.js`, system id `music`) and never touch the simulation's streams.

## 5. Order of work: small PRs, each with a gate Matt hears

| Step | Build | Matt checks |
|---|---|---|
| A | `src/audio/index.js`: the mixer on unlock, the visibility fade, the ambience beds and one-shots driven by the real sound state | The island sounds right as the camera moves: sea from high up, pond lap near water, reeds near reeds, the seasons changing |
| B | Frog and midge voices from the creature agents; the startle hush (doc 23) | Frogs call where they sit; the chorus at dusk |
| C | Settings: music volume, music frequency (Often, Now and then, Rarely, Off), the existing sliders wired | Each slider does what it says; Off is silent |
| D | Music live: `src/audio/music/index.js`, the director at 2 Hz, the frog window, ducking near calling frogs | The hands-off hour (doc 24, "Acceptance checks") |
| E | Special moments: the reveal plays the home tide; the gift bloom; time-preview behavior | The reveal after an absence; dragging the time dial |

A rough guide is one PR per step, each with a plain-language click-test list.

**Shared files need Matt's approval each time:**
- `src/app.js` and `src/main.js` (the hook-up).
- `src/core/store.js` (music settings).
- `src/ui/settings.js` (the Sound section).
- `recipes/index.json` (fold in `recipes/audio-index.json`).
- `recipes/species/frog.json` and `midge.json` (voice settings move in from `recipes/audio/voices/`).
- `tools/index.html` and `tools/unit-tests.html` (link and fold in the audio pages).
- `docs/README.md`, and doc 17's amendments.

The full list is in `docs/audio-future-work.md`, "Merge-time steps". Propose each edit before making it.

## 6. Checks, on the desktop

- **Serve the repo:** Matt double-clicks `play.cmd` (starts `tools/serve.ps1`), or run any static server. Then open `index.html`, `tools/audio-check.html` and `tools/music-lab.html` side by side.
- **Tests:**
  - `node tools/run-audio-tests.mjs` (112 audio tests).
  - `tools/unit-tests-audio.html` in the browser.
  - The game's own `tools/unit-tests.html`.
  - `tools/determinism.html`: audio must not change the world.
- **Types:** `npx -y tsc -p jsconfig.json --noEmit` (no errors in `src/audio`, `tools/` or anything touched).
- **Layout:** at 390 px and 1280 px wide, no console errors and no sideways scroll. Text at least 15 px on desktop and 16 px on phones.
- **Matt reviews by ear:** send WAV recordings whenever something should be heard. `tools/audio-prep/render/` renders a piece offline.

## 7. How Matt works (short version; the handoff has more)

- **Analyze, propose, then build.** Keep proposals short and visual: a diagram beats a paragraph. He approves before code.
- **Questions** go in a plain bullet list at the end of a message, in plain language, with no symbols or variable names. Never use button-style question tools.
- **Deliverables** are files: Markdown for information, self-contained HTML for interactive pages.
- **Big jobs** go to small parallel helpers with precise briefs. Helpers never edit shared files.
- **UI:** no emoji or symbol icons (drawn SVG icons from `src/ui/icons/` only), never sideways scrolling, Nunito.
- **Commits** may carry a Co-Authored-By trailer, never a claude.ai session link.
- **Never** use the two banned words in `CLAUDE.md`.

## 8. Running alongside (not this session's main job)

- **Music step 4b, the melody:** see `docs/audio-develop-plan.md` and the handoff update. Matt wants a melody on top about half the time, and distinct melodies layered over the D2 and G2 rocking.
- **Solo cello audition:** Karoryfer x bigcat (CC0) first, University of Iowa 2012 second.
- **Phone versions of the support kit:** tabled by Matt.
