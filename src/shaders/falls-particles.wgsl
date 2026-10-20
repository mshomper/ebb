// Waterfall droplets (M2): the water of a fall as particles, for the screen-space fluid surface
// (falls-fluid-*.wgsl; van der Laan, Green and Sainz, "Screen Space Fluid Rendering with Curvature
// Flow", I3D 2009; Green, "Screen Space Fluid Rendering for Games", GDC 2010). Visual only.
//   csEmit    each lip near the camera (water-falls.wgsl found them) sends droplets off its edge,
//             as many as its flow carries, in threads at a trickle and a full sheet at a stream
//   csUpdate  droplets fall under gravity with a little drag and spread as they fall, and are gone
//             once they reach the ground or the water below
// Particles live in a ring buffer: new ones overwrite the oldest.

// #include lib-terrain
// #include lib-water
// #include lib-hash

struct FluidSim {
  rectOrigin: vec2u, rectSize: vec2u,   // simulated water rect (cells)
  cam: vec3f, dt: f32,                  // eye (m); real step (s)
  time: f32, nearM: f32, fadeM: f32, rate: f32,           // droplets per second from a full-sheet lip
  radius: f32, lifeS: f32, turbulence: f32, drag: f32,    // m; s; spreading (m/s2); per s
  particleCap: u32, lipCap: u32, frame: u32, minDrop: f32,
  offset: f32, thickMin: f32, thickMax: f32, qThreads: f32,
  qSheet: f32, minDepth: f32, threadShare: f32, maxLean: f32,   // most outward speed (m/s) to follow a leaning face
};

struct Lip { a: vec4f, b: vec4f, c: vec4f };    // as in water-falls.wgsl
// p: position, age (s); v: velocity, life (s; 0 = dead); c: x how much air this droplet's lane takes
// in (shared by droplets that left the same spot on the lip, so whiteness runs in streaks), yzw spare.
struct Particle { p: vec4f, v: vec4f, c: vec4f };

@group(0) @binding(0) var<uniform> s: FluidSim;
@group(0) @binding(1) var heightTex: texture_2d<f32>;
@group(0) @binding(2) var depthTex: texture_2d<f32>;
@group(0) @binding(3) var<storage, read> lips: array<Lip>;
@group(0) @binding(4) var<storage, read> lipCount: array<u32, 4>;
@group(0) @binding(5) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(6) var<storage, read_write> head: array<atomic<u32>, 4>;

const G_FALL: f32 = 9.81;

fn rnd(a: u32, b: u32, c: u32) -> f32 {
  return hashToFloat(hash3(vec3u(a, b, c)));
}

@compute @workgroup_size(64)
fn csEmit(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= min(lipCount[0], s.lipCap)) { return; }
  let lip = lips[i];
  let edge = lip.a.xz;
  let top = lip.a.y;
  // Only near the eye: further off, the lip draws as a curtain (water-falls-draw.wgsl).
  let dist = distance(s.cam, vec3f(edge.x, top, edge.y));
  let near = 1.0 - smoothstep(s.nearM - s.fadeM, s.nearM, dist);
  if (near <= 0.0) { return; }
  let q = lip.b.w;
  let k = smoothstep(s.qThreads, s.qSheet, q);
  // A lip is the same lip frame to frame wherever it is in the list: key its randomness by place.
  let key = hash2(vec2u(u32(edge.x * 64.0 + 100000.0), u32(edge.y * 64.0 + 100000.0)));
  let want = s.rate * mix(s.threadShare, 1.0, pow(k, 0.7)) * near * s.dt;
  let count = min(u32(floor(want + rnd(key, s.frame, 1u))), 32u);
  if (count == 0u) { return; }
  let base = atomicAdd(&head[0], count);
  let dir = lip.b.xy;
  let perp = vec2f(-dir.y, dir.x);
  let atLip = clamp(q / max(lip.b.z, 0.1), 0.004, 0.08);
  for (var j = 0u; j < count; j++) {
    let n = base + j;
    let r0 = rnd(key, n, 2u);
    let r1 = rnd(key, n, 3u);
    let r2 = rnd(key, n, 4u);
    let r3 = rnd(key, n, 5u);
    // Across the edge: at a trickle the water keeps to a few threads, each lip its own; at a
    // stream it fills the whole edge.
    let lane = floor(r0 * 3.0);
    let laneAt = (rnd(key, u32(lane), 6u) - 0.5) * 0.4;
    let even = (r1 - 0.5) * 0.52;
    let across = mix(laneAt + (r1 - 0.5) * 0.08, even, k);
    let outM = s.offset + r2 * atLip;
    // A wall leans out toward its foot: the water follows the face down (lip.c.z, how far out it
    // must come to clear the foot, found by water-falls.wgsl), never falling inside the rock.
    // Capped: over a low drop with a long leaning foot it would otherwise fly off at many m/s.
    let tFall = sqrt(2.0 * max(top - lip.a.w, 0.05) / G_FALL);
    let speed = max(lip.b.z, min((lip.c.z + 0.04) / tFall, s.maxLean)) * (0.85 + 0.3 * r3);
    var vel = vec3f(dir.x * speed, -0.05 * r2, dir.y * speed) + vec3f(perp.x, 0.0, perp.y) * (r0 - 0.5) * 0.06;
    // Each droplet left at its own moment within the frame (not all at once, which would fall in
    // rows): start it that far along its way.
    let early = rnd(key, n, 9u) * s.dt;
    var pos = vec3f(edge.x + perp.x * across + dir.x * outM, top - r3 * atLip * 0.5, edge.y + perp.y * across + dir.y * outM);
    pos += vel * early - vec3f(0.0, 0.5 * G_FALL * early * early, 0.0);
    vel.y -= G_FALL * early;
    // Streaks: lanes about 12 cm wide along the edge, each with its own share of air (strongly
    // uneven, so white streaks stand among glassy ones), flickering a little.
    let laneKey = u32(floor((dot(vec2f(pos.x, pos.z), perp)) * 8.0) + 100000.0);
    let streak = pow(rnd(laneKey, u32(s.time * 3.0), 7u) * 0.3 + rnd(laneKey, 0u, 8u) * 0.7, 2.0);
    // A droplet lives about as long as its fall takes (and a little more to slide and settle),
    // never the whole lifeS: one that misses the ground fades within moments instead of flying on.
    let life = min(s.lifeS, tFall * 1.6 + 0.35) * (0.8 + 0.4 * r1);
    particles[n % s.particleCap] = Particle(vec4f(pos, early), vec4f(vel, life), vec4f(streak, 0.0, 0.0, 0.0));
  }
}

