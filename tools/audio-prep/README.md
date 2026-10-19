# Audio prep scripts

The offline scripts that built the shipped audio. They are kept so a later session can rebuild or extend a sample set, or the theme pieces, the same way. They are not part of the game and never run in the browser. Every result they produced is already committed under `assets/audio/instruments/` and `recipes/music/`; you only need them to make new versions.

Requirements: Python 3 with numpy and scipy, ffmpeg with libopus. The scripts expect their source downloads and intermediate files under `/tmp/ebb-audio-work/` (the folder they were written in); change that path at the top of a script if you keep them elsewhere. Sources are fetched from GitHub by sparse checkout of only the folders named in each script (VCSL: https://github.com/sgossner/VCSL, VSCO 2 CE: https://github.com/sgossner/VSCO-2-CE). Never do a full clone, and never run `git ls-tree -l` on a blobless clone, because it downloads every file.

| Folder | What it built | Notes |
|---|---|---|
| `piano/` | The Steinway B game set (desktop) and the phone set | `REPORT.md` is the full account. `plib.py` holds the shared measuring (onset, attack loudness, brightness, pitch from partials), `prep.py` trims and measures, `build.py` makes the game set, `mobile.py` and `mobile_recipe.py` the phone set, `align.py` lines up the loud layer's attack with the soft one's. |
| `strings/` | Violin, viola and cello sections and the solo contrabass (VSCO 2 CE) | `slib.py` finds and bakes the loops. `looprms.py` adds each loop's steady level (`loopRmsDb`) to a recipe; the sampler levels held notes by it. |
| `harp-flute/` | Harp (VCSL, two VSCO takes) and flute (VSCO 2 CE, non-vibrato and vibrato, looped) | `survey.py` compares sources before choosing. |
| `vibraphone/` | Vibraphone soft mallets and bowed, and the wine glasses (VCSL) | Library note names sit an octave low; files are placed by measured pitch. |
| `themes/` | The four tides in sixteen seasonal settings (`recipes/music/pieces/themes/`) | `make_themes.py` holds the notation in readable form and writes the piece files and `index.json`; `barcheck.py` checks every bar adds up. Edit the notation here, run both, then commit the regenerated JSON. |
| `shortlist/` | `tools/freesound-shortlist.html` from `docs/audio-freesound-shortlist.md` | Run after editing the shortlist. |
| `render/` | An offline render of a theme setting through the real sound engine, as a WAV | Serve the repo (`python3 -m http.server 8731`), then `python3 run.py "id=theme-1-summer&sun=30&wav=out.wav"`. Add `only=bed` or `drop=bed` to hear or measure one layer. |
