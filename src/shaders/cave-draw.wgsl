// The spring's cave (the spring-ore plan, O3; src/render/passes/cave.js). Physical light, painted
// last: the cave is lit only by the hole above it, a disc of sky whose radiance is the outside
// light on level ground over pi, seen past the chimney's rim and falling off as the inverse square;
// the sun itself shines straight down the chimney only when it stands high enough to pass the rim;
// the light that comes in is bounced round the walls as a soft fill. The pool's water refracts the
// stones under it through Beer-Lambert absorption and reflects the bright hole by Fresnel. The beam
// is the dust in the shaft scattering the light toward you. All in lux and nits, pre-exposed; the
// palette paints it at the tonemap.

// #include common
// #include lib-hash

struct CaveUniforms {
  hole: vec4f,      // xyz: the hole's middle at the top of the chimney (m, world), w: its radius
  shaft: vec4f,     // x, z: the chimney's axis; y: the height its bottom rim opens into the cave; w: its radius
  lightIn: vec4f,   // rgb: the outside light on level ground (lux) the hole lets in; w: the bounce share
  sun: vec4f,       // xyz: toward the sun; w: 1 when it can shine down the chimney
  sunE: vec4f,      // rgb: the sun's own illuminance (lux); w: minimum fill (nits)
  bounce: vec4f,    // rgb: the bounced light's irradiance over pi (per unit albedo); w: animTime
  rock: vec4f,      // rgb albedo, w: wetNearM
  rockWet: vec4f,   // rgb albedo, w: roughness when wet
  floorAlb: vec4f,  // rgb albedo, w: roughness when dry
  pool: vec4f,      // x, z: the pool's middle; y: its water level (world); w: its radius
  water: vec4f,     // rgb: absorption per meter; w: f0
  tint: vec4f,      // rgb: what the water scatters; w: ripple slope
  drips: vec4f,     // x: count, y: every dripS seconds, z: beam nits per 1000 lux, w: beam scatter per meter
  you: vec4f,       // xyz: the walker's chest (world): the rock between the eye and it fades out; w: within this far of the line (m)
  glow: vec4f,      // the pool's own soft light (Matt: illuminate it slightly; fake light for the look): rgb its colour, w nits
  // A lantern (the stack's mouth, src/world/stack/mouth.js; all zero in the spring's cave):
  lamp: vec4f,      // xyz: its flame (world); w: its glass's glow (nits), 0 when it is cold
  lampE: vec4f,     // rgb: its luminous intensity (cd, flicker folded in); w: 1 when the rock carries baked light (vertex col: r, g lamp sight, b occlusion)
  lampMix: vec4f,   // x: which baked sight (0 the floor spot, 1 the hook); y: its bounce per cd (lux); z: the air's scatter per meter; w: wet glint strength
  soot: vec4f,      // xyz: the middle of a sooted opening (world; the mouth's arch); w: how far the soot reaches (m), 0 for none
  sootLook: vec4f,  // x: how dark it goes (0..1); yzw: unused
  // The island's rock scan on the rock (the stack's mouth; strength 0 in the spring's cave), decision 0001:
  scanA: vec4f,     // x, y: the boulder-top and cliff-face scans' tiles (per meter); z: strength 0..1; w: normal strength
  scanB: vec4f,     // rgb: the scan's mean albedo (its variation about it is what is drawn); w: how much of the noise bump stays
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> cu: CaveUniforms;
@group(1) @binding(1) var sceneCopy: texture_2d<f32>;
@group(1) @binding(2) var sceneDepth: texture_depth_2d;
// The island's scanned ground maps (src/render/ground-detail.js), the rock only: a albedo, b normal xy, roughness, cavity.
@group(1) @binding(3) var groundA: texture_2d_array<f32>;
@group(1) @binding(4) var groundB: texture_2d_array<f32>;
@group(1) @binding(5) var groundSampler: sampler;
const SCAN_ROCK: i32 = 2;
const SCAN_CLIFF: i32 = 5;

struct Scan { albedo: vec3f, grad: vec3f };

/** One planar read of a scan layer: its albedo and its height gradient along u and v (as piece-draw.wgsl's scanRead). */
fn scanRead(layer: i32, uv: vec2f, u: vec3f, v: vec3f) -> Scan {
  let a = textureSample(groundA, groundSampler, uv, layer);
  let b = textureSample(groundB, groundSampler, uv, layer);
  let t = vec2f(b.r, b.g) * 2.0 - 1.0;
  let tz = sqrt(max(1.0 - dot(t, t), 1e-4));
  var s: Scan;
  s.albedo = a.rgb;
  s.grad = u * (-t.x / tz) + v * (t.y / tz);
  return s;
}

/** The rock scan triplanar at a point: the cliff face on the sides, the boulder top from above (weights from the normal). */
fn scanAt(q: vec3f, n: vec3f) -> Scan {
  var w = pow(abs(n), vec3f(4.0));
  w /= max(w.x + w.y + w.z, 1e-5);
  let sx = scanRead(SCAN_CLIFF, vec2f(q.z, -q.y) * cu.scanA.y, vec3f(0.0, 0.0, 1.0), vec3f(0.0, -1.0, 0.0));
  let sy = scanRead(SCAN_ROCK, vec2f(q.x, q.z) * cu.scanA.x, vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0));
  let sz = scanRead(SCAN_CLIFF, vec2f(q.x, -q.y) * cu.scanA.y, vec3f(1.0, 0.0, 0.0), vec3f(0.0, -1.0, 0.0));
  var s: Scan;
  s.albedo = sx.albedo * w.x + sy.albedo * w.y + sz.albedo * w.z;
  s.grad = sx.grad * w.x + sy.grad * w.y + sz.grad * w.z;
  return s;
}

