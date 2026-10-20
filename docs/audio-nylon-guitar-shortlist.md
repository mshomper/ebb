# Nylon guitar: sample shortlist

Research for the "Nylon guitar" row in doc 24 (Instruments) and the fallback order in doc 25 ("When CC0 does not land"). Nothing has been downloaded, prepared or committed. Every license below was read on its own page on October 20, 2026.

## Decision

October 20, 2026: Matt auditioned the Iowa pp G-string run and picked the Iowa MIS Guitar. Source to prepare from: `Guitar.mono.2496.zip` (598 MB; 24-bit keeps the quiet tails clean when each note is normalized). It is non-CC0, so doc 25's rules apply.

## The short answer

- **Audition first: University of Iowa MIS Guitar.** A real classical guitar (Raimundo 118), every semitone from E2 to B5, three dynamics (pp, mf, ff), recorded with a measurement-grade mic in an anechoic room, long natural decays. Free, no account, and the studio says it "may be downloaded and used for any projects, without restrictions". It is not formally CC0, so it follows doc 25's non-CC0 rules.
- **Audition second: j_e_f_f_g "Nylon Guitar Single Notes" on Freesound.** The only clean-looking CC0 set that is laid out like an instrument: 15 notes, one every minor third. Short (about 2 s, looped), one layer. If it sounds good enough by ear it wins on license; my guess is it will sound thinner than Iowa.
- **No CC0 set matches the full brief** (every minor third or closer, two or more layers, clean). That gap is why Iowa leads.
- **Paid libraries are mostly a dead end** for ebb: their licenses allow music made with them, not shipping the single notes inside a game a browser can unpack. See the paid section.

## How the candidates compare

```
                      range           spacing        layers   length    license
Iowa MIS Guitar       E2 ........ B5  every note     3        long      "any projects, without restrictions"
j_e_f_f_g (CC0)        Eb2 ....... Db6 minor thirds   1        ~2 s      CC0
FreePats Spanish      (not stated)    (not stated)   1?       short?    CC0
quartertone Yamaha    B1 ........ Bb5 scattered      5        ~3 s      CC-BY 4.0 (credit)
oliverharlan Munich   (unlabeled)     11 notes       1        2-10 s    CC0
SpeedY strums (CC0)   chords, down and up strums, mutes            CC0   (rhythm layer only)
```

## Ranked shortlist

