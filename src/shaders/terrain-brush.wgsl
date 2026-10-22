// One brush stamp over its bounding rect of cells (docs/08, Brushes).
// Reads the live textures and writes the scratch twins; the caller copies the rect back,
// so neighbors are always read from the pre-stamp state (race-free smoothing).

struct Stamp {
  center: vec2f,      // world xz, meters
  radius: f32,
  hardness: f32,      // falloff starts at hardness * radius
  amount: f32,        // raise/lower: signed meters at the center; others: blend amount (log2 units)
  level: f32,         // flatten target height
  mode: u32,          // 0 raise/lower, 1 smooth, 2 flatten, 3 paint, 4 cliff shelf, 5 cliff rock
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
@group(0) @binding(5) var guard: texture_2d<f32>;   // 1 under a flight of Steps: heights stay put

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
    case 4u: {
      // Cliff shelf (src/world/terrain/cliff.js cliffHeight): the goal is the level inside, falling
      // away by |amount| (the stroke's Height) across the rim and by `span` meters across the fade
      // before unopened land (hardness holds the rim width in meters here). Terrace only lifts to
      // it and Cut only lowers, so going over a stroke again changes nothing.
      let d = distance(p, s.center);
      if (d < s.radius) {
        let w = max(s.hardness, s.cell * 0.5);
        let fc = 1.0 - smoothstep(s.radius - w, s.radius, d);
        let fall = (1.0 - fc) * max(abs(s.amount), s.cell) + (1.0 - edgeFade(p)) * s.span;
        outH = select(min(h, s.level + fall), max(h, s.level - fall), s.amount > 0.0);
      }
    }
    default: {}
  }
  // Steps keep their shape under every brush (src/world/pieces/steps.js); the stroke's end puts
  // back anything erosion moved.
  if (textureLoad(guard, c, 0).r > 0.5) { outH = h; }
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

// After a Cliff stroke: cells on a sheer face (a drop to a neighbor, either way, past amount meters)
// move toward rock by `level` (the rock share), so faces draw as stone and erosion keeps them sheer.
// Mirrors onFace() in src/world/terrain/cliff.js.
@compute @workgroup_size(8, 8)
fn csCliffRock(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid.xy >= s.rectSize)) { return; }
  let c = gid.xy + s.rectOrigin;
  let ci = vec2i(c);
  let h = loadH(ci);
  let drop = max(max(abs(h - loadH(ci + vec2i(1, 0))), abs(h - loadH(ci - vec2i(1, 0)))),
                 max(abs(h - loadH(ci + vec2i(0, 1))), abs(h - loadH(ci - vec2i(0, 1)))));
  let m = textureLoad(materialIn, c, 0);
  let k = select(0.0, s.level, drop > s.amount);
  let w = mix(m, vec4f(0.0, 0.0, 1.0, 0.0), k);
  textureStore(materialOut, c, w / max(w.x + w.y + w.z + w.w, 1e-4));
}
