"""Bake Matt's textured Meshy model onto our split figure, texel by texel (doc 23; October 26, 2026).

prep.py gives each part (the body and both arms) where to sample from: for the body its own rest
surface; for each arm its surface turned down onto the old sleeve (as for the vertex colours). Here:

1. xatlas unwraps the three parts into one 2048 atlas (new vertices where a seam cuts).
2. Each texel finds its point on our surface, then the nearest point on the textured model's surface
   facing the same way, and reads the model's colour and normal map there.
3. Colour: the model's own (sRGB), so the hat keeps its tan. Where a part keeps its vertex colour
   (the face, exactly as it is today, and the gloves, which come from the old gloves), the texel
   takes that colour instead.
4. Normal: the model's normal map tips its surface normal; the same tip is put on our own surface
   normal and turned back into the part's rest frame (an arm turned onto the sleeve turns back).
   Stored in object space (rest pose), so the skinned shader turns it with the bone, no tangents.
5. Charts are grown past their edges a few texels, so mipmaps never bleed the background in.
"""
import io
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree
import xatlas
import glb

SIZE = 2048
PAD = 4             # xatlas padding between charts (texels)
GROW = 8            # texels grown past each chart's edge
NEAR = 8            # candidate triangles of the textured model per texel


def unwrap(parts):
    """One atlas for all parts: per part, the new-vertex map, triangles and UVs (0..1)."""
    atlas = xatlas.Atlas()
    for p in parts:
        atlas.add_mesh(p['P'].astype(np.float32), p['F'].astype(np.uint32))
    po = xatlas.PackOptions()
    po.resolution = SIZE
    po.padding = PAD
    po.bilinear = True
    atlas.generate(pack_options=po)
    return [atlas[i] for i in range(len(parts))]


def raster(uv, F, size):
    """Every texel centre inside a UV triangle: its texel (y, x), triangle and barycentrics."""
    T = uv[F] * size - 0.5                     # texel centres sit on integer coordinates
    lo = np.floor(T.min(1)).astype(int)
    hi = np.ceil(T.max(1)).astype(int)
    ys, xs, ts, bs = [], [], [], []
    for t in range(len(F)):
        x0, y0 = max(lo[t, 0], 0), max(lo[t, 1], 0)
        x1, y1 = min(hi[t, 0], size - 1), min(hi[t, 1], size - 1)
        if x1 < x0 or y1 < y0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        gx, gy = gx.ravel(), gy.ravel()
        a, b, c = T[t]
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-12:
            continue
        w0 = ((b[1] - c[1]) * (gx - c[0]) + (c[0] - b[0]) * (gy - c[1])) / d
        w1 = ((c[1] - a[1]) * (gx - c[0]) + (a[0] - c[0]) * (gy - c[1])) / d
        w2 = 1 - w0 - w1
        inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
        if not inside.any():
            continue
        ys.append(gy[inside]); xs.append(gx[inside]); ts.append(np.full(inside.sum(), t))
        bs.append(np.stack([w0[inside], w1[inside], w2[inside]], 1))
    if not ys:
        return np.zeros(0, int), np.zeros(0, int), np.zeros(0, int), np.zeros((0, 3))
    return np.concatenate(ys), np.concatenate(xs), np.concatenate(ts), np.concatenate(bs)


