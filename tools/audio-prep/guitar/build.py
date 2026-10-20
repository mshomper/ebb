"""Write recipes/music/instruments/guitar.json from prep.py's results.json, and print the credit lines.
Usage: python build.py <work folder> [<repo>]"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = sys.argv[1]
REPO = sys.argv[2] if len(sys.argv) > 2 else os.path.abspath(os.path.join(HERE, '..', '..', '..'))
R = json.load(open(os.path.join(WORK, 'results.json')))
URL = 'https://theremin.music.uiowa.edu/MISguitar.html'
STRING_NAME = {'sulE': 'low E', 'sulA': 'A', 'sulD': 'D', 'sulG': 'G', 'sulB': 'B', 'sul_E': 'high E'}


def conf(n, resid, spread, nwant=6):
    r = resid if resid is not None else 3.0
    return round(min(1.0, n / nwant) * (1 / (1 + (r / 2.5) ** 2)) * (1 / (1 + (spread / 4.0) ** 2)), 2)


by = {}
for r in R:
    by.setdefault(r['midi'], []).append(r)
zones = []
for m in sorted(by):
    L = sorted(by[m], key=lambda r: r['layer'])
    ref = L[-1]
    cs = [r['pitch']['cents'] for r in L if r['pitch']]
    spread = round(max(cs) - min(cs), 2) if cs else 0
    p = ref['pitch']
    zones.append(dict(
        note=ref['note'], midi=m, measuredCents=p['cents'], tuneConfidence=conf(p['nPartials'], p['residCents'], spread),
        tuneResidualCents=p['residCents'], tunePartials=p['partials'], tuneLayer=ref['layer'], layerSpreadCents=spread,
        string=STRING_NAME[ref['string']], fret=ref['fret'],
        layers=[dict(file=r['out'], layer=r['layer'], peakDb=r['peakDb'], attackRmsDb=r['attackRmsDb'], lenS=r['lenS'],
                     trimStartMs=r['trimStartMs'], measuredCents=r['pitch']['cents'] if r['pitch'] else 0, endReason=r['endReason'],
                     src=f"{r['file']} (pluck at {r['onset'] / r['srcRate']:.2f} s)", channels=1) for r in L]))

cents = [z['measuredCents'] for z in zones]
size = dict(files=len(R), oggBytes=sum(r['oggBytes'] for r in R), m4aBytes=sum(r['m4aBytes'] for r in R),
            decodedBytes48kFloat=int(sum(round(r['lenS'] * 48000) * 4 for r in R)))
short = [r['out'] for r in R if r['endReason'] == 'next pluck']
problems = [
    f"The guitar is tuned flat, as recorded: zone pitches run from {min(cents):+.1f} to {max(cents):+.1f} cents (the low E string about 43 flat, the treble strings 11 to 26 flat). Nothing was corrected in the files; the sampler applies measuredCents at playback (tuning policy equal).",
    "Each source file is a chromatic run on one string; plucks were found by their attack (a 15 dB rise in 50 ms) and named by measured pitch, not by their place in the run, then checked by a partials fit. Of 354 notes in the 46 runs, every one was found.",
    "Zones are every minor third from E2 to A#5 (15 zones), each the take nearest the third fret on the string that plays it there; E2 is the open low E (nothing lower exists). Each zone stretches a semitone either way, so the playable range is D#2 to B5.",
    "Notes ring much longer than 4 s in the source (the median gap to the next pluck is 7.5 s), so all but " + str(len(short)) + " files end at the 4 s maximum with a 250 ms fade from a still-ringing note." + (f" {', '.join(short)} end at the next pluck (the run went on sooner)." if short else ''),
    "Recorded in an anechoic chamber with a measurement microphone: very dry, no room. The music's own reverb gives it space. Mono as recorded.",
    "Levels are as recorded, not normalized. The sampler levels zones by attackRmsDb.",
]
recipe = dict(
    type='instrument', id='guitar', name='Nylon-string guitar', version=1,
    note=("An instrument recipe for the sampler (doc 24). A classical (nylon-string) guitar, plucked, not looped. Each file is one pluck cut from the Iowa MIS chromatic runs: trimmed to 3 ms before the onset, "
          "resampled from 96 kHz to 48 kHz, cut at the next pluck less 20 ms or at 4 s, whichever comes first, with a 250 ms equal-power fade to silence, as the harp. No gain change. Mono. "
          "formats: <file>.ogg is Ogg Opus 56 kbps mono (variable bitrate), <file>.m4a is AAC-LC 80 kbps mono. "
          "Zone fields as in harp.json: measuredCents is the zone's pitch against 12-TET at A4 = 440 Hz, fitted from partials 1 to 6 of the louder layer; tuneConfidence 0 to 1; string and fret say where it was played. "
          "layers: v1 is pp, v2 is mf (the library's ff is not used: the game plays the guitar softly). Tools: tools/audio-prep/guitar/ (prep.py, build.py)."),
    source=dict(library='University of Iowa Electronic Music Studios, Musical Instrument Samples (MIS): Guitar', url=URL,
                license='Free to use: the studio says the recordings "may be downloaded and used for any projects, without restrictions". Not formally CC0, so listed in assets/audio/LICENSES-NONCC0.md (doc 25).',
                notes='Raimundo 118 classical guitar, played by Brian Penkrot (2011); Earthworks QTC40 microphone at 5 ft, anechoic chamber; mono 24-bit 96 kHz AIFF (Guitar.mono.2496.zip). One file per string per dynamic (pp, mf, ff), each a chromatic run.'),
    channels=1, formats=['ogg', 'm4a'], root='assets/audio/instruments/guitar/', layers=2,
    sets=dict(pluck=dict(source='Guitar.mono.2496 chromatic runs, pp and mf', zones=zones)),
    levels=dict(normalized=False, note='Recorded levels, not normalized: mf is louder than pp at the same note. Play layers at their own level; level zones against each other by attackRmsDb.'),
    range=dict(low='E2', high='A#5', playable='D#2 to B5 (each zone stretches a semitone)'),
    size=size, problems=problems)
os.makedirs(os.path.join(REPO, 'recipes', 'music', 'instruments'), exist_ok=True)
json.dump(recipe, open(os.path.join(REPO, 'recipes', 'music', 'instruments', 'guitar.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print('guitar.json:', size)
for p in problems:
    print('-', p)
