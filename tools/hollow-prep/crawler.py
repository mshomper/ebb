"""Make assets/models/hollow/crawler.glb from Matt's silt crawler (H2, October 27, 2026), rigged in code.

Sources (Documents\\Ebb\\_enemies), in the same nTop space as the mote, Z up, the front facing +X:
silt+crawler_body.obj (the rimmed shell plate on the front, the soft body tapering back, two eye knobs on
short stalks), _forelegs.obj and _hindlegs.obj (two straight stubby tubes each) and _tail.obj. They are
used as they are: no further cut and no normal map, only smooth normals.

What it does: turns them Y up with the front facing +Z (x' = y, y' = z, z' = x, as mote.py), scales them by
the one enemy-space factor (recipes/world/hollow.json enemySpace.mPerUnit, the one that makes the mote
20 cm across), and puts the origin on the ground under the middle of the body. Then the rig, in code:
16 bones (root, body, two eye stalks, a hip and a knee for each leg, four tail bones), their pivots found
from the meshes, and skin weights: each leg tube blends from hip to knee across its middle so it curves
instead of hinging, the tail blends bone to bone along its length, and the stalks blend out of the body.
There are no textures (Matt's OBJs have no UVs): COLOR_0 carries where the shell plate is, where the soft
pale underside is and where the eye knobs are; _SURFACE carries Matt's modelled cobbles, read from the
geometry (how far down in a seam each point is, and each cobble's own shade); the shader
(lib-crawler.wgsl) draws the silt, the shells and the knobs from them and the recipe's colours. The prep numbers are foes.lunger.crawler.prep.

    python tools/hollow-prep/crawler.py <folder with the four OBJs> assets/models/hollow/crawler.glb
"""
import json, os, struct, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mote import read_obj, smooth_normals  # noqa: E402

RECIPE = os.path.join(HERE, '..', '..', 'recipes', 'world', 'hollow.json')
PARTS = ['body', 'forelegs', 'hindlegs', 'tail']
BONES = ['root', 'body', 'stalk.l', 'stalk.r', 'hip.fl', 'knee.fl', 'hip.fr', 'knee.fr', 'hip.hl', 'knee.hl', 'hip.hr', 'knee.hr',
         'tail.0', 'tail.1', 'tail.2', 'tail.3']
PARENT = {'root': None, 'body': 'root', 'stalk.l': 'body', 'stalk.r': 'body', 'tail.0': 'root', 'tail.1': 'tail.0', 'tail.2': 'tail.1', 'tail.3': 'tail.2'}
for leg in ('fl', 'fr', 'hl', 'hr'):
    PARENT[f'hip.{leg}'] = 'root'
    PARENT[f'knee.{leg}'] = f'hip.{leg}'
B = {n: i for i, n in enumerate(BONES)}


def to_ours(v):
    """Z up, front +X -> Y up, front +Z (a turn, so the winding stays)."""
    return v[:, [1, 2, 0]]


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def tube(v):
    """A straight tube: its middle, its axis from the end nearest the body (higher) to the foot, its ends' centres and radius."""
    c = v.mean(0)
    a = np.linalg.svd(v - c)[2][0]
    if a[1] > 0:
        a = -a  # toward the foot, downward
    t = (v - c) @ a
    r = float(np.median(np.linalg.norm((v - c) - np.outer(t, a), axis=1)))
    hip, foot = c + a * (t.min() + r), c + a * (t.max() - r)
    return {'hip': hip, 'foot': foot, 'axis': a, 'radius': r, 'low': float(v[:, 1].min())}


