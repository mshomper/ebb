"""Build instrument recipes, stats and problem lists from results/*.jsonl.
Usage: python3 -I build.py <scratch> <repo>"""
import sys, os, json, math, collections, statistics
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import plib

SCR, REPO = sys.argv[1:3]

META = {
    'piano-steinway-b': dict(name='Grand piano (Steinway B)', path='Chordophones/Zithers/Grand Piano, Steinway B', mid=2,
        setsrc={'sus': 'Sus', 'nosus': 'NoSus', 'rel': 'Rel'}),
    'piano-kawai': dict(name='Grand piano (Kawai)', path='Chordophones/Zithers/Grand Piano, Kawai', mid=3,
        setsrc={'sus': 'Sustains', 'rel': 'Releases'}),
    'piano-yamaha-upright': dict(name='Upright piano (Yamaha)', path='Chordophones/Zithers/Upright Piano, Yamaha', mid=2,
        setsrc={'sus': 'Sustains', 'rel': 'Releases'}),
    'piano-knight-upright': dict(name='Upright piano (Knight)', path='Chordophones/Zithers/Upright Piano, Knight', mid=2,
        setsrc={'sus': 'Sustains', 'rel': 'Releases', 'pedal': 'Pedal/On, Pedal/Off'}),
    'fm-piano-tx81z': dict(name='FM electric piano (Yamaha TX81Z)', path='Electrophones/TX81Z/FM Piano', mid=2,
        setsrc={'sus': '(folder root)'}),
}


def url(path):
    return 'https://github.com/sgossner/VCSL/tree/master/' + path.replace(' ', '%20')


def conf(n, resid, spread, nwant):
    r = resid if (resid is not None and not math.isnan(resid)) else 3.0
    c = min(1.0, n / nwant) * (1 / (1 + (r / 2.5) ** 2)) * (1 / (1 + (spread / 4.0) ** 2))
    return round(c, 2)


def file_entry(r, with_pitch):
    e = dict(file=r['out'])
    if r.get('layer'):
        e['layer'] = r['layer']
    if r.get('rr') and r['_hasRR']:
        e['rr'] = r['rr']
    e.update(peakDb=r['peakDb'], attackRmsDb=r['attackRmsDb'])
    if r.get('brightness') is not None:
        e['brightness'] = r['brightness']
    e.update(lenS=r['lenS'], trimStartMs=r['trimStartMs'])
    if with_pitch and r.get('pitch'):
        e['measuredCents'] = r['pitch']['cents']
    e['src'] = r['srcName']
    return e


