"""Strings kit: write instrument recipes, credits rows, index lines and size scenarios from results/prep.json."""
import os, json
from urllib.parse import quote

KIT = '/tmp/ebb-audio-work/kit'
REPO = '/home/claude/ebb'
R = json.load(open(KIT + '/strings/results/prep.json'))
COMMIT = '440300901dfe'
BASE = 'https://github.com/sgossner/VSCO-2-CE/tree/master/Strings/'
SR = 48000

# the second take of the cello E1 soft layer is dropped (rr1 kept: shorter file, loops as cleanly)
DROP_FILES = {('strings-celli', 'sus/E2-v1-rr2')}
for iid, f in DROP_FILES:
    for ext in ('ogg', 'm4a'):
        p = f"{REPO}/assets/audio/instruments/{iid}/{f}.{ext}"
        if os.path.exists(p):
            os.remove(p)
R = [r for r in R if (r['id'], r['file']) not in DROP_FILES]

META = {
    'strings-violins': dict(name='Violin section (VSCO 2 CE), sustain with vibrato', folder='Violin Section/susVib',
                            srcLayers='v1 (soft) and v2 (loud)',
                            dropped='A3 (G3, A3 and B3 are whole tones apart in the source; A3 is played from G3 or B3)'),
    'strings-violas': dict(name='Viola section (VSCO 2 CE), sustain with vibrato', folder='Viola Section/susvib',
                           srcLayers='v1 (soft) and v2 (loud)',
                           dropped='D3 (C3, D3 and E3 are whole tones apart; D3 is played from C3 or E3) and D6 (above the violas\' bed range; the violins cover it)'),
    'strings-celli': dict(name='Cello section (VSCO 2 CE), sustain with vibrato', folder='Cello Section/susvib',
                          srcLayers='v1 (soft) and v3 (loud); the source has no v2',
                          dropped='none (the source is already about every third); the second take of the soft E2 (susvib_E1_v1_2) was set aside, rr1 kept'),
    'strings-basses': dict(name='Contrabass (solo, VSCO 2 CE), sustain with vibrato', folder='Solo Contrabass/SusVib',
                           srcLayers='v1 (soft) and v3 (loud); the source has no v2',
                           dropped='everything below D2 (doc 24: no sub-bass below 60 Hz; the D2 zone reaches down to C2, MIDI 36, and no lower), E2 and G#2 (thinned toward minor thirds), and G#3 and B3 (above E3 the celli take over)'),
}


def mbytes(n):
    return round(n / 1e6, 2)


def decoded_bytes(r, mono=False):
    return int(round(r['lenS'] * SR)) * (1 if mono else r['channels']) * 4


