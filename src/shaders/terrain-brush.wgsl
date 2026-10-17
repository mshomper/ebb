// One brush stamp over its bounding rect of cells (docs/08, Brushes).
// Reads the live textures and writes the scratch twins; the caller copies the rect back,
// so neighbors are always read from the pre-stamp state (race-free smoothing).

struct Stamp {
  center: vec2f,      // world xz, meters
  radius: f32,
  hardness: f32,      // falloff starts at hardness * radius
  amount: f32,        // raise/lower: signed meters at the center; others: blend amount (log2 units)
  level: f32,         // flatten target height
  mode: u32,          // 0 raise/lower, 1 smooth, 2 flatten, 3 paint
  layer: u32,         // paint layer: 0 grass, 1 sand, 2 rock, 3 soil
  rectOrigin: vec2u,  // first cell of the rect
  rectSize: vec2u,
  openMin: vec2f,     // open land, world xz
  openMax: vec2f,
  edgeFade: f32,      // meters of fade before unopened land
  worldOrigin: f32,
  cell: f32,
  span: f32,          // smooth: tap spacing in cells, grows with the brush so big brushes soften big shapes
};

@group(0) @binding(0) var<uniform> s: Stamp;
@group(0) @binding(1) var heightIn: texture_2d<f32>;
@group(0) @binding(2) var heightOut: texture_storage_2d<r32float, write>;
@group(0) @binding(3) var materialIn: texture_2d<f32>;
@group(0) @binding(4) var materialOut: texture_storage_2d<rgba8unorm, write>;

fn falloff(d: f32) -> f32 {
  return 1.0 - smoothstep(s.hardness * s.radius, s.radius, d);
}

fn edgeFade(p: vec2f) -> f32 {
  let inside = min(min(p.x - s.openMin.x, s.openMax.x - p.x), min(p.y - s.openMin.y, s.openMax.y - p.y));
  return clamp(inside / s.edgeFade, 0.0, 1.0);
}

fn loadH(c: vec2i) -> f32 {
  let n = vec2i(textureDimensions(heightIn)) - 1;
  return textureLoad(heightIn, clamp(c, vec2i(0), n), 0).r;
}

fn worldOf(c: vec2u) -> vec2f {
  return vec2f(s.worldOrigin) + (vec2f(c) + 0.5) * s.cell;
}

@compute @workgroup_size(8, 8)
fn csHeight(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid.xy >= s.rectSize)) { return; }
  let c = gid.xy + s.rectOrigin;
  let ci = vec2i(c);
  let p = worldOf(c);
  let h = loadH(ci);
  let f = falloff(distance(p, s.center)) * edgeFade(p);
  var outH = h;
  switch s.mode {
    case 0u: {
      outH = h + s.amount * f;
    }
    case 1u: {
      // 3 x 3 Gaussian mean (1 2 1 / 2 4 2 / 1 2 1), taps `span` cells apart.
      let sp = i32(max(s.span, 1.0));
      var g = 4.0 * h;
      g += 2.0 * (loadH(ci + vec2i(sp, 0)) + loadH(ci - vec2i(sp, 0)) + loadH(ci + vec2i(0, sp)) + loadH(ci - vec2i(0, sp)));
      g += loadH(ci + vec2i(sp, sp)) + loadH(ci + vec2i(-sp, sp)) + loadH(ci + vec2i(sp, -sp)) + loadH(ci + vec2i(-sp, -sp));
      let k = 1.0 - exp2(-s.amount * f);
      outH = mix(h, g / 16.0, k);
    }
    case 2u: {
      let k = 1.0 - exp2(-s.amount * f);
      outH = mix(h, s.level, k);
    }
    default: {}
  }
  textureStore(heightOut, c, vec4f(clamp(outH, -4.0, 12.0), 0.0, 0.0, 0.0));
}

@compute @workgroup_size(8, 8)
fn csPaint(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid.xy >= s.rectSize)) { return; }
  let c = gid.xy + s.rectOrigin;
  let p = worldOf(c);
  let m = textureLoad(materialIn, c, 0);
  let f = falloff(distance(p, s.center)) * edgeFade(p);
  let goal = vec4f(f32(s.layer == 0u), f32(s.layer == 1u), f32(s.layer == 2u), f32(s.layer == 3u));
  let k = 1.0 - exp2(-s.amount * f);
  let w = mix(m, goal, k);
  textureStore(materialOut, c, w / max(w.x + w.y + w.z + w.w, 1e-4));
}
