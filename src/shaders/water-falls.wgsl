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
  thickMin: f32, thickMax: f32, bulkM: f32,  // used by water-falls-draw.wgsl
  brink: f32,         // throw speed off the lip as a share of the brink speed sqrt(g d)
  tuck: f32,          // m a curtain reaches below where it lands (water-falls-draw.wgsl)
  nearM: f32,         // within this distance (m) falls are drawn as droplet water, beyond as curtains (0: curtains only)
  fadeM: f32,         // over this distance (m) one gives way to the other
  _p0: f32,
};

const G_FALL: f32 = 9.81;

// Height a falling drop stops at: the ground, or the water's surface where there is water below
// the lip (never the water it fell from, which still laps the edge in the lip's own cell).
fn landingSurface(p: vec2f, top: f32, lipCell: vec2i) -> f32 {
  let g = terrainHeight(heightTex, p);
  let c = vec2i(floor(waterCellCoord(p) + 0.5));
  // Never the lip's own cell: its water is the film running down the rim, not a pool to land in.
  if (!inRect(c) || all(c == lipCell)) { return g; }
  let d = textureLoad(depthTex, c, 0).r;
  let bed = waterBed(heightTex, c);
  return select(g, max(g, levelAround(c, bed + d)), d > fl.minDepth && bed < top - fl.minDrop * 0.5);
}

// The water level a fall meets at cell c: the lowest of it and its wet neighbors. In a cell that
// straddles a wall's foot (its bed is its lowest corner) the sim can hold a column of water against
// the rock that is never drawn; a real pool has its neighbors at the same level, so it stands.
fn levelAround(c: vec2i, here: f32) -> f32 {
  var level = here;
  let nb = array<vec2i, 4>(vec2i(1, 0), vec2i(-1, 0), vec2i(0, 1), vec2i(0, -1));
  for (var i = 0; i < 4; i++) {
    let q = c + nb[i];
    if (!inRect(q)) { continue; }
    let dq = textureLoad(depthTex, q, 0).r;
    if (dq > fl.minDepth) { level = min(level, waterBed(heightTex, q) + dq); }
  }
  return level;
}

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
  let top0 = bed + d;
  let nb = array<vec2i, 4>(vec2i(1, 0), vec2i(-1, 0), vec2i(0, 1), vec2i(0, -1));
  for (var i = 0; i < 4; i++) {
    let q = c + nb[i];
    if (!inRect(q)) { continue; }
    let dir = vec2f(nb[i]);
    let outward = dot(v, dir);
    if (outward < fl.minSpeed) { continue; }
    let bedQ = waterBed(heightTex, q);
    let footY = bedQ + textureLoad(depthTex, q, 0).r;
    if (bed - bedQ < fl.minDrop || top0 - footY < fl.minDrop) { continue; }
    // On a rim that rounds over two cells, both look like lips; the fall belongs to the lower one
    // (which takes its top from this cell's water), or this one would land on that one's film.
    if (isLip(q, nb[i])) { continue; }
    // The water's real top: this cell's bed is its lowest corner, and the lip cell already sits on the
    // rim's rounded slope, so its own surface is too low. The shelf water just upstream is the level
    // the fall leaves from (when it is wet and not far above: a real step up is not this fall).
    var top = top0;
    var start = waterCellCenter(c);
    var reach = fl.lipReach;
    let up = c - nb[i];
    if (inRect(up)) {
      let dUp = textureLoad(depthTex, up, 0).r;
      let upTop = waterBed(heightTex, up) + dUp;
      if (dUp > fl.minDepth && upTop > top && upTop - top < fl.minDrop * 1.6) {
        top = upTop;
        start = waterCellCenter(up);
        reach += WATER_CELL;
      }
    }
    // The real edge: march the ground out from there to where it first begins to fall away, so the
    // fall starts at the top of the rim and runs down its rounded slope.
    var edge = start + dir * reach;
    var s = 0.0;
    loop {
      if (s > reach) { break; }
      let p = start + dir * s;
      if (terrainHeight(heightTex, p) < top - 0.06) { edge = p - dir * fl.lipStep * 0.5; break; }
      s += fl.lipStep;
    }
    // Water goes over a brink at about the critical speed sqrt(g d), whatever the sim's speed right
    // at the drop (it races toward the hole there), so a thin film hugs the rock and a deep stream
    // throws out.
    let throwV = min(outward, fl.brink * sqrt(G_FALL * d));
    // Where it lands: follow the arc down until it meets the ground or water under it, so a fall
    // onto sloping or hollow ground reaches all the way down.
    // Steep rock (the foot of a wall slopes over its last cells) does not stop it: the water slides
    // down the face, moving out with it, until flatter ground or water takes it.
    var land = footY;
    var slide = 0.0;
    var t = 0.02;
    loop {
      if (t > 2.0) { break; }
      let y = top - 0.5 * G_FALL * t * t;
      var p = edge + dir * (fl.offset + throwV * t + slide);
      // Never inside the rock: out along a steep face until the ground there is below the water
      // (on gentle ground it has simply landed; over the rim's rounded top it is still sliding).
      let leaving = top - y < 0.2;
      loop {
        if (slide > 0.8 || terrainHeight(heightTex, p) <= y + 0.02 || (terrainNormal(heightTex, p).y > 0.6 && !leaving)) { break; }
        slide += 0.04;
        p = edge + dir * (fl.offset + throwV * t + slide);
      }
      // It lands only on gentle ground or on water; on the steep face it keeps sliding down.
      let s = landingSurface(p, top, c);
      let onWater = s > terrainHeight(heightTex, p) + 0.005;
      if (!leaving && y <= s + 0.02 && (onWater || terrainNormal(heightTex, p).y > 0.6)) { land = s; break; }
      land = min(s, y);
      t += 0.02;
    }
    let k = atomicAdd(&counter[0], 1u);
    if (k < fl.cap) {
      lips[k].a = vec4f(edge.x, top, edge.y, land);
      lips[k].b = vec4f(dir, throwV, d * outward);
      // Neighbors along the edge falling the same way, so a fall's outer edges feather off.
      let side = vec2i(-nb[i].y, nb[i].x);
      lips[k].c = vec4f(select(0.0, 1.0, isLip(c + side, nb[i])), select(0.0, 1.0, isLip(c - side, nb[i])), slide, 0.0);
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
