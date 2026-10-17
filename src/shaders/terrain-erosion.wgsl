// Erosion-lite: one thermal erosion step over a rect (Musgrave, Kolb, Mace, SIGGRAPH 1989).
// Gather form: each cell subtracts what it sends to its four neighbors and adds what each
// neighbor sends to it, recomputed from the neighbor's own state. Reads the live height,
// writes the scratch twin, so every cell updates from the same snapshot without races.

struct Erosion {
  rectOrigin: vec2u,
  rectSize: vec2u,
  talusSoil: f32,   // tan(angle) * cell size: the height step allowed between neighbors
  talusRock: f32,
  rate: f32,        // fraction of the excess moved per step (0..1)
  _p0: f32,
};

@group(0) @binding(0) var<uniform> e: Erosion;
@group(0) @binding(1) var heightIn: texture_2d<f32>;
@group(0) @binding(2) var heightOut: texture_storage_2d<r32float, write>;
@group(0) @binding(3) var materialIn: texture_2d<f32>;

// Direction k: 0 +x, 1 -x, 2 +z, 3 -z. The opposite direction is k ^ 1.
fn dirOf(k: u32) -> vec2i {
  let s = select(1, -1, (k & 1u) == 1u);
  return select(vec2i(s, 0), vec2i(0, s), k >= 2u);
}

fn clampCell(c: vec2i) -> vec2i {
  return clamp(c, vec2i(0), vec2i(textureDimensions(heightIn)) - 1);
}

fn H(c: vec2i) -> f32 {
  return textureLoad(heightIn, clampCell(c), 0).r;
}

// How much cell q sends to its neighbor in direction k during this step.
fn outflow(q: vec2i, k: u32) -> f32 {
  let hq = H(q);
  let rock = textureLoad(materialIn, clampCell(q), 0).z;
  let talus = mix(e.talusSoil, e.talusRock, rock);
  var ex = array<f32, 4>(0.0, 0.0, 0.0, 0.0);
  var total = 0.0;
  var most = 0.0;
  for (var i = 0u; i < 4u; i++) {
    let x = max(hq - H(q + dirOf(i)) - talus, 0.0);
    ex[i] = x;
    total += x;
    most = max(most, x);
  }
  if (total <= 0.0) { return 0.0; }
  return e.rate * 0.5 * most * ex[k] / total;
}

@compute @workgroup_size(8, 8)
fn csErode(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid.xy >= e.rectSize)) { return; }
  let c = vec2i(gid.xy + e.rectOrigin);
  var h = H(c);
  for (var k = 0u; k < 4u; k++) {
    h -= outflow(c, k);
    // The neighbor in direction k reaches back toward c in the opposite direction (k ^ 1).
    h += outflow(c + dirOf(k), k ^ 1u);
  }
  textureStore(heightOut, vec2u(c), vec4f(h, 0.0, 0.0, 0.0));
}
