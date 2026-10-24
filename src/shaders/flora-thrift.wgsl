// Sea thrift (docs 10, 14): low cushions of fine leaves with pink pompoms, no mesh, one instance
// per plant from the growth engine's instance buffer. A cushion is many thin camera-facing blades
// from near its center out to a low dome, lit with the dome's normal so it reads as one soft
// mound. A flowering cushion carries pompoms on thin swaying stalks: each head a small
// camera-facing hexagon shaded as a ball. Evergreen; lit like the reeds; season albedo is physical
// (recipes/flora/thrift.json). Other species drawn with it (draw: thrift) may give their heads
// another form (P2b): a flat, frothy head (meadowsweet) or a daisy of white petals round a domed
// heart (chamomile), each a disc square to the stalk's top; and a herb that rests in winter shrinks
// to a low brown crown with no heads.

// #include common
// #include lib-hash
// #include lighting-bindings
// #include lib-sky
// #include lib-lighting
// #include lib-flora

struct ThriftDraw {
  c: FloraCommon,
  shape: vec4f,     // x blades on a new cushion, y on a full one, z cushion radius (m), w cushion height (m)
  bloom: vec4f,     // x blade width (m), y flowers on a new cushion, z on a full one, w stalk height (m)
  head: vec4f,      // x stalk width (m), y head radius (m), z sprout height (m), w blades on a seed
  look: vec4f,      // x stalk height variation, y new cushion radius share, z root shade, w sway per unit wind
  flower: vec4f,    // xyz flower albedo (linear), w 1 / gust size (1/m)
  stalk: vec4f,     // xyz stalk albedo (linear), w gust speed (m/s)
  form: vec4f,      // x head form (0 ball, 1 flat froth, 2 daisy), y dome height (share of head radius), z 1 rests as a crown in winter, w daisy heart share of its radius
  heart: vec4f,     // xyz daisy heart albedo (linear), w daisy petals
  crown: vec4f,     // xyz winter crown albedo (linear), w crown height (share of the cushion's)
};

const HEAD_BALL: f32 = 0.0;

const BLADE_VERTS: u32 = 3u;
const FLOWER_VERTS: u32 = 24u;   // a stalk quad, then a six-triangle head

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> td: ThriftDraw;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,    // the surface's, or facing the camera on a head
  @location(2) side: vec3f,      // a head's right and up, for its ball normal
  @location(3) upv: vec3f,
  @location(4) albedo: vec3f,
  @location(5) disc: vec3f,      // xy on a head (-1..1), z 1 on a head
  @location(6) ao: f32,
};

struct FsOut {
  @location(0) color: vec4f,
  @location(1) normalId: vec4f,
};

