"""Split Matt's teal (Documents\\Ebb\\_creatures\\teal.glb) from the rock it stands on.

The source is one fused mesh: the bird's toes melt into the top of the rock, so there is a single
connected piece:

  - the feet melt smoothly into the rock (no crease, no colour edge: baked shadow darkens the rock
    under the bird), so the mesh is cut level at CUT_Y, just above the rock's top under the toes;
  - the bird is what lies above the cut and joins the legs; a rock bump above the cut, or a pale chip
    of rock touching a toe, stays with the rock. The toes lose a sliver under the cut and get flat soles.

Each piece's holes (the toe soles on the bird, the toe prints on the rock, and a few small holes the
source already had) are filled flat in one colour. Nothing else changes: only triangles crossing the
cut are split, none is merged, the textures are copied byte for byte, and both pieces move by the same offset (the bird's feet on y = 0, centred on the bird;
the source already faces +z) so they still fit together. Units stay as Matt exported them.

    python tools/teal-prep/prep.py <teal.glb> <folder> [folder for a report json]

make.py runs this first, into a scratch folder, then cuts the bird to the creature budget.
"""
import io, json, os, struct, sys
from collections import defaultdict
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'figure-prep'))
import glb  # noqa: E402

CUT_Y = -0.712      # source units: the level cut, just above the rock's top under the toes
BIRD_Y = -0.665     # everything higher is bird (the shanks)
CHIP_H = 0.02       # how far above the cut a rock chip on a toe can reach
WARM_ROCK = 0.125   # base colour red minus blue: the rock sits about 0.10, the toes 0.17
LUM_ROCK = 0.40     # and the rock is pale (about 0.5), the toes darker (about 0.38)


def weld(P):
    """Index of the first vertex at each position (the source splits vertices at UV seams)."""
    key = {}
    out = np.empty(len(P), dtype=np.int64)
    for i, p in enumerate(np.round(P, 5)):
        out[i] = key.setdefault(tuple(p), i)
    return out


def neighbours(T):
    """Triangles sharing each welded edge."""
    edges = defaultdict(list)
    for t, (a, b, c) in enumerate(T):
        for e in ((a, b), (b, c), (c, a)):
            edges[(min(e), max(e))].append(t)
    nb = [[] for _ in T]
    for ts in edges.values():
        for t in ts:
            nb[t].extend(u for u in ts if u != t)
    return nb


def grow(seed, ok, nb):
    lab = seed.copy()
    stack = list(np.nonzero(seed)[0])
    while stack:
        t = stack.pop()
        for u in nb[t]:
            if not lab[u] and ok[u]:
                lab[u] = True
                stack.append(u)
    return lab


def slice_at(P, N, UV, I, y0):
    """Cut every triangle that crosses the level y = y0 into pieces wholly above or below it. A new
    vertex on an edge is shared by the triangles on that edge (keyed by its two real vertices), with
    its normal and uv blended along the edge."""
    P, N, UV = list(P), list(N), list(UV)
    made = {}

    def on_edge(a, b):
        k = (min(a, b), max(a, b))
        if k not in made:
            t = (y0 - P[a][1]) / (P[b][1] - P[a][1])
            P.append(P[a] + (P[b] - P[a]) * t)
            n = N[a] + (N[b] - N[a]) * t
            N.append(n / (np.linalg.norm(n) + 1e-12))
            UV.append(UV[a] + (UV[b] - UV[a]) * t)
            made[k] = len(P) - 1
        return made[k]

    out = []
    for tri in I:
        up = [P[v][1] > y0 for v in tri]
        if all(up) or not any(up):
            out.append(tuple(tri))
            continue
        # Turn the triangle so its lone vertex (the one on its own side) comes first.
        lone = [k for k in range(3) if up[k] == (sum(up) == 1)][0]
        a, b, c = tri[lone], tri[(lone + 1) % 3], tri[(lone + 2) % 3]
        ab, ac = on_edge(a, b), on_edge(a, c)
        out += [(a, ab, ac), (ab, b, c), (ab, c, ac)]
    return np.array(P), np.array(N), np.array(UV), np.array(out, dtype=np.int64)


def texel(img, uv):
    h, w = img.shape[:2]
    return img[np.clip((uv[..., 1] * h).astype(int), 0, h - 1), np.clip((uv[..., 0] * w).astype(int), 0, w - 1)]


def label(P, UV, I, W, y0, img):
    """True for bird triangles: above the cut and joined to the legs. A bump of rock that rises above
    the cut stays with the rock, and so does a chip of it touching a toe (pale grey, just above the cut)."""
    c = P[I].mean(1)
    col = texel(img, UV[I].mean(1))
    chip = (c[:, 1] < y0 + CHIP_H) & (col[:, 0] - col[:, 2] < WARM_ROCK) & (col.mean(1) > LUM_ROCK)
    return grow(c[:, 1] > BIRD_Y, (c[:, 1] > y0) & ~chip, neighbours(W[I]))