struct VsIn { @location(0) pos: vec3f, @location(1) nrm: vec3f, @location(2) col: vec4f };
struct VsOut { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) n: vec3f, @location(2) col: vec4f };
struct FsOut { @location(0) color: vec4f, @location(1) normalId: vec4f };

fn octEncode(n: vec3f) -> vec2f {
  var p = n.xz / (abs(n.x) + abs(n.y) + abs(n.z));
  if (n.y < 0.0) { p = (1.0 - abs(p.yx)) * select(vec2f(-1.0), vec2f(1.0), p >= vec2f(0.0)); }
  return p * 0.5 + 0.5;
}

/** A soft value noise over the rock, so no wall is one flat colour. */
fn vnoise(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  let h = (vec3f(1.0, 57.0, 113.0));
  let n = dot(i, h);
  let a = fract(sin(vec4f(n, n + 1.0, n + 57.0, n + 58.0)) * 43758.5453);
  let b = fract(sin(vec4f(n + 113.0, n + 114.0, n + 170.0, n + 171.0)) * 43758.5453);
  let x = mix(mix(a.xz, a.yw, u.x), mix(b.xz, b.yw, u.x), u.z);
  return mix(x.x, x.y, u.y);
}

/** The rock's bump height: a coarse and a fine layer of noise (m, small). */
fn bump(w: vec3f) -> f32 {
  // The stack's mouth (lit raking by its lantern) takes a broader, softer grain: the finest layer read
  // as blocks there. The spring's cave keeps its own.
  let soft = cu.soot.w > 0.0;
  let p = local(w) * select(1.0, 0.55, soft);
  return vnoise(p * 7.0) * 0.6 + vnoise(p * 23.0) * select(0.3, 0.08, soft) + smoothstep(0.35, 0.65, vnoise(vec3f(p.x * 1.6, p.y * 11.0, p.z * 1.6))) * select(0.3, 0.12, soft);
}

/** A point in the cave's own frame (the noise stays precise near the world's far corners). */
fn local(w: vec3f) -> vec3f { return w - vec3f(cu.shaft.x, cu.pool.y, cu.shaft.z) + vec3f(37.0, 11.0, 23.0); }

/** Light from the hole's disc of sky reaching a point (lux), seen past the chimney's rim. */
fn holeLight(p: vec3f, n: vec3f) -> vec3f {
  let h = cu.hole.xyz; let r = cu.hole.w;
  let d = h - p; let dl = max(length(d), 1e-3); let l = d / dl;
  var vis = 1.0;
  if (p.y < cu.shaft.y) {
    let t = (cu.shaft.y - p.y) / max(h.y - p.y, 1e-3);
    let q = p + d * t;
    vis = 1.0 - smoothstep(cu.shaft.w - 0.1, cu.shaft.w + 0.12, length(q.xz - cu.shaft.xz));
  }
  let area = PI * r * r;
  // L = E_out / pi; E = L * A * cos(at the point) * cos(at the disc, which faces down) / d^2.
  return cu.lightIn.rgb / PI * area * max(dot(n, l), 0.0) * max(l.y, 0.0) / max(dl * dl, r * r) * vis;
}

