import json, re, glob
bad = 0
for f in sorted(glob.glob('/home/claude/ebb/recipes/music/pieces/themes/theme-*.json')):
    p = json.load(open(f))
    num, den = map(int, p['meter'].split('/'))
    unit = int(num * 8 / den)
    for name, s in p['sections'].items():
        voice = None
        for ln in s['abc'].split('\n'):
            if ln.startswith('V:'): voice = ln[2:]; continue
            if not voice or not ln.strip(): continue
            body = re.sub(r'"[^"]*"', '', ln); body = re.sub(r'![^!]*!', '', body)
            for i, bar in enumerate([b for b in body.split('|') if b.strip()]):
                bar = re.sub(r'\[[^\]]*\]', 'N', bar)  # chords count as one note
                tot = 0
                for m in re.finditer(r"(\^|_|=)?([A-Ga-gzxN])[,']*(\d*)", bar):
                    tot += int(m.group(3) or 1)
                if tot != unit:
                    bad += 1; print(f"{p['id']} {name} {voice} bar {i+1}: {tot} (want {unit})")
print('bad bars:', bad)