class Source:
    """The textured model: its triangles, their tangent frames, and its colour and normal maps."""

    def __init__(self, path, n_samples=1_500_000):
        j, b = glb.read(path)
        prim = j['meshes'][0]['primitives'][0]
        self.P = glb.accessor(j, b, prim['attributes']['POSITION']).astype(np.float64)
        self.N = glb.accessor(j, b, prim['attributes']['NORMAL']).astype(np.float64)
        self.UV = glb.accessor(j, b, prim['attributes']['TEXCOORD_0']).astype(np.float64)
        self.I = glb.accessor(j, b, prim['indices']).reshape(-1, 3).astype(np.int64)
        mat = j['materials'][0]
        img = lambda ref: np.asarray(Image.open(io.BytesIO(glb.view(j, b, j['images'][j['textures'][ref['index']]['source']]['bufferView']))).convert('RGB')).astype(np.float32) / 255
        self.col = img(mat['pbrMetallicRoughness']['baseColorTexture'])       # sRGB
        self.nrm = img(mat['normalTexture']) * 2 - 1                          # tangent space
        A, B, C = (self.P[self.I[:, k]] for k in range(3))
        self.Ng = np.cross(B - A, C - A)
        area = np.linalg.norm(self.Ng, axis=1) / 2
        self.Ng /= 2 * area[:, None] + 1e-12
        # Tangents from the UVs (u along T, v along B), per triangle.
        u0, u1, u2 = (self.UV[self.I[:, k]] for k in range(3))
        e1, e2, d1, d2 = B - A, C - A, u1 - u0, u2 - u0
        r = d1[:, 0] * d2[:, 1] - d2[:, 0] * d1[:, 1]
        r = np.where(np.abs(r) < 1e-12, 1e-12, r)
        self.T = (e1 * d2[:, 1:2] - e2 * d1[:, 1:2]) / r[:, None]
        self.B = (e2 * d1[:, 0:1] - e1 * d2[:, 0:1]) / r[:, None]
        # Points spread over the surface, each knowing its triangle: candidates for the nearest.
        rng = np.random.default_rng(5)
        k = rng.choice(len(self.I), n_samples, p=area / area.sum())
        u, v = rng.random(n_samples), rng.random(n_samples)
        flip = u + v > 1
        u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
        self.S = A[k] + (B[k] - A[k]) * u[:, None] + (C[k] - A[k]) * v[:, None]
        self.Sk = k
        self.tree = cKDTree(self.S)
        # The face's skin (sRGB), for painting over the old eye ovals (as prep.py does).
        face = (np.abs(self.S[:, 0]) < 0.15) & (np.abs(self.S[:, 1] - 0.43) < 0.06) & (self.S[:, 2] > 0.1)
        fu = self.UV[self.I[k[face], 0]] + (self.UV[self.I[k[face], 1]] - self.UV[self.I[k[face], 0]]) * u[face, None] \
            + (self.UV[self.I[k[face], 2]] - self.UV[self.I[k[face], 0]]) * v[face, None]
        self.skin = np.median(self.read(self.col, fu), axis=0)

    def read(self, img, uv):
        """Bilinear read of a map at UVs (glTF: v down the image)."""
        H, W = img.shape[:2]
        px = np.clip(uv[:, 0] * W - 0.5, 0, W - 1.001)
        py = np.clip(uv[:, 1] * H - 0.5, 0, H - 1.001)
        x0, y0 = px.astype(int), py.astype(int)
        fx, fy = (px - x0)[:, None], (py - y0)[:, None]
        return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy)
                + img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy)


def closest_on(X, A, B, C):
    """The closest point to X on triangle ABC (all n x 3), as barycentrics (Ericson 5.1.5)."""
    ab, ac, ap = B - A, C - A, X - A
    d1, d2 = (ab * ap).sum(1), (ac * ap).sum(1)
    bp = X - B
    d3, d4 = (ab * bp).sum(1), (ac * bp).sum(1)
    cp = X - C
    d5, d6 = (ab * cp).sum(1), (ac * cp).sum(1)
    va = d3 * d6 - d5 * d4
    vb = d5 * d2 - d1 * d6
    vc = d1 * d4 - d3 * d2
    den = np.where(np.abs(va + vb + vc) < 1e-20, 1e-20, va + vb + vc)
    v, w = vb / den, vc / den
    bary = np.stack([1 - v - w, v, w], 1)
    # The regions outside the face: a vertex or an edge.
    def put(mask, b):
        bary[mask] = b[mask] if b.ndim == 2 else b
    e = lambda x, y: np.where(np.abs(x - y) < 1e-20, 1e-20, x - y)
    t = d1 / e(d1, d3)
    put((vc <= 0) & (d1 >= 0) & (d3 <= 0), np.stack([1 - t, t, 0 * t], 1))
    t = d2 / e(d2, d6)
    put((vb <= 0) & (d2 >= 0) & (d6 <= 0), np.stack([1 - t, 0 * t, t], 1))
    t = (d4 - d3) / e((d4 - d3) + (d5 - d6), 0)
    put((va <= 0) & (d4 - d3 >= 0) & (d5 - d6 >= 0), np.stack([0 * t, 1 - t, t], 1))
    put((d1 <= 0) & (d2 <= 0), np.array([1.0, 0, 0]))
    put((d3 >= 0) & (d4 <= d3), np.array([0, 1.0, 0]))
    put((d6 >= 0) & (d5 <= d6), np.array([0, 0, 1.0]))
    return bary


def tip(a, b):
    """Rotation matrices (n x 3 x 3) turning unit vectors a onto b."""
    v = np.cross(a, b)
    c = (a * b).sum(1)
    K = np.zeros((len(a), 3, 3))
    K[:, 0, 1], K[:, 0, 2], K[:, 1, 0] = -v[:, 2], v[:, 1], v[:, 2]
    K[:, 1, 2], K[:, 2, 0], K[:, 2, 1] = -v[:, 0], -v[:, 1], v[:, 0]
    return np.eye(3)[None] + K + K @ K / (1 + np.maximum(c, -0.999))[:, None, None]


def srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def grow(img, filled, steps):
    """Spread each chart's edge texels outward into the empty ones, step by step."""
    img, filled = img.copy(), filled.copy()
    for _ in range(steps):
        acc = np.zeros_like(img)
        cnt = np.zeros(filled.shape)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
            f = np.roll(np.roll(filled, dy, 0), dx, 1)
            acc += np.roll(np.roll(img, dy, 0), dx, 1) * f[..., None]
            cnt += f
        new = ~filled & (cnt > 0)
        img[new] = acc[new] / cnt[new][:, None]
        filled |= new
    return img


