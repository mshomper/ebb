"""Build instrument recipes (vibraphone, glass), credits rows, audio-index lines and a size summary."""
import json, os, sys
import numpy as np
from collections import defaultdict

KIT = '/tmp/ebb-audio-work/kit'
W = KIT + '/vibraphone'
REPO = '/home/claude/ebb'
R = json.load(open(W + '/results.json'))
SR = 48000
NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B']
NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def sharp(m):
    return f"{NAMES_SHARP[m % 12]}{m // 12 - 1}"


def worst(rs, key):
    return max(r['verify']['ogg']['seam'][key] for r in rs)


def make_zones(rs, kind):
    by = defaultdict(list)
    for r in rs:
        by[r['midi']].append(r)
    zones = []
    for m in sorted(by):
        ls = sorted(by[m], key=lambda r: r['layer'])
        cs = [r['measuredCents'] for r in ls]
        spread = max(cs) - min(cs)
        wsp = max(r['windowSpreadCents'] for r in ls)
        conf = max(0.0, min(1.0, 1 - (spread + wsp) / 8))
        if kind == 'glass':
            conf = min(conf, 0.6)
        z = dict(note=ls[0]['note'], midi=m, measuredCents=round(float(np.mean(cs)), 2), tuneConfidence=round(conf, 2),
                 layerSpreadCents=round(spread, 2), tuneWindowSpreadCents=round(wsp, 2), layers=[])
        if kind == 'glass':
            z['namedInSource'] = ls[0]['namedNote']
        for r in ls:
            L = dict(file=r['file'], layer=r['layer'], peakDb=r['peakDb'], attackRmsDb=r['attackRmsDb'],
                     brightness=r['brightness'], lenS=r['lenS'], trimStartMs=r['trimStartMs'],
                     measuredCents=r['measuredCents'], src=r['srcName'], channels=1, mic=r['chName'])
            if r.get('loop'):
                L['loop'] = r['loop']
                L['loopRmsDb'] = r['loopRmsDb']
                s = r['verify']['ogg']['seam']
                L['loopCheck'] = dict(seamStepVsSteadyMax=s['seamToSteadyMax'], seamLevelDb=s['seamLevelDb'],
                                      naturalLevelDbMedian=s['naturalLevelDbMedian'], crossfadeCorrelation=r['loopSearch']['r'])
            if r['inst'] == 'glass':
                L['rub'] = r['speed'].lower()
            z['layers'].append(L)
        zones.append(z)
    return zones


def gaps(zs):
    out = []
    for a, b in zip(zs[:-1], zs[1:]):
        if b['midi'] - a['midi'] > 2:
            out.append(f"{sharp(a['midi'])} to {sharp(b['midi'])} ({b['midi'] - a['midi']} semitones)")
    return out


def sizes(rs):
    ogg = sum(r['oggBytes'] for r in rs); m4a = sum(r['m4aBytes'] for r in rs)
    dec = sum(int(round(r['lenS'] * SR)) * 4 for r in rs)
    return dict(files=len(rs), oggBytes=ogg, m4aBytes=m4a, decodedBytes=dec)


vib_struck = [r for r in R if r['inst'] == 'vibraphone' and r['set'] == 'struck']
vib_bowed = [r for r in R if r['inst'] == 'vibraphone' and r['set'] == 'bowed']
glass = [r for r in R if r['inst'] == 'glass']
zs, zb, zg = make_zones(vib_struck, 'struck'), make_zones(vib_bowed, 'bowed'), make_zones(glass, 'glass')

FORMATS_NOTE = ("formats: each file exists once per format under root, as <file>.ogg (Ogg Opus, 48 kHz mono, 56 kbps, "
                "variable bitrate) and <file>.m4a (AAC-LC, 48 kHz mono, 80 kbps); the browser picks the first it can play. "
                "Every file was processed at 48 kHz, so the sample positions of the decoded .ogg are the positions of the "
                "processed file (checked by cross-correlation: offset 0 for every file, length equal to the sample). The "
                ".m4a starts in the same place (offset 0) and decodes 0 to 21 ms longer, because AAC pads its last frame; "
                "for a looped file that padding lies after loop.endS and is never played. ")