out_index, credits = [], []
summary = {}
for iid, meta in META.items():
    rs = sorted([r for r in R if r['id'] == iid], key=lambda r: (r['midi'], r['layer']))
    zones = {}
    for r in rs:
        zones.setdefault(r['midi'], []).append(r)
    zl, probs = [], []
    for midi, Ls in sorted(zones.items()):
        Ls.sort(key=lambda r: r['layer'])
        ref = Ls[-1] if len(Ls) == 1 else min(Ls, key=lambda r: -r['tuneConfidence'])
        z = dict(note=Ls[0]['file'].split('/')[1].split('-')[0], midi=midi, measuredCents=ref['measuredCents'],
                 tuneConfidence=ref['tuneConfidence'], tuneLayer=ref['layer'],
                 layerSpreadCents=round(max(r['measuredCents'] for r in Ls) - min(r['measuredCents'] for r in Ls), 2),
                 layers=[])
        for r in Ls:
            sm = r['encode']['ogg']['seam']
            z['layers'].append(dict(file=r['file'], layer=r['layer'], peakDb=r['peakDb'], attackRmsDb=r['attackRmsDb'],
                                    brightness=r['brightness'], lenS=round(r['lenS'], 4),
                                    loop=r['loop'], trimStartMs=r['trimStartMs'], measuredCents=r['measuredCents'],
                                    loopCheck=dict(seamLevelDb=sm['seamLevelDb'], steadyWobbleDb=sm['steadyWobbleDb'],
                                                   seamStepRatio=sm['stepRatio'], seamKinkRatio=sm['curvRatio']),
                                    src=r['srcname'], channels=r['channels']))
            for p in r['problems']:
                if p.startswith('pitch: frame tracker'):
                    p = p + ' (the comb reads the vibrato-smeared average spectrum; the frame tracker\'s median is used)'
                probs.append(f"{r['file']} ({r['srcname']}): {p}")
            if sm['stepRatio'] > 1.0:
                probs.append(f"{r['file']}: after Opus the sample step at the loop seam is {sm['stepRatio']:.2f} times the largest step inside the loop (before encoding {r['wavSeam']['stepRatio']:.2f}); small, but the worst seam of the set")
            if sm['curvRatio'] > 1.5:
                probs.append(f"{r['file']}: after Opus the waveform bends a little at the loop seam (second difference {sm['curvRatio']:.2f} times the largest inside the loop; {r['wavSeam']['curvRatio']:.2f} before encoding): codec error at the join, very small in level, listen for a faint tick")
            if sm['seamLevelDb'] > 0.5:
                probs.append(f"{r['file']}: level changes by {sm['seamLevelDb']} dB across the loop seam (250 ms either side; the note's own 250 ms wobble is {sm['steadyWobbleDb']} dB)")
        if len(Ls) == 2 and Ls[1]['brightness'] <= Ls[0]['brightness']:
            probs.append(f"{z['note']}: the loud layer is not brighter than the soft one (v1 {Ls[0]['brightness']:.3f}, v2 {Ls[1]['brightness']:.3f}); expected for soft bowing, whose first 300 ms is mostly bow noise before the tone builds, so the measure reads it as bright")
        if len(Ls) < 2:
            probs.append(f"{z['note']}: only one layer")
        zl.append(z)
    gaps = [(a['note'], b['note'], b['midi'] - a['midi']) for a, b in zip(zl, zl[1:]) if b['midi'] - a['midi'] > 2]
    if gaps:
        probs.append('zones further apart than a whole tone, by design (the kit brief thins to about a minor third; '
                     'a note is played from the nearer zone, at most 2 semitones away): ' +
                     ', '.join(f"{a} to {b} ({n})" for a, b, n in gaps))
    late = [r for r in rs if r['loop']['startS'] > 3.0]
    if late:
        probs.append('soft swells: in ' + str(len(late)) + ' files the source takes over 3 s to settle, so the loop starts late and the file is longer: ' +
                     ', '.join(f"{r['file']} (loop from {r['loop']['startS']:.2f} s)" for r in late))
    m4alen = sorted(r['encode']['m4a']['lenDiffSamples'] for r in rs)
    probs.append(f"m4a files decode {m4alen[0]} to {m4alen[-1]} samples ({m4alen[0] / 48:.0f} to {m4alen[-1] / 48:.0f} ms) longer than the .ogg because AAC pads its last frame; their start is not shifted (lag 0 against the processed file), so the same loop times hold and loop.endS, not the file end, must be the loop end")
    low, high = zl[0]['midi'], zl[-1]['midi']
    from_name = lambda m: f"{['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][m % 12]}{m // 12 - 1}"
    ogg = sum(r['oggBytes'] for r in rs)
    m4a = sum(r['m4aBytes'] for r in rs)
    dec = sum(decoded_bytes(r) for r in rs)
    summary[iid] = dict(files=len(rs), zones=len(zl), ogg=ogg, m4a=m4a, decoded=dec,
                        decodedV1=sum(decoded_bytes(r) for r in rs if r['layer'] == 1),
                        decodedV1Mono=sum(decoded_bytes(r, True) for r in rs if r['layer'] == 1),
                        lenS=round(sum(r['lenS'] for r in rs), 1),
                        worstSeamDb=max(r['encode']['ogg']['seam']['seamLevelDb'] for r in rs),
                        worstStep=max(r['encode']['ogg']['seam']['stepRatio'] for r in rs),
                        worstCents=max(abs(r['measuredCents']) for r in rs))
    rec = dict(
        type='instrument', id=iid, name=meta['name'], version=1,
        note=("An instrument recipe for the sampler (doc 24, Instruments, Sample preparation and Sampler rules), made for the "
              "strings support kit (October 19, 2026). It describes exactly the files the prep step produced; nothing here is a tuning choice. "
              "Every file is a held, bowed note with a baked loop: layer.loop gives startS and endS in seconds from the file's start, and the "
              "file ends at endS. The 200 ms before loopStart were blended into the end of the loop (equal-power, corrected for the measured "
              "correlation of the two passages), so a plain sample-accurate loop from endS back to startS is seamless; the sampler releases "
              "the note with its own envelope. formats: each file exists once per format under root, as <file>.ogg (Ogg Opus, 48 kHz, 80 kbps "
              "stereo, variable bitrate) and <file>.m4a (AAC-LC, 48 kHz, 128 kbps stereo). Loop times were checked against the decoded .ogg "
              "(same length and start to the sample). measuredCents: the median of a frame-by-frame pitch track (10 ms frames, normalised "
              "square difference) over the steady part, against 12-TET at A440; vibrato averages out in the median. tuneConfidence: the "
              "share of frames with a clear period times (1 - interquartile range of the track / 60 cents). peakDb and attackRmsDb (first "
              "300 ms) are as recorded: VSCO 2 CE keeps its recorded levels, so the soft layer peaks 4 to 22 dB below the loud one (its first 300 ms 6 to 40 dB below, because soft bowing starts slowly). "
              "brightness: share of energy above max(1.5 x the fundamental, 1 kHz) in the first 300 ms. loopCheck: the decoded .ogg played "
              "with the loop four times; seamLevelDb compares 250 ms either side of the seam, steadyWobbleDb is the same measure between "
              "neighbouring 250 ms windows inside the loop, seamStepRatio is the sample step at the seam over the largest step inside the loop. "
              "Note names: the library's file names sit one octave low against scientific pitch (its C3 is middle C); every zone here is named "
              "by the pitch it sounds, confirmed by measurement (src keeps the original name)."),
        source=dict(library='VSCO 2 Community Edition (Versilian Studios)', url=BASE + quote(meta['folder']), license='CC0 1.0',
                    commit=COMMIT,
                    notes=(f"Folder Strings/{meta['folder']}, sustain with vibrato. Source layers {meta['srcLayers']}, renumbered v1 (soft) and v2 (loud). "
                           f"One take per note. Zones not used: {meta['dropped']}. LICENSE is CC0 1.0; the library's Readme.txt also asks (without binding terms) "
                           "that the samples not be sold on their own, and for credit to Versilian Studios/Sam Gossner and Ivy Audio/Simon Dalzell. "
                           "README.md: recorded by Sam Gossner and Simon Dalzell, sample cutting by Elan Hickler/Soundemote.")),
        channels=2, formats=['ogg', 'm4a'], root=f'assets/audio/instruments/{iid}/', layers=2,
        sets=dict(sus=dict(source=meta['folder'].split('/')[-1], loop=True, zones=zl)),
        levels=dict(normalized=False, note="Files keep the library's recorded level (no gain change): build dynamics from the two layers and attackRmsDb, and never re-gain a layer by itself."),
        range=dict(low=from_name(low), high=from_name(high),
                   playable=f"{from_name(max(36, low - 2))} to {from_name(high + 2)} (a note plays from the nearest zone, at most 2 semitones away)"),
        problems=probs)
    path = f"{REPO}/recipes/music/instruments/{iid}.json"
    with open(path, 'w') as f:
        json.dump(rec, f, indent=1, ensure_ascii=False)
        f.write('\n')
    out_index.append(f'    "music/instruments/{iid}": "music/instruments/{iid}.json"')
    credits.append(f"| {meta['name'].split(' (')[0]}{' (solo)' if iid == 'strings-basses' else ''}, in `{iid}/` | `sus` ({len(rs)} files) | "
                   f"[Strings/{meta['folder']}]({BASE + quote(meta['folder'])}) | Versilian Studios LLC (VSCO 2 CE); recorded by Sam Gossner and Simon Dalzell (Ivy Audio), cut by Elan Hickler (Soundemote) | CC0 1.0 | "
                   f"resampled 44.1 to 48 kHz; trimmed to 3 ms before the onset; a loop found in the steady part (1.6 to 2.4 s, at upward zero crossings) with the 200 ms before it crossfaded into the loop's end, and everything after the loop end cut; no gain change; encoded stereo, Opus 80 kbps and AAC 128 kbps. Source layers {meta['srcLayers'].split(';')[0]} renumbered v1, v2; notes renamed one octave up to the pitch they sound. |")