def shells(v, f, n, plate, P):
    """Matt's modelled cobbles on the plate: how far down in a seam each point is (0..1, from the surface's
    concavity against its neighbours), and each cobble's own shade (0..1, one per cobble: the plate's
    points out of the seams joined into islands along the mesh's edges, numbered in mesh order)."""
    nb, cnt = np.zeros_like(v), np.zeros(len(v))
    for a, b in ((0, 1), (1, 2), (2, 0), (1, 0), (2, 1), (0, 2)):
        np.add.at(nb, f[:, a], v[f[:, b]])
        np.add.at(cnt, f[:, a], 1)
    cav = ((nb / np.maximum(cnt, 1)[:, None] - v) * n).sum(1)
    seam = smooth(P['seamFromM'], P['seamFullM'], cav) * (plate > 0.01)
    # Islands: union-find over edges whose both ends are on the plate and out of the seams.
    up = np.arange(len(v))

    def find(i):
        while up[i] != i:
            up[i] = up[up[i]]
            i = up[i]
        return i
    on = (plate > 0.01) & (cav < P['cobbleBelowM'])
    for a, b in ((0, 1), (1, 2), (2, 0)):
        for i, j in zip(f[:, a], f[:, b]):
            if on[i] and on[j]:
                ri, rj = find(i), find(j)
                if ri != rj:
                    up[max(ri, rj)] = min(ri, rj)
    roots = np.array([find(i) for i in range(len(v))])
    # A shade per island from its root's index (a fixed hash, so the model always comes out the same).
    h = (roots.astype(np.uint64) * np.uint64(2654435761)) % np.uint64(4294967296)
    shade = ((h >> np.uint64(8)) & np.uint64(0xffff)).astype(np.float64) / 65535.0
    # Points in the seams take the shade of the cobble beside them (their neighbours' mean), smoothed once.
    sh = np.where(on, shade, 0.0)
    acc, w = np.zeros(len(v)), np.zeros(len(v))
    for a, b in ((0, 1), (1, 2), (2, 0), (1, 0), (2, 1), (0, 2)):
        np.add.at(acc, f[:, a], sh[f[:, b]] * on[f[:, b]])
        np.add.at(w, f[:, a], on[f[:, b]].astype(float))
    shade = np.where(on, shade, np.where(w > 0, acc / np.maximum(w, 1), 0.5))
    islands = len(np.unique(roots[on]))
    return seam, shade, islands


def legs_of(v, front):
    """The two tubes of a pair, left (+x) first, each as tube()."""
    out = {}
    for side, name in ((1, 'l'), (-1, 'r')):
        out[('f' if front else 'h') + name] = (v[:, 0] * side > 0)
    return out