| Rank | Candidate | License, and what it requires | Range and spacing | Layers and round robins | Format and size | Recording quality | Preview without an account |
|---|---|---|---|---|---|---|---|
| 1 | [Iowa MIS Guitar](https://theremin.music.uiowa.edu/MISguitar.html) (Raimundo 118, played by Brian Penkrot, 2011) | Studio page: "may be downloaded and used for any projects, without restrictions". No credit required; credit given anyway as a courtesy. Not a formal license, so treat as non-CC0 (doc 25). | E2 to B5, every semitone, on each of the six strings (many notes exist on two or three strings, so we can pick the warmer string per zone) | 3 dynamics (pp, mf, ff); no round robins | AIFF, one file per string per dynamic holding a chromatic run; zips: mono 16/44.1 114 MB, stereo 16/44.1 232 MB, stereo 24/96 1.16 GB | Earthworks QTC40 mic at 5 ft in an anechoic chamber: very clean and very dry (no room at all; ebb's reverb supplies the space). Long natural decays. | Yes: files download directly, no login, no in-page player |
| 2 | [j_e_f_f_g, Nylon Guitar Single Notes](https://freesound.org/people/j_e_f_f_g/packs/20356/) (2016) | CC0: "copy, modify, distribute and perform the sound" without asking. Nothing required. | 15 notes on C, Eb, Gb, A from octave 2 to 6 (2_Eb to 6_Db): exactly the minor-third spacing we want | 1 layer; no round robins | WAV, 16/44.1 stereo, about 2 s each, looped, under 6 MB total | No recording notes given. Looped endings mean the natural decay was cut; the sampler would fade them. Needs a listen. | Yes: Freesound pages play previews; download needs a free login |
| 3 | [FreePats Spanish Classical Guitar](https://freepats.zenvoid.org/Guitar/acoustic-guitar.html) (2008, version 2019-06-18) | "Creative Commons CC0 1.0 public domain dedication". Nothing required. | Not stated on the page | Not stated; the size (5.1 MB unpacked as FLAC) suggests one layer | SFZ with FLAC 4.5 MB, SFZ with WAV 6.9 MB, SF2 9.5 MB | Author's own words: "The recording conditions were far from ideal", so noise reduction was applied. A MuseScore user calls some notes poor in tone with weak low end. | No: download only, no demo |
| 4 | [quartertone, ClassicalGuitar-multisampled](https://freesound.org/people/quartertone/packs/11573/) (Yamaha Eterna, 2013), with a [harmonics pack](https://freesound.org/people/quartertone/packs/11598/) | CC-BY 4.0: free to use and modify "as long as you credit the author". Doc 24 excluded Salamander piano for being CC-BY, so this needs your OK as an exception. | 161 files; frets 0 to 18 on all strings, MIDI 35 to 82 (B1 to Bb5), positions scattered rather than even | 5 velocity layers; no round robins. Harmonics pack: 4th, 5th, 7th, 12th fret harmonics, 5 layers | WAV, 24/48 mono, about 3 s each with crossfade loops | CAD E100 mic; the only free set with five layers. 3 s notes are short for a guitar and lean on the loop. | Yes: previews play; download needs a free login |
| 5 | [oliverharlan, Munich Nylon Guitar](https://freesound.org/people/oliverharlan/packs/42658/) (2025) | CC0. Nothing required. | 11 notes, pitches not labeled | 1 layer | WAV, 16/44.1 stereo, 2.5 to 9.5 s | "an old cheap guitar" found in a residency flat: character, not polish | Yes: previews play; download needs a free login |
| Extra | [SpeedY, Nylon Guitar Open Chords](https://freesound.org/people/SpeedY/packs/472/), [Bar Chord Style](https://freesound.org/people/SpeedY/packs/476/), [Extra Open Chords](https://freesound.org/people/SpeedY/packs/475/) (2005) | CC0. Nothing required. | Whole chords, not notes: open and barre shapes, down strums and up strums, plus string-mute slaps | n/a | WAV | Older home recordings; needs a listen | Yes, as above |

### Notes on the ranking

- **Why Iowa is first.** It is the only free set that meets the whole brief: every note, more than one dynamic, clean. The dryness is a plus for ebb, since doc 24 already adds reverb on the music bus. The files are runs of notes on one string, so the prep script slices them at each pluck (the same kind of trim the piano prep already does). "sulE", "sulA" in the file names is Italian for "on the E string", "on the A string"; it is not a special technique.
- **How big it gets in the game.** About 14 zones (one every minor third) times 2 layers (pp and mf, or mf and ff), trimmed to about 4 s, mono Opus at 64 kbps, is roughly 1 MB. That fits doc 24's budget of 2.5 MB for a season's extra instruments.
- **Why j_e_f_f_g is second and not first.** Its license is the best possible and its spacing is ideal, but one layer and 2 s looped notes will likely sound flat in a lead line. It is the fallback if Iowa disappoints, or a CC0 replacement later if it sounds better than expected.
- **The SpeedY strums** are a possible rhythm layer for summer mornings (a soft down-up strum on chord changes). They only cover common open and barre shapes, so the score would use them only on chords they match. Your ear decides whether they belong at all; plucked arpeggios from rank 1 may do the job alone.

## Free sets rejected

| Set | Why rejected |
|---|---|
| [Carlos_Vaquero classical guitar packs](https://freesound.org/people/Carlos_Vaquero/packs/9537/) on Freesound (chromatic, per string) | Attribution NonCommercial 4.0: "do not use the sound for commercial purposes" |
| [bangcorrupt, Nylon Plucks](https://freesound.org/people/bangcorrupt/sounds/833157/) | Labeled CC0, but the description says "free for non-commercial use": license unclear. Also open D tuning, fret buzz, handling noise. |
| [SpeedY, Nylon Guitar Single notes](https://freesound.org/people/SpeedY/packs/469/) | CC0, but only open strings, picks and harmonics, not a playable range |
| [Philharmonia sound samples](https://philharmonia.co.uk/audio-sound-samples/) (includes guitar) | They "must not be sold or made available 'as is' (i.e. as samples or as a sampler instrument)". A game that plays the notes through its own sampler is too close to that. |
| [MG Soft Nylon Guitar Lite](https://www.pianobook.co.uk/?p=5692) (Pianobook) | Pianobook terms (as quoted on the Linux audio list): "You may not sell sample(s), or give away any sample(s) for use by any other person(s)". Also only 1 layer, D1 to G3, account needed. |
| Karoryfer guitars ([list](https://sfzinstruments.github.io/guitars/)) | CC0, but all steel or electric (archtop, hollowbody); no nylon guitar |
| VCSL and VSCO 2 CE | No guitar of any kind (VCSL has harp, psaltery, strumstick, dan tranh) |
| Ichiyanagi classical guitar soundfont | No license text could be found |
| General MIDI soundfonts (FluidR3 and similar) | Where the guitar recordings came from is not documented, and quality is below the piano |

## Paid libraries

The rule that sinks most of them: their licenses cover music you record with the library, not shipping the single notes inside a game that plays them live. A web game's audio files are downloaded by the browser and can be saved by anyone, so "not reasonably accessible" clauses do not hold either.

| Library | Price | What its license says | Fit for ebb |
|---|---|---|---|
| [Spitfire, Soft Nylon Guitar](https://spitfireaudio.com/mg-soft-nylon-guitar) (Mike Georgiades) | £99, Kontakt Player, 777 MB; up to 4 layers, up to 5 round robins | Spitfire's own help page allows game sounds "generated by interacting with the interface" only when they "can't be recorded or exported", and bans "something that can be construed as" a sample library | No |
| Embertone (no guitar today) | n/a | Games allowed only if "raw samples are not reasonably accessible to end-users"; otherwise "contact Owner for an Embedded/Redistribution license" | Model to ask for, not a product |
| Output, ProjectSAM, Fluffy Audio | n/a | Ban embedding sounds in software or any "sample playback device" (ProjectSAM names game consoles) | No |
| Orange Tree (Evolution Modern Nylon), Pettinhouse ClassicGuitar, Native Instruments Picked Nylon | not checked | License text not published where it could be read; reject until read | Unknown |

Two paid routes that would work, if the free ones fail:

1. **Ask a guitar library maker for a written embedded license**, the kind Embertone offers. Ask before buying, and keep the reply with the purchase record (doc 25).
2. **Commission a recording**: a session guitarist records about 45 single notes at two dynamics on a nylon guitar, in a quiet room, with a written grant of full rights (or a CC0 release). Price is by quote. This gives ebb its own guitar with no license worries.

## What happens after you pick

The prep follows doc 24's sample steps (trim, fade, tune to A440 within 3 cents, mono, Opus 64 kbps plus AAC fallback) into the empty guitar slot. For a non-CC0 pick (Iowa or quartertone), doc 25's rules apply: only processed files go in the repo, each is listed in `assets/audio/LICENSES-NONCC0.md`, and the repo's license section says they are not covered by the open license.

## Your steps to audition

**Iowa (no account):**

1. Open https://theremin.music.uiowa.edu/MISguitar.html
2. For a quick listen, click three files on the G string, middle register: `Guitar.pp.sulG.C4B4.stereo.aif`, `Guitar.mf.sulG.C4B4.stereo.aif`, `Guitar.ff.sulG.C4B4.stereo.aif` (roughly 40 to 60 MB each; the low E file below measured 46 MB). Each is a slow climb of single notes. The single files are 24-bit, 96 kHz AIFF (the page says 16/44.1, but the pp G file measured 24/96), which Windows Media Player cannot play: open them in Audacity (installed on Matt's machine) by dragging the file in, or ask the session to make WAV copies with ffmpeg. The recordings are raw and quiet (the pp G file peaks at -19.5 dB and averages -40 dB), so listening copies get about 18 dB of gain; prep normalizes each note anyway.
3. Also try one low file, `Guitar.mf.sulE.E2B2.stereo.aif`, to hear the bass notes and how long they ring.
4. If it passes, download `Guitar.stereo.1644.1.zip` (232 MB) and drop it in a folder this session can reach. The prep session takes it from there.

**j_e_f_f_g (free Freesound login to download):**

1. Open https://freesound.org/people/j_e_f_f_g/packs/20356/ and play the previews on the page (no login needed).
2. If it passes, log in and use "Download pack", then drop the zip in the same folder.
