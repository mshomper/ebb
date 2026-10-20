// Waterfalls (M2 Cliff tool; docs/07, 08). Visual only: the live sim moves the water cell to cell,
// and at a cliff it hands it from the lip cell straight to the foot, so nothing would show on the
// face. Here, each frame:
//   csDetect  finds lips: water flowing toward a neighbor whose bed lies well below, the real edge
//             found by marching the ground, and appends one segment per lip (atomic counter)
//   csArgs    turns the count into indirect draw arguments, capped per tier
// then water-falls-draw.wgsl draws a curtain strip per lip along a gravity arc, and spray.

// The drawing half is water-falls-draw.wgsl.

// #include lib-terrain
// #include lib-water

struct Falls {
  rectOrigin: vec2u, rectSize: vec2u,   // simulated rect (water cells)
  minDrop: f32, minDepth: f32, minSpeed: f32, cap: u32,
  rows: u32, time: f32, offset: f32, widthScale: f32,
  qThreads: f32, qSheet: f32, streakM: f32, streakRate: f32,
  albedo: f32, opacity: f32, sprayFrom: f32, sprayM: f32,
  sprayOpacity: f32, lipStep: f32, lipReach: f32, sprayPuffs: u32,
  thickMin: f32, thickMax: f32, bulkM: f32, _p0: f32,  // used by water-falls-draw.wgsl
};

// One lip: a = (edge x, top height, edge z, foot height), b = (direction x, z, speed off the lip, flow q m2/s),
// c = (1 if the cell to its left along the edge is a lip the same way, the same for its right, spare, spare).
struct Lip {
  a: vec4f,
  b: vec4f,
  c: vec4f,
};

// Whether cell c sends water over a drop toward its neighbor in direction n (the test below).
fn isLip(c: vec2i, n: vec2i) -> bool {
  let q = c + n;
  if (!inRect(c) || !inRect(q)) { return false; }
  let d = textureLoad(depthTex, c, 0).r;
  if (d < fl.minDepth || dot(textureLoad(velTex, c, 0).rg, vec2f(n)) < fl.minSpeed) { return false; }
  let bed = waterBed(heightTex, c);
  let bedQ = waterBed(heightTex, q);
  return bed - bedQ >= fl.minDrop && bed + d - (bedQ + textureLoad(depthTex, q, 0).r) >= fl.minDrop;
}

@group(0) @binding(0) var<uniform> fl: Falls;
@group(0) @binding(1) var heightTex: texture_2d<f32>;
@group(0) @binding(2) var depthTex: texture_2d<f32>;
@group(0) @binding(3) var velTex: texture_2d<f32>;
@group(0) @binding(4) var<storage, read_write> lips: array<Lip>;
@group(0) @binding(5) var<storage, read_write> counter: array<atomic<u32>, 4>;
@group(0) @binding(6) var<storage, read_write> args: array<u32, 8>;

fn inRect(c: vec2i) -> bool {
  let o = vec2i(fl.rectOrigin);
  return all(c > o) && all(c < o + vec2i(fl.rectSize) - 1);
}

@compute @workgroup_size(8, 8)
fn csDetect(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid.xy >= fl.rectSize)) { return; }
  let c = vec2i(gid.xy + fl.rectOrigin);
  if (!inRect(c)) { return; }
  let d = textureLoad(depthTex, c, 0).r;
  if (d < fl.minDepth) { return; }
  let v = textureLoad(velTex, c, 0).rg;
  let bed = waterBed(heightTex, c);
  let top = bed + d;
  let nb = array<vec2i, 4>(vec2i(1, 0), vec2i(-1, 0), vec2i(0, 1), vec2i(0, -1));
  for (var i = 0; i < 4; i++) {
    let q = c + nb[i];
    if (!inRect(q)) { continue; }
    let dir = vec2f(nb[i]);
    let outward = dot(v, dir);
    if (outward < fl.minSpeed) { continue; }
    let bedQ = waterBed(heightTex, q);
    let footY = bedQ + textureLoad(depthTex, q, 0).r;
    if (bed - bedQ < fl.minDrop || top - footY < fl.minDrop) { continue; }
    // The real edge: march the ground out from the cell's middle to where it falls away.
    let start = waterCellCenter(c);
    var edge = start + dir * fl.lipReach;
    var s = 0.0;
    loop {
      if (s > fl.lipReach) { break; }
      let p = start + dir * s;
      if (terrainHeight(heightTex, p) < top - fl.minDrop * 0.5) { edge = p - dir * fl.lipStep * 0.5; break; }
      s += fl.lipStep;
    }
    let k = atomicAdd(&counter[0], 1u);
    if (k < fl.cap) {
      lips[k].a = vec4f(edge.x, top, edge.y, footY);
      lips[k].b = vec4f(dir, min(outward, 4.0), d * outward);
      // Neighbors along the edge falling the same way, so a fall's outer edges feather off.
      let side = vec2i(-nb[i].y, nb[i].x);
      lips[k].c = vec4f(select(0.0, 1.0, isLip(c + side, nb[i])), select(0.0, 1.0, isLip(c - side, nb[i])), 0.0, 0.0);
    }
  }
}

@compute @workgroup_size(1)
fn csArgs() {
  let n = min(atomicLoad(&counter[0]), fl.cap);
  // Curtain: three layers (back, middle, front) of rows quads, 6 vertices each, per lip.
  // Spray: sprayPuffs quads per lip.
  // (4 columns across each strip: COLS in water-falls-draw.wgsl.)
  args[0] = fl.rows * 4u * 6u * 3u; args[1] = n; args[2] = 0u; args[3] = 0u;
  args[4] = fl.sprayPuffs * 6u; args[5] = n; args[6] = 0u; args[7] = 0u;
  atomicStore(&counter[1], n);
}