def build(iid):
    rows = [json.loads(l) for l in open(os.path.join(SCR, 'results', iid + '.jsonl'))]
    meta = META[iid]
    hasRR = collections.defaultdict(bool)
    for r in rows:
        if r.get('rr') and r['rr'] > 1:
            hasRR[r['set']] = True
    for r in rows:
        r['_hasRR'] = hasRR[r['set']]
    problems = []
    stats = dict(id=iid)
    sets = {}
    by_set = collections.defaultdict(list)
    for r in rows:
        by_set[r['set']].append(r)
    nlayers = max((r['layer'] or 0) for r in rows if r['set'] == 'sus')
    channels = sorted(set(r['srcChannels'] for r in rows))
    all_cents = []
    layer_diffs = []
    for s in ('sus', 'nosus', 'rel'):
        if s not in by_set:
            continue
        zones = collections.defaultdict(list)
        for r in by_set[s]:
            zones[r['midi']].append(r)
        zl = []
        for m in sorted(zones):
            rs = sorted(zones[m], key=lambda r: ((r['layer'] or 0), (r['rr'] or 0)))
            z = dict(note=plib.midi_name(m), midi=m)
            if s in ('sus', 'nosus'):
                rr1 = [r for r in rs if (r['rr'] or 1) == 1 and r.get('pitch')]
                if not rr1:
                    rr1 = [r for r in rs if r.get('pitch')]
                if rr1:
                    ref = min(rr1, key=lambda r: abs((r['layer'] or 0) - meta['mid']))
                    p = ref['pitch']
                    others = [r['pitch']['cents'] for r in rs if r.get('pitch') and r is not ref]
                    spread = max([abs(c - p['cents']) for c in others], default=0.0)
                    nwant = 5 if plib.midi_hz(m) < 1500 else 3
                    z['measuredCents'] = p['cents']
                    z['tuneConfidence'] = conf(p['nPartials'], p['residCents'], spread, nwant)
                    z['tuneResidualCents'] = p['residCents']
                    z['tunePartials'] = p['partials']
                    z['tuneLayer'] = ref['layer']
                    z['layerSpreadCents'] = round(spread, 2)
                    z['inharmonicityB'] = p['B']
                    us = p.get('unisonSplitCents') or {}
                    if us:
                        z['unisonSplitCents'] = max(us.values())
                    if s == 'sus':
                        all_cents.append((m, p['cents'], z['tuneConfidence'], p['residCents'], spread, p['nPartials']))
                    for r in rs:
                        if r.get('pitch') and r is not ref and (r['rr'] or 1) == 1:
                            layer_diffs.append(abs(r['pitch']['cents'] - p['cents']))
            z['layers'] = [file_entry(r, s in ('sus', 'nosus')) for r in rs]
            zl.append(z)
        sets[s] = dict(source=meta['setsrc'][s], zones=zl)
        # brightness order check per zone (rr1 only)
        if s in ('sus', 'nosus'):
            bad = []
            for z in zl:
                ls = [(e['layer'], e['brightness']) for e in z['layers'] if e.get('rr', 1) == 1 and e.get('brightness') is not None]
                ls.sort()
                if len(ls) >= 2 and any(b2 < b1 * 0.95 for (_, b1), (_, b2) in zip(ls, ls[1:])):
                    bad.append(f"{z['note']} ({', '.join('v%d %.3f' % l for l in ls)})")
            if not json.load(open(os.path.join(SCR, 'notes', iid + '.json')))['levels']['normalized']:
                lbad = []
                for z in zl:
                    ls = sorted((e['layer'], e['attackRmsDb']) for e in z['layers'] if e.get('rr', 1) == 1)
                    if len(ls) >= 2 and any(b2 < b1 for (_, b1), (_, b2) in zip(ls, ls[1:])):
                        lbad.append(f"{z['note']} ({', '.join('v%d %.1f dB' % l for l in ls)})")
                if lbad:
                    problems.append(f"{s}: recorded attack level does not rise with layer in {len(lbad)} of {len(zl)} zones: " + '; '.join(lbad))
            if bad:
                problems.append(f"{s}: brightness does not rise with layer in {len(bad)} of {len(zl)} zones: " + '; '.join(bad))
    if 'pedal' in by_set:
        fl = []
        for r in sorted(by_set['pedal'], key=lambda r: r['out']):
            ev = r.get('pedalEvents') or []
            fl.append(dict(file=r['out'], kind=r['_pedalKind'] if '_pedalKind' in r else r['pedalKindFromName'],
                           lenS=r['lenS'], peakDb=r['peakDb'], attackRmsDb=r['attackRmsDb'], trimStartMs=r['trimStartMs'],
                           events=len(ev), centroidHz=r.get('pedalCentroidHz'), src=r['srcName']))
        sets['pedal'] = dict(source=meta['setsrc']['pedal'], files=fl)
    for s in ('sus', 'nosus'):
        if s in sets:
            wide_l = [f"{z['note']} ({', '.join('v%d %+.1f' % (e['layer'], e['measuredCents']) for e in z['layers'] if 'measuredCents' in e)})"
                      for z in sets[s]['zones'] if z.get('layerSpreadCents', 0) > 5]
            if wide_l:
                problems.append(f"{s}: layers of the same key disagree in pitch by more than 5 cents in {len(wide_l)} zones (usually a high, fast-dying note or a unison that beats; the zone number uses the middle layer): " + '; '.join(wide_l))
    # per-file problems, grouped so the list stays readable
    starts = [r for r in rows if any('starts abruptly' in p for p in r['problems'])]
    if starts:
        bys = collections.Counter(r['set'] for r in starts)
        problems.append("source files begin right at the attack with no silence before it (" + ', '.join(f"{n} of {len(by_set[s])} {s} files" for s, n in bys.items()) +
                        f"; first sample {min(r['firstSampleDbRel'] for r in starts)} to {max(r['firstSampleDbRel'] for r in starts)} dB below the file's peak). Nothing was cut from them; listen for a start click, and if one is heard a 1 to 2 ms fade-in at playback cures it.")
    short = [r for r in rows if any('source file ends' in p for p in r['problems'])]
    if short:
        problems.append(f"{len(short)} sustain files end in the source before falling to -60 dB or reaching the maximum length, so the 250 ms fade lands on a still-audible tail (tail level when the file ends: {min(r.get('noiseFloorDbRel') or 0 for r in short)} to {max(r.get('noiseFloorDbRel') or -99 for r in short)} dB below peak): " + ', '.join(f"{r['out']} ({r['lenS']} s)" for r in short))
    reviewed = json.load(open(os.path.join(SCR, 'notes', iid + '.json'))).get('reviewed', {})
    for r in rows:
        if r['out'] in reviewed:
            problems.append(f"{r['out']} ({r['srcName']}): pitch check flagged it; {reviewed[r['out']]}")
            continue
        for p in r['problems']:
            if 'starts abruptly' in p or 'source file ends' in p or 'Opus onset' in p:
                continue
            problems.append(f"{r['out']} ({r['srcName']}): {p}")
    for r in rows:
        if r.get('remappedFrom'):
            problems.append(f"{r['out']} ({r['srcName']}): placed at {plib.midi_name(r['midi'])}, not {r['remappedFrom']} as its name says, because it " + (f"measurably sounds {plib.midi_name(r['midi'])} ({r['pitch']['cents']} cents)" if r.get('pitch') else "is the release of that key"))
    clicks = [r for r in rows if r.get('clicksAtS')]
    if clicks:
        problems.append(f"click-like sample jumps found in {len(clicks)} files: " + ', '.join(f"{r['out']} at {r['clicksAtS'][:3]} s" for r in clicks[:20]))
    flagged = [(r['out'], r['verify'][e]['onsetErrMs']) for r in rows for e in ('ogg', 'm4a') if abs(r['verify'][e]['onsetErrMs']) > 2]
    if flagged:
        problems.append(f"onset check: in {len(flagged)} encoded files the -30 dB threshold crossing moved by more than 2 ms after encoding (codec ripple on a slow, quiet attack); cross-correlation of the first 80 ms against the processed WAV shows no shift in any of them (lag 0 to 0.02 ms), so the starts are in place")
    # zone spacing
    sz = sorted(set(r['midi'] for r in by_set['sus']))
    gaps = collections.Counter(b - a for a, b in zip(sz, sz[1:]))
    wide = [(plib.midi_name(a), plib.midi_name(b), b - a) for a, b in zip(sz, sz[1:]) if b - a > 2]
    if wide:
        problems.append(f"sus zones further apart than a whole tone (doc 24 sampler rule: at most 2 semitones): " +
                        ', '.join(f"{a} to {b} ({g} semitones)" for a, b, g in wide))
    # missing layers
    for s in ('sus', 'nosus', 'rel'):
        if s not in by_set:
            continue
        zones = collections.defaultdict(set)
        for r in by_set[s]:
            if r['layer']:
                zones[r['midi']].add(r['layer'])
        all_l = set().union(*zones.values()) if zones else set()
        miss = [f"{plib.midi_name(m)} lacks v{','.join(str(l) for l in sorted(all_l - ls))}" for m, ls in sorted(zones.items()) if all_l - ls]
        if miss:
            problems.append(f"{s}: missing layers: " + '; '.join(miss))
        if s == 'rel':
            susm = set(r['midi'] for r in by_set['sus'])
            relm = set(r['midi'] for r in by_set['rel'])
            if susm - relm:
                problems.append(f"rel: no release sample for {len(susm - relm)} sus zones: " + ', '.join(plib.midi_name(m) for m in sorted(susm - relm)))
    stats.update(nFiles=len(rows), channels=channels, layers=nlayers,
                 setCounts={s: len(v) for s, v in by_set.items()},
                 zoneCounts={s: len(set(r['midi'] for r in v)) for s, v in by_set.items() if s != 'pedal'},
                 oggBytes={s: sum(r['oggBytes'] for r in v) for s, v in by_set.items()},
                 m4aBytes={s: sum(r['m4aBytes'] for r in v) for s, v in by_set.items()},
                 zoneGaps=dict(gaps), cents=all_cents,
                 layerDiff=dict(median=round(statistics.median(layer_diffs), 2) if layer_diffs else None,
                                p90=round(float(np.percentile(layer_diffs, 90)), 2) if layer_diffs else None,
                                max=round(max(layer_diffs), 2) if layer_diffs else None, n=len(layer_diffs)),
                 verify={s: dict(oggOnsetMaxMs=max(abs(r['verify']['ogg']['onsetErrMs']) for r in v),
                                 oggDurMaxMs=max(abs(r['verify']['ogg']['durErrMs']) for r in v),
                                 m4aOnsetMaxMs=max(abs(r['verify']['m4a']['onsetErrMs']) for r in v),
                                 m4aDurMaxMs=max(abs(r['verify']['m4a']['durErrMs']) for r in v)) for s, v in by_set.items()})
    return rows, sets, problems, stats, nlayers, channels