COMMON_NOTE = ("An instrument recipe for the sampler (doc 24, Instruments, Sample preparation and Sampler rules). It describes "
               "exactly the files the prep step produced; nothing here is a tuning choice. type, id, name, version: what this is. "
               "source: where the recordings come from. channels: 1, every file is mono, taken from one microphone of the "
               "library's spaced stereo pair (see source.notes). " + FORMATS_NOTE +
               "root: folder of the files, relative to the repo. layers: the most velocity layers any set has, layer 1 the quietest. "
               "sets: one entry per articulation, each with source (the library subfolder) and zones; a zone is one recorded note: "
               "note (scientific pitch, C4 = middle C, sharps written s), midi (C4 = 60). measuredCents: the zone's measured "
               "pitch offset from 12-tone equal temperament at A4 = 440 Hz, in cents, as recorded (the mean of its layers): the "
               "frequency of the first partial from a zero-padded Hann spectrum, measured in two windows (struck: 0.2 to 1 s and 1 to "
               "2 s after the onset, 0.1 to 0.6 and 0.6 to 1.2 s above 1 kHz; looped: the second before the loop and the loop "
               "itself); tuneWindowSpreadCents is how far the two windows disagree, layerSpreadCents how far the layers disagree, "
               "and tuneConfidence (0 to 1) falls as either grows. layers: the files of the zone, quietest first; file is the path "
               "under root without extension. peakDb: sample peak in dBFS. attackRmsDb: RMS of the first 300 ms after the onset, "
               "in dBFS. brightness: share of energy above 1.5 times the fundamental (or 1 kHz, whichever is higher) in those first "
               "300 ms. lenS: length of the file in seconds. trimStartMs: how much was cut from the start (the onset, the first "
               "point above -50 dB of the file's peak, is kept with 3 ms before it). measuredCents on a layer is that file's own "
               "measurement. src: the original file name. mic: which microphone of the pair the file was taken from. No gain was "
               "changed anywhere. levels: normalized false means the library kept the recorded levels, so the layers already step "
               "up in level as they were played. range: the lowest and highest zone. problems: anything odd found while preparing, "
               "in plain words. ")
LOOP_NOTE = ("loop (looped sets only): startS and endS in seconds from the start of the file as encoded (sample = seconds x 48000, "
             "exact). The file ends at loop.endS. A note plays the file from 0, then repeats loop.startS to loop.endS sample "
             "for sample for as long as it is held, and the sampler's own release envelope ends it. The loop was chosen in the "
             "steady part of the sound by matching level, spectrum and level contour at both ends, the start sits on an upward "
             "zero crossing, the end was placed (on an upward crossing, within 12 ms) where the waveform best matches the "
             "material before the start, and the 250 ms before the start were blended into the last 250 ms of the loop with an "
             "equal-power crossfade corrected for that match (crossfadeCorrelation), so the wrap is seamless without any "
             "sampler crossfade. loopRmsDb: RMS of the loop region in dBFS (the held level). loopCheck, measured on the "
             "decoded .ogg with the loop played four times: seamStepVsSteadyMax, the largest sample-to-sample step at a seam "
             "divided by the largest step inside the loop (below 1 means the seam is smoother than the sound itself); "
             "seamLevelDb, the level change from the 50 ms before a seam to the 50 ms after it; naturalLevelDbMedian, the same "
             "50 ms to 50 ms change measured everywhere inside the loop, for comparison. ")

s_vib = sizes(vib_struck + vib_bowed); s_st = sizes(vib_struck); s_bw = sizes(vib_bowed); s_gl = sizes(glass)

