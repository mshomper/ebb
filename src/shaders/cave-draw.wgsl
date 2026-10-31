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
  cut: vec4f,       // x: the cut-away height (world): nothing of the rock above it is drawn, so you look down into the cave; y: how dark the cut rock is
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> cu: CaveUniforms;
@group(1) @binding(1) var sceneCopy: texture_2d<f32>;
@group(1) @binding(2) var sceneDepth: texture_depth_2d;

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

@vertex fn vsCave(i: VsIn) -> VsOut {
  var o: VsOut;
  o.pos = frame.viewProj * vec4f(i.pos, 1.0);
  o.world = i.pos; o.n = i.nrm; o.col = i.col;
  return o;
}

@fragment fn fsCave(i: VsOut, @builtin(front_facing) front: bool) -> FsOut {
  // The diorama's cut: the roof and the walls' tops above it are not drawn.
  if (i.world.y > cu.cut.x) { discard; }
  var n = normalize(i.n);
  // The rock's outside, seen past the cut: plain and dark, like a cut face.
  if (!front && i.col.a < 0.5) {
    return FsOut(vec4f(cu.rock.rgb * cu.bounce.rgb * cu.cut.y * frame.exposure, 1.0), vec4f(octEncode(-n), 0.0, 0.0));
  }
  let p = i.world;
  let v = normalize(frame.cameraPos - p);
  var albedo: vec3f; var rough: f32;
  if (i.col.a > 0.5) {
    // A made thing (the pan, the rope): its own albedo.
    albedo = i.col.rgb; rough = 0.7;
  } else {
    // Rock: wetter near the water and low down, floor gravel where it faces up; a soft mottle.
    let toPool = length(p.xz - cu.pool.xz) - cu.pool.w;
    let wet = max(1.0 - smoothstep(0.0, cu.rock.w, toPool), 1.0 - smoothstep(cu.pool.y + 0.02, cu.pool.y + 0.25, p.y));
    let up = smoothstep(0.55, 0.85, n.y);
    // Mottled and banded like limestone, darker in the hollows that face away from the light.
    let band = 0.85 + 0.3 * vnoise(vec3f(p.x * 0.6, p.y * 7.0, p.z * 0.6));
    let m = (0.6 + 0.8 * vnoise(p * 3.1) * vnoise(p * 0.9 + 4.0)) * band * mix(0.7, 1.0, smoothstep(-0.3, 0.6, n.y));
    albedo = mix(mix(cu.rock.rgb, cu.floorAlb.rgb, up), cu.rockWet.rgb, wet * 0.8) * m;
    rough = mix(cu.floorAlb.w, cu.rockWet.w, wet);
  }
  let e = holeLight(p, n) + sunLight(p, n);
  var radiance = albedo * (e / PI + cu.bounce.rgb * (0.6 + 0.4 * max(n.y, 0.0))) + vec3f(cu.sunE.w);
  radiance += wetSpec(p, n, v, rough) * (1.0 - rough);
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
  var refl = cu.bounce.rgb * 0.15;
  if (r.y > 0.01) {
    let q = p + r * ((cu.hole.y - p.y) / r.y);
    let inHole = 1.0 - smoothstep(cu.hole.w * 0.8, cu.hole.w * 1.1, length(q.xz - cu.hole.xz));
    refl += cu.lightIn.rgb / PI * inHole;
  }
  let color = mix(under * T + scatter, refl * frame.exposure, f);
  return FsOut(vec4f(color, 1.0), vec4f(octEncode(n), 1.0, 0.0));
}

// ---- the beam: dust in the shaft scattering the light toward you ----

@fragment fn fsBeam(i: VsOut) -> @location(0) vec4f {
  // Behind the rock or the walker: nothing (the depth is read, not attached).
  if (i.pos.z <= textureLoad(sceneDepth, vec2i(i.pos.xy), 0) || i.world.y > cu.cut.x) { discard; }
  let n = normalize(i.n);
  let v = normalize(frame.cameraPos - i.world);
  // Thickest seen face on (the shaft's middle), thin at its edges; fading toward the floor.
  let thick = pow(abs(dot(n, v)), 1.5);
  let along = clamp((cu.hole.y - i.world.y) / max(cu.hole.y - cu.pool.y, 0.5), 0.0, 1.0);
  let t = cu.bounce.w;
  let motes = smoothstep(0.93, 1.0, vnoise(i.world * 26.0 + vec3f(0.0, t * 0.15, t * 0.05))) * 2.0;
  let sunK = select(0.0, 1.0, cu.sun.w > 0.5) * 3.0;
  let lux = cu.lightIn.rgb + cu.sunE.rgb * sunK;
  let c = lux * (cu.drips.z / 1000.0) * cu.drips.w * thick * (1.0 - along * 0.6) * (1.0 + motes);
  return vec4f(c * frame.exposure, 0.0);
}
