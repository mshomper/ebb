"""Make the game's teal from Matt's teal.glb (Documents\\Ebb\\_creatures): option B, Matt's call of
November 1, 2026. The rock is dropped; the bird is cut to the creature budget and its maps baked anew.

1. prep.py splits the bird from its rock (full detail, into a scratch folder).
2. cut.mjs cuts the welded bird with the game's quadric edge collapse, once per size, each vertex's
   colour riding along so colour edges keep their vertices.
3. tools/figure-prep/bake.py (as for the walker) unwraps each cut bird into a fresh atlas and bakes it,
   texel by texel, from the full-detail bird: its colour, and its tangent-space normal map turned into an
   object-space normal, which is what the creature shader reads (no tangents). The roughness and metal
   map is not carried: the creature pass never reads it.

    python tools/teal-prep/make.py <teal.glb> assets/models/teal

Writes teal.glb (one bird, near the camera) and teal-flock.glb (each bird of a flock).
"""
import io, json, os, struct, subprocess, sys, tempfile
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'figure-prep'))
sys.path.insert(0, HERE)
import glb   # noqa: E402
import bake  # noqa: E402
import prep  # noqa: E402

SIZES = (                 # file, triangles (the turnstone's budget), atlas size
    ('teal', 3000, 1024),
    ('teal-flock', 1200, 512),
)
COLOUR_WEIGHT = 1.0       # how much a colour difference across an edge costs in the cut
JPEG_COLOUR, JPEG_NORMAL = 92, 95


def welded_bird(path):
    """The full-detail bird welded by position, and each welded vertex's base colour."""
    j, b = glb.read(path)
    prim = j['meshes'][0]['primitives'][0]
    P = glb.accessor(j, b, prim['attributes']['POSITION']).astype(np.float64)
    UV = glb.accessor(j, b, prim['attributes']['TEXCOORD_0']).astype(np.float64)
    I = glb.accessor(j, b, prim['indices']).reshape(-1, 3).astype(np.int64)
    W = prep.weld(P)
    keep = np.unique(W)
    remap = -np.ones(len(P), dtype=np.int64)
    remap[keep] = np.arange(len(keep))
    F = remap[W[I]]
    F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 2] != F[:, 0])]
    ref = j['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index']
    img = np.asarray(Image.open(io.BytesIO(glb.view(j, b, j['images'][j['textures'][ref]['source']]['bufferView']))).convert('RGB')).astype(np.float32) / 255
    col = prep.texel(img, UV[keep])
    return P[keep], F, col


def cut(P, F, col, target, scratch):
    src, dst = os.path.join(scratch, 'in.bin'), os.path.join(scratch, f'out-{target}.bin')
    with open(src, 'wb') as f:
        f.write(struct.pack('<II', len(P), len(F)))
        f.write(P.astype(np.float64).tobytes()); f.write(F.astype(np.uint32).tobytes()); f.write(col.astype(np.float32).tobytes())
    subprocess.run(['node', os.path.join(HERE, 'cut.mjs'), src, str(target), str(COLOUR_WEIGHT), dst], check=True)
    raw = open(dst, 'rb').read()
    n, m = struct.unpack_from('<II', raw, 0)
    Pc = np.frombuffer(raw, np.float64, n * 3, 8).reshape(n, 3)
    Fc = np.frombuffer(raw, np.uint32, m * 3, 8 + n * 24).reshape(m, 3).astype(np.int64)
    return Pc, Fc


def vertex_normals(P, F):
    fn = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])   # area weighted
    N = np.zeros_like(P)
    for k in range(3):
        np.add.at(N, F[:, k], fn)
    return N / (np.linalg.norm(N, axis=1, keepdims=True) + 1e-12)


def write_glb(path, name, P, N, UV, F, colour_jpg, normal_jpg):
    chunks = [P.astype(np.float32).tobytes(), N.astype(np.float32).tobytes(), UV.astype(np.float32).tobytes(),
              F.astype(np.uint16 if len(P) < 65536 else np.uint32).ravel().tobytes(), colour_jpg, normal_jpg]
    views, body = [], b''
    for k, data in enumerate(chunks):
        body += b'\0' * ((-len(body)) % 4)
        v = {'buffer': 0, 'byteOffset': len(body), 'byteLength': len(data)}
        if k < 3: v['target'] = 34962
        elif k == 3: v['target'] = 34963
        views.append(v)
        body += data
    body += b'\0' * ((-len(body)) % 4)
    j = {
        'asset': {'version': '2.0', 'generator': 'ebb tools/teal-prep/make.py'},
        'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': name}],
        'meshes': [{'name': name, 'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1, 'TEXCOORD_0': 2}, 'indices': 3, 'material': 0}]}],
        'materials': [{'name': 'teal', 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0, 'roughnessFactor': 0.7,
                                                                 'baseColorTexture': {'index': 0}},
                       'normalTexture': {'index': 1}, 'extras': {'normalSpace': 'object'}}],
        'images': [{'bufferView': 4, 'mimeType': 'image/jpeg', 'name': 'colour'}, {'bufferView': 5, 'mimeType': 'image/jpeg', 'name': 'normal'}],
        'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}],
        'textures': [{'source': 0, 'sampler': 0}, {'source': 1, 'sampler': 0}],
        'accessors': [
            {'bufferView': 0, 'componentType': 5126, 'count': len(P), 'type': 'VEC3', 'min': P.min(0).tolist(), 'max': P.max(0).tolist()},
            {'bufferView': 1, 'componentType': 5126, 'count': len(P), 'type': 'VEC3'},
            {'bufferView': 2, 'componentType': 5126, 'count': len(P), 'type': 'VEC2'},
            {'bufferView': 3, 'componentType': 5123 if len(P) < 65536 else 5125, 'count': F.size, 'type': 'SCALAR'},
        ],
        'bufferViews': views, 'buffers': [{'byteLength': len(body)}],
    }
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(body)))
        f.write(struct.pack('<I4s', len(js), b'JSON')); f.write(js)
        f.write(struct.pack('<I4s', len(body), b'BIN\0')); f.write(body)


def main(src, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    with tempfile.TemporaryDirectory() as scratch:
        prep.main(src, scratch)                                  # the full-detail bird, off its rock
        full = os.path.join(scratch, 'teal.glb')
        P, F, col = welded_bird(full)
        for name, target, size in SIZES:
            Pc, Fc = cut(P, F, col, target, scratch)
            Nc = vertex_normals(Pc, Fc)
            bake.SIZE = size
            part = {'P': Pc, 'N': Nc, 'F': Fc, 'C': np.zeros_like(Pc), 'Ps': Pc, 'Ns': Nc, 'Rt': np.eye(3), 'keep': np.zeros(len(Pc))}
            maps, colour, normal, cover = bake.bake([part], full, lambda S: np.zeros(len(S), bool))
            vm, F2, UV = maps[0]
            path = os.path.join(out_dir, name + '.glb')
            write_glb(path, name, Pc[vm], Nc[vm], UV, F2.astype(np.int64),
                      bake.encode(colour, 'JPEG', quality=JPEG_COLOUR), bake.encode(normal, 'JPEG', quality=JPEG_NORMAL))
            print(json.dumps({'out': path, 'triangles': len(F2), 'vertices': len(vm), 'atlas': size,
                              'atlasCover': round(cover, 3), 'bytes': os.path.getsize(path)}))


if __name__ == '__main__':
    main(*sys.argv[1:])