def boundary_loops(w, tri):
    """Each hole's rim as real vertex indices, in the winding of the triangles beside it. Walked edge by
    edge, so a rim that touches itself at one vertex (two toes meeting) still comes out as loops."""
    count = defaultdict(int)
    for a, b, c in w[tri]:
        for e in ((a, b), (b, c), (c, a)):
            count[(min(e), max(e))] += 1
    out, real = defaultdict(list), {}
    for t in tri:
        for x, y in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            if count[(min(w[x], w[y]), max(w[x], w[y]))] == 1:
                out[w[x]].append(w[y])
                real.setdefault(w[x], x)      # a real vertex at that welded spot
    loops = []
    for s in list(out):
        while out[s]:
            loop, v = [s], out[s].pop()
            while v != s and out[v]:
                loop.append(v)
                v = out[v].pop()
            if len(loop) >= 3:
                loops.append([real[v] for v in loop])
    return loops


def ear_clip(pts2):
    """Triangles (index triples) filling a polygon given counter-clockwise. Points sitting on another
    point (the cut makes some) never block an ear; when no clean ear is left (a rim that folds over in
    its plane) the widest convex corner is clipped anyway, so the hole always closes."""
    idx = list(range(len(pts2)))
    tris = []
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    same = lambda a, b: abs(a[0] - b[0]) + abs(a[1] - b[1]) < 1e-7
    forced = 0
    while len(idx) > 3:
        best = None
        for k in range(len(idx)):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            a, b, c = pts2[i0], pts2[i1], pts2[i2]
            area = cross(a, b, c)
            if area <= 0:
                continue
            if best is None or area > best[0]:
                best = (area, k)
            if any(cross(a, b, q) >= 0 and cross(b, c, q) >= 0 and cross(c, a, q) >= 0
                   for q in (pts2[j] for j in idx if j not in (i0, i1, i2))
                   if not (same(q, a) or same(q, b) or same(q, c))):
                continue
            break
        else:
            forced += 1
            k = best[1] if best else 0
        i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
        tris.append((i0, i1, i2))
        idx.pop(k)
    tris.append(tuple(idx))
    return tris, forced


def piece(P, N, UV, I, W, keep, img, prefer=None):
    """The kept triangles, their vertices compacted, and each hole closed. A fill is ear-clipped flat
    in the hole's own plane and takes one colour: the rim texel nearest `prefer` (or the rim's median
    colour), so it never smears across texture islands."""
    I = I[keep]
    used = np.unique(I)
    remap = -np.ones(len(P), dtype=np.int64)
    remap[used] = np.arange(len(used))
    p, nrm, uv, tri = P[used].copy(), N[used].copy(), UV[used].copy(), remap[I]
    w = remap[W[used]]                        # welded index, in the new numbering
    w[w < 0] = np.arange(len(used))[w < 0]
    loops = boundary_loops(w, tri)
    add_p, add_n, add_uv, add_t = [], [], [], []
    fans = 0
    for loop in loops:
        ring = np.array(loop[::-1])           # reversed: the fill faces out of the piece
        q = p[ring]
        normal = np.zeros(3)                  # Newell's normal of the reversed rim
        for k in range(len(q)):
            normal += np.cross(q[k], q[(k + 1) % len(q)])
        normal /= np.linalg.norm(normal) + 1e-12
        ax = np.cross(normal, [0, 1, 0] if abs(normal[1]) < 0.9 else [1, 0, 0]); ax /= np.linalg.norm(ax)
        ay = np.cross(normal, ax)
        pts2 = [(float(v @ ax), float(v @ ay)) for v in q]
        cols = texel(img, uv[ring])
        pick = uv[ring[np.argmin(np.abs(cols - (np.median(cols, 0) if prefer is None else prefer)).sum(1))]]
        base = len(p) + len(add_p)
        tris, forced = ear_clip(pts2)
        fans += forced > 0
        add_p.extend(q); add_n.extend([normal] * len(q)); add_uv.extend([pick] * len(q))
        add_t.extend((base + x, base + y, base + z) for x, y, z in tris)
    if add_p:
        p = np.vstack([p, add_p]); nrm = np.vstack([nrm, add_n]); uv = np.vstack([uv, add_uv])
        tri = np.vstack([tri, np.array(add_t)])
    return p.astype(np.float32), nrm.astype(np.float32), uv.astype(np.float32), tri.astype(np.uint32), loops, fans


