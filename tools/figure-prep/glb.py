"""Read and write a single-mesh GLB: positions, normals, uvs, indices and images."""
import json, struct
import numpy as np

COMP = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def read(path):
    b = open(path, 'rb').read()
    jl = struct.unpack_from('<I', b, 12)[0]
    j = json.loads(b[20:20 + jl])
    bl = struct.unpack_from('<I', b, 20 + jl)[0]
    bin_ = b[28 + jl:28 + jl + bl]
    return j, bin_


def view(j, bin_, bvi):
    bv = j['bufferViews'][bvi]
    o = bv.get('byteOffset', 0)
    return bin_[o:o + bv['byteLength']]


def accessor(j, bin_, ai):
    a = j['accessors'][ai]
    bv = j['bufferViews'][a['bufferView']]
    o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = NCOMP[a['type']]
    dt = COMP[a['componentType']]
    stride = bv.get('byteStride')
    if stride and stride != n * np.dtype(dt).itemsize:
        raise ValueError('strided accessor')
    arr = np.frombuffer(bin_, dtype=dt, count=a['count'] * n, offset=o)
    return arr.reshape(a['count'], n) if n > 1 else arr


def write(path, j, bin_, replace):
    """Rewrite the GLB with some bufferViews' bytes replaced ({bufferView index: bytes})."""
    parts, off = [], 0
    for i, bv in enumerate(j['bufferViews']):
        data = replace.get(i, view(j, bin_, i))
        pad = (-off) % 4
        if pad:
            parts.append(b'\0' * pad)
            off += pad
        bv['byteOffset'] = off
        bv['byteLength'] = len(data)
        parts.append(data)
        off += len(data)
    body = b''.join(parts)
    body += b'\0' * ((-len(body)) % 4)
    j['buffers'][0]['byteLength'] = len(body)
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    total = 12 + 8 + len(js) + 8 + len(body)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total))
        f.write(struct.pack('<I4s', len(js), b'JSON')); f.write(js)
        f.write(struct.pack('<I4s', len(body), b'BIN\0')); f.write(body)
