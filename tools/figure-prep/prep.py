"""Make the walker's figure asset (doc 23, W5): Matt's nTop meshes (the body and two arms, split from
the A-pose model, no UVs) coloured from Meshy's textured model, written as assets/figures/walker.glb.

Colour: dense samples of the textured model's surface hold its colour (linear); each new vertex takes
the colour of nearby samples facing the same way. The arms are in an A-pose, so each is first turned
down about its shoulder and settled onto the old sleeve (a trimmed best fit) before it takes colour;
the glove (past the cuff) takes colour from the old dark gloves alone. The old eye ovals become skin:
the game's shader draws the eyes.

Parts: every body vertex gets a part label (_PART) that the game's rig turns into skin weights.

Run (Python 3 with numpy, scipy and pillow), from the repo root:
  python tools/figure-prep/prep.py <meshy textured .glb> <body .obj> <left arm .obj> <right arm .obj> assets/figures/walker.glb
"""
import io, json, struct, sys
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree
import glb

PARTS = {'torso': 0, 'head': 1, 'hat': 2, 'pack': 3, 'skirt': 4, 'leg.l': 5, 'leg.r': 6, 'arm': 7}
GLOVE_T = 0.475              # where the glove starts along an arm (m out from the shoulder)
GLOVE_Y = 0.645 - 0.951      # the old gloves are below this height (the textured model's frame)
REST = {1: np.array([0.065, -0.46, 0.07]), -1: np.array([-0.065, -0.46, 0.07])}   # the old hanging arms
EYES = dict(cx=0.093, mid=0.002, cy=0.464, rx=0.0297, ry=0.0717)                  # the approved ovals (old frame)
OBJ_SCALE = 0.1              # nTop exports tenths of a metre
# The hat's felt, dyed madder rust (approved October 21, 2026): seen from above it stands clear of
# grass, sand and water. Linear albedo; the felt's own light and dark (wear, folds) are kept.
HAT_RUST = np.array([0.254, 0.069, 0.034])


def read_obj(path):
    v, f = [], []
    for line in open(path):
        if line.startswith('v '):
            v.append([float(x) for x in line.split()[1:4]])
        elif line.startswith('f '):
            f.append([int(x.split('/')[0]) - 1 for x in line.split()[1:4]])
    return np.array(v) * OBJ_SCALE, np.array(f, np.int64)


def vertex_normals(P, F):
    n = np.zeros_like(P)
    fn = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
    for k in range(3):
        np.add.at(n, F[:, k], fn)
    return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-12)


def rot_from_to(a, b):
    a, b = a / np.linalg.norm(a), b / np.linalg.norm(b)
    v, c = np.cross(a, b), a @ b
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K / (1 + c)


def textured_samples(path, n=2_500_000):
    """Points on the textured model's surface with their linear colour and facing."""
    j, b = glb.read(path)
    prim = j['meshes'][0]['primitives'][0]
    P0 = glb.accessor(j, b, prim['attributes']['POSITION']).astype(np.float64)
    UV0 = glb.accessor(j, b, prim['attributes']['TEXCOORD_0']).astype(np.float64)
    I0 = glb.accessor(j, b, prim['indices']).reshape(-1, 3).astype(np.int64)
    mat = j['materials'][0]
    img = j['textures'][mat['pbrMetallicRoughness']['baseColorTexture']['index']]['source']
    tex = np.asarray(Image.open(io.BytesIO(glb.view(j, b, j['images'][img]['bufferView']))).convert('RGB')).astype(np.float64) / 255
    H, W = tex.shape[:2]
    A, B, C = P0[I0[:, 0]], P0[I0[:, 1]], P0[I0[:, 2]]
    fn = np.cross(B - A, C - A)
    area = np.linalg.norm(fn, axis=1) / 2
    fn /= 2 * area[:, None] + 1e-12
    rng = np.random.default_rng(3)
    k = rng.choice(len(I0), n, p=area / area.sum())
    u, v = rng.random(n), rng.random(n)
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    S = A[k] + (B[k] - A[k]) * u[:, None] + (C[k] - A[k]) * v[:, None]
    uv = UV0[I0[k, 0]] + (UV0[I0[k, 1]] - UV0[I0[k, 0]]) * u[:, None] + (UV0[I0[k, 2]] - UV0[I0[k, 0]]) * v[:, None]
    px = np.clip(uv[:, 0] * W - 0.5, 0, W - 1.001)
    py = np.clip(uv[:, 1] * H - 0.5, 0, H - 1.001)
    x0, y0 = px.astype(int), py.astype(int)
    fx, fy = (px - x0)[:, None], (py - y0)[:, None]
    col = (tex[y0, x0] * (1 - fx) * (1 - fy) + tex[y0, x0 + 1] * fx * (1 - fy)
           + tex[y0 + 1, x0] * (1 - fx) * fy + tex[y0 + 1, x0 + 1] * fx * fy)
    col = np.where(col <= 0.04045, col / 12.92, ((col + 0.055) / 1.055) ** 2.4)
    # The old eye ovals (with their rims) become skin.
    for side in (-1, 1):
        e = ((S[:, 0] - EYES['mid'] - side * EYES['cx']) / (EYES['rx'] * 1.5)) ** 2 + ((S[:, 1] - EYES['cy']) / (EYES['ry'] * 1.3)) ** 2
        col[(e < 1) & (S[:, 2] > 0.05)] = np.nan
    skin = np.nanmedian(col[(np.abs(S[:, 0]) < 0.15) & (np.abs(S[:, 1] - 0.43) < 0.06) & (S[:, 2] > 0.1)], axis=0)
    col[np.isnan(col[:, 0])] = skin
    return S, col, fn[k]