def write_glb(path, name, p, n, uv, tri, src_json, src_bin):
    """One mesh, one material: the source's material, samplers and images, copied as they are."""
    idx = tri.reshape(-1).astype(np.uint16 if len(p) < 65536 else np.uint32)
    chunks = [p.tobytes(), n.tobytes(), uv.tobytes(), idx.tobytes()]
    chunks += [glb.view(src_json, src_bin, im['bufferView']) for im in src_json['images']]
    views, body, off = [], b'', 0
    for k, data in enumerate(chunks):
        body += b'\0' * ((-len(body)) % 4)
        v = {'buffer': 0, 'byteOffset': len(body), 'byteLength': len(data)}
        if k < 3: v['target'] = 34962
        elif k == 3: v['target'] = 34963
        views.append(v)
        body += data
    body += b'\0' * ((-len(body)) % 4)
    lo, hi = p.min(0).tolist(), p.max(0).tolist()
    j = {
        'asset': {'version': '2.0', 'generator': 'ebb tools/teal-prep/prep.py'},
        'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': name}],
        'meshes': [{'name': name, 'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1, 'TEXCOORD_0': 2}, 'indices': 3, 'material': 0}]}],
        'materials': src_json['materials'], 'textures': src_json['textures'], 'samplers': src_json['samplers'],
        'images': [{**im, 'bufferView': 4 + k} for k, im in enumerate(src_json['images'])],
        'accessors': [
            {'bufferView': 0, 'componentType': 5126, 'count': len(p), 'type': 'VEC3', 'min': lo, 'max': hi},
            {'bufferView': 1, 'componentType': 5126, 'count': len(p), 'type': 'VEC3'},
            {'bufferView': 2, 'componentType': 5126, 'count': len(p), 'type': 'VEC2'},
            {'bufferView': 3, 'componentType': 5123 if idx.dtype == np.uint16 else 5125, 'count': len(idx), 'type': 'SCALAR'},
        ],
        'bufferViews': views, 'buffers': [{'byteLength': len(body)}],
    }
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(body)))
        f.write(struct.pack('<I4s', len(js), b'JSON')); f.write(js)
        f.write(struct.pack('<I4s', len(body), b'BIN\0')); f.write(body)


def main(src, out_dir, report_dir=None):
    j, b = glb.read(src)
    prim = j['meshes'][0]['primitives'][0]
    P = glb.accessor(j, b, prim['attributes']['POSITION']).astype(np.float64)
    N = glb.accessor(j, b, prim['attributes']['NORMAL']).astype(np.float64)
    UV = glb.accessor(j, b, prim['attributes']['TEXCOORD_0']).astype(np.float64)
    I = glb.accessor(j, b, prim['indices']).reshape(-1, 3).astype(np.int64)
    base_img = j['images'][j['textures'][j['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index']]['source']]
    img = np.asarray(Image.open(io.BytesIO(glb.view(j, b, base_img['bufferView']))).convert('RGB')).astype(np.float32) / 255
    P, N, UV, I = slice_at(P, N, UV, I, CUT_Y)
    W = weld(P)
    bird = label(P, UV, I, W, CUT_Y, img)

    # One move for both pieces (the source already faces +z): feet on y = 0, centred on the bird.
    Q, Nq = P, N
    bp = Q[np.unique(I[bird])]
    shift = np.array([-(bp[:, 0].min() + bp[:, 0].max()) / 2, -bp[:, 1].min(), -(bp[:, 2].min() + bp[:, 2].max()) / 2])
    Q = Q + shift

    os.makedirs(out_dir, exist_ok=True)
    report = {'source': {'triangles': len(I), 'vertices': len(P)}, 'shift': shift.tolist()}
    rock_col = np.median(texel(img, UV[I[~bird]].mean(1)), 0)   # the rock's toe prints are filled in rock colour
    for name, keep, prefer in (('teal', bird, None), ('teal-rock', ~bird, rock_col)):
        p, n, uv, tri, loops, fans = piece(Q, Nq, UV, I, W, keep, img, prefer)
        write_glb(os.path.join(out_dir, name + '.glb'), name, p, n, uv, tri, j, b)
        report[name] = {'triangles': int(len(tri)), 'vertices': int(len(p)), 'holes': len(loops), 'folded_fills': fans,
                        'hole_sizes': sorted(len(l) for l in loops), 'size_m': (p.max(0) - p.min(0)).round(3).tolist(),
                        'bytes': os.path.getsize(os.path.join(out_dir, name + '.glb'))}
        print(name, report[name])
    if report_dir:
        os.makedirs(report_dir, exist_ok=True)
        json.dump(report, open(os.path.join(report_dir, 'teal-prep-report.json'), 'w'), indent=1)


if __name__ == '__main__':
    main(*sys.argv[1:])