def main(src, out):
    H = json.load(open(RECIPE, encoding='utf-8'))
    k = H['enemySpace']['mPerUnit']
    P = H['foes']['lunger']['crawler']['prep']
    raw = {p: read_obj(os.path.join(src, f'silt+crawler_{p}.obj')) for p in PARTS}
    raw = {p: (to_ours(v) * k, f) for p, (v, f) in raw.items()}
    bv = raw['body'][0]
    lo = np.vstack([v for v, _ in raw.values()]).min(0)
    origin = np.array([(bv[:, 0].min() + bv[:, 0].max()) / 2, lo[1], (bv[:, 2].min() + bv[:, 2].max()) / 2])
    raw = {p: (v - origin, f) for p, (v, f) in raw.items()}
    bv = raw['body'][0]

    # ---- the legs ----
    legs = {}
    for part, front in (('forelegs', True), ('hindlegs', False)):
        v = raw[part][0]
        for name, mask in legs_of(v, front).items():
            legs[name] = dict(tube(v[mask]), mask=mask)
    for L in legs.values():
        L['knee'] = (L['hip'] + L['foot']) / 2
        L['length'] = float(np.linalg.norm(L['foot'] - L['hip']))
        L['footLift'] = float(L['foot'][1] - L['low'])

    # ---- the eye stalks: what stands above the body's own top, split left and right ----
    top = bv[np.abs(bv[:, 0]) < P['stalkMidM'], 1].max()
    stalks = {}
    for side, name in ((1, 'l'), (-1, 'r')):
        m = (bv[:, 1] > top + P['stalkAboveM']) & (bv[:, 0] * side > 0)
        sv = bv[m]
        tip = sv[np.argmax(sv[:, 1])]
        base = np.array([sv[:, 0].mean(), top, sv[:, 2].mean()])
        stalks[name] = {'base': base, 'tip': tip, 'knobFrom': float(sv[:, 1].min() + (tip[1] - sv[:, 1].min()) * P['knobShare'])}

    # ---- the tail: its middle line in four, root end (nearest the body) first ----
    tv = raw['tail'][0]
    z0, z1 = tv[:, 2].max(), tv[:, 2].min()
    tail_piv = []
    for i in range(4):
        s = z0 + (z1 - z0) * i / 4
        m = np.abs(tv[:, 2] - s) < (z0 - z1) / 10
        tail_piv.append(np.array([tv[m, 0].mean(), tv[m, 1].mean(), s]))
    tail_tip = np.array([0.0, tv[tv[:, 2] < z1 + (z0 - z1) * 0.05, 1].mean(), z1])

    # ---- the skeleton ----
    hind_mid = (legs['hl']['hip'] + legs['hr']['hip']) / 2
    piv = {
        'root': np.array([0.0, hind_mid[1], hind_mid[2]]),
        'body': (bv.min(0) + bv.max(0)) / 2,
        'stalk.l': stalks['l']['base'], 'stalk.r': stalks['r']['base'],
    }
    for n, L in legs.items():
        piv[f'hip.{n}'], piv[f'knee.{n}'] = L['hip'], L['knee']
    for i in range(4):
        piv[f'tail.{i}'] = tail_piv[i]
    skeleton = [{'name': n, 'parent': (B[PARENT[n]] if PARENT[n] else -1), 'pivot': piv[n].round(5).tolist()} for n in BONES]

    # ---- skin weights and zones, part by part ----
    pos, nrm, col, srf, jnt, wgt, idx = [], [], [], [], [], [], []
    base = 0
    tris = {}
    for p in PARTS:
        v, f = raw[p]
        n, _ = smooth_normals(v, f)
        c = np.zeros((len(v), 3))
        surf = np.zeros((len(v), 2))
        j = np.zeros((len(v), 4), np.int64)
        w = np.zeros((len(v), 4))
        # The soft pale underside: what faces down, low on the body (every part).
        c[:, 1] = smooth(P['bellyNormal'][0], P['bellyNormal'][1], -n[:, 1])
        if p == 'body':
            c[:, 1] *= 1 - smooth(P['bellyBelowM'][0], P['bellyBelowM'][1], v[:, 1])
        if p == 'body':
            # The shell plate: the front, where the surface faces forward-ish.
            c[:, 0] = smooth(P['plateFromM'][0], P['plateFromM'][1], v[:, 2]) * smooth(P['plateFacing'][0], P['plateFacing'][1], n[:, 2])
            c[:, 1] *= 1 - c[:, 0]
            surf[:, 0], surf[:, 1], cobbles = shells(v, f, n, c[:, 0], P)
            print(f'shell plate: {cobbles} cobbles')
            j[:, 0], w[:, 0] = B['body'], 1
            for name, S in stalks.items():
                side = 1 if name == 'l' else -1
                on = (v[:, 0] * side > 0) & (np.abs(v[:, 2] - S['base'][2]) < P['stalkReachM'])
                s = smooth(top - P['stalkBlendM'], top + P['stalkBlendM'], v[:, 1]) * on
                j[on, 1], w[on, 1] = B[f'stalk.{name}'], s[on]
                w[on, 0] = 1 - s[on]
                c[:, 2] = np.maximum(c[:, 2], smooth(S['knobFrom'] - 0.004, S['knobFrom'] + 0.004, v[:, 1]) * on)
        elif p in ('forelegs', 'hindlegs'):
            for name, L in legs.items():
                if (name[0] == 'f') != (p == 'forelegs'):
                    continue
                m = L['mask']
                t = (v[m] - L['hip']) @ L['axis'] / L['length']
                b = P['kneeBlendShare'] / 2
                s = smooth(0.5 - b, 0.5 + b, t)
                j[m, 0], j[m, 1] = B[f'hip.{name}'], B[f'knee.{name}']
                w[m, 0], w[m, 1] = 1 - s, s
        else:
            # Along the tail: each bone to the next, blended across each joint.
            s = (z0 - v[:, 2]) / (z0 - z1) * 4  # 0 at the root end, 4 at the tip
            seg = np.clip(np.floor(s), 0, 3).astype(np.int64)
            for i in range(4):
                m = seg == i
                frac = s[m] - i
                nxt = min(i + 1, 3)
                blend = smooth(1 - P['tailBlendShare'], 1 + P['tailBlendShare'], frac) if i < 3 else np.zeros(m.sum())
                j[m, 0], j[m, 1] = B[f'tail.{i}'], B[f'tail.{nxt}']
                w[m, 0], w[m, 1] = 1 - blend, blend
            # Its root end, sunk in the body, follows the root.
            m = s < P['tailRootShare']
            j[m, 2], w[m, 2] = B['root'], 1 - smooth(0, P['tailRootShare'], s[m])
            w[m, 0] *= 1 - w[m, 2]
            w[m, 1] *= 1 - w[m, 2]
        # Weights as bytes summing to 255.
        wb = np.round(w / w.sum(1, keepdims=True) * 255).astype(np.int64)
        wb[:, 0] += 255 - wb.sum(1)
        pos.append(v); nrm.append(n); col.append(c); srf.append(surf); jnt.append(j); wgt.append(wb)
        idx.append(f + base)
        base += len(v)
        tris[p] = len(f)
    pos, nrm, col, srf = np.vstack(pos), np.vstack(nrm), np.vstack(col), np.vstack(srf)
    jnt, wgt, idx = np.vstack(jnt), np.vstack(wgt), np.vstack(idx)

    ext = pos.max(0) - pos.min(0)
    extras = {
        'note': 'Matt\'s silt crawler (nTop, October 27, 2026), metres, Y up, facing +Z, the origin on the ground under the body\'s middle. '
                'skeleton: 16 bones, parents first, pivots in rest metres; legs: each tube\'s hip, knee and foot (the foot cap\'s middle, footLiftM over the ground), '
                'left (+x) first, front then hind; stalks: base and tip; COLOR_0: plate, underside, knob (shares); _SURFACE: seam, cobble shade (for lib-crawler.wgsl).',
        'mPerUnit': k, 'widthM': round(float(ext[0]), 4), 'lengthM': round(float(ext[2]), 4), 'heightM': round(float(ext[1]), 4),
        'triangles': tris,
        'skeleton': skeleton,
        'legs': {n: {'hip': L['hip'].round(5).tolist(), 'knee': L['knee'].round(5).tolist(), 'foot': L['foot'].round(5).tolist(),
                     'lengthM': round(L['length'], 5), 'radiusM': round(L['radius'], 5), 'footLiftM': round(L['footLift'], 5)} for n, L in legs.items()},
        'stalks': {n: {'base': S['base'].round(5).tolist(), 'tip': S['tip'].round(5).tolist()} for n, S in stalks.items()},
        'tailTip': tail_tip.round(5).tolist(),
    }
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    write_glb(out, pos, nrm, col, srf, jnt, wgt, idx, extras)
    print(f'{len(idx)} triangles ({tris}), {len(pos)} vertices')
    print(f'{ext[0] * 100:.1f} cm wide, {ext[2] * 100:.1f} cm long with the tail, {ext[1] * 100:.1f} cm high ({k} m a unit)')
    for n, L in legs.items():
        print(f"leg {n}: {L['length'] * 100:.1f} cm, radius {L['radius'] * 100:.1f} cm, foot {L['footLift'] * 100:.1f} cm over the ground")
    print(f'wrote {out} ({os.path.getsize(out)} bytes)')