vib = dict(
    type='instrument', id='vibraphone', name='Vibraphone (soft mallets and bowed)', version=1,
    note=COMMON_NOTE + LOOP_NOTE + (
        "VIBRAPHONE: struck is soft mallets, motor off, two velocity layers, each note left to ring and cut where its 50 ms "
        "RMS falls to 60 dB below its peak or at 5 s, whichever comes first, then an equal-power fade over the last 250 ms; "
        "not looped. bowed is the bar bowed with a bass bow, one take per note, looped; the bow swells in over 1 to 2 s, so "
        "attackRmsDb says little and loopRmsDb is the level to balance by. The bowed notes were recorded at their own levels "
        "(loop RMS from %.1f to %.1f dBFS), so the sampler" % (min(r['loopRmsDb'] for r in vib_bowed), max(r['loopRmsDb'] for r in vib_bowed)) + " should level them by loopRmsDb, not play them as recorded."),
    source=dict(library='VCSL (Versilian Community Sample Library)',
                url='https://github.com/sgossner/VCSL/tree/master/Idiophones/Struck%20Idiophones/Vibraphone',
                license='CC0 1.0', commit='c1ea7bcc3c73',
                notes=("Folder Idiophones/Struck Idiophones/Vibraphone, 44.1 kHz 16-bit stereo, subfolders Soft Mallets (11 notes x 2 "
                       "velocity layers, v1 and v2), Hard Mallets (11 notes x 2 layers, v2 and v3, not used), Bowed (6 notes, one "
                       "take). There is no motor-on (vibrato) recording in the library: every soft-mallet file is motor off (the "
                       "level contour of each loud layer has under 0.3 dB of periodic modulation). The file names sit one octave "
                       "low: Vibes_soft_F2 sounds F3 (174.6 Hz), Vibes_bowed_D4 sounds D5 (587 Hz); every file was placed by "
                       "measurement. The two microphones are spaced along the bars: per note the left-right balance runs from -13 "
                       "to +17 dB and the correlation from -0.34 to 0.99, so a plain left-plus-right fold lost up to 4.2 dB and "
                       "comb filtered. Each note therefore uses the one microphone that carries more of its ring (energy from 0.8 s "
                       "after the onset), the same for both layers. C4 v1 and E4 v1 come from the library's rr2 takes (no rr1 "
                       "exists for those). Levels are as recorded (not normalised).")),
    channels=1, formats=['ogg', 'm4a'], root='assets/audio/instruments/vibraphone/', layers=2,
    sets=dict(struck=dict(source='Soft Mallets', looped=False, tailMaxS=5.0, fadeS=0.25, zones=zs),
              bowed=dict(source='Bowed', looped=True, crossfadeS=0.25, zones=zb)),
    levels=dict(normalized=False, note=("Recorded levels. struck: v1 peaks %.1f to %.1f dBFS, v2 %.1f to %.1f dBFS. bowed: peaks %.1f to "
                                        "%.1f dBFS, loop RMS %.1f to %.1f dBFS." % (
                                            min(r['peakDb'] for r in vib_struck if r['layer'] == 1), max(r['peakDb'] for r in vib_struck if r['layer'] == 1),
                                            min(r['peakDb'] for r in vib_struck if r['layer'] == 2), max(r['peakDb'] for r in vib_struck if r['layer'] == 2),
                                            min(r['peakDb'] for r in vib_bowed), max(r['peakDb'] for r in vib_bowed),
                                            min(r['loopRmsDb'] for r in vib_bowed), max(r['loopRmsDb'] for r in vib_bowed)))),
    range=dict(struck=dict(low=zs[0]['note'], high=zs[-1]['note']), bowed=dict(low=zb[0]['note'], high=zb[-1]['note'])),
    sizes=dict(struck=s_st, bowed=s_bw, total=s_vib),
    problems=[
        "struck zones are 3 or 4 semitones apart (the library recorded every major or minor third), wider than doc 24's whole-tone rule: " + ", ".join(gaps(zs)) + ". A note between zones is shifted up to 2 semitones.",
        "bowed has only 6 notes, " + ", ".join(z['note'] for z in zb) + ", with gaps of " + ", ".join(gaps(zb)) + "; a note can be up to 3.5 semitones from its zone, so bowed lines should stay near the recorded notes (doc 24's winter and mist colors use it for held tones, which suits this).",
        "struck F3 (the lowest bar) is unlike the rest: its ring dies fast on one microphone, its third bar mode (1.91 kHz) is louder than the fundamental in the attack (brightness 0.78 and 0.98), and the soft layer is very quiet (peak -42 dBFS), which makes its measured pitch less sure (v1 -3.1 cents, v2 +1.0).",
        "struck C6 rings out (falls 60 dB) before the 5 s cap: v1 at 3.49 s, v2 at 4.48 s; every other struck file is cut at 5 s.",
        "bowed A3 is mostly its fourth partial (A5, the bar's tuned overtone two octaves up) with the fundamental 8 dB below it, so it sounds hollow and high; G4 also has a strong second mode (brightness 0.68).",
        "bowed levels differ a lot between notes as recorded (loop RMS " + ", ".join(f"{r['note']} {r['loopRmsDb']:.1f}" for r in sorted(vib_bowed, key=lambda r: r['midi'])) + " dBFS); level by loopRmsDb.",
        "Hard Mallets and motor-on recordings: the first is in the library but not used (summer asks for soft mallets); the second does not exist in VCSL.",
    ])

