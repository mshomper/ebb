"""Copy the chosen mobile files into the repo and write the `mobile` block of the Steinway recipe.
Usage: python3 -I mobile_recipe.py"""
import sys, os, json, math, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plib

SP = '/tmp/ebb-audio-work'
OUT = SP + '/piano-prep/mobile-out'
REPO = '/home/claude/ebb'
REC = REPO + '/recipes/music/instruments/piano-steinway-b.json'
ROOT = 'assets/audio/instruments/piano-steinway-b/mobile/'
ZONES = list(range(34, 99, 4))
# mobile layer -> game-set layer, per set (see the note below for why)
PICK = {'sus': {1: 1, 2: 3}, 'nosus': {1: 2, 2: 3}}
PEDAL = ['down-1', 'up-1']


def conf(n, resid, spread, nwant):
    """Same confidence as the first prep (build.py)."""
    r = resid if (resid is not None and not math.isnan(resid)) else 3.0
    return round(min(1.0, n / nwant) * (1 / (1 + (r / 2.5) ** 2)) * (1 / (1 + (spread / 4.0) ** 2)), 2)


NOTE = (
    "MOBILE SET: the lighter piano phones play (doc 24, Performance budget); the sampler uses it in place of "
    "sets, layers and root when its tier is 'mobile', and the desktop keeps the game set above. It is made from "
    "the same processed recordings as the game set: zones every major third (A#1, D2, F#2 ... D7, the game set's "
    "range), two velocity layers, tails cut to tailS seconds with the game set's 250 ms quarter-cosine fade, mono "
    "throughout, encoded Opus at opusKbps and AAC at aacKbps. Mono is the left microphone alone (monoFrom): the "
    "library's two close microphones are spaced, and averaging them cancels part of some notes (A#3, F#5, D6 and "
    "A#6 lost 4 to 11 dB of their attack, a hollow sound), while the left microphone alone has no cancellation and "
    "keeps the pair's colour best. layerFrom says which recording of the game set each mobile layer is (layer 1 "
    "the softer): pedal down uses the softest and loudest (v1, v3); without pedal the softest recording (v1) is "
    "almost a pure tone, about twenty times duller than the pedal-down v1, so the no-pedal set uses v2 and v3, "
    "which match the pedal-down pair in brightness and keep a chord change (where the pedal lifts) from changing "
    "colour. File names are those of the game set's recording "
    "each one was made from (sus/D4-v3 is the game set's sus/D4-v3, shortened and mono), so layer, not the name, "
    "is the mobile layer. The loud layer of each pedal and no-pedal zone is moved by alignMs milliseconds (at most 1 ms, "
    "positive later) so its attack lines up in phase with the soft one: in a velocity blend the two recordings sound "
    "together, and out of phase they partly cancelled (up to 4.8 dB lost at A#6); lined up, every zone's blend now "
    "rises by the same 1.5 to 1.6 dB. Every file's peak, attack loudness, length, brightness and pitch were measured again from "
    "the encoded file (decoded at 48 kHz), the same way as the game set; a zone's measuredCents is the mean of its "
    "two layers, layerSpreadCents their difference, and tuneConfidence follows the first prep's rule. There are no key-off sounds: unpacked "
    "for a piece they would add 5 to 6 MB (all the layers of each zone a piece touches), and the pedal and no-pedal "
    "notes alone already come to about 9 to 14 MB a piece (median 12), at the phone budget. pedalNoise: the Knight upright's pedal "
    "mechanism for phones, one press and one lift (down-1, up-1; the desktop has four of each), cut to tailS with the same fade, left microphone, then brought to the stereo files' "
    "attack loudness (the sampler plays the pedal at a fixed level). downloadMB: what a phone downloads; "
    "decodedMB: the memory once every file is unpacked at 48 kHz (the sampler unpacks only what a piece uses).")


LAGS = json.load(open(SP + '/piano-prep/mobile-lags.json'))