def write_glb(path, pos, nrm, col, srf, jnt, wgt, idx, extras):
    blobs, views, accessors = [], [], []

    def add(arr, target, comp, typ, minmax=False, normalized=False):
        data = arr.tobytes()
        off = sum(len(b) for b in blobs)
        pad = (-off) % 4
        if pad:
            blobs.append(b'\0' * pad)
            off += pad
        blobs.append(data)
        views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data), 'target': target})
        a = {'bufferView': len(views) - 1, 'componentType': comp, 'count': len(arr), 'type': typ}
        if normalized:
            a['normalized'] = True
        if minmax:
            a['min'] = arr.min(0).tolist()
            a['max'] = arr.max(0).tolist()
        accessors.append(a)
        return len(accessors) - 1

    attrs = {
        'POSITION': add(pos.astype(np.float32), 34962, 5126, 'VEC3', True),
        'NORMAL': add(nrm.astype(np.float32), 34962, 5126, 'VEC3'),
        'COLOR_0': add(col.astype(np.float32), 34962, 5126, 'VEC3'),
        '_SURFACE': add(srf.astype(np.float32), 34962, 5126, 'VEC2'),
        'JOINTS_0': add(jnt.astype(np.uint8), 34962, 5121, 'VEC4'),
        'WEIGHTS_0': add(wgt.astype(np.uint8), 34962, 5121, 'VEC4', normalized=True),
    }
    i = add(idx.astype(np.uint32).reshape(-1), 34963, 5125, 'SCALAR')
    body = b''.join(blobs)
    body += b'\0' * ((-len(body)) % 4)
    j = {
        'asset': {'version': '2.0', 'generator': 'ebb tools/hollow-prep/crawler.py'},
        'scene': 0, 'scenes': [{'nodes': [0]}],
        'nodes': [{'name': 'crawler', 'mesh': 0, 'extras': extras}],
        'meshes': [{'name': 'crawler', 'primitives': [{'attributes': attrs, 'indices': i, 'material': 0}]}],
        'materials': [{'name': 'silt', 'pbrMetallicRoughness': {'baseColorFactor': [0.2, 0.17, 0.14, 1], 'metallicFactor': 0, 'roughnessFactor': 0.7}}],
        'buffers': [{'byteLength': len(body)}], 'bufferViews': views, 'accessors': accessors,
    }
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    with open(path, 'wb') as fh:
        fh.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(body)))
        fh.write(struct.pack('<I4s', len(js), b'JSON'))
        fh.write(js)
        fh.write(struct.pack('<I4s', len(body), b'BIN\0'))
        fh.write(body)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(*sys.argv[1:])
