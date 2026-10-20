"""Process VCSL piano sets for ebb. Usage: python3 -I prep.py <vcsl_root> <repo_root> <scratch> [ids...]
Writes per-file results to <scratch>/results/<id>.jsonl, processed WAVs to <scratch>/wav, encoded files to the repo."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import re, json, subprocess, math, multiprocessing as mp
import numpy as np
import soundfile as sf
import plib

INSTR = {
    'piano-steinway-b': dict(path='Chordophones/Zithers/Grand Piano, Steinway B', octave=0, kind='piano', mid=2),
    'piano-kawai': dict(path='Chordophones/Zithers/Grand Piano, Kawai', octave=12, kind='piano', mid=3),
    'piano-yamaha-upright': dict(path='Chordophones/Zithers/Upright Piano, Yamaha', octave=12, kind='piano', mid=2),
    'piano-knight-upright': dict(path='Chordophones/Zithers/Upright Piano, Knight', octave=None, kind='piano', mid=2),
    'fm-piano-tx81z': dict(path='Electrophones/TX81Z/FM Piano', octave=0, kind='fm', mid=2),
}


def knight_chart(root):
    p = os.path.join(root, INSTR['piano-knight-upright']['path'], 'PitchValueConversionChart.txt')
    keys = []
    for line in open(p, encoding='utf-8', errors='replace'):
        m = re.match(r'\s*(\d{3})\s*=\s*(\d+)', line)
        if m:
            keys.append((int(m.group(1)), int(m.group(2))))
    return [k for _, k in sorted(keys)]


def max_len_s(midi):
    """Spec: 8 s at A0 (21) falling linearly in log-frequency (i.e. in semitones) to 4 s at C8 (108)."""
    t = (min(max(midi, 21), 108) - 21) / (108 - 21)
    return 8.0 - 4.0 * t


def inventory(root, iid):
    cfg = INSTR[iid]
    base = os.path.join(root, cfg['path'])
    jobs = []

    def add(src, set_, midi, layer, rr, kind, srcname, extra=None):
        j = dict(id=iid, src=src, set=set_, midi=midi, layer=layer, rr=rr, kind=kind, srcName=srcname,
                 instKind=cfg['kind'])
        if extra:
            j.update(extra)
        jobs.append(j)

    if iid == 'piano-steinway-b':
        for sub, set_ in (('Sus', 'sus'), ('NoSus', 'nosus'), ('Rel', 'rel')):
            for f in sorted(os.listdir(os.path.join(base, sub))):
                m = re.match(r'JHPiano_(Sus|NoSus|NoSusRel)_Close_([A-G]#?-?\d)_vl(\d)_rr(\d)\.wav$', f)
                if not m:
                    print('UNPARSED', f); continue
                add(os.path.join(base, sub, f), set_, plib.parse_note(m.group(2)), int(m.group(3)) - 1,
                    int(m.group(4)), 'rel' if set_ == 'rel' else 'sus', f, dict(namedAs=m.group(2)))
    elif iid == 'piano-kawai':
        for sub, set_ in (('Sustains', 'sus'), ('Releases', 'rel')):
            for f in sorted(os.listdir(os.path.join(base, sub))):
                m = re.match(r'GPiano_(sus|rel)_([A-G]#?-?\d)_v(\d)_rr(\d)_Player\.wav$', f)
                if not m:
                    print('UNPARSED', f); continue
                midi = plib.parse_note(m.group(2)) + 12
                extra = dict(namedAs=m.group(2))
                if m.group(2) == 'A#-1':
                    # measured: every layer of this file sounds A0 (27.5 Hz) about 14 cents flat, not A#0
                    midi = 21; extra['remappedFrom'] = 'As0'
                add(os.path.join(base, sub, f), set_, midi, int(m.group(3)),
                    int(m.group(4)), 'rel' if set_ == 'rel' else 'sus', f, extra)
    elif iid == 'piano-yamaha-upright':
        for sub, set_ in (('Sustains', 'sus'), ('Releases', 'rel')):
            for f in sorted(os.listdir(os.path.join(base, sub))):
                m = re.match(r'Upright1_(Sus|Rel)_([A-G]#?-?\d)_vl(\d)_rr(\d)\.wav$', f)
                if not m:
                    print('UNPARSED', f); continue
                midi = plib.parse_note(m.group(2)) + 12
                extra = dict(namedAs=m.group(2))
                if set_ == 'sus' and m.group(2) == 'C0' and (m.group(3), m.group(4)) != ('3', '2'):
                    # measured: these four takes sound A#0 (about +11 cents), not C1; vl3 rr2 does sound C1
                    midi = 22; extra['remappedFrom'] = 'C1'
                add(os.path.join(base, sub, f), set_, midi, int(m.group(3)),
                    int(m.group(4)), 'rel' if set_ == 'rel' else 'sus', f, extra)
    elif iid == 'piano-knight-upright':
        chart = knight_chart(root)
        # The files carry note-name tags, not the chart's 000-044 numbers. Sort the distinct tags by the
        # pitch they name and pair them with chart entries 000..044 in order (Info.txt: wholetone from low A).
        tags = set()
        for sub in ('Sustains', 'Releases'):
            for f in os.listdir(os.path.join(base, sub)):
                m = re.search(r'_([A-G]#?-?\d)\.wav$', f)
                if m:
                    tags.add(m.group(1))
        tags = sorted(tags, key=plib.parse_note)
        assert len(tags) == len(chart), (len(tags), len(chart))
        tagmidi = dict(zip(tags, chart))
        for f in sorted(os.listdir(os.path.join(base, 'Sustains'))):
            m = re.match(r'Player_vl(\d)_rr(\d)_([A-G]#?-?\d)\.wav$', f)
            if not m:
                print('UNPARSED', f); continue
            add(os.path.join(base, 'Sustains', f), 'sus', tagmidi[m.group(3)], int(m.group(1)), int(m.group(2)),
                'sus', f, dict(namedAs=m.group(3), chartIndex=tags.index(m.group(3))))
        for f in sorted(os.listdir(os.path.join(base, 'Releases'))):
            m = re.match(r'Player_rel_rr(\d)_([A-G]#?-?\d)\.wav$', f)
            if not m:
                print('UNPARSED', f); continue
            add(os.path.join(base, 'Releases', f), 'rel', tagmidi[m.group(2)], None, int(m.group(1)), 'rel', f,
                dict(namedAs=m.group(2), chartIndex=tags.index(m.group(2))))
        for sub, kind in (('On', 'down'), ('Off', 'up')):
            for f in sorted(os.listdir(os.path.join(base, 'Pedal', sub))):
                m = re.match(r'Player_Ped(On|Off)_(\d{3})\.wav$', f)
                if not m:
                    print('UNPARSED', f); continue
                add(os.path.join(base, 'Pedal', sub, f), 'pedal', None, None, None, 'pedal', f,
                    dict(pedalKindFromName=kind, pedalIndex=int(m.group(2)) + 1))
    elif iid == 'fm-piano-tx81z':
        for f in sorted(os.listdir(base)):
            if not f.endswith('.wav'):
                continue
            m = re.match(r'FMPiano_([A-G]#?-?\d)_vl(\d)\.wav$', f)
            if not m:
                print('UNPARSED', f); continue
            add(os.path.join(base, f), 'sus', plib.parse_note(m.group(1)), int(m.group(2)), 1, 'sus', f,
                dict(namedAs=m.group(1)))
    # round robins: a set "has round robins" when any of its files has rr > 1
    sets_rr = {}
    for j in jobs:
        if j['rr'] and j['rr'] > 1:
            sets_rr[j['set']] = True
    for j in jobs:
        if j['set'] == 'pedal':
            j['out'] = f"pedal/{j['pedalKindFromName']}-{j['pedalIndex']}"
            continue
        n = plib.midi_name(j['midi'])
        name = n + (f"-v{j['layer']}" if j['layer'] else '')
        if sets_rr.get(j['set']):
            name += f"-rr{j['rr']}"
        j['out'] = f"{j['set']}/{name}"
    return jobs


# ------------------------------------------------------------------ per file

def equal_power_fade(n):
    t = (np.arange(n) + 0.5) / n
    return np.cos(0.5 * np.pi * t)


def brightness(x, sr, onset, midi):
    """Share of signal energy above max(1.5 x the note's fundamental, 1 kHz) in the first 300 ms after onset."""
    seg = x[onset:onset + int(0.3 * sr)]
    if len(seg) < 64:
        return None
    w = np.hanning(len(seg))[:, None]
    P = (np.abs(np.fft.rfft(seg * w, axis=0)) ** 2).sum(axis=1)
    f = np.fft.rfftfreq(len(seg), 1 / sr)
    cut = max(1.5 * plib.midi_hz(midi), 1000.0) if midi else 1000.0
    tot = P[f > 20].sum()
    return float(P[f >= cut].sum() / tot) if tot > 0 else None


def find_clicks(x, sr, a, b):
    """Sample jumps far above the local level of the first difference (after the attack)."""
    if b - a < int(0.05 * sr):
        return []
    d = np.diff(x[a:b], axis=0)
    out = []
    for c in range(d.shape[1]):
        dc = d[:, c]
        sq = dc * dc
        w = int(0.02 * sr)
        cs = np.concatenate([[0.0], np.cumsum(sq)])
        idx = np.arange(len(dc))
        lo = np.clip(idx - w // 2, 0, len(dc)); hi = np.clip(idx + w // 2, 0, len(dc))
        loc = np.sqrt((cs[hi] - cs[lo]) / np.maximum(hi - lo, 1))
        hit = np.nonzero((np.abs(dc) > 10 * loc) & (np.abs(dc) > 2e-3))[0]
        for h in hit:
            t = (a + h) / sr
            if not out or t - out[-1] > 0.01:
                out.append(t)
    return sorted(set(round(t, 3) for t in out))


def clip_runs(x, thr=0.9995, minrun=3):
    a = np.abs(x) >= thr
    runs = 0; longest = 0
    for c in range(x.shape[1]):
        v = a[:, c].astype(np.int8)
        if not v.any():
            continue
        dv = np.diff(np.concatenate([[0], v, [0]]))
        st = np.nonzero(dv == 1)[0]; en = np.nonzero(dv == -1)[0]
        L = en - st
        runs += int(np.sum(L >= minrun)); longest = max(longest, int(L.max()))
    return runs, longest


def onset_at(x, rel_db):
    a = np.max(np.abs(x), axis=1)
    pk = a.max()
    idx = np.nonzero(a > pk * 10 ** (rel_db / 20))[0]
    return int(idx[0]) if len(idx) else 0


def decode(path, sr_out):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ar', str(sr_out), '-'],
                       capture_output=True, check=True)
    return np.frombuffer(r.stdout, dtype=np.float32)


def process(job):
    repo, scratch = job['_repo'], job['_scratch']
    x, sr = plib.load(job['src'])
    info = sf.info(job['src'])
    res = dict(job)
    for k in ('_repo', '_scratch'):
        res.pop(k)
    res.update(srcChannels=x.shape[1], srcRate=sr, srcSubtype=info.subtype, srcLenS=round(len(x) / sr, 3))
    probs = []
    peak = float(np.max(np.abs(x)))
    on = onset_at(x, -50.0)
    pre = int(round(0.003 * sr))
    start = max(0, on - pre)
    res['onsetS'] = round(on / sr, 4)
    res['trimStartMs'] = round(start / sr * 1000, 1)
    res['peakDb'] = round(plib.db(peak), 2)
    a0 = float(np.max(np.abs(x[0])))
    res['firstSampleDbRel'] = round(plib.db(a0) - plib.db(peak), 1)
    if a0 > peak * 10 ** (-40 / 20):
        probs.append(f"file starts abruptly: first sample is {res['firstSampleDbRel']} dB below peak (no silence before the attack; a start click is possible)")
    # pre-onset noise (in the part we cut away, and in the 3 ms we keep)
    if on > int(0.01 * sr):
        sq = np.mean(x[:on] ** 2, axis=1)
        _, env = plib.rms_env(sq, sr, 0.01, 0.005)
        res['preOnsetMaxRmsDbRel'] = round(plib.db(env.max()) - plib.db(peak), 1)
    else:
        res['preOnsetMaxRmsDbRel'] = None
    # early blip: how long from the -50 dB onset until the signal reaches -20 dB of peak
    on20 = onset_at(x, -20.0)
    res['riseMs'] = round((on20 - on) / sr * 1000, 1)
    if job['kind'] in ('sus',) and res['riseMs'] > 40:
        probs.append(f"slow or split onset: {res['riseMs']} ms from -50 dB to -20 dB of peak (possible noise before the note)")
    # DC offset
    dc = np.mean(x, axis=0)
    res['dcOffsetDb'] = round(plib.db(float(np.max(np.abs(dc)))), 1)
    if np.max(np.abs(dc)) > 1e-3:
        probs.append(f"DC offset {res['dcOffsetDb']} dBFS")
    # clipping
    runs, longest = clip_runs(x)
    res['clipRuns'] = runs
    if runs:
        probs.append(f"clipping: {runs} runs of 3+ samples at full scale (longest {longest})")
    # attack RMS
    seg = x[on:on + int(0.3 * sr)]
    res['attackRmsDb'] = round(plib.db(float(np.sqrt(np.mean(seg ** 2)))), 2)
    res['brightness'] = round(brightness(x, sr, on, job['midi']), 5) if job['set'] != 'pedal' else None
    # tail
    sq = np.mean(x[start:] ** 2, axis=1)
    starts, env = plib.rms_env(sq, sr)
    thr = peak * 10 ** (-60 / 20)
    emax = int(np.argmax(env))
    below = np.nonzero(env[emax:] <= thr)[0]
    if job['kind'] == 'sus':
        maxL = max_len_s(job['midi']); fade = 0.25
    elif job['kind'] == 'rel':
        maxL = 2.0; fade = 0.10
    else:
        maxL = 8.0; fade = 0.10   # pedal: keep the whole natural sound (the pedal-down ring is the point)
    if len(below):
        t60 = (starts[emax + below[0]] + int(0.05 * sr)) / sr
        res['tail60S'] = round(t60, 3)
    else:
        t60 = None
        res['tail60S'] = None
        res['noiseFloorDbRel'] = round(plib.db(float(env[emax:].min())) - plib.db(peak), 1)
    natural = (len(x) - start) / sr
    L = min(t60 if t60 else natural, maxL, natural)
    res['endReason'] = '-60 dB' if (t60 and t60 <= maxL and t60 <= natural) else ('max length' if maxL < natural else 'end of source file')
    if res['endReason'] == 'end of source file' and job['kind'] == 'sus':
        probs.append(f"source file ends at {natural:.2f} s before reaching -60 dB or the {maxL:.1f} s max (tail floor {res.get('noiseFloorDbRel')} dB)")
    n = int(round(L * sr))
    y = x[start:start + n].copy()
    nf = min(int(round(fade * sr)), len(y))
    y[-nf:] *= equal_power_fade(nf)[:, None]
    y[-1:] = 0.0
    res['lenS'] = round(len(y) / sr, 3)
    res['fadeMs'] = round(nf / sr * 1000)
    # clicks in the kept sustain (after the attack)
    if job['set'] != 'pedal':
        cl = find_clicks(y, sr, int(0.15 * sr) + pre, len(y) - nf)
        res['clicksAtS'] = cl[:10]
        if cl:
            probs.append(f"{len(cl)} click-like jump(s) in the kept sound at {', '.join(str(c) for c in cl[:5])} s")
    # pitch (sustain sets only)
    if job['kind'] == 'sus':
        r = plib.measure_pitch(x, sr, on, job['midi'], job['instKind'])
        if r.get('ok'):
            v, det = plib.note_check(r['spec'], r, job['midi'], job['instKind'])
            res['pitch'] = dict(cents=round(r['cents'], 2), f0FitCents=round(r['f0Cents'], 2),
                                peakFitCents=round(r['peakFitCents'], 2),
                                unisonSplitCents={str(k): round(v, 1) for k, v in r['unisonSplitCents'].items()},
                                p1Cents=None if r['p1Cents'] is None else round(r['p1Cents'], 2),
                                B=float('%.3g' % r['B']), residCents=None if math.isnan(r['resid']) else round(r['resid'], 2),
                                nPartials=r['nPartials'], partials=r['partialNs'], window=[round(w, 2) for w in r['window']],
                                check=v, checkDetail=det)
            if v != 'ok' or job.get('checkOctaves'):
                # which nearby note explains the file best (semitone and octave neighbours)
                cand = {}
                for sh in (-12, -2, -1, 0, 1, 2, 12):
                    r2 = r if sh == 0 else plib.measure_pitch(x, sr, on, job['midi'] + sh, job['instKind'])
                    if not r2.get('ok'):
                        continue
                    v2, d2 = plib.note_check(r2['spec'], r2, job['midi'] + sh, job['instKind'])
                    cand[sh] = (v2, round(r2['cents'], 1), r2['nPartials'], d2.get('explainedShare'))
                res['pitch']['neighbours'] = {str(k): v for k, v in cand.items()}
                oks = [k for k, c in cand.items() if c[0] == 'ok']
                if v != 'ok' and oks:
                    alt = min(oks, key=lambda k: (abs(k), -cand[k][2]))
                    res['pitch']['bestAltShift'] = alt
                if v != 'ok':
                    probs.append(f"pitch check '{v}' for the named note ({det}); neighbours that pass: {oks}")
        else:
            res['pitch'] = None
            probs.append('pitch could not be measured')
    # pedal waveform description
    if job['set'] == 'pedal':
        sqm = np.mean(y ** 2, axis=1)
        st, e = plib.rms_env(sqm, sr, 0.02, 0.005)
        edb = 20 * np.log10(e / e.max())
        # events: local maxima above -20 dB, at least 80 ms apart
        ev = []
        for i in range(1, len(edb) - 1):
            if edb[i] > -20 and edb[i] >= edb[i - 1] and edb[i] >= edb[i + 1]:
                t = st[i] / sr
                if not ev or t - ev[-1][0] > 0.08:
                    ev.append((round(t, 3), round(float(edb[i]), 1)))
        imax = int(np.argmax(e))
        dec = np.nonzero(edb[imax:] < -40)[0]
        res['pedalEvents'] = ev[:8]
        res['pedalDecayTo40dBS'] = round(dec[0] * 0.005, 3) if len(dec) else None
        Pm = (np.abs(np.fft.rfft(y.mean(1))) ** 2)
        fr = np.fft.rfftfreq(len(y), 1 / sr)
        res['pedalCentroidHz'] = round(float(np.sum(fr * Pm) / np.sum(Pm)))
        res['pedalLowShare'] = round(float(Pm[fr < 200].sum() / Pm.sum()), 3)
    # write processed WAV and encode
    wav = os.path.join(scratch, 'wav', job['id'], job['out'] + '.wav')
    os.makedirs(os.path.dirname(wav), exist_ok=True)
    sf.write(wav, y.astype(np.float32), sr, subtype='FLOAT')
    outbase = os.path.join(repo, 'assets/audio/instruments', job['id'], job['out'])
    os.makedirs(os.path.dirname(outbase), exist_ok=True)
    mono = y.shape[1] == 1
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', wav, '-af', 'aresample=resampler=soxr:precision=28',
                    '-ar', '48000', '-c:a', 'libopus', '-b:a', '64k' if mono else '96k', '-vbr', 'on',
                    '-application', 'audio', '-map_metadata', '-1', outbase + '.ogg'], check=True)
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', wav, '-c:a', 'aac', '-b:a', '96k' if mono else '128k',
                    '-map_metadata', '-1', '-movflags', '+faststart', outbase + '.m4a'], check=True)
    res['oggBytes'] = os.path.getsize(outbase + '.ogg')
    res['m4aBytes'] = os.path.getsize(outbase + '.m4a')
    # verify: decoded duration and onset position
    ver = {}
    exp30 = (onset_at(y, -30.0)) / sr
    for ext, rate in (('ogg', 48000), ('m4a', sr)):
        d = decode(outbase + '.' + ext, rate)
        ch = y.shape[1]
        d = d.reshape(-1, ch)
        ver[ext] = dict(lenS=round(len(d) / rate, 4), durErrMs=round((len(d) / rate - len(y) / sr) * 1000, 2),
                        onsetErrMs=round((onset_at(d, -30.0) / rate - exp30) * 1000, 2),
                        onset50ErrMs=round((onset_at(d, -50.0) / rate - on_rel(y, sr)) * 1000, 2))
    res['verify'] = ver
    if abs(ver['ogg']['onsetErrMs']) > 2:
        probs.append(f"Opus onset shifted by {ver['ogg']['onsetErrMs']} ms")
    res['problems'] = probs
    return res


def on_rel(y, sr):
    return onset_at(y, -50.0) / sr


def main():
    root, repo, scratch = sys.argv[1:4]
    ids = sys.argv[4:] or list(INSTR)
    os.makedirs(os.path.join(scratch, 'results'), exist_ok=True)
    for iid in ids:
        jobs = inventory(root, iid)
        mid = INSTR[iid]['mid']
        for j in jobs:
            j['_repo'] = repo; j['_scratch'] = scratch
            j['checkOctaves'] = j['kind'] == 'sus' and j['set'] == 'sus' and j['layer'] == mid and (j['rr'] or 1) == 1
        with mp.Pool(os.cpu_count()) as pool:
            out = pool.map(process, jobs, chunksize=1)
        with open(os.path.join(scratch, 'results', iid + '.jsonl'), 'w') as f:
            for r in out:
                f.write(json.dumps(r) + '\n')
        print(iid, len(out), 'done', flush=True)


if __name__ == '__main__':
    main()