NOTE_COMMON = (
    "An instrument recipe for the sampler (doc 24, Instruments, Sample preparation and Sampler rules). It describes exactly the files "
    "the prep step produced; nothing here is a tuning choice. type, id, name, version: what this is. source: where the recordings come "
    "from (library, folder url, license) and what the library's own note files say (notes). channels: channel count of every file. "
    "formats: each file exists once per format under root, as <file>.ogg (Ogg Opus, 48 kHz, 96 kbps stereo or 64 kbps mono, variable "
    "bitrate) and <file>.m4a (AAC-LC at the source rate, 128 kbps stereo or 96 kbps mono); the browser picks the first it can play. "
    "root: folder of the files, relative to the repo. layers: the number of velocity layers in the sustain set, layer 1 the quietest. "
    "sets: one entry per articulation: sus (sustain, pedal down or natural ring), nosus (dampers working), rel (release or key-off noise, "
    "played on note-off), pedal (sounds of the pedal mechanism). Each set has source (the library subfolder) and zones; a zone is one "
    "recorded key: note (scientific pitch, C4 = middle C, sharps written s in file names), midi (C4 = 60). measuredCents: the zone's "
    "measured pitch offset from 12-tone equal temperament at A4 = 440 Hz, in cents, as recorded; piano strings are inharmonic (partial n "
    "sits at n f0 sqrt(1 + B n^2)), so it is fitted from partials 1 to 6 (2 to 8 in the bass, where the fundamental is weak) over a "
    "window of the early sustain, each partial taken as the level-weighted centre of its unison-string cluster, and it is the pitch of "
    "the fitted first partial. Real pianos are stretch-tuned on purpose (bass flat, treble sharp); nothing has been corrected. "
    "tuneLayer: the layer the zone's number comes from (the middle one). tuneResidualCents: how far the found partials sit from the fit "
    "(root mean square, cents). tunePartials: which partials were found and used. layerSpreadCents: the largest difference between this "
    "zone's layers. inharmonicityB: the fitted B. unisonSplitCents: the widest spread seen inside one partial's cluster (a sign of "
    "unison strings tuned apart, which is heard as beating or chorus). tuneConfidence: 0 to 1, falls with fewer partials, a larger "
    "residual and a larger layer spread; below about 0.5 trust the ear over the number. layers: the files of the zone, quietest first; "
    "file is the path under root without extension; layer is its velocity layer and rr its round-robin take when the set has takes. "
    "peakDb: the file's sample peak in dBFS. attackRmsDb: the RMS level of its first 300 ms after the onset, in dBFS. Whether these "
    "levels mean anything depends on the source (see levels below). brightness: the share of energy above 1.5 times the note's "
    "fundamental (or 1 kHz, whichever is higher) in those first 300 ms, which should rise from layer to layer; in a very quiet file "
    "the noise floor can inflate it. lenS: length after the prep, in seconds. trimStartMs: how much was cut from the "
    "start (the onset, the first point above -50 dB of the file's peak, is kept with 3 ms before it). measuredCents on a layer is that "
    "file's own measurement. src: the original file name. Every file was cut where its 50 ms RMS fell to 60 dB below its peak, or at a "
    "maximum length (8 s at A0 falling evenly per semitone to 4 s at C8 for sustains, 2 s for releases), whichever came first, then "
    "given an equal-power fade over its last 250 ms (100 ms for releases and pedal sounds) so it ends in true silence. No gain was changed. "
    "levels: whether the source normalised each file (normalized true: the levels say nothing about how hard the key was played, so the "
    "sampler rebuilds the dynamic range from velocity with its own curve and must not re-gain the layers) or kept the recorded levels "
    "(normalized false: the layers already step up in level as they were played, and the sampler should play them at their own level). "
    "range: the lowest and highest sustain zone. problems: anything odd found while preparing, in plain words. The .m4a files decode "
    "about 23 ms longer than the .ogg files because AAC pads its last frame with silence; the start is in the same place in both.")