with open(KIT + '/strings-index.txt', 'w') as f:
    f.write(',\n'.join(out_index) + '\n')
with open(KIT + '/strings-credits.md', 'w') as f:
    f.write("Strings support kit rows for assets/audio/instruments/CREDITS.md. Source: VSCO 2 Community Edition, "
            "<https://github.com/sgossner/VSCO-2-CE>, commit `440300901dfe` (4 August 2020), LICENSE: CC0 1.0 Universal. "
            "Readme.txt adds non-binding requests: do not sell the samples directly, and credit Versilian Studios/Sam Gossner and Ivy Audio/Simon Dalzell with a link to the VSCO: CE homepage (http://vis.versilstudios.net/vsco-community.html).\n\n")
    f.write("| Instrument | Set | Source | Author and library | License | Edits |\n|---|---|---|---|---|---|\n")
    f.write('\n'.join(credits) + '\n')
tot = {k: sum(s[k] for s in summary.values()) for k in ('files', 'ogg', 'm4a', 'decoded', 'decodedV1', 'decodedV1Mono')}
json.dump(dict(per=summary, total=tot), open(KIT + '/strings/results/sizes.json', 'w'), indent=1)
for k, s in summary.items():
    print(k, s)
print('total', {k: (mbytes(v) if k != 'files' else v) for k, v in tot.items()})
