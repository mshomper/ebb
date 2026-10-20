# Piano sample prep report (ebb, branch m2-audio-engine)

Source: VCSL commit c1ea7bcc3c73, sparse checkout of five folders. Scripts in this folder: plib.py (pitch and analysis), prep.py (per-file processing, multiprocessing), build.py (recipes), xver.py (encode alignment check). Processed float WAVs are in wav/, per-file results in results/*.jsonl, summary numbers in stats.json. Nothing was committed.

## Method

- Onset: first sample above -50 dB of the file's peak; the file starts 3 ms before it (most VCSL files begin within 3 ms of the attack, so trimStartMs is 0 for nearly all).
- Tail: cut where the 50 ms RMS falls to -60 dB below peak, or at the maximum (8 s at A0 falling per semitone to 4 s at C8; releases 2 s; pedal sounds kept whole), then an equal-power cosine fade (250 ms sustains, 100 ms releases and pedal). No gain change.
- Tuning: zero-padded Hann FFT (bin spacing 0.01 Hz, parabolic interpolation) of 0.15 to 1.2 s after onset (2.0 s below 130 Hz, 0.05 to 0.5 s above 1 kHz, 0.03 to 0.3 s above 2 kHz), stereo channel powers summed. A grid search over f0 (+-60 cents) and B (0 to 0.06) locks onto the partial series, then a weighted least-squares fit of (f_n/n)^2 = f0^2 (1 + B n^2) on partials 1 to 6 (2 to 8 below 110 Hz). Each partial is taken as the amplitude-weighted centre of its unison cluster (peaks within 15 cents and 12 dB), which removed a 5-cent layer disagreement at Steinway A#5 caused by picking one string of a split unison. measuredCents is the fitted first partial against 12-TET at A440. FM piano: harmonic fit, B = 0.
- Wrong-note check: share of the strongest peaks explained by the fitted series, odd-partial and sub-octave tests, and a neighbour search (+-1, +-2 semitones, +-1 octave). Every flag was reviewed by hand against the peak list.
- Encode check: every .ogg and .m4a decoded back. Opus durations match to 0.01 ms. Threshold onsets moved by 2 to 6 ms in about 100 quiet, slow-attack files; cross-correlation of the first 80 ms shows a lag of 0 (two files 0.02 ms), so no start was shifted. AAC files decode about 22 ms longer (end padding).

## Sizes (bytes)

| Instrument | Set | Files | Ogg | M4A |
|---|---|---|---|---|
| piano-steinway-b | sus | 126 | 9,935,088 | 12,016,434 |
| piano-steinway-b | nosus | 126 | 9,428,533 | 11,230,615 |
| piano-steinway-b | rel | 99 | 1,343,198 | 1,789,733 |
| piano-kawai | sus | 144 | 9,769,084 | 12,050,342 |
| piano-kawai | rel | 84 | 1,022,507 | 1,390,737 |
| piano-yamaha-upright | sus | 71 | 5,160,426 | 5,164,913 |
| piano-yamaha-upright | rel | 71 | 306,170 | 294,599 |
| piano-knight-upright | sus | 90 | 6,369,585 | 8,040,947 |
| piano-knight-upright | rel | 45 | 924,808 | 1,445,205 |
| piano-knight-upright | pedal | 8 | 311,092 | 521,094 |
| fm-piano-tx81z | sus | 66 | 3,072,896 | 4,815,933 |

Steinway B sus set alone, all measured by encoding: Opus 96 kbps stereo 9,935,088; Opus 64 kbps stereo 6,335,422; notes below C4 in mono at 64 kbps with C4 and up at 96 kbps stereo 7,802,569; below C4 mono 64 kbps with the rest 64 kbps stereo 6,146,949. Mono saves little because Opus already codes the close-mic stereo efficiently. None fits a 4 MB core budget; length is what costs (the 8 s to 4 s maxima). A 4 s cap everywhere at 64 kbps stereo would land near 3.5 to 4 MB (estimate).

## Tuning per sus zone (cents vs 12-TET A440, confidence)

### piano-steinway-b

As0 -20.8 (0.37) C1 -19.3 (0.77) D1 -5.1 (0.54) E1 -14.3 (0.49) Fs1 -9.3 (0.64) Gs1 -6.1 (0.91) As1 -8.5 (0.43) C2 -4.4 (0.42) D2 -2.1 (0.27) E2 -5.8 (0.58) Fs2 -1.4 (0.68) Gs2 -0.6 (0.71) As2 -4.0 (0.67) C3 -1.6 (0.62) D3 -0.5 (0.64) E3 -3.1 (0.83) Fs3 -3.7 (0.87) Gs3 -3.4 (0.91) As3 -5.4 (0.33) C4 -2.3 (0.71) D4 -4.2 (0.79) E4 -2.1 (0.51) Fs4 -1.2 (0.72) Gs4 -2.7 (0.71) As4 -1.9 (0.45) C5 -3.3 (0.66) D5 -1.2 (0.74) E5 +1.0 (0.44) Fs5 +0.1 (0.68) Gs5 -2.0 (0.79) As5 -2.1 (0.23) C6 -1.6 (0.41) D6 +0.2 (0.55) E6 +1.4 (0.43) Fs6 -0.8 (0.57) Gs6 +2.0 (0.33) As6 +2.4 (0.68) C7 +13.9 (0.74) D7 +7.6 (0.92) E7 +12.6 (0.34) Fs7 +9.8 (0.58) Gs7 +5.6 (0.02)

Layer agreement (other layers vs the middle one, same take): median 0.7 c, 90th percentile 2.67 c, max 15.06 c.

Problems:

- Steinway rel has no release samples from E6 up. That is expected: the top strings of a grand have no dampers, so there is nothing to release.
- sus: brightness does not rise with layer in 6 of 42 zones: D3 (v1 0.056, v2 0.110, v3 0.096); As3 (v1 0.034, v2 0.056, v3 0.049); C4 (v1 0.086, v2 0.112, v3 0.103); Fs4 (v1 0.200, v2 0.297, v3 0.272); D6 (v1 0.004, v2 0.014, v3 0.011); Gs7 (v1 0.015, v2 0.030, v3 0.019)
- nosus: brightness does not rise with layer in 3 of 42 zones: Fs6 (v1 0.001, v2 0.000, v3 0.003); E7 (v1 0.000, v2 0.000, v3 0.000); Fs7 (v1 0.000, v2 0.000, v3 0.000)
- sus: layers of the same key disagree in pitch by more than 5 cents in 1 zones (usually a high, fast-dying note or a unison that beats; the zone number uses the middle layer): Gs7 (v1 +6.0, v2 +5.6, v3 +20.6)
- nosus: layers of the same key disagree in pitch by more than 5 cents in 5 zones (usually a high, fast-dying note or a unison that beats; the zone number uses the middle layer): Fs6 (v1 +6.7, v2 -0.9, v3 -0.7); As6 (v1 +6.2, v2 -2.4, v3 +1.7); C7 (v1 +16.4, v2 +9.2, v3 +8.9); D7 (v1 +17.8, v2 +9.5, v3 +10.4); Fs7 (v1 +18.3, v2 +10.2, v3 +9.1)
- rel: no release sample for 9 sus zones: E6, Fs6, Gs6, As6, C7, D7, E7, Fs7, Gs7

### piano-kawai

A0 -14.0 (0.48) C1 -15.9 (0.78) Ds1 -24.7 (0.79) Fs1 -12.3 (0.86) A1 -6.9 (0.85) C2 -16.3 (0.77) Ds2 -10.1 (0.9) Fs2 -2.5 (0.62) A2 -8.4 (0.44) C3 -7.5 (0.54) D3 -6.3 (0.85) E3 -4.8 (0.7) Fs3 -3.2 (0.8) Gs3 -7.8 (0.94) As3 -7.7 (0.54) C4 -5.9 (0.63) D4 -9.8 (0.54) E4 -5.6 (0.74) Fs4 -7.9 (0.92) Gs4 -1.5 (0.26) As4 -6.9 (0.47) C5 -4.8 (0.9) D5 +0.9 (0.49) E5 -2.4 (0.68) Fs5 +0.1 (0.62) Gs5 -1.9 (0.64) As5 -0.9 (0.28) B5 +0.5 (0.73) C6 -0.7 (0.55) Ds6 -4.6 (0.36) Fs6 -0.3 (0.95) A6 -2.7 (0.29) C7 -0.3 (0.72) Ds7 +1.0 (0.58) Fs7 +4.6 (0.41) G7 -5.3 (0.34) A7 -1.8 (0.4) C8 -2.8 (0.63)

Layer agreement (other layers vs the middle one, same take): median 0.49 c, 90th percentile 2.33 c, max 4.67 c.

Problems:

- The Kawai's lowest files, named A#-1 (A#0 after the octave fix), sound A0 about 11 to 14 cents flat (partials every 27.4 Hz), so they are placed at A0. The key's release files, also named A#-1, are placed with them at A0.
- sus: brightness does not rise with layer in 11 of 38 zones: C3 (v1 0.000, v2 0.003, v3 0.088, v4 0.076); E4 (v1 0.000, v2 0.007, v3 0.039, v4 0.032); Fs5 (v1 0.003, v2 0.001, v3 0.029, v4 0.060); C6 (v1 0.007, v2 0.003, v3 0.045, v4 0.062); Ds6 (v1 0.008, v2 0.002, v3 0.021, v4 0.030); Fs6 (v1 0.010, v2 0.001, v3 0.009, v4 0.009); A6 (v1 0.005, v2 0.001, v3 0.014, v4 0.041); Ds7 (v1 0.006, v2 0.001, v3 0.006, v4 0.008); G7 (v1 0.004, v2 0.000); A7 (v1 0.004, v2 0.001, v3 0.004, v4 0.008); C8 (v1 0.001, v2 0.000, v3 0.001, v4 0.003)
- 8 sustain files end in the source before falling to -60 dB or reaching the maximum length, so the 250 ms fade lands on a still-audible tail (tail level when the file ends: -53.3 to -37.4 dB below peak): sus/A6-v1 (2.389 s), sus/A7-v1 (1.396 s), sus/C7-v1 (2.991 s), sus/C8-v1 (1.064 s), sus/Ds6-v1 (3.316 s), sus/Ds7-v1 (1.621 s), sus/Fs6-v1 (3.404 s), sus/G7-v1 (1.902 s)
- sus/Ds2-v1 (GPiano_sus_D#1_v1_rr1_Player.wav): pitch check flagged it; reviewed by hand: partials sit at 77.1, 154.7, 231.8, 309.6 Hz, so this is D#2 as placed; the automatic octave flag came from low rumble peaks in a very quiet layer (peak -41 dB)
- sus/Fs5-v1 (GPiano_sus_F#4_v1_rr1_Player.wav): pitch check flagged it; reviewed by hand: the soft layer is almost a pure fundamental at 739 Hz (F#5) with weak upper partials, which tripped the automatic check; the note is right
- sus/Fs6-v2 (GPiano_sus_F#5_v2_rr1_Player.wav): pitch check flagged it; reviewed by hand: fundamental at 1479 Hz (F#6), weak upper partials; the note is right
- sus/A0-v2 (GPiano_sus_A#-1_v2_rr1_Player.wav): placed at A0, not As0 as its name says, because it measurably sounds A0 (-13.92 cents)
- sus/A0-v3 (GPiano_sus_A#-1_v3_rr1_Player.wav): placed at A0, not As0 as its name says, because it measurably sounds A0 (-14.01 cents)
- sus/A0-v4 (GPiano_sus_A#-1_v4_rr1_Player.wav): placed at A0, not As0 as its name says, because it measurably sounds A0 (-10.67 cents)
- rel/A0-v2 (GPiano_rel_A#-1_v2_rr1_Player.wav): placed at A0, not As0 as its name says, because it is the release of that key
- rel/A0-v3 (GPiano_rel_A#-1_v3_rr1_Player.wav): placed at A0, not As0 as its name says, because it is the release of that key
- rel/A0-v4 (GPiano_rel_A#-1_v4_rr1_Player.wav): placed at A0, not As0 as its name says, because it is the release of that key
- onset check: in 47 encoded files the -30 dB threshold crossing moved by more than 2 ms after encoding (codec ripple on a slow, quiet attack); cross-correlation of the first 80 ms against the processed WAV shows no shift in any of them (lag 0 to 0.02 ms), so the starts are in place
- sus zones further apart than a whole tone (doc 24 sampler rule: at most 2 semitones): A0 to C1 (3 semitones), C1 to Ds1 (3 semitones), Ds1 to Fs1 (3 semitones), Fs1 to A1 (3 semitones), A1 to C2 (3 semitones), C2 to Ds2 (3 semitones), Ds2 to Fs2 (3 semitones), Fs2 to A2 (3 semitones), A2 to C3 (3 semitones), C6 to Ds6 (3 semitones), Ds6 to Fs6 (3 semitones), Fs6 to A6 (3 semitones), A6 to C7 (3 semitones), C7 to Ds7 (3 semitones), Ds7 to Fs7 (3 semitones), A7 to C8 (3 semitones)
- sus: missing layers: A0 lacks v1; As5 lacks v4; B5 lacks v1,2; Fs7 lacks v1,2; G7 lacks v3,4
- rel: missing layers: D3 lacks v4; Ds3 lacks v2; E3 lacks v4; Gs3 lacks v4; A3 lacks v2,3; As3 lacks v4; D4 lacks v4; Ds4 lacks v2,3; E4 lacks v4; Gs4 lacks v4; A4 lacks v2,3; As4 lacks v4; As5 lacks v3,4; B5 lacks v2
- rel: no release sample for 8 sus zones: Fs6, A6, C7, Ds7, Fs7, G7, A7, C8

### piano-yamaha-upright

As0 +12.7 (0.01) C1 -42.0 (0.78) G1 -23.9 (0.14) C2 -15.4 (0.05) G2 -4.4 (0.41) C3 -4.7 (0.34) G3 -4.2 (0.66) C4 -1.3 (0.65) G4 -0.1 (0.68) C5 -2.5 (0.72) G5 -1.0 (0.59) C6 -3.4 (0.37) G6 +1.7 (0.01) C7 -3.3 (0.77)

Layer agreement (other layers vs the middle one, same take): median 1.62 c, 90th percentile 10.6 c, max 38.27 c.

Problems:

- sus/G6-v1-rr1 (Upright1_Sus_G5_vl1_rr1.wav) looks like a bad take: its energy is almost all at 3128 Hz (G7, the second partial) with the G6 fundamental buried, it dies within 0.7 s (the other G6 takes ring 1.6 to 2.1 s) and its brightness is 0.85 against 0.003 to 0.016 for the others; its measured pitch (-36.6 cents) is not trustworthy. Suggest the sampler use sus/G6-v1-rr2 only.
- sus/As0-v1-rr1 (Upright1_Sus_C0_vl1_rr1.wav) is the quietest file of the set (peak -38 dB, mostly rumble below the partials) and measures +47.7 cents where the other three A#0 takes measure +11 to +13; treat its number as unreliable.
- The lowest Yamaha zone is odd: of the five files named C0, four (vl1 rr1, vl1 rr2, vl2 rr1, vl3 rr1) sound A#0 about 11 to 13 cents sharp and only vl3 rr2 sounds C1 (42 cents flat). They are placed as recorded: zone As0 with layers v1 (two takes), v2 and v3, and zone C1 with v3 only. That leaves C1 without soft layers and A#0 without a release sample (the release files named C0 were all left at C1).
- sus: brightness does not rise with layer in 3 of 14 zones: G3 (v1 0.000, v2 0.045, v3 0.034); C4 (v1 0.020, v2 0.055, v3 0.051); G6 (v1 0.850, v2 0.003, v3 0.016)
- sus: layers of the same key disagree in pitch by more than 5 cents in 4 zones (usually a high, fast-dying note or a unison that beats; the zone number uses the middle layer): As0 (v1 +47.7, v1 +11.2, v2 +12.7, v3 +11.1); G1 (v1 -16.5, v2 -23.9, v3 -18.6); C2 (v1 -2.8, v2 -15.4, v2 -15.9, v3 -15.0, v3 -15.4); G6 (v1 -36.6, v1 -0.4, v2 +1.7, v2 +1.7, v3 -0.8, v3 +0.4, v3 -0.9)
- source files begin right at the attack with no silence before it (56 of 71 sus files, 45 of 71 rel files; first sample -39.4 to -5.7 dB below the file's peak). Nothing was cut from them; listen for a start click, and if one is heard a 1 to 2 ms fade-in at playback cures it.
- sus/C6-v1-rr1 (Upright1_Sus_C5_vl1_rr1.wav): pitch check flagged it; reviewed by hand: fundamental at 1046 Hz (C6) with a weak second partial; the note is right
- sus/As0-v1-rr1 (Upright1_Sus_C0_vl1_rr1.wav): placed at As0, not C1 as its name says, because it measurably sounds As0 (47.68 cents)
- sus/As0-v1-rr2 (Upright1_Sus_C0_vl1_rr2.wav): placed at As0, not C1 as its name says, because it measurably sounds As0 (11.21 cents)
- sus/As0-v2-rr1 (Upright1_Sus_C0_vl2_rr1.wav): placed at As0, not C1 as its name says, because it measurably sounds As0 (12.69 cents)
- sus/As0-v3-rr1 (Upright1_Sus_C0_vl3_rr1.wav): placed at As0, not C1 as its name says, because it measurably sounds As0 (11.07 cents)
- onset check: in 15 encoded files the -30 dB threshold crossing moved by more than 2 ms after encoding (codec ripple on a slow, quiet attack); cross-correlation of the first 80 ms against the processed WAV shows no shift in any of them (lag 0 to 0.02 ms), so the starts are in place
- sus zones further apart than a whole tone (doc 24 sampler rule: at most 2 semitones): C1 to G1 (7 semitones), G1 to C2 (5 semitones), C2 to G2 (7 semitones), G2 to C3 (5 semitones), C3 to G3 (7 semitones), G3 to C4 (5 semitones), C4 to G4 (7 semitones), G4 to C5 (5 semitones), C5 to G5 (7 semitones), G5 to C6 (5 semitones), C6 to G6 (7 semitones), G6 to C7 (5 semitones)
- sus: missing layers: C1 lacks v1,2; C7 lacks v1
- rel: missing layers: C7 lacks v1
- rel: no release sample for 1 sus zones: As0

### piano-knight-upright

A0 -7.6 (0.75) B0 -10.2 (0.8) Cs1 -16.3 (0.6) Ds1 -19.4 (0.81) F1 -4.6 (0.75) G1 -12.1 (0.57) A1 -12.5 (0.83) B1 -16.6 (0.37) Cs2 -14.3 (0.39) Ds2 -9.3 (0.33) F2 +0.6 (0.67) G2 -6.6 (0.54) A2 -13.6 (0.23) B2 -1.2 (0.79) Cs3 -2.1 (0.84) Ds3 +3.7 (0.73) F3 -0.9 (0.67) G3 -0.8 (0.86) A3 -0.8 (0.96) B3 +0.8 (0.89) Cs4 +1.8 (0.78) Ds4 +4.4 (0.91) F4 +1.4 (0.73) G4 +2.8 (0.63) A4 +2.6 (0.9) B4 +7.0 (0.87) Cs5 +4.6 (0.94) Ds5 +1.9 (0.97) F5 +2.7 (0.98) G5 +2.5 (0.82) A5 +4.3 (0.91) B5 +9.2 (0.89) Cs6 +9.3 (0.45) Ds6 +7.5 (0.33) F6 +13.2 (0.57) G6 +9.8 (0.2) A6 +7.6 (0.03) B6 +8.6 (0.06) Cs7 +11.4 (0.4) Ds7 +24.0 (0.78) F7 +25.8 (0.27) G7 +33.1 (0.79) A7 +39.3 (0.53) B7 +61.5 (0.57) C8 +64.4 (0.63)

Layer agreement (other layers vs the middle one, same take): median 0.7 c, 90th percentile 2.33 c, max 15.91 c.

Problems:

- sus: brightness does not rise with layer in 1 of 45 zones: B7 (v1 0.000, v2 0.000)
- sus: layers of the same key disagree in pitch by more than 5 cents in 2 zones (usually a high, fast-dying note or a unison that beats; the zone number uses the middle layer): A6 (v1 +23.5, v2 +7.6); B6 (v1 +15.5, v2 +8.6)
- 5 sustain files end in the source before falling to -60 dB or reaching the maximum length, so the 250 ms fade lands on a still-audible tail (tail level when the file ends: -57.6 to -52.4 dB below peak): sus/A7-v1 (2.39 s), sus/Ds7-v1 (3.134 s), sus/F7-v1 (2.522 s), sus/G7-v1 (2.348 s), sus/F7-v2 (2.74 s)
- sus/B7-v1 (Player_vl1_rr1_B6.wav): pitch check flagged it; reviewed by hand: sounds about 62 cents above B7 (4094 Hz). C8 is also about 62 cents sharp and A7 37, G7 32, F7 26, so this is the top of a steep stretch tuning rather than a wrong file, but these two keys sit closer to a quarter tone sharp than any other zone; trust the ear
- sus/C8-v1 (Player_vl1_rr1_C7.wav): pitch check flagged it; reviewed by hand: about 62 cents sharp of C8 (4348 Hz); see B7
- sus/B7-v2 (Player_vl2_rr1_B6.wav): pitch check flagged it; reviewed by hand: same as v1, about 62 cents sharp of B7
- sus/C8-v2 (Player_vl2_rr1_C7.wav): pitch check flagged it; reviewed by hand: about 64 cents sharp of C8; see B7
- onset check: in 39 encoded files the -30 dB threshold crossing moved by more than 2 ms after encoding (codec ripple on a slow, quiet attack); cross-correlation of the first 80 ms against the processed WAV shows no shift in any of them (lag 0 to 0.02 ms), so the starts are in place

### fm-piano-tx81z

C0 +4.5 (0.58) E0 +4.4 (0.46) Gs0 +4.1 (0.34) C1 +3.3 (0.75) E1 +3.3 (0.23) Gs1 +2.5 (0.64) C2 +2.8 (0.5) E2 +2.4 (0.68) Gs2 +1.5 (0.74) C3 +1.1 (0.53) E3 +1.3 (0.79) Gs3 +0.8 (0.8) C4 +0.6 (0.83) E4 +0.9 (0.87) Gs4 -0.4 (0.51) C5 +0.2 (0.91) E5 +0.5 (0.75) Gs5 -0.3 (0.46) C6 +0.4 (0.9) E6 +0.6 (0.91) Gs6 -0.1 (0.97) C7 +0.2 (0.83)

Layer agreement (other layers vs the middle one, same take): median 0.21 c, 90th percentile 0.81 c, max 2.07 c.

Problems:

- 26 sustain files end in the source before falling to -60 dB or reaching the maximum length, so the 250 ms fade lands on a still-audible tail (tail level when the file ends: -53.8 to -45.0 dB below peak): sus/C5-v1 (4.59 s), sus/C5-v2 (5.022 s), sus/C5-v3 (5.301 s), sus/C6-v1 (3.256 s), sus/C6-v2 (3.628 s), sus/C6-v3 (3.771 s), sus/C7-v1 (2.337 s), sus/C7-v2 (2.486 s), sus/C7-v3 (2.682 s), sus/E4-v1 (5.756 s), sus/E5-v1 (3.92 s), sus/E5-v2 (4.26 s), sus/E5-v3 (4.369 s), sus/E6-v1 (2.873 s), sus/E6-v2 (3.183 s), sus/E6-v3 (3.372 s), sus/Gs3-v1 (6.214 s), sus/Gs4-v1 (4.566 s), sus/Gs4-v2 (5.045 s), sus/Gs4-v3 (5.165 s), sus/Gs5-v1 (3.277 s), sus/Gs5-v2 (3.624 s), sus/Gs5-v3 (3.766 s), sus/Gs6-v1 (2.322 s), sus/Gs6-v2 (2.553 s), sus/Gs6-v3 (2.631 s)
- sus zones further apart than a whole tone (doc 24 sampler rule: at most 2 semitones): C0 to E0 (4 semitones), E0 to Gs0 (4 semitones), Gs0 to C1 (4 semitones), C1 to E1 (4 semitones), E1 to Gs1 (4 semitones), Gs1 to C2 (4 semitones), C2 to E2 (4 semitones), E2 to Gs2 (4 semitones), Gs2 to C3 (4 semitones), C3 to E3 (4 semitones), E3 to Gs3 (4 semitones), Gs3 to C4 (4 semitones), C4 to E4 (4 semitones), E4 to Gs4 (4 semitones), Gs4 to C5 (4 semitones), C5 to E5 (4 semitones), E5 to Gs5 (4 semitones), Gs5 to C6 (4 semitones), C6 to E6 (4 semitones), E6 to Gs6 (4 semitones), Gs6 to C7 (4 semitones)
