// The Hollow (H3a; doc 16, The lantern, The camera below; src/render/passes/hollow.js). Physical
// light, painted last: the rock is lit only by the walker's lantern, a point light of so many candela
// falling off as the inverse square, its shadows soft-traced through the floor's own signed field (a
// 3D texture: positive in the air, its distance to the rock), with occlusion read from the same field
// and a faint bounce gathered round the flame. No light of its own anywhere else: the darks sit at
// minNits and the palette turns them deep blue-green at the tonemap. The rock in the way of the view
// is cut away (seen from inside the stone) or faded (between the eye and you); the veil, drawn after
// the walker, ghosts it back at a low fill with an outline where it turns edge-on.

// #include common
// #include lib-hash

struct HollowUniforms {
  lamp: vec4f,      // xyz: the flame (world); w: its glass's glow (nits), 0 when out
  lampE: vec4f,     // rgb: its luminous intensity (cd, flicker folded in); w: soft shadow sharpness
  rock: vec4f,      // rgb: the walls' albedo (linear); w: roughness
  floorAlb: vec4f,  // rgb: the floor's albedo; w: wet within this far of standing water (m)
  wetRock: vec4f,   // rgb: wet rock's albedo; w: its roughness
  bounce: vec4f,    // x: the bounce per cd (lux at the flame's side); y: the air's scatter per metre; z: water f0; w: animTime
  fieldMin: vec4f,  // xyz: the field's first sample (world); w: its spacing (m)
  fieldN: vec4f,    // xyz: its sample counts; w: the shadow trace's most steps
  you: vec4f,       // xyz: your chest (world); w: within this far of the line from the eye the rock fades (m)
  veil: vec4f,      // x: the fill's alpha; y: the outline's alpha; z: the veil's nits; w: the faintest the rock goes (nits)
  water: vec4f,     // rgb: still water's albedo; w: 1 once a floor's field is in
  lampAt: vec4f,    // xyz: where the carried lantern hangs (world); w: its yaw
  // The island's rock scan on the rock, as the stack's mouth (decision 0001; the pass sets these):
  scanA: vec4f,     // x, y: the boulder-top and cliff-face scans' tiles (per meter); z: strength 0..1; w: normal strength
  scanB: vec4f,     // rgb: the scan's mean albedo (its variation about it is what is drawn); w: how much of the noise bump stays
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> hu: HollowUniforms;
@group(1) @binding(1) var field: texture_3d<f32>;
@group(1) @binding(2) var fieldSampler: sampler;
// The island's scanned ground maps (src/render/ground-detail.js), the rock only: a albedo, b normal xy, roughness, cavity.
@group(1) @binding(3) var groundA: texture_2d_array<f32>;
@group(1) @binding(4) var groundB: texture_2d_array<f32>;
@group(1) @binding(5) var groundSampler: sampler;
const SCAN_ROCK: i32 = 2;
const SCAN_CLIFF: i32 = 5;

struct Scan { albedo: vec3f, grad: vec3f };

/** One planar read of a scan layer: its albedo and its height gradient along u and v (as cave-draw.wgsl). */
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

/** The rock scan triplanar at a point: the cliff face on the sides, the boulder top from above. */
fn scanAt(q: vec3f, n: vec3f) -> Scan {
  var w = pow(abs(n), vec3f(4.0));
  w /= max(w.x + w.y + w.z, 1e-5);
  let sx = scanRead(SCAN_CLIFF, vec2f(q.z, -q.y) * hu.scanA.y, vec3f(0.0, 0.0, 1.0), vec3f(0.0, -1.0, 0.0));
  let sy = scanRead(SCAN_ROCK, vec2f(q.x, q.z) * hu.scanA.x, vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0));
  let sz = scanRead(SCAN_CLIFF, vec2f(q.x, -q.y) * hu.scanA.y, vec3f(1.0, 0.0, 0.0), vec3f(0.0, -1.0, 0.0));
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
  let n = dot(i, vec3f(1.0, 57.0, 113.0));
  let a = fract(sin(vec4f(n, n + 1.0, n + 57.0, n + 58.0)) * 43758.5453);
  let b = fract(sin(vec4f(n + 113.0, n + 114.0, n + 170.0, n + 171.0)) * 43758.5453);
  let x = mix(mix(a.xz, a.yw, u.x), mix(b.xz, b.yw, u.x), u.z);
  return mix(x.x, x.y, u.y);
}

