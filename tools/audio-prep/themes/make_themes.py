"""Write the island-theme candidates (doc 24, Motifs; phase 3) as piece files.

Four candidates, each a tide: it rises by step to one held note, then falls back past where it
began. Each has four seasonal settings of at most 40 s: spring D major, summer F major (with the
morning lift), autumn E Dorian (the theme also in the bass, on cello), winter D minor (the theme
in augmentation over open fifths, an inverted fragment to close). All original material.
"""
import json, os

REPO = '/home/claude/ebb'
OUT = os.path.join(REPO, 'recipes/music/pieces/themes')
os.makedirs(OUT, exist_ok=True)

SEASON = {
    'spring': {'key': 'D', 'K': 'D', 'mode': 'ionian'},
    'summer': {'key': 'F', 'K': 'F', 'mode': 'ionian'},
    'autumn': {'key': 'Edor', 'K': 'Edor', 'mode': 'dorian'},
    'winter': {'key': 'Dm', 'K': 'Dm', 'mode': 'aeolian'},
}

# Instruments and layers per season (doc 24, The four seasons). Lists are in order of preference;
# the realizer takes the first one that exists. bed/touch say how the support layers move per
# section: out, in, swell, steady, thin.
PALETTE = {
    'spring': {'melody': ['piano'], 'accomp': ['piano'], 'counter': ['flute', 'bell'], 'bed': ['strings', 'pad'], 'touch': ['harp', 'bell']},
    'summer': {'melody': ['fm-piano', 'piano'], 'accomp': ['piano'], 'counter': ['vibraphone', 'bell'], 'bed': ['strings', 'pad'], 'touch': ['vibraphone', 'bell']},
    'autumn': {'melody': ['piano'], 'accomp': ['piano'], 'counter': ['cello', 'piano'], 'bed': ['pad', 'strings'], 'touch': ['harp', 'bell']},
    'winter': {'melody': ['piano'], 'accomp': ['piano'], 'counter': ['vibraphone-bowed', 'glass', 'pad'], 'bed': ['strings', 'pad'], 'touch': ['bell']},
}
# Where the tides play as ordinary pieces (doc 24: all four tides, every season; the director's
# tides.weight keeps them from crowding other pieces). The home tide also opens each season.
SLOTS = {'spring': ['morning', 'interlude'], 'summer': ['morning', 'interlude'], 'autumn': ['morning', 'interlude', 'evening'], 'winter': ['morning', 'interlude', 'nocturne']}
BED_STYLE = {'spring': 'warm', 'summer': 'warm', 'autumn': 'warm', 'winter': 'open-fifths'}


def abc(meter, K, mel, acc=None, counter=None):
    unit = '1/8'
    s = f"X:1\nM:{meter}\nL:{unit}\nK:{K}\nV:mel\n{mel}\n"
    if counter:
        s += f"V:counter\n{counter}\n"
    if acc:
        s += f"V:acc\n{acc}\n"
    return s


def bars(line):
    return line.count('|')


C = {}