// Height a droplet stops at: the ground, or water lying there.
fn surfaceAt(p: vec2f) -> f32 {
  let g = terrainHeight(heightTex, p);
  let c = vec2i(floor(waterCellCoord(p) + 0.5));
  let o = vec2i(s.rectOrigin);
  if (any(c < o) || any(c >= o + vec2i(s.rectSize))) { return g; }
  let d = textureLoad(depthTex, c, 0).r;
  if (d <= s.minDepth) { return g; }
  // The lowest of it and its wet neighbors (as levelAround in water-falls.wgsl): a column of water
  // the sim holds against a wall's foot is never drawn, so droplets do not stop on it.
  var level = waterBed(heightTex, c) + d;
  let nb = array<vec2i, 4>(vec2i(1, 0), vec2i(-1, 0), vec2i(0, 1), vec2i(0, -1));
  for (var i = 0; i < 4; i++) {
    let q = c + nb[i];
    if (any(q < o) || any(q >= o + vec2i(s.rectSize))) { continue; }
    let dq = textureLoad(depthTex, q, 0).r;
    if (dq > s.minDepth) { level = min(level, waterBed(heightTex, q) + dq); }
  }
  return max(g, level);
}

@compute @workgroup_size(64)
fn csUpdate(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= s.particleCap) { return; }
  var pt = particles[i];
  if (pt.v.w <= 0.0) { return; }
  let age = pt.p.w + s.dt;
  if (age > pt.v.w) { particles[i].v.w = 0.0; return; }
  var v = pt.v.xyz;
  v.y -= G_FALL * s.dt;
  v *= exp(-s.drag * s.dt);
  // A falling sheet breaks up and spreads: a slowly changing push, stronger as the water ages.
  // It leaves the lip as a coherent sheet and frays more the further it falls.
  let slot = u32(age * 6.0);
  let push = vec3f(rnd(i, slot, 11u) - 0.5, (rnd(i, slot, 12u) - 0.5) * 0.3, rnd(i, slot, 13u) - 0.5);
  v += push * s.turbulence * smoothstep(0.05, 0.6, age) * s.dt;
  var p = pt.p.xyz + v * s.dt;
  // Reached the ground or the water below: gone (the plunge's foam is the water sim's). Steep rock
  // (a wall's sloping foot) does not stop it: it slides down the face, pushed out of the rock.
  let under = surfaceAt(p.xz);
  if (age > 0.08 && p.y < under - 0.02) {
    let n = terrainNormal(heightTex, p.xz);
    let ground = terrainHeight(heightTex, p.xz);
    if (n.y > 0.6 || under > ground + 0.01) { particles[i].v.w = 0.0; return; }
    // On the steep face: out of the rock along the face's outward direction, then slide on down.
    let outDir = normalize(n.xz + vec2f(1e-5, 0.0));
    var q = p.xz;
    for (var k = 0; k < 12; k++) {
      if (terrainHeight(heightTex, q) <= p.y) { break; }
      q += outDir * 0.02;
    }
    p = vec3f(q.x, p.y, q.y);
    v -= n * min(dot(v, n), 0.0);
  }
  particles[i] = Particle(vec4f(p, age), vec4f(v, pt.v.w), pt.c);
}