/** The sun straight down the chimney, when it stands high enough (lux). */
fn sunLight(p: vec3f, n: vec3f) -> vec3f {
  let s = cu.sun.xyz;
  if (cu.sun.w < 0.5 || s.y < 0.05) { return vec3f(0.0); }
  let r = cu.hole.w;
  let qh = p + s * ((cu.hole.y - p.y) / s.y);
  var vis = 1.0 - smoothstep(r * 0.85, r * 1.05, length(qh.xz - cu.hole.xz));
  if (p.y < cu.shaft.y) {
    let qc = p + s * ((cu.shaft.y - p.y) / s.y);
    vis *= 1.0 - smoothstep(cu.shaft.w * 0.85, cu.shaft.w * 1.05, length(qc.xz - cu.shaft.xz));
  }
  return cu.sunE.rgb * max(dot(n, s), 0.0) * vis;
}

/** A soft wet sheen: the hole's disc, mirrored in wet stone (nits). */
fn wetSpec(p: vec3f, n: vec3f, v: vec3f, rough: f32) -> vec3f {
  let l = normalize(cu.hole.xyz - p);
  let hv = normalize(l + v);
  let a = max(rough * rough, 0.02); let a2 = a * a;
  let nh = max(dot(n, hv), 0.0);
  let dd = a2 / (PI * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
  let f = 0.04 + 0.96 * pow(1.0 - max(dot(v, hv), 0.0), 5.0);
  return holeLight(p, n) * dd * f * 0.08 / max(dot(n, v), 0.1);
}

/** The lantern's light reaching a point (lux), with its baked sight of the flame. */
fn lampLight(p: vec3f, n: vec3f, sight: f32) -> vec3f {
  let d = cu.lamp.xyz - p; let d2 = max(dot(d, d), 0.04);
  return cu.lampE.rgb * max(dot(n, d * inverseSqrt(d2)), 0.0) / d2 * sight;
}

/** The lantern's flame mirrored in wet stone (nits). */
fn lampSpec(p: vec3f, n: vec3f, v: vec3f, rough: f32, sight: f32) -> vec3f {
  let l = normalize(cu.lamp.xyz - p); let hv = normalize(l + v);
  let a = max(rough * rough, 0.03); let a2 = a * a;
  let nh = max(dot(n, hv), 0.0);
  let dd = a2 / (PI * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
  let f = 0.04 + 0.96 * pow(1.0 - max(dot(v, hv), 0.0), 5.0);
  return lampLight(p, n, sight) * dd * f / max(dot(n, v), 0.1);
}

/**
 * The air round the lantern lit by it, along the view ray from the eye to p: the inverse-square
 * light integrated along the ray (closed form), times the scatter per meter (nits).
 */
fn lampHaze(p: vec3f) -> vec3f {
  if (cu.lampMix.z <= 0.0) { return vec3f(0.0); }
  let e = frame.cameraPos; let rd = p - e; let len = length(rd); let dir = rd / max(len, 1e-4);
  let c = cu.lamp.xyz - e; let t0 = dot(c, dir); let h = max(length(c - dir * t0), 0.06);
  let s = (atan((len - t0) / h) - atan(-t0 / h)) / h;
  return cu.lampE.rgb * cu.lampMix.z * s / (4.0 * PI);
}

@vertex fn vsCave(i: VsIn) -> VsOut {
  var o: VsOut;
  o.pos = frame.viewProj * vec4f(i.pos, 1.0);
  o.world = i.pos; o.n = i.nrm; o.col = i.col;
  return o;
}

@fragment fn fsCave(i: VsOut, @builtin(front_facing) front: bool) -> FsOut {
  // The rock between the eye and you fades out (a soft dither), so the roof and walls never hide you.
  if (i.col.a < 0.5 && cu.you.w > 0.0) {
    let e = frame.cameraPos;
    let d = cu.you.xyz - e;
    let t = clamp(dot(i.world - e, d) / max(dot(d, d), 1e-4), 0.0, 1.0);
    let off = length(i.world - (e + d * t));
    let fade = (1.0 - smoothstep(cu.you.w * 0.6, cu.you.w, off)) * smoothstep(0.98, 0.85, t);
    let dither = hashToFloat(hash2(vec2u(i.pos.xy)));
    if (fade > dither) { discard; }
  }
  var n = normalize(i.n);
  if (!front && i.col.a < 0.5) { n = -n; }
  let p = i.world;
  // The island's rock scan (the stack's mouth): read on the mesh's own normal, before the bumps.
  let scanK = select(0.0, cu.scanA.z, i.col.a < 0.5);
  // (Read everywhere, then weighed by scanK: a texture read must stay in uniform control flow.)
  let scan = scanAt(local(p), n);
  // The rock's own grain: a bump from two scales of noise, so the light rakes across worn stone (less
  // of it under the scan, whose own relief takes over).
  if (i.col.a < 0.5) {
    let e = 0.012;
    let b = vec3f(
      bump(p + vec3f(e, 0.0, 0.0)) - bump(p - vec3f(e, 0.0, 0.0)),
      bump(p + vec3f(0.0, e, 0.0)) - bump(p - vec3f(0.0, e, 0.0)),
      bump(p + vec3f(0.0, 0.0, e)) - bump(p - vec3f(0.0, 0.0, e))) / (2.0 * e);
    n = normalize(n - (b - n * dot(b, n)) * 0.06 * mix(1.0, cu.scanB.w, scanK));
    let g = scan.grad * cu.scanA.w * scanK;
    n = normalize(n - (g - n * dot(g, n)));
  }
  let v = normalize(frame.cameraPos - p);
  var albedo: vec3f; var rough: f32;
  // The lantern's glass and flame: their own glow while it burns (else a made thing, lit as one).
  if (i.col.a > 1.5 && cu.lamp.w > 0.0) {
    return FsOut(vec4f(i.col.rgb * cu.lamp.w * frame.exposure, 1.0), vec4f(octEncode(n), 0.0, 2.0 / 3.0));
  }
  if (i.col.a > 0.5) {
    // A made thing (the pan, the rope): its own albedo.
    albedo = i.col.rgb; rough = 0.7;
  } else {
    // Rock: wetter near the water and low down, floor gravel where it faces up; a soft mottle.
    let toPool = length(p.xz - cu.pool.xz) - cu.pool.w;
    // (Low down counts as wet only in the spring's cave, a seep round its pool; the stack's mouth has a
    // dry stone floor, wet only by its pool: else the whole floor glistened.)
    let lowWet = select(1.0 - smoothstep(cu.pool.y + 0.02, cu.pool.y + 0.25, p.y), 0.0, cu.soot.w > 0.0);
    let wet = max(1.0 - smoothstep(0.0, cu.rock.w, toPool), lowWet);
    let up = smoothstep(0.55, 0.85, n.y);
    // Mottled and banded like limestone, darker in the hollows that face away from the light.
    let q = local(p);
    let soft = cu.soot.w > 0.0;
    let band = 0.8 + 0.4 * smoothstep(select(0.35, 0.2, soft), select(0.65, 0.8, soft), vnoise(vec3f(q.x * 0.8, q.y * select(9.0, 3.2, soft), q.z * 0.8)));
    let grain = 0.75 + 0.5 * vnoise(q * select(11.0, 4.0, soft));
    let m = (0.7 + 0.6 * smoothstep(0.3, 0.7, vnoise(q * 2.3))) * band * grain * mix(0.6, 1.0, smoothstep(-0.3, 0.6, n.y));
    albedo = mix(mix(cu.rock.rgb, cu.floorAlb.rgb, up), cu.rockWet.rgb, wet * 0.8) * m;
    // The scan's variation about its own mean (the palette still sets the colour, at the tonemap).
    albedo *= mix(vec3f(1.0), scan.albedo / max(cu.scanB.rgb, vec3f(0.01)), scanK);
    // Old soot round the arch's opening, thicker above it where the smoke went up, and the scratched
    // signs in it: pale fine lines where the soot was scored through.
    if (cu.soot.w > 0.0) {
      let sd = (p - cu.soot.xyz) / vec3f(cu.soot.w, cu.soot.w * 1.35, cu.soot.w);
      let up = smoothstep(-0.6, 0.7, (p.y - cu.soot.y) / cu.soot.w);
      // A band hugging the opening's rim (the opening itself is air), heaviest above it.
      let dn = length(sd);
      let sootK = smoothstep(0.28, 0.42, dn) * (1.0 - smoothstep(0.7, 1.0, dn)) * (0.4 + 0.6 * up) * (0.7 + 0.3 * vnoise(q * 4.0));
      let scratch = smoothstep(0.9, 0.96, vnoise(vec3f(q.x * 26.0, q.y * 2.2, q.z * 26.0))) * smoothstep(0.25, 0.6, sootK) * (1.0 - smoothstep(0.75, 0.95, sootK));
      albedo *= (1.0 - cu.sootLook.x * sootK) + scratch * 1.4;
    }
    // Under the water: darker still, weed-stained, and broken up (the bed of a rock pool).
    let under = 1.0 - smoothstep(cu.pool.y - 0.06, cu.pool.y, p.y);
    albedo *= mix(1.0, 0.45 + 0.5 * vnoise(q * 6.0), under);
    rough = mix(cu.floorAlb.w, cu.rockWet.w, wet);
  }
  // Baked into the rock where there is a lantern (the stack's mouth): its sight of the flame from
  // here and how open the air round it is; full sight and no occlusion elsewhere.
  let baked = cu.lampE.w > 0.5 && i.col.a < 0.5;
  let sight = select(1.0, select(i.col.r, i.col.g, cu.lampMix.x > 0.5), baked);
  let ao = select(1.0, i.col.b, baked);
  let e = holeLight(p, n) + sunLight(p, n);
  // The bounce and fill gather round where the light comes in, and fade into the far corners.
  let toLight = length(p - vec3f(cu.shaft.x, cu.pool.y, cu.shaft.z));
  let near = 1.0 / (1.0 + toLight * toLight * 0.35);
  // The lantern's own bounce gathers round it the same way.
  let toLamp = length(p - cu.lamp.xyz);
  let lampB = cu.lampE.rgb * cu.lampMix.y / (1.0 + toLamp * toLamp * 0.5);
  let soft = (cu.bounce.rgb * near + lampB) * (0.5 + 0.5 * max(n.y, 0.0)) * ao;
  var radiance = albedo * ((e + lampLight(p, n, sight)) / PI + soft) + vec3f(cu.sunE.w) * ao;
  radiance += wetSpec(p, n, v, rough) * (1.0 - rough);
  // Its glints only in wet stone, never as glitter on the dry floor: on the smooth normal, a little rougher.
  // (and none under the pool's water: the water's own surface takes the glints there)
  let wetK = (1.0 - smoothstep(cu.rockWet.w, cu.floorAlb.w, rough)) * smoothstep(cu.pool.y - 0.01, cu.pool.y + 0.02, p.y);
  radiance += lampSpec(p, normalize(i.n) * select(1.0, -1.0, !front && i.col.a < 0.5), v, max(rough, 0.35), sight) * wetK * cu.lampMix.w;
  radiance += lampHaze(p);
  return FsOut(vec4f(radiance * frame.exposure, 1.0), vec4f(octEncode(n), 0.0, select(0.0, 2.0 / 3.0, i.col.a > 0.5)));
}

// ---- the pool ----

@vertex fn vsWater(i: VsIn) -> VsOut {
  var o: VsOut;
  o.pos = frame.viewProj * vec4f(i.pos, 1.0);
  o.world = i.pos; o.n = vec3f(0.0, 1.0, 0.0); o.col = i.col;
  return o;
}

/** The water's surface normal: slow swell and the rings where drips fall. */
fn waterNormal(p: vec3f) -> vec3f {
  let t = cu.bounce.w;
  var g = vec2f(sin(p.x * 3.1 + t * 0.7) + sin(p.z * 2.3 - t * 0.5), cos(p.x * 2.7 - t * 0.6) + cos(p.z * 3.3 + t * 0.4)) * 0.25;
  let count = u32(cu.drips.x);
  for (var k = 0u; k < count; k++) {
    let h = hashToFloat(hash2(vec2u(k, 77u)));
    let h2 = hashToFloat(hash2(vec2u(k, 191u)));
    let c = cu.pool.xz + (vec2f(h, h2) - 0.5) * cu.pool.w * 1.1;
    let ph = fract(t / cu.drips.y + h * 3.7);
    let d = length(p.xz - c);
    let ring = ph * 0.7;
    let w = exp(-pow((d - ring) / 0.04, 2.0)) * (1.0 - ph) * 3.0;
    g += normalize(p.xz - c + vec2f(1e-4)) * w;
  }
  return normalize(vec3f(-g.x * cu.tint.w, 1.0, -g.y * cu.tint.w));
}

@fragment fn fsWater(i: VsOut) -> FsOut {
  let px = vec2i(i.pos.xy);
  let dScene = textureLoad(sceneDepth, px, 0);
  // Reverse-Z: the water shows only where it is nearer than the stones.
  if (i.pos.z <= dScene) { discard; }
  let p = i.world;
  let n = waterNormal(p);
  let v = normalize(frame.cameraPos - p);
  // The water's depth along the view ray, from the two depths (reverse-Z with an infinite far plane).
  let thick = max(frame.near / max(dScene, 1e-7) - frame.near / max(i.pos.z, 1e-7), 0.0);
  let size = vec2i(textureDimensions(sceneCopy));
  let off = vec2i(n.xz * 14.0);
  let under = textureLoad(sceneCopy, clamp(px + off, vec2i(0), size - 1), 0).rgb;
  let T = exp(-cu.water.rgb * thick);
  let eIn = holeLight(p, vec3f(0.0, 1.0, 0.0)) + sunLight(p, vec3f(0.0, 1.0, 0.0));
  let scatter = cu.tint.rgb * (eIn / PI + cu.bounce.rgb) * (1.0 - T) * frame.exposure;
  let f = cu.water.w + (1.0 - cu.water.w) * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  // The reflection: the hole's bright disc where the mirrored ray meets it, else the dim rock above.
  let r = reflect(-v, n);
  // The dark cave mirrored: little but what is bright (the hole, a lantern), the ripples breaking it up
  // (the stack's mouth, with soot set: darker still, as still cave water reads).
  let dimRefl = select(0.15, 0.025, cu.soot.w > 0.0);
  var refl = cu.bounce.rgb * dimRefl * (0.5 + vnoise(local(p) * 3.0 + n * 6.0));
  if (r.y > 0.01) {
    let q = p + r * ((cu.hole.y - p.y) / r.y);
    let inHole = 1.0 - smoothstep(cu.hole.w * 0.8, cu.hole.w * 1.1, length(q.xz - cu.hole.xz));
    refl += cu.lightIn.rgb / PI * inHole;
  }
  // A soft light of its own, strongest in the deep middle and on the ripples, so the pool reads.
  let deep = 1.0 - exp(-thick * 3.0);
  let ripple = 1.0 + 4.0 * (1.0 - n.y);
  let own = cu.glow.rgb * cu.glow.w * deep * ripple * frame.exposure;
  // The lantern: lighting what the water scatters, its flame mirrored in the surface, the haze above.
  let lampIn = lampLight(p, vec3f(0.0, 1.0, 0.0), 1.0);
  let lampScatter = cu.tint.rgb * (lampIn / PI) * (1.0 - T) * frame.exposure;
  var lampRefl = vec3f(0.0);
  if (cu.lamp.w > 0.0) {
    // The flame itself, a bright smear broken by the ripples.
    let toL = cu.lamp.xyz - p; let lr = max(dot(r, normalize(toL)), 0.0);
    lampRefl = vec3f(1.0, 0.6, 0.28) * cu.lamp.w * (pow(lr, 4000.0) + pow(lr, 600.0) * 0.0015);
  }
  // The air's glow round a lantern: what shows through the water already carries it (the copy), so it
  // comes off before the water dims what is under it, and goes on once, in front.
  let hz = lampHaze(p) * frame.exposure;
  let below = max(under - hz, vec3f(0.0));
  let color = mix(below * T + scatter + lampScatter, (refl + lampRefl) * frame.exposure, f) + own + hz;
  return FsOut(vec4f(color, 1.0), vec4f(octEncode(n), 1.0, 0.0));
}

// ---- the beam: dust in the shaft scattering the light toward you ----

@fragment fn fsBeam(i: VsOut) -> @location(0) vec4f {
  // Behind the rock or the walker: nothing (the depth is read, not attached).
  if (i.pos.z <= textureLoad(sceneDepth, vec2i(i.pos.xy), 0)) { discard; }
  let n = normalize(i.n);
  let v = normalize(frame.cameraPos - i.world);
  // Thickest seen face on (the shaft's middle), thin at its edges; fading toward the floor.
  let thick = pow(abs(dot(n, v)), 1.5);
  let along = clamp((cu.hole.y - i.world.y) / max(cu.hole.y - cu.pool.y, 0.5), 0.0, 1.0);
  let t = cu.bounce.w;
  let motes = smoothstep(0.93, 1.0, vnoise(local(i.world) * 26.0 + vec3f(0.0, t * 0.15, t * 0.05))) * 2.0;
  let sunK = select(0.0, 1.0, cu.sun.w > 0.5) * 3.0;
  let lux = cu.lightIn.rgb + cu.sunE.rgb * sunK;
  let c = lux * (cu.drips.z / 1000.0) * cu.drips.w * thick * (1.0 - along * 0.6) * (1.0 + motes);
  return vec4f(c * frame.exposure, 0.0);
}