# ---------------------------------------------------------------- 1. First water (3/4)
C[1] = {
    'name': 'First water',
    'about': 'A waltz-like tide in 3/4: up by step from the home note to the fifth, held across the bar, then down past the start to the leading note. Plain and singable; the held note is the high water.',
    'meter': '3/4',
    'settings': {
        'spring': {'tempo': [80, 88], 'sections': {
            'A': {'mel': '!mp!"D"D3 E F2 | "Gmaj7"G2 A4- | "A7"A2 G F E2 | "D"D4 "A/C#"C2 |'},
            'B': {'mel': '"Bm7"B,2 D2 F2 | "Gmaj7"B4 A2 | "Em7"G2 F E D2 | "A"E6 |'},
            "A'": {'mel': '"D"D3 E F2 | "Gmaj7"G2 A4- | "A7sus4"A2 G F "A7"E2 | "D"D6 |',
                   'counter': 'z6 | z2 f2 e2 | d4 c2 | d6 |'},
            'coda': {'mel': '!p!"G/D"B,2 D2 G2 | "D"!fermata!F6 |'},
        }},
        'summer': {'tempo': [84, 92], 'sections': {
            'A': {'mel': '!mp!"F"F3 G A2 | "Bbmaj7"B2 c4- | "C7"c2 B A G2 | "F"F4 "C/E"E2 |'},
            'B': {'mel': '"Dm7"D2 F A d2 | "Bbmaj7"d2 c B c2 | "Gm7"B A G F G2 | "C"G6 |'},
            "A'": {'mel': '"F"F3 G A2 | "Bbmaj7"B2 c4- | "Csus4"c2 B A "C7"G2 | "F"F6 |',
                   'counter': 'z6 | z2 d2 e2 | f4 e2 | f6 |'},
            'coda': {'mel': '!p!"Bb/F"D2 F2 B2 | "F"!fermata!A6 |'},
        }},
        'autumn': {'tempo': [66, 74], 'sections': {
            'A': {'mel': '!p!"Em"E3 F G2 | "A"A2 B4- | "Bm7"B2 A G F2 | "Em"E4 "D"D2 |'},
            'B': {'mel': '"Em"B6 | "A"c6 | "Bm7"d6 | "Em"B4 "D"A2 |',
                  'counter': 'E,3 F, G,2 | A,2 B,4- | B,2 A, G, F,2 | E,4 D,2 |'},
            "A'": {'mel': '"Em"E3 F G2 | "A"A2 B4- | "Bm7"B2 A G "D"F2 | "Em"E6 |'},
            'coda': {'mel': '!pp!"A/E"E2 A2 c2 | "Em"!fermata!B6 |'},
        }},
        'winter': {'tempo': [50, 56], 'sections': {
            'A': {'mel': '!p!"Dm"D6 | "Dm"E2 F4 | "Gm"G4 A2- | "F"A6- | "Am7"A4 G2 | "Gm7"F2 E4 | "Dm"D6- | "Dm"D2 "Am/C"C4 |',
                  'acc': '[D,,A,,]6 | [D,,A,,]6 | [G,,D,]6 | [F,,C,]6 | [A,,E,]6 | [G,,D,]6 | [D,,A,,]6 | [D,,A,,]2 [C,G,]4 |',
                  'counter': 'z6 | z6 | d6- | d6 | c6 | B6 | z6 | z6 |'},
            'coda': {'mel': '!pp!"Gm/Bb"D2 C2 B,2 | "Dm"!fermata!A,6 |',
                     'acc': '[G,,D,]6 | [D,,A,,]6 |'},
        }},
    },
}

