# Phase 4 plan: the development engine

> A proposal for Matt's approval (October 20, 2026). Nothing here is built yet. Doc 24's "The development engine" is the spec; this plan says how it gets built, what material it starts from, and how you tune it.

## The one big choice

**A grown piece comes out in the same form as a written piece.** The engine writes a piece file: sections, a melody line, chord symbols on every bar, a form, and a palette. That file then goes through the same realizer as the four tides, so it gets the same voicings, left-hand textures, string bed, rubato, pedaling and instruments.

This choice gives four things:

- Everything you've already tuned (voicings, textures, layers) carries over for free.
- The lab shows grown pieces as sheet music and piano roll with no new display code.
- **Keep** is simple: the file is saved as an anchor, and from then on it's authored score.
- The same seed, season and slot always regenerate the same file and the same name, so hearted pieces will work later.

The engine writes only melody, harmony and form. It does not touch sound.

```
material (spring.json)       engine (develop/)                       existing
---------------------        -----------------                       --------
form templates  ----->  1 template   phrase plan + tension curve
chord grammar   ----->  2 harmony    walk the grammar, land cadences
motif bank      ----->  3 melody     place motifs, develop them
                        4 fit        strong beats on chord tones
                        5 counter    optional second line
                        6 critic     24 candidates, best few, one by seed
                                  |
                                  v
                          a piece file  ---->  realizer  ---->  sound
                          (+ note jobs, name)  (voicing, textures,
                                                bed, rubato, pedal)
```

## The spring material (first draft, for you to tweak)

### Motif bank: eight tide fragments and three spring motifs

Rhythms are in beats (a quarter note is 1). Every fragment is cut from the spring settings you approved, so grown pieces sound related to the tides.

| # | Name | From | Notes (rhythm) | Meter | Role |
|---|---|---|---|---|---|
| 1 | First water rise | Tide 1, bars 1 and 2 | D (1.5) E (0.5) F# (1) / G (1) A (2, held) | 3/4 | opening |
| 2 | First water fall | Tide 1, bar 3 | A (1) G (0.5) F# (0.5) E (1) | 3/4 | falling, answer |
| 3 | Moon pull run | Tide 4, bar 1 | D E F# G A (0.5 each) B (0.5, tied on) | 3/4 | climbing |
| 4 | Moon pull lean | Tide 4, bar 2 | B (2) A (1) | 3/4 | cadential (a sixth leaning onto the fifth) |
| 5 | Sandbar lilt | Tide 2, bars 1 and 2 | B (1) C# (0.5) D (1) E (0.5) / F# (3, held) | 6/8 | opening, from the minor chord |
| 6 | Sandbar turn | Tide 2, bar 3 | F# (1) E D C# B (0.5 each) | 6/8 | falling |
| 7 | Breath | Tide 3, bar 1 | F# (1) G (1) A (2, held) | 4/4 | opening, the stillest |
| 8 | Breath sigh | Tide 3, bar 2 | A (1) G F# (0.5 each) E (1) D (1) | 4/4 | cadential, home on the tonic |
| 9 | Green shoot (new) | spring | B (1) C# (0.5) D (1.5) over G | any | climbing (the Lydian lift: the raised fourth over G rising to D) |
| 10 | Puddle (new) | spring | A (1) F# (1) G (0.5) A (0.5) / B (2) | any | answer (a third down, then back up by step past the start) |
| 11 | Open window (new) | spring | G (1) F# (0.5) E (0.5) / F# (3) | any | cadential, ending on the third |

Motifs move to any key and fit any meter. A 3/4 motif stretched into 4/4 keeps its note order, and its rhythm is re-fitted to the bar.

### Chord grammar: D major with Lydian and Mixolydian color

| From | To (how often) |
|---|---|
| D | B minor 7 (0.3), G maj7 (0.25), F# minor 7 (0.2), C (0.15), E minor 7 (0.1) |
| G maj7 | D, plagal (0.45), A7 sus4 (0.25), E minor 9 (0.3) |
| B minor 7 | E minor 7 (0.35), G maj7 (0.4), F# minor 7 (0.25) |
| F# minor 7 | G maj7 (0.5), B minor 7 (0.3), E minor 7 (0.2) |
| E minor 7 | A7 sus4 (0.4), D, ii to I (0.3), G over D (0.3) |
| A7 sus4 | D (0.5), B minor 7, deceptive (0.3), A (0.2) |
| C (the flat seven) | D, modal (0.6), G maj7 (0.4) |

These are the moves, with how often each is taken. Doc 24 limits dominant sevenths at cadences, so the marked cadences are:

- **Plagal**: G to D.
- **Modal**: C to D (the flat seven, a spring lift).
- **ii–I**: E minor 7 to D.
- **Deceptive**: A sus4 to B minor 7.
- **Half**: ending on A sus4.

The walk is also forbidden from forming a plain I–V–vi–IV loop. The table is the shape; the exact weights live in the recipe, and you tune them on sliders.

### Form templates: five for spring