/** A point in the floor's own frame (the noise stays precise far from the world's middle). */
fn local(w: vec3f) -> vec3f { return w - hu.fieldMin.xyz + vec3f(37.0, 11.0, 23.0); }

/** The field at a point: the distance to the rock in the air (m), negative in the rock, clamped. */
fn fieldAt(p: vec3f) -> f32 {
  let uvw = ((p - hu.fieldMin.xyz) / hu.fieldMin.w + 0.5) / hu.fieldN.xyz;
  return textureSampleLevel(field, fieldSampler, uvw, 0.0).r;
}

/** How much of the flame a point sees (0..1): a soft shadow traced along the field toward it. */
fn lampSight(p: vec3f, n: vec3f) -> f32 {
  if (hu.water.w < 0.5) { return 1.0; }
  let to = hu.lamp.xyz - p; let dist = length(to); let d = to / max(dist, 1e-4);
  let o = p + n * 0.06;
  var res = 1.0; var t = 0.08;
  let steps = i32(hu.fieldN.w);
  for (var k = 0; k < steps; k++) {
    if (t > dist - 0.15) { break; }
    let h = fieldAt(o + d * t);
    res = min(res, hu.lampE.w * h / t);
    if (res < 0.02) { return 0.0; }
    t += clamp(h * 0.85, 0.04, 0.8);
  }
  return clamp(res, 0.0, 1.0);
}

/** How open the air round a point is (0..1), from the field a little way out along its normal. */
fn openness(p: vec3f, n: vec3f) -> f32 {
  if (hu.water.w < 0.5) { return 1.0; }
  var occ = 0.0;
  for (var k = 1; k <= 3; k++) {
    let d = 0.22 * f32(k * k);
    occ += max(0.0, d - fieldAt(p + n * d)) / d;
  }
  return clamp(1.0 - occ * 0.42, 0.15, 1.0);
}

/** The lantern's light reaching a point (lux), before its shadow. */
fn lampLight(p: vec3f, n: vec3f) -> vec3f {
  let d = hu.lamp.xyz - p; let d2 = max(dot(d, d), 0.04);
  return hu.lampE.rgb * max(dot(n, d * inverseSqrt(d2)), 0.0) / d2;
}

