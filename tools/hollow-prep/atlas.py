"""The two Python steps of tools/hollow-prep/watcher.mjs (H2, the hagstone watcher, October 27, 2026).

    python atlas.py unwrap <mesh.bin> <out.bin> <size> <padding>
        mesh.bin: uint32 vertex count, uint32 triangle count, float32 xyz a vertex, uint32 3 a triangle.
        out.bin: uint32 new vertex count, uint32 triangle count, uint32 the old vertex a new vertex came
        from, float32 uv a new vertex (0..1, v down the image), uint32 3 a triangle. xatlas unwraps it
        into one atlas of size texels, charts padding texels apart (where a seam cuts, a vertex splits).
    python atlas.py jpeg <rgb.bin> <size> <out.jpg> <quality>
        rgb.bin: size * size * 3 bytes, rows top first. Written as a baseline JPEG.

Needs numpy, pillow and xatlas (pip install xatlas, MIT licence), as tools/figure-prep/bake.py does.
"""
import struct, sys
import numpy as np


def unwrap(src, out, size, pad):
    import xatlas
    raw = open(src, 'rb').read()
    nv, nf = struct.unpack_from('<II', raw, 0)
    v = np.frombuffer(raw, np.float32, nv * 3, 8).reshape(-1, 3)
    f = np.frombuffer(raw, np.uint32, nf * 3, 8 + nv * 12).reshape(-1, 3)
    atlas = xatlas.Atlas()
    atlas.add_mesh(v, f)
    po = xatlas.PackOptions()
    po.resolution = size
    po.padding = pad
    po.bilinear = True
    atlas.generate(pack_options=po)
    vmap, idx, uv = atlas[0]
    with open(out, 'wb') as fh:
        fh.write(struct.pack('<II', len(vmap), len(idx)))
        fh.write(vmap.astype(np.uint32).tobytes())
        fh.write(uv.astype(np.float32).tobytes())
        fh.write(idx.astype(np.uint32).tobytes())
    print(f'xatlas: {atlas.chart_count} charts, {len(vmap)} vertices after the seams, {float(np.ravel(atlas.utilization)[0]) * 100:.0f}% of the atlas used')


def jpeg(src, size, out, quality):
    from PIL import Image
    a = np.frombuffer(open(src, 'rb').read(), np.uint8).reshape(size, size, 3)
    Image.fromarray(a, 'RGB').save(out, 'JPEG', quality=quality, subsampling=0, optimize=True)


if __name__ == '__main__':
    if len(sys.argv) >= 2 and sys.argv[1] == 'unwrap' and len(sys.argv) == 6:
        unwrap(sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]))
    elif len(sys.argv) >= 2 and sys.argv[1] == 'jpeg' and len(sys.argv) == 6:
        jpeg(sys.argv[2], int(sys.argv[3]), sys.argv[4], int(sys.argv[5]))
    else:
        sys.exit(__doc__)
