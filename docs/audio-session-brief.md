# ebb audio: brief for the music and sound session

Paste or attach this file at the start of a fresh session, with `24-music.md` and `25-soundscape-seasons.md`. It tells the session what to build, in what order, and how to work with Matt.

## What you are making

An original, seasonal, day-following score for **ebb** (a cozy idler and living diorama on raw WebGPU, repo `mshomper/ebb`), plus the seasonal soundscape around it. Every note comes from composed material. Some pieces (anchors) you write in full; others (grown pieces) are composed at play time by a development engine that works each season's motifs by rules. Matt's main interest is that engine: he wants to design the algorithm that composes, more than a fixed set of tracks. Sounds and instrument samples come from CC0 sources only.

The feeling: peaceful, meditative, never annoying, never something a player turns down. Inspired by the spirit of ConcernedApe's Stardew Valley scores (seasonal sound worlds, music with the morning and then room to breathe, simple singable modal melodies), with no quotation of any existing work.

## Read first, in this order

1. `CLAUDE.md` in the repo: working rules (they apply to everything here).
2. `docs/01-vision-and-pillars.md`, then `docs/17-audio.md`.
3. `24-music.md` and `25-soundscape-seasons.md` (these specs; add them to `docs/` on your branch).
4. For context as needed: `docs/02` (clock: 1 game day = 24 real minutes, 7 days a season), `docs/05` (day keys by sun elevation), `docs/06` (`sky:sun-crossed`), `docs/10` (seasons and weather odds, `recipes/world/seasons.json`), `docs/11` and `docs/12` (frogs and midges, events), `docs/23` (presence and the hush), `docs/16` (preview and photo mode), `docs/19` (budgets), `docs/20` (M2).
5. `recipes/species/frog.json` (call window, chorus gap) and `recipes/species/midge.json` (dusk density).

## Who you are working with

Matt owns ebb. He is an expert in computational design and biomimicry, does not write code, and is a highly visual learner: show, do not describe at length. He has played piano for about 35 years and has a sharp, critical ear. Assume he will hear muddy voicings, out-of-tune samples, velocity layer steps, mechanical timing, aimless arpeggios and generic chord loops. Treat his notes on bars and voicings as a fellow musician's. He has no MIDI keyboard and no recording gear: he reviews by ear in the lab, tunes the development engine's rules, and can write motifs or phrases in the lab's material editor when he wants to compose.

## How to work

