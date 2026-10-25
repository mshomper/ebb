# The walker's sketchbook art (P2i I5; the sketchbook brief): one drawing per file, three tiers per
# subject, <id>-1.png Rough, -2 Shading, -3 Detail, on plain flat cream, 1024 x 1024.
#
#   python tools/assets/sketch-sheets.py split   Matt's two placeholder sheets
#       (_sketches/placeholders/sheet-a.webp, sheet-b.webp) cut into single tiered PNGs in _sketches/.
#   python tools/assets/sketch-sheets.py ship    every <id>-<n>.png in _sketches/ whose id is a
#       sketchbook subject, as assets/sketches/<id>-<n>.webp, and assets/sketches/manifest.json
#       listing what is there. Matt's real drawings drop in by filename and ship the same way.
#
# Needs Python 3 with Pillow and NumPy. Offline only; the game never runs this.

import json, re, sys
from pathlib import Path
import numpy as np
from PIL import Image

SRC = Path(r'C:\Users\mshom\Documents\Ebb\_sketches')
REPO = Path(__file__).resolve().parents[2]
OUT = REPO / 'assets' / 'sketches'
SIZE = 1024
# Paper: the flat cream every drawing sits on (sheet A's own paper), and how much of the sheet's
# grain under it is flattened away.
CREAM = (233, 224, 204)
FLAT = 0.94
# The subject fills about three quarters of the height, or this much of the width if wider.
FILL_H, FILL_W = 0.75, 0.88

# Cells by eye from the ink profiles: sheet, the column [x0, x1), and each tier's rows [y0, y1).
# Sheet A crops cleanest for the creatures (tiers stacked with wide gaps) and the lily; sheet B
# for the daisy (gaps between its tiers) and the iris (cut at its two thinnest rows).
CELLS = {
    'frog':      ('a', (41, 315),    [(41, 209), (227, 398), (413, 589)]),
    'dragonfly': ('a', (416, 724),   [(41, 204), (230, 394), (417, 583)]),
    'turtle':    ('a', (780, 1090),  [(61, 205), (242, 392), (429, 584)]),
    'minnow':    ('a', (1179, 1466), [(89, 182), (268, 362), (454, 549)]),
    'lilies':    ('a', (46, 299),    [(633, 731), (740, 849), (868, 998)]),
    'iris':      ('b', (1302, 1471), [(538, 657), (658, 793), (794, 982)]),
    'chamomile': ('b', (898, 1059),  [(563, 647), (664, 793), (797, 978)]),
    # No island species yet: kept as spare placeholders, never shipped.
    'spare-rudbeckia': ('a', (404, 556), [(629, 721), (737, 834), (848, 1000)]),
    'spare-echinacea': ('a', (703, 852), [(623, 718), (730, 838), (839, 1007)]),
}


def load(sheet):
    im = np.asarray(Image.open(SRC / 'placeholders' / f'sheet-{sheet}.webp').convert('RGB')).astype(np.float32)
    paper = np.median(im.reshape(-1, 3), axis=0)
    return im, paper


def flatten(rgb, paper):
    """The sheet's paper to flat cream: each channel over the paper's, the grain near it flattened."""
    v = np.clip(rgb / paper / FLAT, 0, 1)
    return v * np.array(CREAM, dtype=np.float32)


def bbox(rgb, paper):
    """The drawing's tight box in a cell: rows and columns with at least two inked pixels."""
    ink = rgb.mean(axis=2) < paper.mean() - 25
    rows, cols = np.where(ink.sum(axis=1) >= 2)[0], np.where(ink.sum(axis=0) >= 2)[0]
    pad = 6
    return (max(0, cols[0] - pad), max(0, rows[0] - pad), min(rgb.shape[1], cols[-1] + 1 + pad), min(rgb.shape[0], rows[-1] + 1 + pad))


def split():
    sheets = {s: load(s) for s in 'ab'}
    for sid, (sheet, (x0, x1), tiers) in CELLS.items():
        im, paper = sheets[sheet]
        crops = []
        for (y0, y1) in tiers:
            cell = im[y0:y1, x0:x1]
            bx0, by0, bx1, by1 = bbox(cell, paper)
            crops.append(flatten(cell[by0:by1, bx0:bx1], paper))
        # One scale for all three tiers, so the page shows one drawing maturing at one size.
        h = max(c.shape[0] for c in crops); w = max(c.shape[1] for c in crops)
        k = min(FILL_H * SIZE / h, FILL_W * SIZE / w)
        for n, c in enumerate(crops, 1):
            tile = Image.fromarray(np.uint8(np.round(c)))
            tile = tile.resize((round(c.shape[1] * k), round(c.shape[0] * k)), Image.LANCZOS)
            page = Image.new('RGB', (SIZE, SIZE), CREAM)
            page.paste(tile, ((SIZE - tile.width) // 2, (SIZE - tile.height) // 2))
            page.save(SRC / f'{sid}-{n}.png', optimize=True)
            print(f'{sid}-{n}.png  {tile.width} x {tile.height}')


def ship():
    subjects = set(json.loads((REPO / 'recipes' / 'world' / 'sketchbook.json').read_text(encoding='utf-8'))['subjects'])
    OUT.mkdir(parents=True, exist_ok=True)
    art = {}
    for f in sorted(SRC.glob('*.png')):
        m = re.fullmatch(r'(.+)-(\d|m-[a-z-]+)', f.stem)
        if not m or m.group(1) not in subjects:
            continue
        Image.open(f).convert('RGB').save(OUT / f'{f.stem}.webp', quality=82, method=6)
        art.setdefault(m.group(1), []).append(m.group(2))
    (OUT / 'manifest.json').write_text(json.dumps({'note': 'Written by tools/assets/sketch-sheets.py ship: the sketchbook drawings in this folder, by subject id (tiers 1 to 3, moments m-<moment>).',
                                                   'art': art}, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(art))


if __name__ == '__main__':
    {'split': split, 'ship': ship}[sys.argv[1] if len(sys.argv) > 1 else 'split']()