def main():
    rec = json.load(open(REC, encoding='utf-8'))
    m = json.load(open(SP + '/piano-prep/mobile-measure.json'))
    sizes = json.load(open(OUT + '/sizes.json'))
    sets = {}
    files = []
    for s in ('sus', 'nosus'):
        zl = []
        for z in rec['sets'][s]['zones']:
            if z['midi'] not in ZONES:
                continue
            by = {L['layer']: L for L in z['layers']}
            layers = []
            for ml, gl in PICK[s].items():
                L = by[gl]
                q = m[L['file']]
                e = dict(file=L['file'], layer=ml, peakDb=q['peakDb'], attackRmsDb=q['attackRmsDb'])
                if q.get('brightness') is not None:
                    e['brightness'] = q['brightness']
                e['lenS'] = q['lenS']
                if L['file'] in LAGS:
                    e['alignMs'] = round(LAGS[L['file']] / 44.1, 3)
                if q.get('pitch'):
                    e['measuredCents'] = q['pitch']['cents']
                e.update(channels=1, src=L['src'])
                layers.append(e)
                files.append(L['file'])
            nz = dict(note=z['note'], midi=z['midi'])
            if s != 'rel':
                ps = [m[e['file']]['pitch'] for e in layers]
                c = [p['cents'] for p in ps]
                spread = abs(c[0] - c[1])
                res = [p['resid'] for p in ps if p['resid'] is not None]
                nwant = 5 if plib.midi_hz(z['midi']) < 1500 else 3
                nz.update(measuredCents=round(sum(c) / 2, 2),
                          tuneConfidence=conf(min(p['nPartials'] for p in ps), max(res) if res else None, spread, nwant),
                          tuneResidualCents=max(res) if res else None,
                          layerSpreadCents=round(spread, 2))
            nz['layers'] = layers
            zl.append(nz)
        sets[s] = dict(source=rec['sets'][s]['source'], zones=zl)
    ped = []
    for p in PEDAL:
        q = m['pedal/' + p]
        ped.append(dict(file='pedal/' + p, kind='down' if p.startswith('down') else 'up', lenS=q['lenS'],
                        peakDb=q['peakDb'], attackRmsDb=q['attackRmsDb'], channels=1,
                        src=f"pedal-knight {p} (Player_Ped{'On' if p.startswith('down') else 'Off'}_00{int(p[-1]) - 1}.wav)"))
        files.append('pedal/' + p)

    def mb(fs, k):
        return round(sum(sizes[f][k] for f in fs) / 1e6, 2)

    def dec(fs):
        return round(sum(round(m[f]['lenS'] * 48000) * 4 for f in fs) / 1048576, 2)

    by_set = {s: [e['file'] for z in sets[s]['zones'] for e in z['layers']] for s in sets}
    by_set['pedal'] = ['pedal/' + p for p in PEDAL]
    mobile = dict(
        note=NOTE,
        root=ROOT, channels=1, formats=['ogg', 'm4a'], layers=2,
        layerFrom={s: {str(k): f'v{v}' for k, v in PICK[s].items()} for s in PICK},
        tailS=2.5, fadeS=0.25, zoneStepSemitones=4, monoFrom='left microphone',
        opusKbps=60, aacKbps=80,
        range=dict(low=sets['sus']['zones'][0]['note'], high=sets['sus']['zones'][-1]['note'],
                   playable='A1 to D#7 (each zone stretches two semitones either way)'),
        downloadMB=dict(opus=mb(files, 0), aac=mb(files, 1),
                        bySet={s: dict(opus=mb(f, 0), aac=mb(f, 1)) for s, f in by_set.items()}),
        decodedMB=dict(all=dec(files), bySet={s: dec(f) for s, f in by_set.items()}, sampleRateHz=48000),
        files=len(files),
        sets=sets,
        pedalNoise=dict(id='pedal-knight-mobile', root=ROOT, sets=dict(pedal=dict(source='pedal-knight (Pedal/On, Pedal/Off)', files=ped))),
        built='October 19, 2026, for Matt to judge on a phone',
    )
    rec['mobile'] = mobile
    with open(REC, 'w', encoding='utf-8') as f:
        json.dump(rec, f, indent=1, ensure_ascii=False)
        f.write('\n')
    dst = os.path.join(REPO, ROOT)
    if os.path.isdir(dst):
        shutil.rmtree(dst)
    for fl in files:
        for ext in ('ogg', 'm4a'):
            os.makedirs(os.path.dirname(os.path.join(dst, fl)), exist_ok=True)
            shutil.copy2(os.path.join(OUT, fl + '.' + ext), os.path.join(dst, fl + '.' + ext))
    print(json.dumps({k: v for k, v in mobile.items() if k in ('downloadMB', 'decodedMB', 'files', 'range')}, indent=1))


if __name__ == '__main__':
    main()
