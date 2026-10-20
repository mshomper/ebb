"""Write recipes/music/instruments/harp.json and flute.json from ../results.json, plus credits and index lines."""
import json, math, os
KIT = '/tmp/ebb-audio-work/kit'
REPO = '/home/claude/ebb'
R = json.load(open(KIT + '/harpflute/results.json'))
VCSL_URL = 'https://github.com/sgossner/VCSL/tree/master/Chordophones/Composite%20Chordophones/Concert%20Harp'
VSCO_H_URL = 'https://github.com/sgossner/VSCO-2-CE/tree/master/Strings/Harp'
VSCO_F_URL = 'https://github.com/sgossner/VSCO-2-CE/tree/master/Woodwinds/Flute'


def conf(n, resid, spread, nwant):
    r = resid if (resid is not None and not (isinstance(resid, float) and math.isnan(resid))) else 3.0
    return round(min(1.0, n / nwant) * (1 / (1 + (r / 2.5) ** 2)) * (1 / (1 + (spread / 4.0) ** 2)), 2)


def name_sharp(n):
    return n.replace('s', '#')


def layer_entry(r):
    e = dict(file=r['out'], layer=r['layer'])
    if r.get('rr'):
        e['rr'] = r['rr']
    e.update(peakDb=r['peakDb'], attackRmsDb=r['attackRmsDb'], brightness=r['brightness'], lenS=round(r['lenS'], 4),
             trimStartMs=r['trimStartMs'], measuredCents=r['pitch']['cents'])
    if r['kind'] == 'loop':
        s = r['verify']['ogg']['seam']
        e['loop'] = r['loop']
        import soundfile as sf, numpy as np
        y, _ = sf.read(KIT + '/harpflute/wav/flute/' + r['out'] + '.wav')
        e['loopRmsDb'] = round(float(20 * np.log10(np.sqrt(np.mean(y[r['loopSamples'][0]:r['loopSamples'][1]] ** 2)))), 2)
        e['crossfadeMs'] = r['crossfade']['ms']
        e['crossfadeShape'] = 'equal-gain' if r['crossfade']['shape'] == 'gain' else 'equal-power'
        e['seamLevelDb'] = s['seamLevelDb']
        e['seamStepRatio'] = s['seamStepRatio']
        e['monoFrom'] = r['monoFrom']
        if r.get('fadeInMs'):
            e['fadeInMs'] = r['fadeInMs']
    else:
        e['endReason'] = r['endReason']
    e['src'] = r['srcFile'] + ('' if r['lib'] == ('vsco' if r['id'] == 'flute' else 'vcsl') else ' (VSCO 2 CE)' if r['lib'] == 'vsco' else ' (VCSL)')
    e['channels'] = r['channels']
    return e


def zones(rs, nwant):
    by = {}
    for r in rs:
        by.setdefault(r['midi'], []).append(r)
    out = []; probs = []
    for m in sorted(by):
        L = sorted(by[m], key=lambda r: (r['layer'], r.get('rr') or 0))
        ref = [r for r in L if (r.get('rr') or 1) == 1]
        ref = ref[len(ref) - 1] if len(ref) == 2 else ref[0]       # the louder layer when there are two (fuller partial series)
        cs = [r['pitch']['cents'] for r in L]
        spread = max(cs) - min(cs)
        p = ref['pitch']
        z = dict(note=L[0]['note'], midi=m, measuredCents=p['cents'],
                 tuneConfidence=conf(p['nPartials'], p['residCents'], spread, nwant),
                 tuneResidualCents=p['residCents'], tunePartials=p['partials'], tuneLayer=ref['layer'],
                 layerSpreadCents=round(spread, 2), layers=[layer_entry(r) for r in L])
        out.append(z)
    return out


def size(rs):
    return dict(files=len(rs), oggBytes=sum(r['oggBytes'] for r in rs), m4aBytes=sum(r['m4aBytes'] for r in rs),
                decodedBytes48kFloat=int(sum(round(r['lenS'] * 48000) * r['channels'] * 4 for r in rs)))


def bright_order(zs, label):
    bad = []
    for z in zs:
        ls = [l for l in z['layers'] if (l.get('rr') or 1) == 1]
        if len(ls) == 2 and ls[1]['brightness'] < ls[0]['brightness']:
            bad.append(f"{name_sharp(z['note'])} (v1 {ls[0]['brightness']:.3f}, v2 {ls[1]['brightness']:.3f})")
    return [f"{label}: brightness does not rise with layer in {len(bad)} of {len(zs)} zones: " + '; '.join(bad)] if bad else []