# ---------------------------------------------------------------- 2. Sandbar (6/8)
C[2] = {
    'name': 'Sandbar',
    'about': 'A lilting 6/8 tide that starts below the home note, on the sixth, climbs by step to the third and holds it a whole bar, then slips down past the start to the fifth below. A little wistful; it begins on the minor chord.',
    'meter': '6/8',
    'settings': {
        'spring': {'tempo': [66, 72], 'sections': {
            'A': {'mel': '!mp!"Bm7"B,2 C D2 E | "Gmaj7"F6- | "Em7"F2 E D "A7"C B, | "D/A"A,6 |'},
            'B': {'mel': '"Gmaj7"D2 E F2 A | "F#m7"A3 G2 F | "Em9"E2 F G2 B | "A7sus4"A6 |'},
            "A'": {'mel': '"Bm7"B,2 C D2 E | "Gmaj7"F3- F2 A | "Em7"G2 F E "A7"D C | "D"D6 |',
                   'counter': 'z6 | z3 c3 | B3 A3 | F6 |'},
            'coda': {'mel': '!p!"G/D"B,2 D G2 B | "D"!fermata!A6 |'},
        }},
        'summer': {'tempo': [72, 80], 'sections': {
            'A': {'mel': '!mp!"Dm7"D2 E F2 G | "Bbmaj7"A6- | "Gm7"A2 G F "C7"E D | "F/C"C6 |'},
            'B': {'mel': '"Bbmaj7"F2 G A2 c | "C/Bb"c3 B2 A | "Am7"G2 A B2 d | "C7sus4"c6 |'},
            "A'": {'mel': '"Dm7"D2 E F2 G | "Bbmaj7"A3- A2 c | "Gm7"B2 A G "C7"F E | "F"F6 |',
                   'counter': 'z6 | z3 e3 | d3 c3 | A6 |'},
            'coda': {'mel': '!p!"Bb/F"D2 F B2 d | "F"!fermata!c6 |'},
        }},
        'autumn': {'tempo': [60, 66], 'sections': {
            'A': {'mel': '!p!"F#m7"C2 D E2 F | "G"G6- | "A7"G2 F E D C | "Em/B"B,6 |'},
            'B': {'mel': '"F#m7"e6 | "G"d6 | "A7"c6 | "Em"B6 |',
                  'counter': 'C,2 D, E,2 F, | G,6- | G,2 F, E, D, C, | B,,6 |'},
            "A'": {'mel': '"F#m7"C2 D E2 F | "G"G3- G2 B | "A7"A2 G F E D | "Em"E6 |'},
            'coda': {'mel': '!pp!"A/E"E2 A c2 e | "Em"!fermata!B6 |'},
        }},
        'winter': {'tempo': [42, 48], 'sections': {
            'A': {'mel': '!p!"Gm"B,4 C2 | "Dm"D4 E2 | "Bb"F6- | "Dm/F"F6- | "C"F4 E2 | "Bb"D2 C2 B,2 | "Dm/A"A,6- | "A"A,6 |',
                  'acc': '[G,,D,]6 | [D,,A,,]6 | [B,,F,]6 | [B,,F,]6 | [C,G,]6 | [B,,F,]6 | [D,,A,,]6 | [A,,E,]6 |',
                  'counter': 'z6 | z6 | d6- | d6 | c6- | c6 | z6 | ^c6 |'},
            'coda': {'mel': '!pp!"Gm"F2 E D2 C | "Dm"!fermata!D6 |',
                     'acc': '[G,,D,]6 | [D,,A,,]6 |'},
        }},
    },
}

# ---------------------------------------------------------------- 3. Breath (4/4)
C[3] = {
    'name': 'Breath',
    'about': 'The smallest tide: two bars in 4/4, a breath in (third, fourth, fifth, held) and a breath out (down by step to the home note). Hymn-like; it says the most when it is said slowly.',
    'meter': '4/4',
    'settings': {
        'spring': {'tempo': [72, 80], 'sections': {
            'A': {'mel': '!mp!"D"F2 G2 A4- | "Gmaj7"A2 G F "A7sus4"E2 D2 | "Bm7"F2 G2 B4- | "Em7"B2 A G "A7"F2 E2 |'},
            'B': {'mel': '"Bm7"d2 c B "F#m7"A2 F2 | "Gmaj7"G2 F E "A7sus4"E4 |'},
            "A'": {'mel': '"D"F2 G2 A4- | "G"A2 G F "A7"E2 "D"D2 |',
                   'counter': 'z4 c4 | d8 |'},
            'coda': {'mel': '!p!"G/D"B,2 D2 G4 | "D"!fermata!F8 |'},
        }},
        'summer': {'tempo': [76, 84], 'sections': {
            'A': {'mel': '!mp!"F"A2 B2 c4- | "Bbmaj7"c2 B A "C7sus4"G2 F2 | "Dm7"A2 B2 d4- | "Gm7"d2 c B "C7"A2 G2 |'},
            'B': {'mel': '"Dm7"f2 e d "Am7"c2 A2 | "Bbmaj7"B2 A G "C7sus4"G4 |'},
            "A'": {'mel': '"F"A2 B2 c4- | "Bb"c2 B A "C7"G2 "F"F2 |',
                   'counter': 'z4 e4 | f8 |'},
            'coda': {'mel': '!p!"Bb/F"D2 F2 B4 | "F"!fermata!A8 |'},
        }},
        'autumn': {'tempo': [66, 72], 'sections': {
            'A': {'mel': '!p!"Em"G2 A2 B4- | "A7"B2 A G "Em"F2 E2 | "G"B2 c2 d4- | "A7"d2 c B "Bm7"A2 F2 |'},
            'B': {'mel': '"Em"e8 | "A7"c8 |',
                  'counter': 'G,2 A,2 B,4- | B,2 A, G, F,2 E,2 |'},
            "A'": {'mel': '"Em"G2 A2 B4- | "A7"B2 A G "Em"F2 E2 |'},
            'coda': {'mel': '!pp!"A/E"E2 A2 c4 | "Em"!fermata!B8 |'},
        }},
        'winter': {'tempo': [48, 54], 'sections': {
            'A': {'mel': '!p!"Dm"F4 G4 | "Bbmaj7"A8- | "Gm"A4 G2 F2 | "Am"E4 "Dm"D4 |',
                  'acc': '[D,,A,,]8 | [B,,F,]8 | [G,,D,]8 | [A,,E,]4 [D,,A,,]4 |',
                  'counter': 'z8 | c8 | d8 | z8 |'},
            'B': {'mel': '"Bb"F2 E2 D4- | "Gm"D2 E F "A"G2 A2 |',
                  'acc': '[B,,F,]8 | [G,,D,]4 [A,,E,]4 |'},
            'coda': {'mel': '!pp!"Dm"!fermata!D8 |',
                     'acc': '[D,,A,,]8 |'},
        }},
    },
}