gl = dict(
    type='instrument', id='glass', name='Wine glasses (rubbed)', version=1,
    note=COMMON_NOTE + LOOP_NOTE + (
        "GLASS: one set, sus, the rim of a wine glass rubbed with a wet finger, looped. Two layers by rubbing speed: layer 1 "
        "slow (softer, slower warble), layer 2 fast (louder, about 5 Hz warble); see rub on each layer. The glasses are household "
        "glasses, not tuned instruments: each is placed at the note nearest its measured pitch, and measuredCents is large "
        "(up to 49 cents flat), so the sampler must apply it. The level of a rubbed glass swings by several dB a few times a "
        "second; that warble is part of the sound and is kept in the loop, which is why seamLevelDb is compared to "
        "naturalLevelDbMedian rather than to the 0.5 dB aim for steady sounds. The library's release recordings (the ring after "
        "the finger lifts, Releases/Slow and Releases/Fast) are not included; the sampler's release envelope stands in for them."),
    source=dict(library='VCSL (Versilian Community Sample Library)',
                url='https://github.com/sgossner/VCSL/tree/master/Idiophones/Friction%20Idiophones/Wine%20Glasses',
                license='CC0 1.0', commit='c1ea7bcc3c73',
                notes=("Folder Idiophones/Friction Idiophones/Wine Glasses, 44.1 kHz 24-bit stereo: four glasses (glass1 to glass4), "
                       "Sustains/Slow and Sustains/Fast (11.7 to 25.4 s of continuous rubbing) and Releases/Slow and Releases/Fast. "
                       "The file names are one octave low, and glass3, named A#4, sounds 963 Hz, 43 to 49 cents below B5, so it is "
                       "placed at B5. Each glass uses its left microphone, which carries more of the sound for all four (a "
                       "left-plus-right fold lost up to 7.7 dB, the pair being out of phase on glass3 and glass4). Levels are as "
                       "recorded.")),
    channels=1, formats=['ogg', 'm4a'], root='assets/audio/instruments/glass/', layers=2,
    sets=dict(sus=dict(source='Sustains/Slow (layer 1) and Sustains/Fast (layer 2)', looped=True, crossfadeS=0.25, zones=zg)),
    levels=dict(normalized=False, note=("Recorded levels: slow peaks %.1f to %.1f dBFS, fast %.1f to %.1f dBFS; loop RMS %.1f to %.1f dBFS." % (
        min(r['peakDb'] for r in glass if r['layer'] == 1), max(r['peakDb'] for r in glass if r['layer'] == 1),
        min(r['peakDb'] for r in glass if r['layer'] == 2), max(r['peakDb'] for r in glass if r['layer'] == 2),
        min(r['loopRmsDb'] for r in glass), max(r['loopRmsDb'] for r in glass)))),
    range=dict(low=zg[0]['note'], high=zg[-1]['note']),
    sizes=dict(sus=s_gl),
    problems=[
        "Only four glasses: " + ", ".join(z['note'] for z in zg) + " (gaps " + ", ".join(gaps(zg)) + "). Lines that leave these notes are shifted by up to 2.5 semitones, and a rubbed glass shifted far sounds less like glass; it suits held tones and shimmer near these pitches.",
        "Untuned glasses: zone pitches " + ", ".join(f"{z['note']} {z['measuredCents']:+.1f} c" for z in zg) + ". The slow and fast takes of one glass differ by up to %.1f cents, and the pitch drifts a few cents while rubbing." % max(z['layerSpreadCents'] for z in zg),
        "glass3 is named A#4 in the library but sounds near B5 (963 Hz); placed at B5.",
        "The warble makes the level at a loop seam move by %.1f to %.1f dB over 50 ms, against a median of %.1f to %.1f dB anywhere inside the same loops; the seams are as smooth as the sound around them." % (
            min(r['verify']['ogg']['seam']['seamLevelDb'] for r in glass), max(r['verify']['ogg']['seam']['seamLevelDb'] for r in glass),
            min(r['verify']['ogg']['seam']['naturalLevelDbMedian'] for r in glass), max(r['verify']['ogg']['seam']['naturalLevelDbMedian'] for r in glass)),
    ])