- **Analyze, propose, then build.** Before writing code, present a short, visual plan for Matt's approval. Do the same before each new phase.
- **Branches, never main.** Suggested: `m2-audio-engine`, `m2-music-spring`, `m2-soundscape`. Matt click-tests on desktop and in the Claude mobile app before any merge. Any steps Matt takes locally are written as GitHub Desktop actions.
- **Commits and PRs**: a `Co-Authored-By: Claude` trailer is fine; never a claude.ai session link. Every PR has a plain-language click-test list.
- **Listening and heavy checks run on Matt's machine**, in pages under `tools/` (`music-lab.html`, `audio-check.html`), opened beside the game. Do not run long renders in the cloud and wait on them.
- **Big jobs in small, parallel pieces**: for example one subagent preparing piano samples while another builds the ABC parser and a third drafts spring pieces. Keep working rather than waiting.
- **Do not over-deliberate**: make an educated call from the specs, state it in a line, move on.
- **Questions for Matt** go in a plain bullet list at the end of a message, in plain language, with no symbols or variable names in the questions.
- **House rules**: no emoji or symbol-glyph icons (every icon a drawn SVG in `src/ui/icons/`), no horizontal scrolling at any width, UI text at least 15 px desktop and 16 px phone, Nunito for UI, never the words "genuine" or "genuinely".
- **Code rules**: plain JavaScript ES modules with JSDoc, no build step, Web Audio API directly, small files (propose a split past about 600 lines), every tunable in `recipes/`, modules talk through `src/core/events.js` and `src/core/store.js`, no `Math.random()` (use `src/core/rng.js` with system id `music`), vendored libraries under `src/vendor/` with their licenses (abcjs, MIT, for the lab's notation).
- **Milestone note**: audio is M2 work and the M1 slice is still finishing (S6 frogs in progress). Matt has opened this audio track deliberately; keep it on its own branches and touch slice code only where the audio hooks in (events it listens to, the Sound settings section).

## Where things can and cannot come from

- The workspace reaches GitHub and package registries. VCSL (`github.com/sgossner/VCSL`) and VSCO 2 CE (`github.com/sgossner/VSCO-2-CE`) are both CC0 and on GitHub; clone with a blob filter and fetch only the folders you need (they are large).
- Freesound is not reachable from the shell. Build a shortlist with your web tools (CC0 filter only), Matt previews and downloads originals with his account, and drops them in a connected folder or attaches them.
- CC0 first. Salamander Grand Piano (CC-BY 3.0) is out. Free royalty-free bundles (such as Sonniss GDC) and paid libraries are a fallback only, under doc 25's "When CC0 does not land" rules (game-ready files only in the repo, listed separately).
- Nylon guitar is wanted for spring and summer; another session is searching for it. Build the instrument slot so it drops in when found.
- Every file goes into `assets/audio/CREDITS.md` or `assets/audio/instruments/CREDITS.md` with source URL, author, license and edits.

## Phases and gates

Each gate is Matt listening in a tool page and saying yes, or giving notes.

| Phase | Build | Gate (what Matt checks) |
|---|---|---|
| 0. Plan | A one-page visual plan: module map, phase list, first sample set | Matt approves the plan |
| 1. Mixer and piano | `src/audio/mixer.js` per doc 17 if it does not exist yet (graph, buses incl. `music`, unlock, visibility); `sampler.js`; Steinway B prepared (trim, tune, encode, velocity curve); music lab instrument bench (computer keyboard and on-screen keys), tuning check, layer crossfade test | The piano feels playable and in tune; no velocity steps; pedal and release sound natural. A/B against the Kawai and the Yamaha upright. |
| 2. Score engine | `score.js` (ABC subset), `realize.js`, `voicing.js`, `synth.js`, `director.js` with the lab's day simulator, notation and piano roll; one short test piece | The test piece plays from notation; two seeds sound different but the same piece; the day timeline shows slots, rests and silence share |
| 3. Island theme | Three or four candidate themes, each shown in its four seasonal settings (notation plus audio in the lab). Matt may also sketch his own in the material editor. | Matt chooses or rewrites the theme |
| 4. Development engine | `develop.js` (template, harmony walk, motif development, fit, critic) in a worker; lab engine panel with sliders, note-job overlay and Keep; material editor; spring motif bank and chord grammar as test material | Matt tunes the rules until grown seeds sound composed; this is his phase as much as yours |
| 5. Spring | 5 anchors (morning 3, nocturne 2) in batches; spring material finished (motifs, chord grammar, 4 to 6 templates); stand-ins for the grown slots until the engine passes its gate (about 20 seeds per slot); harp, flute, kalimba and pad prepared | Each batch reviewed bar by bar; grown seeds auditioned per slot |
| 6. In the game | Director live on a branch; Sound settings (music volume, music frequency); reveal theme; gift bloom; frog window silence; ducking near calling frogs | The hands-off hour (doc 24 acceptance checks) |
| 7. Summer, autumn, winter | Anchors and material for each (winter in D minor, leaning melancholy), their instruments, season edge blending | Same review as spring, then a season-jump listening session |

**Soundscape track (parallel, from phase 1):** doc 17's first pass (water, wind, frog voice) if not built yet, then doc 25: sea and air beds, seasonal reed, grass and rain variants, distant visitors, frog seasonal voice, midge swarm voice, frog body sounds, procedural drops and knocks, tool ground states. Start with the shortlist so Matt can preview and download while the engine is built. Gate: `audio-check.html` with the season and hour scrubber, then the doc 25 acceptance checks in the game.

## How to deliver a piece for review

For every piece: the lab link with the piece selected, its notation, a one- or two-line note on intent (what moment of the day, what color, where the contrast is), the keys and instruments it may use, two contrasting seeds to compare, and a line saying it quotes nothing known. Matt replies with bar numbers and seeds. Revise and say exactly what changed.

## What not to do

- No looping rendered music files; the score is composed data realized live.
- No motif invented from nothing at runtime: anchors vary only within their declared limits, and grown pieces develop authored motifs under the engine's rules.
- No drums, no hits, no fanfares, no UI music, nothing louder than mezzo-forte.
- No animal heard on the island unless it lives there; distant visitors stay rare, soft and beyond the shore.
- No non-CC0 file outside doc 25's fallback rules, no source WAVs of a licensed library in the repo, and nothing loaded from a CDN at runtime.
- No changes to `main` without Matt's explicit approval.