# ---------------------------------------------------------------- 4. Moon pull (3/4)
C[4] = {
    'name': 'Moon pull',
    'about': 'A 3/4 tide that runs up the scale in one breath to the sixth and leans on it (the pull of something just out of reach), then falls in thirds and steps past the start to the fifth below.',
    'meter': '3/4',
    'settings': {
        'spring': {'tempo': [76, 84], 'sections': {
            'A': {'mel': '!mp!"D"D E F G A B- | "Em7"B4 A2 | "F#m7"F2 E2 C2 | "A"A,6 |'},
            'B': {'mel': '"Gmaj7"G2 B2 d2 | "F#m7"c4 A2 | "Em7"B2 G2 E2 | "Asus4"D4 "A"C2 |'},
            "A'": {'mel': '"D"D E F G A B- | "Gmaj7"B4 A2 | "Em7"F2 E2 "A7"C2 | "D"D6 |',
                   'counter': 'z6 | d4 c2 | A4 G2 | F6 |'},
            'coda': {'mel': '!p!"G/D"G2 B2 d2 | "D"!fermata!d6 |'},
        }},
        'summer': {'tempo': [84, 92], 'sections': {
            'A': {'mel': '!mp!"F"F G A B c d- | "Gm7"d4 c2 | "Am7"A2 G2 E2 | "C"C6 |'},
            'B': {'mel': '"Bbmaj7"B2 d2 f2 | "Am7"e4 c2 | "Gm7"d2 B2 G2 | "Csus4"F4 "C"E2 |'},
            "A'": {'mel': '"F"F G A B c d- | "Bbmaj7"d4 c2 | "Gm7"A2 G2 "C7"E2 | "F"F6 |',
                   'counter': 'z6 | f4 e2 | c4 B2 | A6 |'},
            'coda': {'mel': '!p!"Bb/F"B2 d2 f2 | "F"!fermata!f6 |'},
        }},
        'autumn': {'tempo': [66, 72], 'sections': {
            'A': {'mel': '!p!"Em"E F G A B c- | "F#m7"c4 B2 | "G"G2 F2 D2 | "Em/B"B,6 |'},
            'B': {'mel': '"Em"B6 | "F#m7"A6 | "G"G6 | "Bm"F6 |',
                  'counter': 'E, F, G, A, B, C- | C4 B,2 | G,2 F,2 D,2 | B,,6 |'},
            "A'": {'mel': '"Em"E F G A B c- | "A"c4 B2 | "G"G2 F2 "D"D2 | "Em"E6 |'},
            'coda': {'mel': '!pp!"A/E"c2 e2 a2 | "Em"!fermata!g6 |'},
        }},
        'winter': {'tempo': [51, 56], 'sections': {
            'A': {'mel': '!p!"Dm"D2 E2 F2 | "Gm"G2 A2 B2- | "Bb"B6- | "Bbmaj7"B2 A4 | "Dm"F4 E2- | "C"E2 C4 | "Dm/A"A,6- | "A"A,6 |',
                  'acc': '[D,,A,,]6 | [G,,D,]6 | [B,,F,]6 | [B,,F,]6 | [D,,A,,]6 | [C,G,]6 | [D,,A,,]6 | [A,,E,]6 |',
                  'counter': 'z6 | z6 | d6- | d6 | A6 | G6 | z6 | z6 |'},
            'coda': {'mel': '!pp!"Bb"F2 G2 A2 | "Dm"!fermata!D6 |',
                     'acc': '[B,,F,]6 | [D,,A,,]6 |'},
        }},
    },
}