def spread_list(zs, label, lim):
    bad = [f"{name_sharp(z['note'])} ({', '.join('v%d%s %+.1f' % (l['layer'], '-rr%d' % l['rr'] if l.get('rr') else '', l['measuredCents']) for l in z['layers'])})"
           for z in zs if z['layerSpreadCents'] > lim]
    return [f"{label}: layers of the same note disagree in pitch by more than {lim} cents in {len(bad)} zones: " + '; '.join(bad)] if bad else []


# ---------------- harp ----------------
H = [r for r in R if r['id'] == 'harp']
hz = zones(H, 6)
hsize = size(H)
worst_h = max(hz, key=lambda z: abs(z['measuredCents']))
hprobs = []
hprobs.append("The harp is tuned flat and unevenly: zone pitches run from %+.1f to %+.1f cents (median %+.1f), worst %s at %+.1f. Nothing was corrected; the sampler applies measuredCents at playback."
              % (min(z['measuredCents'] for z in hz), max(z['measuredCents'] for z in hz),
                 sorted(z['measuredCents'] for z in hz)[len(hz) // 2], name_sharp(worst_h['note']), worst_h['measuredCents']))
hprobs += spread_list(hz, 'sus', 4)
hprobs += bright_order(hz, 'sus')
hprobs.append("C3 v1 is the VSCO 2 CE take (KSHarp_C3_mf.wav), not VCSL's KSHarp_C3_mf3.wav: VCSL's take swells back up by about 3 dB at 3 to 3.5 s (a sympathetic string or a touch) where the VSCO take decays smoothly; same pitch (-3.6 cents) and brightness.")
hprobs.append("D7 has no mf take in either library. v1 is VCSL's KSHarp_D7_f1.wav (warmer, peak -22 dBFS) and v2 is VSCO 2 CE's KSHarp_D7_f.wav, a different and brighter, about 6 dB louder f take; VCSL's D7 p take (1.1 s, peak -44 dBFS, cut off while still ringing) was left out.")
hprobs.append("Low and middle notes ring far longer than 4 s in the source (B1 f rings past 25 s), so 23 of 38 files (every zone from B1 to A4, plus E5) end at the 4 s maximum with the 250 ms fade from a still-ringing note, 8 to 44 dB below the attack. The other 15 die naturally to -60 dB before 4 s.")
hprobs.append("Levels are as recorded and vary a lot from zone to zone (peaks -40 dBFS at B1 mf to -9 dBFS at A4 f); the low strings were recorded much quieter. The sampler should level zones by attackRmsDb, not peakDb.")
hprobs.append("Zones are every minor or major third (3 or 4 semitones apart, 5 from A6 to D7), as the library recorded them, so most zones stretch up to 2 semitones; the VCSL zones E1, G1, B6 and F7 were left out (outside the C2 to C7 range, or denser than a minor third at the top).")
harp = dict(
    type='instrument', id='harp', name='Concert harp', version=1,
    note=("An instrument recipe for the sampler (doc 24). It describes exactly the files the prep step produced. Plucked, not looped: each file is trimmed to 3 ms before the onset (first point above -50 dB of the file's peak), "
          "resampled to 48 kHz, cut where its 50 ms RMS falls to -60 dB below peak or at 4 s, whichever comes first, and given a 250 ms equal-power fade to silence, as the piano game set. No gain change. "
          "Stereo as recorded. formats: <file>.ogg is Ogg Opus 80 kbps stereo (variable bitrate), <file>.m4a is AAC-LC 128 kbps at 48 kHz. Both decode with the onset in the same place (cross-correlation lag 0 samples, one file 1 sample); the .ogg decodes to exactly the WAV length and the .m4a about 0 to 21 ms longer (AAC end padding). "
          "Zone fields as in piano-steinway-b.json: measuredCents is the zone's pitch against 12-TET at A4 = 440 Hz, fitted from partials 1 to 6 of the louder layer (harp strings are close to harmonic; B is tiny); tuneConfidence 0 to 1. "
          "Layer fields: peakDb, attackRmsDb (first 300 ms), brightness (share of energy above max(1.5 f0, 1 kHz) in the first 300 ms), lenS, trimStartMs, measuredCents, endReason, src (original file name; the library is VCSL unless marked VSCO 2 CE). "
          "layers: v1 is mf (VCSL file suffix mf1), v2 is f (f1). The recordings are the same harp in both libraries: VSCO 2 CE's harp folder holds 23 files, 20 of them bit-identical to VCSL's mf1 files; VCSL adds an f layer for every zone, so VCSL is the source, with the two VSCO takes noted in problems."),
    source=dict(library='VCSL (Versilian Community Sample Library), two takes from VSCO 2 Community Edition', url=VCSL_URL, alternateUrl=VSCO_H_URL,
                license='CC0 1.0 (both repositories, LICENSE file: CC0 1.0 Universal)',
                commit=dict(vcsl='c1ea7bcc3c73', vsco='440300901dfe'),
                notes="Folder 'Concert Harp' (files KSHarp_*), one round robin, layers mf and f (p or mp only at G1, D7 and F7). Not normalized: the levels are as played and recorded. Note names are scientific pitch (C4 = middle C), confirmed by measurement."),
    channels=2, formats=['ogg', 'm4a'], root='assets/audio/instruments/harp/', layers=2,
    sets=dict(sus=dict(source='Concert Harp', zones=hz)),
    levels=dict(normalized=False, note='Recorded levels, not normalized: f is 3 to 14 dB louder than mf at the same note in attack RMS (B5 only 0.6 dB, where the f take is brighter instead). Play layers at their own level; level zones against each other by attackRmsDb.'),
    range=dict(low='B1', high='D7', playable='A1 to E7 (each end zone stretches about 2 semitones)'),
    size=hsize, problems=hprobs)

# ---------------- flute ----------------
F = [r for r in R if r['id'] == 'flute']
nv = zones([r for r in F if r['set'] == 'nv'], 8)
vb = zones([r for r in F if r['set'] == 'vib'], 8)
fs = size(F)
fprobs = []
fprobs.append("VSCO 2 CE names the flute an octave low (its C3 sounds C4: the strongest partial and the fundamental sit at 261.6 Hz, nothing at 130.8 Hz). Every zone here is placed at the pitch it sounds, C4 to C7.")
fprobs.append("The recordings are a spaced stereo pair whose channels partly cancel when summed (the steady part loses up to 8 dB in an L+R fold-down), so each file is mono from its louder channel (monoFrom on each layer). The two layers of a zone can come from different channels, which may sound slightly different in room tone.")
fprobs += spread_list(nv, 'nv', 3)
fprobs += spread_list(vb, 'vib', 3)
fprobs += [b + ' (E6 v1 is a quiet take whose first 300 ms carry more breath than tone, which inflates the number)' for b in bright_order(nv, 'nv')]
fprobs.append("nv: C7 has one layer only (the library has no second one there); C6 and E6 use the library's v2 as the loud layer, the others its v3.")
fprobs.append("vib has one dynamic layer (the library's v1) with two round-robin takes at C5, E5 and E6 (files -rr1 and -rr2).")
fprobs.append("Levels are as recorded (not normalized); quiet layers sit low (nv C4 v1 peaks at -41 dBFS). Level by loopRmsDb.")
fq = [l for z in nv + vb for l in z['layers']]
fprobs.append("Four vib files (C4, A4, E5 rr1, C6) start with no silence: their very first sample is already only 54 to 58 dB below the peak, so they got a 2 ms fade-in (fadeInMs) against a start click; nothing else was changed at the start.")
worst = max(fq, key=lambda l: l['seamLevelDb'])
worst_r = max(fq, key=lambda l: l['seamStepRatio'])
flute = dict(
    type='instrument', id='flute', name='Flute', version=1,
    note=("An instrument recipe for the sampler (doc 24). Looped sustains. Every file: mono from its louder channel, resampled to 48 kHz, trimmed to 3 ms before the onset (the library files already start at the breath, so trimStartMs is 0 to 4.4 ms), "
          "then given a loop in its steady part: loop (startS, endS, seconds from the file start as encoded, exact 48 kHz sample positions) is at least 1.8 s and at most 3.9 s long, starts at an upward zero crossing after the attack and ends at the upward zero crossing whose waveform best matches the start. "
          "The region was chosen from about 24 candidates per crossfade length by spectrum, level and pitch match (pitch matters for the vibrato set: the loop joins at the same point of the vibrato cycle), then checked by playing it four times. "
          "A crossfade is baked in (crossfadeMs, 150 to 250 ms; equal-gain where the two ends are in phase, equal-power otherwise): the crossfadeMs before loopStart are blended into the end of the loop, so a plain sample-accurate jump from loopEnd back to loopStart is seamless. "
          "The file ends at loopEnd (the sampler releases with its own envelope). seamLevelDb is the level change across the seam (200 ms RMS before against after, decoded .ogg); seamStepRatio is the largest sample step at the seam over the 99.9th-percentile step inside the loop (below 1 means the seam is not a click). "
          "formats: <file>.ogg is Ogg Opus 56 kbps mono; <file>.m4a is AAC-LC 80 kbps mono at 48 kHz. The .ogg decodes to exactly the WAV length with loop points in place (cross-correlation lag 0 samples at both points). "
          "The .m4a was encoded with 2048 samples of the loop's own continuation after loopEnd, because AAC can return a few samples short; it decodes 43 to 64 ms longer, its loop points also sit at lag 0, and a player that ignores the extra tail loses nothing. "
          "sets: nv is sustain non-vibrato (mist mornings, soft leads), 2 layers; vib is sustain with vibrato, 1 layer with round robins at C5, E5, E6. measuredCents: harmonic fit of partials 1 to 8 over 1.2 s in the middle of the loop (for vib, the vibrato's centre)."),
    source=dict(library='VSCO 2 Community Edition', url=VSCO_F_URL, license='CC0 1.0 (repository LICENSE file: CC0 1.0 Universal)', commit='440300901dfe',
                notes="Folders susNV (files LDFlute_susNV_*) and susvib (LDFlute_susvib_*). The library's Readme asks for credit to Versilian Studios / Sam Gossner and a link to the VSCO: CE homepage, and not to sell the samples on their own; the license itself is CC0. Layers in the source: susNV v1 and v3 (v2 at C5 and E5 there, C6 and E6 here); susvib v1 only, with second takes (_2) at C4, E4, E5 there."),
    channels=1, formats=['ogg', 'm4a'], root='assets/audio/instruments/flute/', layers=2,
    sets=dict(nv=dict(source='Woodwinds/Flute/susNV', zones=nv), vib=dict(source='Woodwinds/Flute/susvib', layers=1, zones=vb)),
    levels=dict(normalized=False, note='Recorded levels, not normalized. loopRmsDb (RMS of the loop region, dBFS) is the better level measure for a sustained note than attackRmsDb, since the flute speaks slowly: the loud layer is 3 to 13 dB above the soft one in attack RMS except at C4, where the two are level in the first 300 ms. Play layers at their own level.'),
    range=dict(low='C4', high='C7', playable='A#3 to D7'),
    loops=dict(worstSeamLevelDb=worst['seamLevelDb'], worstSeamLevelFile=worst['file'], worstSeamStepRatio=worst_r['seamStepRatio'], worstSeamStepFile=worst_r['file']),
    size=fs, problems=fprobs)

os.makedirs(REPO + '/recipes/music/instruments', exist_ok=True)
for d in (harp, flute):
    json.dump(d, open(f"{REPO}/recipes/music/instruments/{d['id']}.json", 'w'), indent=1, ensure_ascii=False)
    print(d['id'], d['size'])
for p in hprobs + fprobs:
    print('-', p)

cred = f"""| Instrument | Set | Source | Author and library | License | Edits |
|---|---|---|---|---|---|
| Concert harp, in `harp/` | `sus` ({hsize['files']} files) | [Chordophones/Composite Chordophones/Concert Harp]({VCSL_URL}); C3 v1 and D7 v2 from [VSCO 2 CE Strings/Harp]({VSCO_H_URL}) | Versilian Studios LLC (VCSL, commit c1ea7bcc3c73; VSCO 2 Community Edition, commit 440300901dfe) | CC0 1.0 | 19 zones B1 to D7 (every minor or major third), layers mf and f; resampled to 48 kHz; trimmed to 3 ms before the onset; cut where the 50 ms RMS falls to -60 dB below peak or at 4 s, 250 ms equal-power fade to silence; no gain change; stereo, Opus 80 kbps and AAC 128 kbps. |
| Flute, in `flute/` | `nv` ({len([r for r in F if r['set']=='nv'])} files) | [Woodwinds/Flute/susNV]({VSCO_F_URL}/susNV) | Versilian Studios LLC (VSCO 2 Community Edition, commit 440300901dfe) | CC0 1.0 | placed an octave above the library's names (it names C4 as C3); mono from the louder channel; resampled to 48 kHz; loop found in the steady part with a 150 to 250 ms crossfade baked in before loopEnd; everything after loopEnd removed; no gain change; Opus 56 kbps and AAC 80 kbps mono. |
| Flute, in `flute/` | `vib` ({len([r for r in F if r['set']=='vib'])} files) | [Woodwinds/Flute/susvib]({VSCO_F_URL}/susvib) | Versilian Studios LLC (VSCO 2 Community Edition, commit 440300901dfe) | CC0 1.0 | same as nv; four files given a 2 ms fade-in because they start on the breath with no silence. |
"""
open(KIT + '/harpflute-credits.md', 'w').write(cred)
open(KIT + '/harpflute-index.txt', 'w').write('    "music/instruments/harp": "music/instruments/harp.json",\n    "music/instruments/flute": "music/instruments/flute.json"\n')
