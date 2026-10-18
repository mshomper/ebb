// Ripples (docs/07): a damped 2D wave equation on a fine world-anchored window around the camera
// focus, one dispatch per fixed real-time substep, ping-ponging the state.
//   h' = (2h - h_prev + C^2 lap(h)) * damping,   C = c dt / dx (kept at or under 0.5)
// Drops are smooth dips pressed into both h and h_prev (a displacement at rest, which rings out):
// raindrops and the pour brush come from a world-anchored drop grid hashed per substep, so any
// number fall without the CPU; queued impulses (creatures, fish) come from the uniform array.
// Only water ripples: on dry ground and thin films h is held at rest, so rings stop at the shore.
// Visual only: real seconds, never saved.

// #include lib-hash
// #include lib-terrain
// #include lib-water

const MAX_IMPULSES: u32 = 32u;

// One substep's settings. Mirrors STEP_BYTES in src/world/water/ripples.js.
struct RippleStep {
  origin: vec2i,          // world texel index of the window's first texel
  size: u32,              // N, texels per side
  texelM: f32,
  c2: f32,                // (c dt / dx)^2
  damping: f32,           // per substep
  minDepth: f32,          // water thinner than this holds no ripples (m)
  stepIndex: u32,         // substep counter, seeds the drop hash
  rainP: f32,             // chance a drop cell gets a raindrop this substep
  dropCellM: f32,         // drop grid cell size (m); drop radii never exceed it
  rainRadiusM: f32,
  rainStrengthM: f32,
  pour: vec4f,            // brush x, z, radius (m), chance per drop cell this substep (0: off)
  pourDrop: vec2f,        // pour drop radius (m), strength (m)
  _p0: f32,
  impulseCount: u32,
  impulses: array<vec4f, 32>,   // x, z (m), strength (m, dip depth), radius (m)
};

// State texel: h, h_prev, and the world texel it belongs to (x, z as floats).
@group(0) @binding(0) var<uniform> st: RippleStep;
@group(0) @binding(1) var stateIn: texture_2d<f32>;
@group(0) @binding(2) var stateOut: texture_storage_2d<rgba32float, write>;
@group(0) @binding(3) var heightOut: texture_storage_2d<r32float, write>;
@group(1) @binding(0) var waterDepth: texture_2d<f32>;   // live water depth (m), 0.5 m cells

fn wrapIndex(c: vec2i) -> vec2i {
  let n = i32(st.size);
  return ((c % n) + n) % n;
}

// h and h_prev of world texel c; at rest when the texel holds another world texel (it wrapped in
// as the window moved, or it lies outside the window).
fn stateAt(c: vec2i) -> vec2f {
  let k = c - st.origin;
  if (any(k < vec2i(0)) || any(k >= vec2i(i32(st.size)))) { return vec2f(0.0); }
  let s = textureLoad(stateIn, wrapIndex(c), 0);
  if (any(s.zw != vec2f(c))) { return vec2f(0.0); }
  return s.xy;
}

fn depthLoad(c: vec2i) -> f32 {
  return textureLoad(waterDepth, clamp(c, vec2i(0), vec2i(WATER_CELLS - 1)), 0).r;
}

// Bilinear live water depth at a world point.
fn depthAt(xz: vec2f) -> f32 {
  let u = waterCellCoord(xz);
  let i = vec2i(floor(u));
  let f = u - floor(u);
  let a = depthLoad(i);
  let b = depthLoad(i + vec2i(1, 0));
  let c = depthLoad(i + vec2i(0, 1));
  let d = depthLoad(i + vec2i(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Smooth compact dip profile: 1 at the center, 0 at the radius, (1 - t^2)^2.
fn bump(d: f32, radius: f32) -> f32 {
  let t = d / max(radius, 1e-4);
  if (t >= 1.0) { return 0.0; }
  let k = 1.0 - t * t;
  return k * k;
}

// Candidate drop in drop cell g, hash layer `layer` (0 rain, 1 pour), this substep: xy its world
// position, z a uniform roll in [0, 1); it falls when the roll is under the layer's chance.
fn dropIn(g: vec2i, layer: u32) -> vec3f {
  let h = hash3(vec3u(bitcast<u32>(g.x), bitcast<u32>(g.y), st.stepIndex * 2u + layer));
  let roll = hashToFloat(h);
  let px = hashToFloat(pcg(h ^ 0x9e3779b9u));
  let pz = hashToFloat(pcg(h ^ 0x85ebca6bu));
  return vec3f((vec2f(g) + vec2f(px, pz)) * st.dropCellM, roll);
}

// Total dip (m) at world point xz from rain and pour drops this substep.
fn drops(xz: vec2f) -> f32 {
  let g0 = vec2i(floor(xz / st.dropCellM));
  var dip = 0.0;
  let rainOn = st.rainP > 0.0;
  let pourOn = st.pour.w > 0.0 && distance(xz, st.pour.xy) < st.pour.z + st.dropCellM;
  if (!rainOn && !pourOn) { return 0.0; }
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let g = g0 + vec2i(i, j);
      if (rainOn) {
        let r = dropIn(g, 0u);
        if (r.z < st.rainP) { dip += st.rainStrengthM * bump(distance(xz, r.xy), st.rainRadiusM); }
      }
      if (pourOn) {
        let p = dropIn(g, 1u);
        if (p.z < st.pour.w && distance(p.xy, st.pour.xy) < st.pour.z) {
          dip += st.pourDrop.y * bump(distance(xz, p.xy), st.pourDrop.x);
        }
      }
    }
  }
  return dip;
}

@compute @workgroup_size(8, 8)
fn csRipple(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid.xy >= vec2u(st.size))) { return; }
  let c = st.origin + vec2i(gid.xy);   // world texel this invocation updates
  let idx = wrapIndex(c);
  let xz = (vec2f(c) + 0.5) * st.texelM;

  let s = stateAt(c);
  // Isotropic 9-point Laplacian (Patra and Karttunen 2006): with only a few texels per ring, the
  // 5-point one turns rings into squares.
  let edges = stateAt(c + vec2i(1, 0)).x + stateAt(c - vec2i(1, 0)).x
            + stateAt(c + vec2i(0, 1)).x + stateAt(c - vec2i(0, 1)).x;
  let corners = stateAt(c + vec2i(1, 1)).x + stateAt(c + vec2i(-1, 1)).x
              + stateAt(c + vec2i(1, -1)).x + stateAt(c + vec2i(-1, -1)).x;
  let lap = (4.0 * edges + corners - 20.0 * s.x) / 6.0;
  var h = (2.0 * s.x - s.y + st.c2 * lap) * st.damping;
  var hPrev = s.x * st.damping;

  // Drops: a dip pressed into both, so the water starts displaced and at rest.
  var dip = drops(xz);
  for (var k = 0u; k < min(st.impulseCount, MAX_IMPULSES); k++) {
    let im = st.impulses[k];
    dip += im.z * bump(distance(xz, im.xy), im.w);
  }
  h -= dip;
  hPrev -= dip;

  // Only on water: thin films and dry ground absorb the rings over a short shallow band.
  let wet = smoothstep(st.minDepth, st.minDepth * 3.0, depthAt(xz));
  h *= wet;
  hPrev *= wet;
  if (h != h || hPrev != hPrev) { h = 0.0; hPrev = 0.0; }

  textureStore(stateOut, idx, vec4f(h, hPrev, vec2f(c)));
  textureStore(heightOut, idx, vec4f(h, 0.0, 0.0, 0.0));
}