var<private> QUAD: array<vec2f, 6> = array<vec2f, 6>(
  vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(-1.0, 1.0),
  vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

fn nothing() -> VsOut {
  var o: VsOut;
  o.pos = vec4f(0.0, 0.0, -2.0, 1.0);   // outside the clip volume: the triangle is dropped
  o.world = vec3f(0.0); o.normal = vec3f(0.0, 1.0, 0.0); o.side = vec3f(1.0, 0.0, 0.0); o.upv = vec3f(0.0, 1.0, 0.0);
  o.albedo = vec3f(0.0); o.disc = vec3f(0.0); o.ao = 1.0;
  return o;
}

fn emit(p: vec3f, n: vec3f, albedo: vec3f, ao: f32) -> VsOut {
  var o = nothing();
  o.world = p;
  o.pos = frame.viewProj * vec4f(p, 1.0);
  o.normal = n;
  o.albedo = albedo;
  o.ao = ao;
  return o;
}

// Across a thin part at p running along dir, facing the camera.
fn facingSide(p: vec3f, dir: vec3f) -> vec3f {
  let s = cross(dir, frame.cameraPos - p);
  return select(vec3f(1.0, 0.0, 0.0), normalize(s), length(s) > 1e-6);
}

@vertex
fn vsThrift(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
  let a = plants[ii * FLORA_STRIDE];
  let b = plants[ii * FLORA_STRIDE + 1u];
  let lk = floraLookOf(ii);
  let stage = u32(round(a.w));
  let size = clamp(a.z, 0.0, 1.0);
  let seed = stage == FLORA_SEED;
  let plantU = u32(b.y * 16777216.0);
  let salt = u32(td.c.misc.y);
  let bladesMax = u32(td.shape.y);
  let radius = td.shape.z * select(mix(td.look.y, 1.0, size), 0.25, seed);
  // A herb resting for winter: a low crown of its brown leaf bases.
  let crown = td.form.z > 0.5 && stage == FLORA_DORMANT;
  let domeH = max(td.shape.w * mix(0.5, 1.0, size) * select(1.0, td.crown.w, crown), td.head.z);
  let leaf = select(td.c.albedo.xyz, mix(td.c.albedo.xyz, td.crown.xyz, 0.85), crown);
  let center = vec3f(a.x, b.w - 0.005, a.y);
  let up = vec3f(0.0, 1.0, 0.0);

  if (vi < bladesMax * BLADE_VERTS) {
    // ---- a blade of the cushion ----
    let blade = vi / BLADE_VERTS;
    let corner = vi % BLADE_VERTS;
    let blades = select(u32(round(floraKeep(mix(td.shape.x, td.shape.y, size), lk, false))), u32(td.head.w), seed);
    if (blade >= blades) { return nothing(); }
    let h0 = hash3(vec3u(plantU, blade, salt));
    let h1 = pcg(h0);
    let h2 = pcg(h1);
    let h3 = pcg(h2);
    let v = vec4f(hashToFloat(h0), hashToFloat(h1), hashToFloat(h2), hashToFloat(h3));
    // From near the middle out to a point on the low dome (more of them toward the top).
    let az = v.x * 6.2831853;
    let rb = radius * 0.35 * sqrt(v.y);
    let rootXZ = center.xz + vec2f(cos(az), sin(az)) * rb;
    let root = vec3f(rootXZ.x, center.y, rootXZ.y);
    let elev = mix(0.35, 1.5, sqrt(v.z));
    let az2 = az + (v.w - 0.5) * 0.8;
    let domeN = normalize(vec3f(cos(az2) * cos(elev) / max(radius, 1e-3), sin(elev) / max(domeH, 1e-3), sin(az2) * cos(elev) / max(radius, 1e-3)));
    var tipP = center + vec3f(cos(az2) * cos(elev) * radius, sin(elev) * domeH, sin(az2) * cos(elev) * radius) * (0.85 + 0.3 * v.w);
    // Picked: the tips trimmed back; drowned: the blades laid down toward the ground.
    tipP = root + (tipP - root) * (1.0 - floraLooks.pick.y * lk.x * step(0.4, v.w));
    tipP.y = mix(tipP.y, center.y + 0.01, floraLooks.drown.x * lk.z);
    var tip = select(tipP, root + vec3f((v.w - 0.5) * 0.02, td.head.z * (0.7 + 0.6 * v.z), (v.x - 0.5) * 0.02), seed);
    // A plant picked past the cut share lays a few cut blades flat at its foot.
    let cuts = select(0u, u32(floraLooks.pick.w), !seed && lk.x >= floraLooks.pick.z);
    if (blade < cuts) {
      let ca = (f32(blade) + 0.4 * v.x) * 2.3;
      let cr = radius * (1.05 + 0.3 * v.y);
      tip = center + vec3f(cos(ca) * (cr + 0.6 * radius), 0.008, sin(ca) * (cr + 0.6 * radius));
      let cp = center + vec3f(cos(ca + 0.15) * cr, 0.008, sin(ca + 0.15) * cr);
      let cs = facingSide(cp, normalize(tip - cp));
      let cw = max(td.bloom.x * 1.2, floraPixelM(cp) * td.c.misc.z);
      var q = tip;
      if (corner == 0u) { q = cp - cs * cw * 0.5; }
      if (corner == 1u) { q = cp + cs * cw * 0.5; }
      return emit(q, up, floraLookAlbedo(leaf, lk) * 0.85, 0.9);
    }
    let dir = normalize(tip - root);
    let side = facingSide(root, dir);
    let width = max(td.bloom.x * (0.8 + 0.4 * v.y), floraPixelM(root) * td.c.misc.z);
    var p = tip;
    if (corner == 0u) { p = root - side * width * 0.5; }
    if (corner == 1u) { p = root + side * width * 0.5; }
    let tint = 0.85 + 0.3 * hashToFloat(h3 ^ 0x2b7u);
    let t = select(1.0, 0.0, corner < 2u);
    return emit(p, mix(up, domeN, 0.8), floraLookAlbedo(leaf, lk) * tint * (0.8 + 0.35 * t), mix(td.look.z, 1.0, t));
  }

  // ---- a pompom on its stalk: flowering cushions only ----
  let kf = vi - bladesMax * BLADE_VERTS;
  let fi = kf / FLOWER_VERTS;
  let slot = kf % FLOWER_VERTS;
  let flowers = u32(round(floraKeep(mix(td.bloom.y, td.bloom.z, size), lk, true)));
  if (stage != FLORA_FLOWERING || fi >= flowers) { return nothing(); }
  let hf = hash3(vec3u(plantU, fi, salt ^ 0x7f4au));
  let vf = vec3f(hashToFloat(hf), hashToFloat(pcg(hf)), hashToFloat(pcg(pcg(hf))));
  let az = vf.x * 6.2831853;
  let rb = radius * 0.55 * sqrt(vf.y);
  let baseXZ = center.xz + vec2f(cos(az), sin(az)) * rb;
  let base = vec3f(baseXZ.x, center.y, baseXZ.y);
  // A drowning plant's heads droop on lower, leaning stalks.
  let height = td.bloom.w * (1.0 - td.look.x * 0.5 + td.look.x * vf.z) * mix(0.6, 1.0, size) * (1.0 - floraLooks.drown.z * lk.z);
  // Lean a little outward; sway with gusts, stiff at the base.
  let lean = 0.12 + 0.2 * vf.y;
  let axis = floraLookLean(normalize(vec3f(cos(az) * lean, 1.0, sin(az) * lean)), lk);
  let gust = floraGust(td.c, baseXZ, td.flower.w, td.stalk.w, vf.z);
  let bend = vec3f(td.c.wind.x, 0.0, td.c.wind.y) * (td.c.wind.w * td.look.w * gust);
  let k = 2.0;

  if (slot < 6u) {
    let corner = QUAD[slot];
    let p0 = floraCurve(base, axis, bend, height, k, corner.y);
    let tangent = floraTangent(axis, bend, k, corner.y);
    let side = facingSide(p0, tangent);
    let width = max(td.head.x, floraPixelM(p0) * td.c.misc.z);
    return emit(p0 + side * corner.x * width * 0.5, normalize(cross(side, tangent)), floraLookAlbedo(td.stalk.xyz, lk), mix(td.look.z, 1.0, corner.y));
  }
  // The head: a hexagon facing the camera at the stalk's top, shaded as a ball.
  let top = floraCurve(base, axis, bend, height, k, 1.0);
  let hr = td.head.y * (0.85 + 0.3 * vf.x) * mix(0.7, 1.0, size);
  let toCam = normalize(frame.cameraPos - top);
  let side = normalize(select(cross(up, toCam), vec3f(1.0, 0.0, 0.0), abs(toCam.y) > 0.999));
  let upv = cross(toCam, side);
  let hk = slot - 6u;
  let tri = hk / 3u;
  let corner = hk % 3u;
  var d = vec2f(0.0);
  if (corner != 0u) {
    // A flat head or daisy turns by its own seeded angle, so neighbours' rims do not line up.
    let t = f32(tri + corner - 1u) * 1.0471976 + select(0.0, vf.z * 6.2831853, td.form.x > HEAD_BALL + 0.5);
    d = vec2f(cos(t), sin(t));
  }
  if (td.form.x > HEAD_BALL + 0.5) {
    // A flat head (froth) or a daisy: a disc square to the stalk's top, its middle domed up.
    let nrm = floraTangent(axis, bend, k, 1.0);
    let dx = normalize(select(cross(nrm, vec3f(0.0, 0.0, 1.0)), vec3f(1.0, 0.0, 0.0), abs(nrm.z) > 0.999));
    let dz = cross(dx, nrm);
    let dome = select(0.0, td.form.y * hr, corner == 0u);
    var o = emit(top + (dx * d.x + dz * d.y) * hr + nrm * dome, normalize(nrm + (dx * d.x + dz * d.y) * 0.45), td.flower.xyz * (0.9 + 0.2 * vf.y), 1.0);
    o.disc = vec3f(d, 1.0 + td.form.x);
    return o;
  }
  // Pushed half a radius toward the camera, so the stalk's top hides inside the ball.
  var o = emit(top + (side * d.x + upv * d.y) * hr + toCam * hr * 0.5, toCam, td.flower.xyz * (0.9 + 0.2 * vf.y), 1.0);
  o.side = side;
  o.upv = upv;
  o.disc = vec3f(d, 1.0);
  return o;
}

@fragment
fn fsThrift(in: VsOut) -> FsOut {
  var n = normalize(in.normal);
  var albedo = in.albedo;
  let r = length(in.disc.xy);
  if (in.disc.z > 2.5) {
    // A daisy: white petals round a gold heart, the rim cut into rounded petal tips.
    let a = atan2(in.disc.y, in.disc.x);
    let lobe = abs(cos(a * td.heart.w * 0.5));
    if (r > 0.6 + 0.25 * lobe) { discard; }
    if (r < td.form.w) { albedo = td.heart.xyz * (0.85 + 0.3 * hashToFloat(hash2(vec2u((in.disc.xy + 1.0) * 40.0)))); }
    else { albedo *= 0.9 + 0.1 * lobe; }
  } else if (in.disc.z > 1.5) {
    // A frothy flat head: many tiny flowers, a soft scalloped rim and a speckle of shade.
    let a = atan2(in.disc.y, in.disc.x);
    if (r > 0.72 + 0.12 * abs(cos(a * 4.5)) * hashToFloat(hash2(vec2u(u32(a * 9.0 + 40.0), 7u)))) { discard; }
    let speck = hashToFloat(hash2(vec2u((in.disc.xy + 1.0) * 24.0)));
    albedo *= 0.75 + 0.35 * speck;
  } else if (in.disc.z > 0.5) {
    // A ball of florets: the sphere's normal, a little darker toward its rim and in a speckle.
    let r2 = min(dot(in.disc.xy, in.disc.xy), 1.0);
    n = normalize(normalize(in.side) * in.disc.x + normalize(in.upv) * in.disc.y + n * sqrt(1.0 - r2));
    let speck = hashToFloat(hash2(vec2u((in.disc.xy + 1.0) * 6.0)));
    albedo *= (1.0 - 0.25 * r2) * (0.9 + 0.2 * speck);
  }
  let color = floraShade(td.c, in.world, n, albedo, in.ao, in.pos.xy, 0.25, 1.0, 0.0);
  return FsOut(vec4f(color, 1.0), floraNormalId());
}