def main(meshy, body_obj, left_obj, right_obj, out):
    S, col, SN = textured_samples(meshy)
    tree = cKDTree(S)

    def colours(P, N):
        d, idx = tree.query(P, k=24)
        agree = (SN[idx] * N[:, None, :]).sum(2)
        w = np.where(agree > 0.25, 1.0 / (d + 0.002), 0.0)
        none = w.sum(1) == 0
        w[none] = 1.0 / (d[none] + 0.002)
        w /= w.sum(1, keepdims=True)
        return (col[idx] * w[..., None]).sum(1)

    parts, report = [], {}
    for name, path in (('body', body_obj), ('arm.l', left_obj), ('arm.r', right_obj)):
        P, F = read_obj(path)
        N = vertex_normals(P, F)
        if name == 'body':
            C = colours(P, N)
            parts.append(dict(name=name, P=P, N=N, C=C, F=F))
            continue
        s = 1 if P[:, 0].mean() > 0 else -1
        near = P[np.argsort(np.abs(P[:, 0]))[: max(20, len(P) // 20)]]
        pivot = near.mean(0)
        axis = np.linalg.svd(P - P.mean(0), full_matrices=False)[2][0]
        if axis @ (P.mean(0) - pivot) < 0:
            axis = -axis
        R = rot_from_to(axis, REST[s])
        Pm = (P - pivot) @ R.T + pivot
        Nm = N @ R.T
        region = (np.sign(S[:, 0]) == s) & (np.abs(S[:, 0]) > 0.14) & (S[:, 1] > -0.48) & (S[:, 1] < 0.26)
        sub = np.where(region)[0]
        local = cKDTree(S[sub])
        for _ in range(40):
            d, ii = local.query(Pm, k=1)
            keep = (d < np.quantile(d, 0.75)) & ((SN[sub[ii]] * Nm).sum(1) > 0.3)
            a, t = Pm[keep], S[sub[ii]][keep]
            ca, ct = a.mean(0), t.mean(0)
            U, _, Vt = np.linalg.svd((a - ca).T @ (t - ct))
            Rk = (U @ Vt).T
            if np.linalg.det(Rk) < 0:
                Vt[-1] *= -1
                Rk = (U @ Vt).T
            Pm = (Pm - ca) @ Rk.T + ct
            Nm = Nm @ Rk.T
        C = colours(Pm, Nm)
        tt = (P - pivot) @ axis
        g = np.clip((tt - GLOVE_T + 0.01) / 0.02, 0, 1)
        gi = np.where((np.sign(S[:, 0]) == s) & (np.abs(S[:, 0]) > 0.2) & (S[:, 1] < GLOVE_Y) & (col.mean(1) < 0.06))[0]
        d, ii = cKDTree(S[gi]).query(Pm, k=12)
        gc = (col[gi[ii]] / (d[..., None] + 0.002)).sum(1) / (1 / (d + 0.002)).sum(1)[:, None]
        C = C * (1 - g[:, None]) + gc * g[:, None]
        report[name] = dict(shoulder=pivot.tolist(), axis=axis.tolist(), lengthM=float(tt.max()))
        parts.append(dict(name=name, P=P, N=N, C=C, F=F))

    # Stand on the ground (y = 0), and keep the shoulders and axes in that frame for the rig.
    y0 = min(p['P'][:, 1].min() for p in parts)
    for p in parts:
        p['P'][:, 1] -= y0
    for r in report.values():
        r['shoulder'][1] -= y0

    # Part labels for the body (the rig's skin weights read them); the arms are all 'arm'.
    body = parts[0]
    P, C = body['P'], body['C']
    lum = C.mean(1)
    head_c = np.array([0.0, 1.40, 0.0])
    dh = np.linalg.norm(P - head_c, axis=1)
    lab = np.full(len(P), PARTS['torso'], np.uint8)
    lab[(P[:, 1] > 0.25) & (P[:, 1] < 0.86)] = PARTS['skirt']
    trousers = (P[:, 1] < 0.64) & (lum < 0.045) & (np.abs(P[:, 0]) < 0.17) & (P[:, 2] < 0.16)
    # Legs: close to either leg's axis (x about 0.1 m out) and low, or the dark trousers; the coat
    # hem that hangs below 0.37 m is further out and stays with the skirt.
    near_leg = np.hypot(np.abs(P[:, 0]) - 0.1, P[:, 2] - 0.04) < 0.095
    legs = ((P[:, 1] < 0.37) & near_leg) | (P[:, 1] < 0.2) | trousers
    lab[legs & (P[:, 0] >= 0)] = PARTS['leg.l']
    lab[legs & (P[:, 0] < 0)] = PARTS['leg.r']
    lab[(P[:, 2] < -0.17) & (P[:, 1] > 0.72) & (P[:, 1] < 1.32) & (np.abs(P[:, 0]) < 0.28)] = PARTS['pack']
    lab[(P[:, 1] > 1.24) & (dh < 0.3)] = PARTS['head']
    # The hat: everything high, and the brim all round (out past the head, and lighter than the dark
    # hair and face beside it).
    Y = C @ np.array([0.2126, 0.7152, 0.0722])
    rxz = np.hypot(P[:, 0], P[:, 2])
    lab[(P[:, 1] > 1.62) | ((P[:, 1] > 1.38) & (rxz > 0.2) & (Y > 0.08))] = PARTS['hat']
    body['L'] = lab

    # Dye the hat's felt rust: each vertex keeps its brightness against the felt's middle, so the
    # wear and folds stay; the dark band and the green leaf stay as they were.
    hat = lab == PARTS['hat']
    mid = np.median(Y[hat])
    # The leaf in the band (the walker's left side of the crown): greener than the felt around it.
    in_box = (P[:, 0] > 0.13) & (P[:, 0] < 0.28) & (P[:, 1] > 1.56) & (P[:, 1] < 1.78) & (P[:, 2] > -0.1) & (P[:, 2] < 0.04)
    leaf = in_box & (C[:, 1] > C[:, 0] * 0.68)
    band = np.clip((Y / mid - 0.25) / 0.15, 0, 1)
    w = (hat & ~leaf) * band
    dyed = HAT_RUST[None, :] * (Y / mid)[:, None]
    C[:] = C * (1 - w[:, None]) + np.clip(dyed, 0, 1) * w[:, None]
    for p in parts[1:]:
        p['L'] = np.full(len(p['P']), PARTS['arm'], np.uint8)
    counts = {k: int((lab == v).sum()) for k, v in PARTS.items()}

    # The GLB: one node per part; POSITION, NORMAL, COLOR_0 (linear), _PART; extras say where the arms are.
    blobs, views, accessors, meshes, nodes, off = [], [], [], [], [], 0

    def add(arr, target, comp, typ, normalized=False):
        nonlocal off
        data = arr.tobytes()
        pad = (-len(data)) % 4
        views.append(dict(buffer=0, byteOffset=off, byteLength=len(data), target=target))
        blobs.append(data + b'\0' * pad)
        off += len(data) + pad
        acc = dict(bufferView=len(views) - 1, componentType=comp, count=len(arr), type=typ)
        if normalized:
            acc['normalized'] = True
        if typ == 'VEC3' and comp == 5126:
            acc['min'] = arr.min(0).tolist()
            acc['max'] = arr.max(0).tolist()
        accessors.append(acc)
        return len(accessors) - 1

    for p in parts:
        attrs = dict(POSITION=add(p['P'].astype(np.float32), 34962, 5126, 'VEC3'),
                     NORMAL=add(p['N'].astype(np.float32), 34962, 5126, 'VEC3'),
                     COLOR_0=add(np.clip(p['C'], 0, 1).astype(np.float32), 34962, 5126, 'VEC3'),
                     _PART=add(p['L'], 34962, 5121, 'SCALAR'))
        meshes.append(dict(name=p['name'], primitives=[dict(attributes=attrs, indices=add(p['F'].astype(np.uint32).ravel(), 34963, 5125, 'SCALAR'), material=0)]))
        nodes.append(dict(name=p['name'], mesh=len(meshes) - 1))
    blob = b''.join(blobs)
    gj = dict(asset=dict(version='2.0', generator='ebb tools/figure-prep/prep.py'), scene=0,
              scenes=[dict(nodes=list(range(len(nodes))))], nodes=nodes, meshes=meshes,
              materials=[dict(name='cloth', pbrMetallicRoughness=dict(baseColorFactor=[1, 1, 1, 1], metallicFactor=0, roughnessFactor=0.65))],
              accessors=accessors, bufferViews=views, buffers=[dict(byteLength=len(blob))],
              extras=dict(parts=PARTS, arms=report))
    js = json.dumps(gj, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    with open(out, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(blob)))
        f.write(struct.pack('<I4s', len(js), b'JSON'))
        f.write(js)
        f.write(struct.pack('<I4s', len(blob), b'BIN\0'))
        f.write(blob)
    print(json.dumps(dict(out=out, bytes=12 + 16 + len(js) + len(blob), parts=counts, arms=report,
                          verts=sum(len(p['P']) for p in parts), tris=sum(len(p['F']) for p in parts)), indent=1))


if __name__ == '__main__':
    main(*sys.argv[1:6])