# How the bed and the touches move, by section (winter has no answer section).
LAYERS = {
    'spring': {'bed': {'A': 'out', 'B': 'swell', "A'": 'steady', 'coda': 'thin'}, 'touch': 0.8},
    'summer': {'bed': {'A': 'in', 'B': 'swell', "A'": 'steady', 'coda': 'thin'}, 'touch': 0.9},
    'autumn': {'bed': {'A': 'in', 'B': 'steady', "A'": 'swell', 'coda': 'thin'}, 'touch': 0.7},
    'winter': {'bed': {'A': 'swell', 'B': 'steady', 'coda': 'thin'}, 'touch': 0.5},
}

index = {'note': 'The island-theme candidates (doc 24, Motifs; phase 3): four tides, each in four seasonal settings of at most 40 s. Each id names recipes/music/pieces/themes/<id>.json. Matt chooses one theme (or rewrites one).', 'seasons': list(SEASON), 'candidates': []}
for n, cand in C.items():
    entry = {'n': n, 'name': cand['name'], 'about': cand['about'], 'settings': {}}
    for season, st in cand['settings'].items():
        S = SEASON[season]
        meter = cand['meter']
        sections = {}
        for name, sec in st['sections'].items():
            mel = sec['mel'].strip()
            nb = bars(mel)
            for v in ('acc', 'counter'):
                if sec.get(v):
                    assert bars(sec[v]) == nb, f'{n} {season} {name} {v}: {bars(sec[v])} bars, mel {nb}'
            sections[name] = {'bars': nb, 'abc': abc(meter, S['K'], mel, sec.get('acc'), sec.get('counter'))}
        names = list(sections)
        grammar = ' '.join(names)
        pid = f'theme-{n}-{season}'
        piece = {
            'id': pid,
            'title': f'Theme {n}, {cand["name"]}: {season}',
            'version': 1,
            'theme': {'candidate': n, 'name': cand['name'], 'season': season},
            'slots': SLOTS[season],
            'seasons': [season],
            'weather': ['clear', 'cloud'],
            'requires': {},
            'avoidWhen': {},
            'keys': [S['key']],
            'mode': S['mode'],
            'meter': meter,
            'tempo': st['tempo'],
            'palette': PALETTE[season],
            'layers': {'bed': {'style': BED_STYLE[season], 'sections': {k: v for k, v in LAYERS[season]['bed'].items() if k in sections}}, 'touch': {'chance': LAYERS[season]['touch']}},
            'form': {'grammar': grammar, 'short': grammar, 'optional': {}},
            'sections': sections,
            'variation': {'octave': [0], 'paraphrase': 0, 'ornament': 0.1},
            'motifs': [],
            'notes': cand['about'] + {
                'spring': ' Spring: D major, bright piano; the bed comes in for the answer, a flute echoes the held note, harp touches the cadences.',
                'summer': ' Summer: F major with the morning lift (a busier answer); the code-built piano leads, a warm string bed, vibraphone touches.',
                'autumn': ' Autumn: E Dorian, lower and rounder; the answer puts the theme in the bass on the cello under a high held line.',
                'winter': ' Winter: D minor, the theme in augmentation over open fifths, a bowed high line, and an inverted fragment to close.',
            }[season],
        }
        with open(os.path.join(OUT, f'{pid}.json'), 'w') as f:
            json.dump(piece, f, indent=1, ensure_ascii=False)
            f.write('\n')
        entry['settings'][season] = pid
    index['candidates'].append(entry)

with open(os.path.join(REPO, 'recipes/music/pieces/themes/index.json'), 'w') as f:
    json.dump(index, f, indent=1, ensure_ascii=False)
    f.write('\n')
print('ok', sum(len(c['settings']) for c in C.values()), 'settings')