def main():
    allstats = {}
    for iid, meta in META.items():
        if not os.path.exists(os.path.join(SCR, 'results', iid + '.jsonl')):
            continue
        rows, sets, problems, stats, nlayers, channels = build(iid)
        extra = json.load(open(os.path.join(SCR, 'notes', iid + '.json')))
        sus = sets['sus']['zones']
        rec = dict(type='instrument', id=iid, name=meta['name'], version=1,
                   note=NOTE_COMMON + (' ' + extra['noteExtra'] if extra.get('noteExtra') else ''),
                   source=dict(library='VCSL (Versilian Community Sample Library)', url=url(meta['path']), license='CC0 1.0',
                               notes=extra['sourceNotes']),
                   channels=channels[0] if len(channels) == 1 else channels,
                   formats=['ogg', 'm4a'], root=f'assets/audio/instruments/{iid}/', layers=nlayers, sets=sets,
                   levels=extra['levels'],
                   range=dict(low=sus[0]['note'], high=sus[-1]['note']),
                   problems=extra.get('problemsLead', []) + problems)
        os.makedirs(os.path.join(REPO, 'recipes/music/instruments'), exist_ok=True)
        with open(os.path.join(REPO, 'recipes/music/instruments', iid + '.json'), 'w') as f:
            json.dump(rec, f, indent=1, ensure_ascii=False)
            f.write('\n')
        allstats[iid] = stats
    json.dump(allstats, open(os.path.join(SCR, 'stats.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
