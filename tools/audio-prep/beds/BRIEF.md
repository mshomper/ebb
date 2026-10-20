# Bed processing: shared rules for both helpers

You are turning field recordings Matt picked on Freesound into looping ambience beds for the game ebb (a calm island idler). Matt reviews by ear and has a sharp ear: no clicks at loop points, no audible edits, no pumping, no harshness.

## Inputs
- Sources (read-only): `/mnt/user-data/uploads/Ebb/<folder>/<file>`. Copy anything you modify into your own work folder; never edit the uploads.
- Matt's notes per file are in `/root/.claude/uploads/0407f2c9-8651-5a80-9151-941a975294b0/6286e132-ebb-sound-picks.md` (read it; his notes are the brief for tone).
- Spec: `/home/claude/ebb-beds/docs/25-soundscape-seasons.md` sections "Contamination rules" and "Processing" (read them).
- Tools: ffmpeg (has libopus and aac), python3 with numpy, scipy, soundfile, pyloudnorm. Write your scripts in your own work folder (`/home/claude/ebb-scratch/beds/<your-id>/`), not in the repo. Run python with `-I`.

## Processing, per take
1. Decode to 48 kHz float stereo (mono sources: duplicate to stereo with a very slight decorrelation, e.g. a 7 to 13 ms all-pass or short delay difference, so it is not dead center).
2. Choose the cleanest stretch. Contamination to avoid (doc 25): birds in beds (look for narrowband tonal chirps 1.5 to 8 kHz in a spectrogram: short, high spectral-flatness dips with strong pitched peaks), human voices (energy 100 to 3 kHz with formant structure and syllable rhythm ~3 to 6 Hz), handling bumps, wind buffeting (large low-frequency bursts below 150 Hz), clipping, traffic or engines (steady low hum or slow swells). Write a short contamination scan per source (times of suspected events) and choose stretches that avoid them. If something cannot be avoided, say so in the report rather than hiding it.
3. High-pass at 40 Hz (gentle, 2nd order). Apply the tone EQ named in your job (gentle shelves; never more than about 6 dB on a shelf).
4. Make it loop: take the stretch plus an extra 2 s, and crossfade the last 2 s into the first 2 s equal-power (sin/cos), so the file's end flows into its start. Check: the RMS of a 200 ms window across the loop seam must be within 1 dB of the surrounding windows, and the sample-level join must be continuous (no step).
5. Loudness: integrated −30 LUFS per take (pyloudnorm), true peak below −3 dBFS.
6. Encode both: Ogg Opus stereo, 56 kbps (`-c:a libopus -b:a 56k -vbr on -application audio`), and AAC `.m4a` at 64 kbps (`-c:a aac -b:a 64k`). Check the Opus file decodes and its length is right.
7. Two takes per bed, of different lengths: take a about 45 s, take b about 53 s (prime-ish lengths so their combination rarely repeats), drawn from different parts of the source where possible. The game plays both together, crossfading emphasis between them slowly, so they must sit at the same loudness and character.

## Budget
The whole soundscape must fit in about 9 MB of Opus. That is why the bitrate is 56 kbps and the takes are short. Report each file's size.

## Where files go (in the worktree `/home/claude/ebb-beds`, branch m2-soundscape-beds)
- `assets/audio/beds/<layer>/<name>.ogg` and `.m4a`, names given in your job.
- Do NOT edit `assets/audio/beds/takes.json`, `assets/audio/CREDITS.md`, or any file outside `assets/audio/beds/<your layers>/`. Do not commit; the lead merges.
- Instead write `/home/claude/ebb-scratch/beds/<your-id>/result.json`:
  ```json
  { "takes": { "<layer>": { "<season or all>": ["<take name>", ...] } },
    "credits": [ { "file": "assets/audio/beds/<layer>/<name>.ogg", "title": "...", "author": "...", "url": "...", "license": "CC0 1.0 | CC BY 4.0", "source": "<original file name>", "edits": "stretch 0:41-1:26, high-pass 40 Hz, high shelf -3 dB at 6 kHz, looped (2 s equal-power), -30 LUFS, Opus 56 kbps" } ],
    "sizesKB": { "<file>": 0 } }
  ```
  Take names: a plain name such as `a` means the file `<layer>/<season>-a.ogg` (or `<layer>/a.ogg` for "all"). A name starting with `@` is a path from the beds folder, e.g. `@reeds/green-a` means `reeds/green-a.ogg`; use this when several seasons share one file. (The lead adds this `@` support to the loader.)
  The license for every file is on its Freesound page; all picks are CC0 except the two YleArkisto and klankbeeld reed files, which are CC BY 4.0. Author names are in the Freesound URL (`/people/<author>/`).
- Also write a 20 s preview WAV per bed (both takes mixed as the game plays them, 16-bit 48 kHz) to `/home/claude/ebb-scratch/beds/previews/<layer>-<name>.wav`, so Matt can listen without the game.
- Write `/home/claude/ebb-scratch/beds/<your-id>/report.md`: per bed, which source and stretch, what was cut and why, the EQ, sizes, and anything Matt should listen for. Plain language, short.

## Final reply
Five lines or fewer: what was built, total size, and any bed that did not come out clean.