os.makedirs(REPO + '/recipes/music/instruments', exist_ok=True)
json.dump(vib, open(REPO + '/recipes/music/instruments/vibraphone.json', 'w'), indent=2)
json.dump(gl, open(REPO + '/recipes/music/instruments/glass.json', 'w'), indent=2)

# credits
VURL = 'https://github.com/sgossner/VCSL/tree/master/Idiophones/Struck%20Idiophones/Vibraphone'
GURL = 'https://github.com/sgossner/VCSL/tree/master/Idiophones/Friction%20Idiophones/Wine%20Glasses'
rows = [
    "| Instrument | Set | Source | Author and library | License | Edits |",
    "|---|---|---|---|---|---|",
    f"| Vibraphone, in `vibraphone/` | `struck` ({len(vib_struck)} files) | [Idiophones/Struck Idiophones/Vibraphone/Soft Mallets]({VURL}/Soft%20Mallets) | Versilian Studios LLC (VCSL) | CC0 1.0 | one microphone per note (the one carrying more of the ring), resampled to 48 kHz; trimmed to 3 ms before the onset; cut where the 50 ms RMS falls to -60 dB below peak or at 5 s, 250 ms equal-power fade to silence; no gain change; renamed one octave up to the pitch they sound (library names sit an octave low); encoded mono, Opus 56 kbps and AAC 80 kbps. |",
    f"| Vibraphone, in `vibraphone/` | `bowed` ({len(vib_bowed)} files) | [Idiophones/Struck Idiophones/Vibraphone/Bowed]({VURL}/Bowed) | Versilian Studios LLC (VCSL) | CC0 1.0 | one microphone per note, resampled to 48 kHz; trimmed to 3 ms before the onset; a loop found in the steady part with the 250 ms before its start blended into its end (baked crossfade), file cut at the loop end; no gain change; renamed one octave up; encoded mono, Opus 56 kbps and AAC 80 kbps. |",
    f"| Wine glasses, in `glass/` | `sus` ({len(glass)} files) | [Idiophones/Friction Idiophones/Wine Glasses/Sustains]({GURL}/Sustains) (Slow as layer 1, Fast as layer 2) | Versilian Studios LLC (VCSL) | CC0 1.0 | left microphone, resampled to 48 kHz; trimmed to 3 ms before the onset; looped like the bowed vibraphone (baked 250 ms crossfade, cut at the loop end); no gain change; placed at the note nearest each glass's measured pitch (D#5, F#5, B5, D6; the library names are an octave low and glass3 is named A#4); encoded mono, Opus 56 kbps and AAC 80 kbps. |",
]
open(KIT + '/vibraphone-credits.md', 'w').write("\n".join(rows) + "\n")
open(KIT + '/vibraphone-index.txt', 'w').write(
    '"music/instruments/vibraphone": "music/instruments/vibraphone.json",\n'
    '"music/instruments/glass": "music/instruments/glass.json"\n')
print(json.dumps(dict(struck=s_st, bowed=s_bw, vib=s_vib, glass=s_gl), indent=1))
print('struck cents', [(z['note'], z['measuredCents'], z['tuneConfidence']) for z in zs])
print('bowed cents', [(z['note'], z['measuredCents'], z['tuneConfidence']) for z in zb])
print('glass cents', [(z['note'], z['measuredCents'], z['tuneConfidence']) for z in zg])
print('bowed loopRms', [(r['note'], r['loopRmsDb']) for r in vib_bowed])
print('worst bowed seam', worst(vib_bowed, 'seamToSteadyMax'), worst(vib_bowed, 'seamLevelDb'))
print('worst glass seam', worst(glass, 'seamToSteadyMax'), worst(glass, 'seamLevelDb'))
print('m4a len diff', max(r['verify']['m4a']['lenDiffMs'] for r in R), 'lags', set(r['verify']['ogg']['lagMs'] for r in R), set(r['verify']['m4a']['lagMs'] for r in R))