/** The flame mirrored in wet stone or still water (nits). */
fn lampSpec(p: vec3f, n: vec3f, v: vec3f, rough: f32, f0: f32) -> vec3f {
  let l = normalize(hu.lamp.xyz - p); let hv = normalize(l + v);
  let a = max(rough * rough, 0.02); let a2 = a * a;
  let nh = max(dot(n, hv), 0.0);
  let dd = a2 / (PI * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
  let f = f0 + (1.0 - f0) * pow(1.0 - max(dot(v, hv), 0.0), 5.0);
  return lampLight(p, n) * dd * f / max(dot(n, v), 0.1);
}

/** The air round the lantern lit by it, along the view ray to p (closed form of the inverse square), nits. */
fn lampHaze(p: vec3f) -> vec3f {
  let e = frame.cameraPos; let rd = p - e; let len = length(rd); let dir = rd / max(len, 1e-4);
  let c = hu.lamp.xyz - e; let t0 = dot(c, dir); let h = max(length(c - dir * t0), 0.06);
  let s = (atan((len - t0) / h) - atan(-t0 / h)) / h;
  return hu.lampE.rgb * hu.bounce.y * s / (4.0 * PI);
}

@vertex fn vsHollow(i: VsIn) -> VsOut {
  var o: VsOut;
  var p = i.pos; var n = i.nrm; var col = i.col;
  // The carried lantern (alpha 4 its body, 5 its glass) is made at its foot and hung where it is now.
  if (col.a > 3.5) {
    let c = cos(hu.lampAt.w); let s = sin(hu.lampAt.w);
    p = vec3f(p.x * c + p.z * s, p.y, -p.x * s + p.z * c) + hu.lampAt.xyz;
    n = vec3f(n.x * c + n.z * s, n.y, -n.x * s + n.z * c);
    col.a -= 3.0;
  }
  o.pos = frame.viewProj * vec4f(p, 1.0);
  o.world = p; o.n = n; o.col = col;
  return o;
}

/**
 * In the way of the view: 0 clear, 1 fully faded (between the eye and your chest, near that line).
 * The floor never is (a face turned up, low down): only walls, pillars and the roof hide you.
 */
fn inTheWay(p: vec3f, n: vec3f) -> f32 {
  if (n.y > 0.55 && p.y < hu.you.y - 0.4) { return 0.0; }
  let e = frame.cameraPos; let d = hu.you.xyz - e;
  let t = dot(p - e, d) / max(dot(d, d), 1e-4);
  let off = length(p - (e + d * clamp(t, 0.0, 1.0)));
  return (1.0 - smoothstep(hu.you.w * 0.55, hu.you.w, off)) * (1.0 - smoothstep(0.82, 0.95, t)) * step(0.0, t);
}

/** Seen from inside the stone: the mesh's own face turned away from the eye (its normal points into the air). */
fn fromInside(world: vec3f, n: vec3f) -> bool {
  var g = cross(dpdx(world), dpdy(world));
  g = g * select(1.0, -1.0, dot(g, n) < 0.0);
  return dot(g, frame.cameraPos - world) < 0.0;
}

@fragment fn fsHollow(i: VsOut) -> FsOut {
  let rockish = i.col.a < 0.5;
  let inside = fromInside(i.world, i.n);
  // The rock scan, read everywhere (a texture read must stay in uniform control flow) on the mesh's
  // own normal, then weighed in on the rock only.
  let scan = scanAt(local(i.world), normalize(i.n) * select(1.0, -1.0, inside));
  // The rock in the way: cut away here (the veil ghosts it back after the walker); a made thing in
  // the way (the rope) is simply left out.
  if (rockish && inside) { discard; }
  if ((rockish || (i.col.a > 0.5 && i.col.a < 1.5)) && inTheWay(i.world, normalize(i.n)) > 0.5) { discard; }
  var n = normalize(i.n);
  if (inside) { n = -n; }
  let p = i.world;
  let v = normalize(frame.cameraPos - p);
  // The lantern's glass: its own glow while it burns.
  if (i.col.a > 1.5 && i.col.a < 2.5 && hu.lamp.w > 0.0) {
    return FsOut(vec4f(i.col.rgb * hu.lamp.w * frame.exposure, 1.0), vec4f(octEncode(n), 0.0, 2.0 / 3.0));
  }
  var albedo: vec3f; var rough: f32; var f0 = 0.04;
  let q = local(p);
  if (i.col.a > 2.5) {
    // Still water: dark, its surface broken by slow ripples, the flame mirrored in it.
    let t = hu.bounce.w;
    n = normalize(vec3f(0.03 * sin(q.x * 3.1 + t * 0.6) + 0.02 * sin(q.z * 4.7 - t * 0.4), 1.0, 0.03 * cos(q.z * 2.9 + t * 0.5) + 0.02 * cos(q.x * 5.3 + t * 0.3)));
    // None inside the rock (the sheet runs past the walls; seen from above with the roof cut away).
    if (fieldAt(p) < -0.02) { discard; }
    // Shallow and clear: the wet stone under it shows through, its grain the rock scan's.
    albedo = hu.water.rgb * mix(vec3f(1.0), scan.albedo / max(hu.scanB.rgb, vec3f(0.01)), hu.scanA.z); rough = 0.08; f0 = hu.bounce.z;
  } else if (i.col.a > 0.5) {
    albedo = i.col.rgb; rough = 0.7;
  } else {
    // Worn rock: floor where it faces up, mottled and banded, wet near standing water.
    let up = smoothstep(0.55, 0.85, n.y);
    let band = 0.8 + 0.4 * smoothstep(0.3, 0.7, vnoise(vec3f(q.x * 0.7, q.y * 6.0, q.z * 0.7)));
    let grain = 0.8 + 0.4 * vnoise(q * 9.0);
    let m = (0.7 + 0.6 * smoothstep(0.3, 0.7, vnoise(q * 1.9))) * band * grain;
    let wet = i.col.r;
    let sk = hu.scanA.z;
    albedo = mix(mix(hu.rock.rgb, hu.floorAlb.rgb, up), hu.wetRock.rgb, wet * 0.8) * mix(m, 1.0, sk * 0.6);
    // The scan's variation about its own mean (the palette still sets the colour, at the tonemap).
    albedo *= mix(vec3f(1.0), scan.albedo / max(hu.scanB.rgb, vec3f(0.01)), sk);
    rough = mix(hu.rock.w, hu.wetRock.w, wet);
    // A fine bump so the lantern rakes across worn stone.
    let e = 0.02;
    let b = vec3f(vnoise(q * 6.0 + vec3f(e, 0.0, 0.0)) - vnoise(q * 6.0 - vec3f(e, 0.0, 0.0)),
      vnoise(q * 6.0 + vec3f(0.0, e, 0.0)) - vnoise(q * 6.0 - vec3f(0.0, e, 0.0)),
      vnoise(q * 6.0 + vec3f(0.0, 0.0, e)) - vnoise(q * 6.0 - vec3f(0.0, 0.0, e))) / (2.0 * e);
    n = normalize(n - (b - n * dot(b, n)) * 0.05 * mix(1.0, hu.scanB.w, sk));
    let g = scan.grad * hu.scanA.w * sk;
    n = normalize(n - (g - n * dot(g, n)));
  }
  let sight = lampSight(p, normalize(i.n) * select(1.0, -1.0, inside));
  let ao = openness(p, n);
  let toLamp = length(p - hu.lamp.xyz);
  let lampB = hu.lampE.rgb * hu.bounce.x / (1.0 + toLamp * toLamp * 0.3);
  var radiance = albedo * (lampLight(p, n) * sight / PI + lampB * ao * (0.5 + 0.5 * max(n.y, 0.0))) + vec3f(hu.veil.w) * ao;
  let wetK = select(1.0 - smoothstep(0.2, 0.6, rough), 1.0, i.col.a > 2.5);
  radiance += lampSpec(p, n, v, max(rough, 0.05), f0) * sight * wetK * select(0.3, 1.0, i.col.a > 2.5);
  radiance += lampHaze(p);
  return FsOut(vec4f(radiance * frame.exposure, 1.0), vec4f(octEncode(n), select(0.0, 1.0, i.col.a > 2.5), select(0.0, 2.0 / 3.0, i.col.a > 0.5 && i.col.a < 2.5)));
}

// ---- the veil: the rock cut away from the view, ghosted back near the line from the eye to you ----

@fragment fn fsVeil(i: VsOut) -> @location(0) vec4f {
  let inside = fromInside(i.world, i.n);
  let g = normalize(cross(dpdx(i.world), dpdy(i.world)));
  let way = inTheWay(i.world, normalize(i.n));
  if (i.col.a > 0.5 || !(inside || way > 0.5)) { discard; }
  // Only near the line from the eye to you; elsewhere the cut stays open (the dark hides it).
  let e = frame.cameraPos; let d = hu.you.xyz - e;
  let t = dot(i.world - e, d) / max(dot(d, d), 1e-4);
  let off = length(i.world - (e + d * clamp(t, 0.0, 1.0)));
  let near = (1.0 - smoothstep(hu.you.w, hu.you.w * 2.2, off)) * (1.0 - smoothstep(0.9, 1.0, t)) * step(0.0, t);
  if (near <= 0.0) { discard; }
  let edge = 1.0 - smoothstep(0.08, 0.32, abs(dot(g, normalize(e - i.world))));
  let a = max(hu.veil.x, hu.veil.y * edge) * near;
  return vec4f(hu.rock.rgb * hu.veil.z * frame.exposure * (1.0 + edge), a);
}
