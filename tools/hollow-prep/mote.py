"""Make assets/models/hollow/mote.glb from Matt's soot mote (H2, October 27, 2026).

Sources (Documents\\Ebb\\_enemies): mote_body.obj, Matt's own decimation (13,856 triangles), Z up with
the eyes facing +X; mote_eyes.obj, two eye discs placed for the first body. The body is used as it is:
no further cut and no normal map, only smooth normals. The eyes are not kept as geometry: the shader
draws them (lib-mote.wgsl), so each disc becomes a placement, its middle carried out along its axis to
the body's surface, its axis and its radius, written into the node's extras.

What it does: turns the model Y up with the eyes facing +Z (our forward; x' = y, y' = z, z' = x, a
turn, so the winding stays), centres it on its bounds, scales it to sizeM across (the longest side,
recipes/world/hollow.json foes.motes.mote.sizeM), and gives it the recipe's plain soot albedo.

    python tools/hollow-prep/mote.py <mote_body.obj> <mote_eyes.obj> assets/models/hollow/mote.glb
"""
import json, os, struct, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
RECIPE = os.path.join(HERE, '..', '..', 'recipes', 'world', 'hollow.json')


def read_obj(path):
    v, f = [], []
    for line in open(path):
        s = line.split()
        if not s:
            continue
        if s[0] == 'v':
            v.append([float(x) for x in s[1:4]])
        elif s[0] == 'f':
            idx = [int(x.split('/')[0]) - 1 for x in s[1:]]
            for k in range(1, len(idx) - 1):
                f.append([idx[0], idx[k], idx[k + 1]])
    return np.array(v, np.float64), np.array(f, np.int64)


def to_ours(v):
    """Z up, eyes +X -> Y up, eyes +Z."""
    return v[:, [1, 2, 0]]


def smooth_normals(v, f):
    fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])  # area-weighted
    n = np.zeros_like(v)
    for k in range(3):
        np.add.at(n, f[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12), fn


def ray_hit(o, d, v, f):
    """Furthest hit of the line o + t d (t may be negative) on the mesh, near o (Moller-Trumbore)."""
    a, b, c = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    e1, e2 = b - a, c - a
    p = np.cross(d, e2)
    det = (e1 * p).sum(1)
    ok = np.abs(det) > 1e-12
    inv = np.where(ok, 1 / np.where(ok, det, 1), 0)
    s = o - a
    u = (s * p).sum(1) * inv
    q = np.cross(s, e1)
    w = (q * d).sum(1) * inv
    t = (q * e2).sum(1) * inv
    hit = ok & (u >= 0) & (w >= 0) & (u + w <= 1)
    ts = t[hit]
    return ts[np.argmin(np.abs(ts))] if len(ts) else 0.0


def eye_placements(ev, ef, bv, bf, centre):
    """Each disc: its middle, its outward axis (area-weighted face normals facing away from the body's middle), its radius."""
    out = []
    ec, efn = ev, np.cross(ev[ef[:, 1]] - ev[ef[:, 0]], ev[ef[:, 2]] - ev[ef[:, 0]])
    fmid = ev[ef].mean(1)
    for side in (1, -1):  # +x is the mote's left, as the walker's
        m = fmid[:, 0] * side > 0
        verts = np.unique(ef[m])
        mid = ec[verts].mean(0)
        fn = efn[m]
        fn = np.where(((fn @ np.eye(3)) * (fmid[m] - centre)).sum(1, keepdims=True) < 0, -fn, fn)
        axis = fn.sum(0)
        axis /= np.linalg.norm(axis)
        r = np.linalg.norm(np.cross(ec[verts] - mid, axis), axis=1).max()
        # Carry the middle out (or in) along the axis to the body's surface.
        t = ray_hit(mid, axis, bv, bf)
        out.append({'side': side, 'centre': mid + axis * t, 'axis': axis, 'radius': r, 'movedBy': t})
    return out


def write_glb(path, pos, nrm, idx, albedo, extras):
    blobs, views, accessors = [], [], []

    def add(arr, target, comp, typ, minmax=False):
        data = arr.tobytes()
        off = sum(len(b) for b in blobs)
        pad = (-off) % 4
        if pad:
            blobs.append(b'\0' * pad)
            off += pad
        blobs.append(data)
        views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data), 'target': target})
        a = {'bufferView': len(views) - 1, 'componentType': comp, 'count': len(arr), 'type': typ}
        if minmax:
            a['min'] = arr.min(0).tolist()
            a['max'] = arr.max(0).tolist()
        accessors.append(a)
        return len(accessors) - 1

    p = add(pos.astype(np.float32), 34962, 5126, 'VEC3', True)
    n = add(nrm.astype(np.float32), 34962, 5126, 'VEC3')
    i = add(idx.astype(np.uint16 if pos.shape[0] < 65536 else np.uint32).reshape(-1), 34963, 5123 if pos.shape[0] < 65536 else 5125, 'SCALAR')
    body = b''.join(blobs)
    body += b'\0' * ((-len(body)) % 4)
    j = {
        'asset': {'version': '2.0', 'generator': 'ebb tools/hollow-prep/mote.py'},
        'scene': 0, 'scenes': [{'nodes': [0]}],
        'nodes': [{'name': 'mote', 'mesh': 0, 'extras': extras}],
        'meshes': [{'name': 'mote', 'primitives': [{'attributes': {'POSITION': p, 'NORMAL': n}, 'indices': i, 'material': 0}]}],
        'materials': [{'name': 'soot', 'pbrMetallicRoughness': {'baseColorFactor': list(albedo) + [1], 'metallicFactor': 0, 'roughnessFactor': 1}}],
        'buffers': [{'byteLength': len(body)}], 'bufferViews': views, 'accessors': accessors,
    }
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(body)))
        f.write(struct.pack('<I4s', len(js), b'JSON'))
        f.write(js)
        f.write(struct.pack('<I4s', len(body), b'BIN\0'))
        f.write(body)


def main(body_obj, eyes_obj, out):
    M = json.load(open(RECIPE, encoding='utf-8'))['foes']['motes']['mote']
    bv, bf = read_obj(body_obj)
    ev, ef = read_obj(eyes_obj)
    bv, ev = to_ours(bv), to_ours(ev)
    centre = (bv.min(0) + bv.max(0)) / 2
    k = M['sizeM'] / (bv.max(0) - bv.min(0)).max()
    bv, ev = (bv - centre) * k, (ev - centre) * k
    nrm, _ = smooth_normals(bv, bf)
    eyes = eye_placements(ev, ef, bv, bf, np.zeros(3))
    extras = {
        'note': 'Matt\'s soot mote (nTop, October 27, 2026), metres, Y up, facing +Z, centred. eyes: the shader\'s placements (lib-mote.wgsl), left (+x) first.',
        'acrossM': M['sizeM'],
        'eyes': [{'centre': e['centre'].round(5).tolist(), 'axis': e['axis'].round(4).tolist(), 'radiusM': round(float(e['radius']), 5)} for e in eyes],
    }
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    write_glb(out, bv, nrm, bf, M['albedo'], extras)
    print(f'{len(bf)} triangles, {len(bv)} vertices, {(bv.max(0) - bv.min(0)).round(4).tolist()} m across')
    for e in eyes:
        print(f"eye {'left' if e['side'] > 0 else 'right'}: centre {e['centre'].round(4).tolist()} axis {e['axis'].round(3).tolist()} radius {e['radius']:.4f} m, moved {e['movedBy'] * 1000:.1f} mm to the surface")
    print(f'wrote {out} ({os.path.getsize(out)} bytes)')


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