def bake(parts, source_path, eyes_mask):
    """parts: dicts with P, N (rest), F, C (linear vertex colour), Ps, Ns (where to sample, the
    textured model's frame), Rt (rest to sampling turn), keep (0..1 per vertex: keep the vertex
    colour, no detail). eyes_mask(S): the old eye ovals on the textured model (painted as skin).
    Returns per part the new vertex map, triangles and UVs, and the colour (sRGB 8-bit) and
    object-space normal (8-bit) images."""
    src = Source(source_path)
    maps = unwrap(parts)
    colour = np.zeros((SIZE, SIZE, 3), np.float32)
    normal = np.zeros((SIZE, SIZE, 3), np.float32)
    filled = np.zeros((SIZE, SIZE), bool)
    for p, (vm, F2, UV) in zip(parts, maps):
        ys, xs, ts, bw = raster(UV, F2.astype(np.int64), SIZE)
        tri = vm[F2[ts]]                                     # original vertex ids, n x 3
        lerp = lambda a: (a[tri] * bw[..., None]).sum(1)
        X, Ns = lerp(p['Ps']), lerp(p['Ns'])
        Ns /= np.linalg.norm(Ns, axis=1, keepdims=True) + 1e-12
        Nr = lerp(p['N'])
        Nr /= np.linalg.norm(Nr, axis=1, keepdims=True) + 1e-12
        keep = lerp(p['keep'][:, None])[:, 0]
        vcol = srgb(lerp(p['C']))
        col = np.zeros((len(X), 3))
        nrest = np.zeros((len(X), 3))
        for s in range(0, len(X), 200_000):
            x, n = X[s:s + 200_000], Ns[s:s + 200_000]
            _, ii = src.tree.query(x, k=NEAR * 3)
            cand = src.Sk[ii]                                   # m x K triangles
            m, K = cand.shape
            xx = np.repeat(x, K, 0)
            cf = cand.ravel()
            A, B, C = (src.P[src.I[cf, k]] for k in range(3))
            bary = closest_on(xx, A, B, C)
            q = A * bary[:, :1] + B * bary[:, 1:2] + C * bary[:, 2:3]
            d = np.linalg.norm(q - xx, axis=1).reshape(m, K)
            agree = (src.Ng[cf].reshape(m, K, 3) * n[:, None, :]).sum(2)
            score = d + np.where(agree > 0.2, 0, 1.0)            # facing away: only if nothing else
            best = np.argmin(score, axis=1)
            pick = np.arange(m) * K + best
            t, bb = cf[pick], bary[pick]
            uv = (src.UV[src.I[t]] * bb[..., None]).sum(1)
            c = src.read(src.col, uv)
            S = q[pick]
            c[eyes_mask(S)] = src.skin
            col[s:s + len(x)] = c
            # The model's normal map tips its smooth normal; the same tip goes on ours.
            ng = (src.N[src.I[t]] * bb[..., None]).sum(1)
            ng /= np.linalg.norm(ng, axis=1, keepdims=True) + 1e-12
            Tt = src.T[t] - ng * (src.T[t] * ng).sum(1, keepdims=True)
            Tt /= np.linalg.norm(Tt, axis=1, keepdims=True) + 1e-12
            sign = np.sign((np.cross(ng, Tt) * src.B[t]).sum(1))[:, None]
            Bt = np.cross(ng, Tt) * np.where(sign == 0, 1, sign)
            tn = src.read(src.nrm, uv)
            # glTF maps read with tangents from the UVs: green points down the image (three.js flips it too).
            npert = Tt * tn[:, :1] - Bt * tn[:, 1:2] + ng * tn[:, 2:3]
            npert /= np.linalg.norm(npert, axis=1, keepdims=True) + 1e-12
            ns = (tip(ng, npert) @ n[..., None])[..., 0]
            # Back from where the part was sampled to its rest pose.
            nrest[s:s + len(x)] = ns @ p['Rt']
        col = col * (1 - keep[:, None]) + vcol * keep[:, None]
        nrest = nrest * (1 - keep[:, None]) + Nr * keep[:, None]
        nrest /= np.linalg.norm(nrest, axis=1, keepdims=True) + 1e-12
        colour[ys, xs] = col
        normal[ys, xs] = nrest * 0.5 + 0.5
        filled[ys, xs] = True
    colour = grow(colour, filled, GROW)
    normal = grow(normal, filled, GROW)
    to8 = lambda a: (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)
    return maps, to8(colour), to8(normal), float(filled.mean())


def encode(img, fmt, **kw):
    out = io.BytesIO()
    Image.fromarray(img).save(out, fmt, **kw)
    return out.getvalue()
