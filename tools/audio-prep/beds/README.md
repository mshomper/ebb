# Bed prep scripts

The offline scripts that made the recorded ambience beds in `assets/audio/beds/` (October 20, 2026) from Matt's Freesound picks. They never run in the browser. Every result is already committed; you need them only to remake or extend a bed.

- `BRIEF.md`: the shared rules both helpers followed (stretch choice, contamination scan, 40 Hz high-pass, 2 s equal-power loop seam, -30 LUFS, Opus 56 kbps plus AAC, take lengths about 45 and 53 s).
- `water/`: sea, pond lap, trickle, stream run, the rain beds and drizzle. `bedlib.py` holds the shared steps (decode, loop seam, loudness, encode, checks); `build_beds.py` and `build_sea.py` hold every stretch and filter; `debird.py` is the gentle spectral attenuation used on the trickle.
- `wind/`: reeds, grass, open wind and winter air. `process.py` holds every stretch and EQ; `birds.py` the bird-call repair used on the Pink Lakes wind; `preview.py` the 20 s previews.
- `scan.py`, `zoom.py`, `birdscan.py`, `ltas.py`: the contamination scans (spectrograms and long-term spectra).
- `REPORT-wind.md` and `REPORT-water.md`: what was made from which stretch, what was cut and why, and what to listen for.

Paths: the scripts read Matt's downloads from `/mnt/user-data/uploads/Ebb/<folder>/` (the session's copy of `C:\Users\mshom\Music\Ebb`) and write under `/home/claude/ebb-scratch/beds/` and the repo's `assets/audio/beds/`. Change the paths at the top of a script to run it elsewhere. Needs Python 3 with numpy, scipy, soundfile and pyloudnorm, and ffmpeg with libopus.