| Template | Phrases (bars) | Tension curve | Slots |
|---|---|---|---|
| Song | statement 4, answer 5, development 4, return 3, cadence 2 | low, rise, peak, settle | interlude, morning |
| Duet | call 3, answer 3, call 3, answer and cadence 5 | gentle waves | interlude |
| Arch | statement 4, climb 4, peak 5, return 4, cadence 3 | one slow arch | evening, morning |
| Rain | statement 4, a bar of rest, answer 5, a bar of rest, cadence 6 | flat, inward | rain |
| Mist | long-note statement 5 (augmentation), answer 6, cadence 4 | very low | mist |

The phrase lengths mix 3, 5 and 6 bars on purpose (doc 24: no square four-bar closure every time).

## How a melody is grown

1. **Each phrase start takes a motif** that matches the role the template asks for (opening, answer, climbing and so on).
2. **The following bars develop it** with one of these, each with a weight you can slide:

| Technique | What it does | Starting weight |
|---|---|---|
| Return | the motif again, as is | 0.20 |
| Sequence | the motif moved up or down by scale steps to fit the new chord | 0.20 |
| Fragment | only its head or its tail | 0.15 |
| Extension | one or two more steps continue the motif's direction | 0.12 |
| Augmentation | twice as slow (mist and evening lean here) | 0.10 |
| Inversion | upside down around its first note | 0.08 |
| Displacement | the same notes, starting half a beat or a beat later | 0.08 |
| Diminution | twice as fast (rare, mornings only) | 0.07 |

3. **The fit step** places strong-beat notes on chord tones, or on a suspension that resolves down by step. Weak beats take passing and neighbor tones.
4. **Contour rules are checked**: a range of a tenth or less, one high point per phrase, every leap recovered by step, and every phrase ends on a goal note.

## The critic

The engine makes 24 candidates per seed and scores each one:

- **Rule breaks** (heavy penalty): parallel fifths or octaves against the bass, an unrecovered leap, more than one high point in a phrase, a range over a tenth.
- **Melodic interest**: some variety of steps, leaps and rhythms, without wandering.
- **Motif balance**: close to half recognizable motif, half development.
- **Tension match**: how well the piece follows its template's curve.
- **Frog band**: evening pieces stay out of D5 to F#6.
- **Freshness**: unlike what played recently.

The best four are kept, and the seed picks one of them. Growing a piece runs in a background worker, a minute before its slot opens.

## The Engine tab in the lab

```
+------------------------------------------------------------+
| Instruments | Piece | Day | Themes | Engine                 |
+------------------------------------------------------------+
| Season [spring]  Slot [interlude]  Seed [ 4127 ] [<] [>]   |
| "Low Mists at Dusk"            template: Song   [Play] [Keep]|
+------------------------------+-----------------------------+
| sheet music, each melody     | Development (sliders)       |
| note colored by its job:     |   Return       ----o----    |
|   motif / development /      |   Sequence     ----o----    |
|   chord tone / suspension /  |   Fragment     ---o-----    |
|   passing tone; bent rules   |   ...                       |
|   outlined in red            | Harmony (sliders)           |
+------------------------------+   Plagal       ----o----    |
| piano roll, same colors      |   Modal (C-D)  ---o-----    |
|                              | Critic (sliders)            |
| 24 candidates as small bars, |   Motif share  ----o----    |
| best four marked, the chosen |   ...                       |
| one highlighted              | [Twenty seeds in a row]     |
+------------------------------+-----------------------------+
```

On a phone the two columns stack, with the sliders below the music and no sideways scroll.

**Twenty seeds in a row** plays 20 consecutive seeds with a short gap between them. This is the doc 24 gate: you listen through, mark any seed that doesn't sound composed, and give bar notes.

Every slider writes to `recipes/music/develop.json`. When a setting sounds right, you press **Save settings**, and the page downloads the recipe for you to send me.

## Build order: small steps, each one heard

| Step | What gets built | What you check |
|---|---|---|
| 4a | Templates and the harmony walk; plays chords only, as a struck left hand under a held bed | Do the progressions sound like spring and never like a loop? |
| 4b | Melody: motifs placed and developed, then fitted | Do the phrases sound composed, with goal notes and cadences that land? |
| 4c | The critic and 24 candidates, in a worker | Is the chosen seed better than a random candidate? |
| 4d | The full Engine tab: note-job overlay, sliders, Keep, twenty seeds in a row | Tune it until 20 interlude seeds all pass |
| 4e | The material editor: write or edit motifs and grammar moves on a clickable grid | You can change a motif and hear it grow |

At each step I'll also send WAV recordings of a few seeds, so you can listen away from the lab.

## Files

- `src/audio/music/develop/`, split small:
  - `index.js` runs a seed into a piece file.
  - `template.js`, `harmony.js`, `melody.js`, `fit.js`, `critic.js` hold the engine's steps.
  - `jobs.js` is the worker entry.
- `recipes/music/material/spring.json`: the motif bank, chord grammar, templates and textures.
- `recipes/music/develop.json`: the technique weights, critic terms and candidate count.
- `tools/music-lab/engine.js`: the Engine tab, and later `material.js` for the material editor.
- New tests in `tools/unit-tests-develop.js`: the same seed always gives the same piece, no rule breaks across 200 seeds, and cadences land where the template says.

Everything stays on a new audio branch, `m2-music-develop`, and nothing touches shared game files.
