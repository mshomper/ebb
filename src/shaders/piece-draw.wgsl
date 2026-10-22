// Placed pieces (doc 09, docs/future/10): loose stones, drawn with the island's own scanned rock
// (the ground detail arrays, lib-ground's layers: boulder top from above, rock face from the sides),
// projected triplanar in the stone's own frame so the grain rides with it when it tips. Each stone's
// baked vertex albedo (weathered grey, mottled, soil-stained below the ground line) is scaled by the
// scan's variation around the rock's recipe mean, so stones read darker than fresh rock but of the
// same stone. Lit like the ground (shadeGround: sun and moon with shadows, sky fill with cavity, GGX
// sheen) and given a soft dark damp ring where they meet the ground. Driftwood logs share the pass
// with no rock scan: weathered silver-grey wood (their baked vertex albedo) with a grain that runs
// along the log, fine checking cracks along it, growth rings on the broken ends, and a small bump
// from both. Physical albedo only; the palette paints at tonemap (docs/05).

// #include common
// #include lib-hash
// #include lighting-bindings
// #include lib-sky
// #include lib-lighting

struct PieceDraw {
  look: vec4f,      // x contact darkness 0..1, y contact radius (footprint shares), z f0, w scan fade 0..1 (0 before the maps load)
  rockMean: vec4f,  // rgb the rock scan's mean albedo (terrain.json albedoRock), w normal strength
  rough: vec4f,     // x, y top scan roughness range; z, w side scan roughness range
  tile: vec4f,      // x 1 / top tile (m), y 1 / side tile (m), z, w terminator range
  wood: vec4f,      // driftwood: x roughness, y bump (m), z grain streaks across the log, w crack darkness 0..1
  moss: vec4f,      // pond stones' and Steps' moss: rgb albedo (linear), w how far it creeps in from the rim onto the top (0..1)
  bark: vec4f,      // driftwood's bark: rgb albedo (linear), w how much of a fresh log it still covers (0..1)
  sea: vec4f,       // x shipworm grooves' darkness, y cracks' width on the oldest wood, z a kept log's darkening when fully aged, w its softening
};

struct Piece {
  at: vec4f,        // x, y, z (ground under its middle), yaw (radians)
  more: vec4f,      // x size (length, m), y, z ground slope along its own x and z, w seed for the scan offset
  extra: vec4f,     // x, y footprint half width and half length (mesh units); z 1 for plain earth (the damp patch: no rock scan),
                    // or minus a slab's moss (0..1: how mossy its rim has grown with age);
                    // w a log's thickness over its length (0 for a stone): its mesh is 1 thick, squeezed by the bone
  wear: vec4f,      // a log's: x time at sea (0 fresh .. 1 old), y how aged it is where it was kept (0..1), z its moss (0..1)
  bone: mat4x4f,   // mesh units: set into the ground, leaned with the slope, tipped (a log: rolled) when lifted
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var<uniform> pd: PieceDraw;
@group(2) @binding(1) var<storage, read> pieces: array<Piece>;
@group(2) @binding(2) var groundA: texture_2d_array<f32>;
@group(2) @binding(3) var groundB: texture_2d_array<f32>;
@group(2) @binding(4) var groundSampler: sampler;

const ROCK_LAYER: i32 = 2;
const CLIFF_LAYER: i32 = 5;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) albedo: vec3f,
  @location(3) local: vec3f,      // position in the stone's own frame, meters, offset by its seed
  @location(4) localN: vec3f,
  @location(5) ax: vec3f,         // the stone's own x, y, z axes in the world (posed and turned)
  @location(6) ay: vec3f,
  @location(7) az: vec3f,
  @location(8) @interpolate(flat) scanned: f32,   // 1 for stone, 0 for plain earth and wood
  @location(9) woodP: vec3f,      // a log's cross-section (mesh units, about its middle) and meters along it, seeded
  @location(10) @interpolate(flat) wood: f32,     // 1 for a log
  @location(11) @interpolate(flat) moss: f32,     // a slab's moss 0..1
  @location(12) @interpolate(flat) wear: vec4f,   // a log's wear (Piece.wear)
};

struct FsOut {
  @location(0) color: vec4f,
  @location(1) normalId: vec4f,
};

fn octEncode(n: vec3f) -> vec2f {
  var p = n.xz / (abs(n.x) + abs(n.y) + abs(n.z));
  if (n.y < 0.0) { p = (1.0 - abs(p.yx)) * select(vec2f(-1.0), vec2f(1.0), p >= vec2f(0.0)); }
  return p * 0.5 + 0.5;
}

/** A direction in the stone's frame turned by its yaw into the world (creature-draw.wgsl place). */
fn turn(d: vec3f, yaw: f32) -> vec3f {
  let c = cos(yaw);
  let s = sin(yaw);
  return vec3f(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
}

@vertex
fn vsPiece(@location(0) position: vec3f, @location(1) normal: vec3f, @location(2) albedo: vec3f,
           @builtin(instance_index) ii: u32) -> VsOut {
  let pc = pieces[ii];
  let size = pc.more.x;
  let posed = (pc.bone * vec4f(position, 1.0)).xyz;
  var o: VsOut;
  o.world = turn(posed * size, pc.at.w) + pc.at.xyz;
  o.pos = frame.viewProj * vec4f(o.world, 1.0);
  // A log's bone squeezes it across (by a): its normals take the inverse squeeze, so they stay true.
  let a = pc.extra.w;
  let isLog = a > 0.0;
  let nIn = select(normal, normal * vec3f(1.0 / max(a * a, 1e-6), 1.0 / max(a * a, 1e-6), 1.0), isLog);
  o.normal = turn(normalize((pc.bone * vec4f(nIn, 0.0)).xyz), pc.at.w);
  o.wood = select(0.0, 1.0, isLog);
  o.woodP = vec3f(position.x, position.y - 0.5, position.z * size + pc.more.w * 3.7);
  o.albedo = albedo;
  o.local = position * size + vec3f(pc.more.w * 7.31, pc.more.w * 3.17, pc.more.w * 5.53);
  o.localN = normal;
  o.ax = turn((pc.bone * vec4f(1.0, 0.0, 0.0, 0.0)).xyz, pc.at.w);
  o.ay = turn((pc.bone * vec4f(0.0, 1.0, 0.0, 0.0)).xyz, pc.at.w);
  o.az = turn((pc.bone * vec4f(0.0, 0.0, 1.0, 0.0)).xyz, pc.at.w);
  o.scanned = (1.0 - max(pc.extra.z, 0.0)) * (1.0 - o.wood);
  o.moss = max(-pc.extra.z, 0.0);
  o.wear = pc.wear;
  return o;
}

struct Wood { albedo: vec3f, height: f32, crack: f32, bark: f32 };

/**
 * Driftwood's surface at a point (woodP): a grain of streaks running along the log (value noise
 * fast across it and slow along it), thin checking cracks where a coarser noise crosses its middle,
 * and growth rings on the end grain (end: 1 there). Time at sea (wear.x) sets the rest (L2): a fresh
 * log keeps patches of brown bark, furrowed along it; older wood's cracks open wider, and the oldest
 * shows the meandering grooves shipworms bored. A kept log's age (wear.y) darkens it and softens its
 * cracks and grain. albedo multiplies the baked tone (or, on bark, replaces it); height in 0..1.
 */
fn woodAt(p: vec3f, end: f32, base: vec3f, wear: vec4f) -> Wood {
  let k = pd.wood.z;
  let sea = wear.x;
  let age = wear.y;
  let g1 = valueNoise2(vec2f(p.x * k + p.z * 1.1, p.y * k), 71u);
  let g2 = valueNoise2(vec2f(p.y * k * 1.7 - p.z * 0.7, p.x * k * 1.7), 73u);
  let grain = mix(0.6 * g1 + 0.4 * g2, 0.5, pd.sea.w * age * 0.6);
  let c = valueNoise2(vec2f(p.x * k * 0.3 + p.z * 0.35, p.y * k * 0.3), 79u);
  // Cracks open wider with time at sea, and their edges soften as a kept log ages.
  let cw = mix(0.015, pd.sea.y, sea);
  let crack = (1.0 - smoothstep(0.0, cw * (1.0 + 2.0 * pd.sea.w * age), abs(c - 0.5))) * (1.0 - end) * (1.0 - 0.4 * pd.sea.w * age);
  let r = length(p.xy) * 2.0;
  let rings = 0.5 + 0.5 * sin(r * 34.0 + 3.0 * valueNoise2(p.xy * 6.0, 83u));
  // Shipworm grooves: wandering channels mostly along the grain, in patches, on old wood only.
  // Slow along the log and quicker across it, so the noise's middle line runs along the grain and
  // wanders, like a bored tunnel laid open; only in a few patches.
  let gv = 0.7 * valueNoise2(vec2f(p.z * 2.2, (p.x + p.y * 0.8) * 3.2), 89u) + 0.3 * valueNoise2(vec2f(p.z * 6.0, (p.y - p.x) * 7.0), 97u);
  let bored = smoothstep(0.5, 0.68, valueNoise2(vec2f(p.z * 0.9, (p.x - p.y) * 1.3), 101u));
  let groove = (1.0 - smoothstep(0.004, 0.022, abs(gv - 0.5))) * bored * smoothstep(0.5, 0.85, sea) * (1.0 - end);
  // Bark: broad patches round and along a fresh log (two noises, so there is no seam round it),
  // furrowed along its length; none left after long at sea.
  let cover = pd.bark.w * (1.0 - smoothstep(0.0, 0.65, sea));
  let bn = 0.5 * valueNoise2(vec2f(p.z * 2.2 + 3.1, p.x * 2.6), 103u) + 0.5 * valueNoise2(vec2f(p.z * 2.2 - 5.7, p.y * 2.6), 107u);
  let bark = (1.0 - smoothstep(cover - 0.06, cover + 0.02, bn)) * (1.0 - end) * step(0.001, cover);
  let furrow = valueNoise2(vec2f(p.z * 4.0, (p.x + p.y * 1.3) * 26.0), 109u);
  var w: Wood;
  let wood = base * ((0.84 + 0.32 * grain) * (1.0 - pd.wood.w * crack) * (1.0 - pd.sea.x * groove) * mix(1.0, 0.82 + 0.2 * rings, end));
  let barkA = pd.bark.rgb * (0.6 + 0.6 * furrow);
  w.albedo = mix(wood, barkA, bark) * (1.0 - pd.sea.z * age);
  w.height = mix((0.5 * grain - crack - 0.8 * groove + 0.3 * rings * end) * (1.0 - pd.sea.w * age * 0.5), furrow * 1.6 + 0.4, bark);
  w.crack = max(crack, groove) * (1.0 - bark);
  w.bark = bark;
  return w;
}

struct Scan { albedo: vec3f, grad: vec3f, rough: f32, cavity: f32 };

/** One planar read of a layer: its albedo, its height gradient along u and v (stone frame), roughness and cavity. */
fn scanRead(layer: i32, uv: vec2f, u: vec3f, v: vec3f, r: vec2f) -> Scan {
  let a = textureSample(groundA, groundSampler, uv, layer);
  let b = textureSample(groundB, groundSampler, uv, layer);
  let t = vec2f(b.r, b.g) * 2.0 - 1.0;
  let tz = sqrt(max(1.0 - dot(t, t), 1e-4));
  var s: Scan;
  s.albedo = a.rgb;
  s.grad = (u * (-t.x / tz) + v * (t.y / tz)) * pd.rockMean.w;
  s.rough = mix(r.x, r.y, b.b);
  s.cavity = b.a;
  return s;
}

@fragment
fn fsPiece(in: VsOut) -> FsOut {
  let nL = normalize(in.localN);
  // Triplanar in the stone's frame: boulder top from above, rock face on the sides.
  var w = pow(abs(nL), vec3f(4.0));
  w /= max(w.x + w.y + w.z, 1e-5);
  let p = in.local;
  let sx = scanRead(CLIFF_LAYER, vec2f(p.z, -p.y) * pd.tile.y, vec3f(0.0, 0.0, 1.0), vec3f(0.0, -1.0, 0.0), pd.rough.zw);
  let sy = scanRead(ROCK_LAYER, vec2f(p.x, p.z) * pd.tile.x, vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), pd.rough.xy);
  let sz = scanRead(CLIFF_LAYER, vec2f(p.x, -p.y) * pd.tile.y, vec3f(1.0, 0.0, 0.0), vec3f(0.0, -1.0, 0.0), pd.rough.zw);
  let fade = pd.look.w * in.scanned;
  let scan = sx.albedo * w.x + sy.albedo * w.y + sz.albedo * w.z;
  // The scan's variation about its own mean, on the stone's weathered albedo.
  var albedo = in.albedo * mix(vec3f(1.0), scan / max(pd.rockMean.rgb, vec3f(0.01)), fade);
  // Moss on an old slab (doc 09, weathering): it rims the rounded edge first, in soft patches, then
  // creeps in over the top as the stone ages. Physical albedo; the palette paints it at tonemap.
  if (in.moss > 0.0) {
    let rim = smoothstep(0.2, 0.45, nL.y) * (1.0 - smoothstep(0.88, 0.98, nL.y));
    let blot = valueNoise2(p.xz * 9.0, 91u) * 0.7 + valueNoise2(p.xz * 31.0, 97u) * 0.3;
    let onTop = smoothstep(0.9, 0.98, nL.y) * smoothstep(1.0 - pd.moss.w * in.moss, 1.05 - pd.moss.w * in.moss, blot);
    let k = in.moss * clamp(max(rim * smoothstep(0.25, 0.55, blot + in.moss * 0.4), onTop), 0.0, 1.0);
    albedo = mix(albedo, pd.moss.rgb * (0.8 + 0.4 * blot), k);
  }
  let rough = mix(0.75, sx.rough * w.x + sy.rough * w.y + sz.rough * w.z, fade);
  let cavity = mix(1.0, sx.cavity * w.x + sy.cavity * w.y + sz.cavity * w.z, fade);
  // Surface gradient (Mikkelsen 2020), in the stone's frame, then to the world.
  let g = (sx.grad * w.x + sy.grad * w.y + sz.grad * w.z) * fade;
  let nDL = normalize(nL - (g - dot(g, nL) * nL));
  let nMesh = normalize(in.normal);
  let nStone = normalize(in.ax * nDL.x + in.ay * nDL.y + in.az * nDL.z);
  // Driftwood: its grain, cracks and end rings, and their bump from screen derivatives (Mikkelsen
  // 2010's surface gradient), worked out for every fragment so the derivatives stay uniform.
  let wd = woodAt(in.woodP, smoothstep(0.6, 0.9, abs(nL.z)), in.albedo, in.wear);
  let hW = wd.height * pd.wood.y;
  let dpx = dpdx(in.world);
  let dpy = dpdy(in.world);
  let r1 = cross(dpy, nMesh);
  let r2 = cross(nMesh, dpx);
  let det = dot(dpx, r1);
  let surf = sign(det) * (dpdx(hW) * r1 + dpdy(hW) * r2);
  let nWood = normalize(abs(det) * nMesh - surf);
  let nWoodSafe = select(nMesh, nWood, abs(det) > 1e-12);
  var albedoW = wd.albedo;
  // Moss on a kept log in damp shade (L2c): it takes the top first, in soft blots, creeping down the
  // flanks as it thickens. Physical albedo; the palette paints it at tonemap.
  let mossW = in.wear.z;
  if (mossW > 0.0) {
    let blot = valueNoise2(in.woodP.zx * vec2f(5.0, 9.0), 113u) * 0.7 + valueNoise2(in.woodP.zy * vec2f(17.0, 23.0), 127u) * 0.3;
    let up = smoothstep(0.75 - 0.6 * mossW, 1.0 - 0.45 * mossW, nMesh.y);
    let k = up * smoothstep(1.0 - mossW, 1.12 - mossW, blot);
    albedoW = mix(albedoW, pd.moss.rgb * (0.8 + 0.4 * blot), k);
  }
  let isWood = in.wood;
  let nDetail = normalize(mix(nStone, nWoodSafe, isWood));
  let roughW = mix(pd.wood.x + 0.08 * in.wear.y, 0.95, wd.bark);
  let color = shadeGround(mix(albedo, albedoW, isWood), in.world, nMesh, nDetail, mix(rough, roughW, isWood),
    mix(cavity, 1.0 - 0.35 * wd.crack, isWood), in.pos, pd.tile.zw, pd.look.z, 1.0, 1.0, vec3f(0.0));
  let safe = select(vec3f(0.0), color, color == color);
  // Outline group 2: a soft line where it stands against the ground, not a creature's.
  return FsOut(vec4f(max(safe, vec3f(0.0)), 1.0), vec4f(octEncode(nMesh), 0.0, 2.0 / 3.0));
}

// ---- the damp ring: a soft darkening of the ground where the stone meets it ----

struct RingOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

var<private> QUAD: array<vec2f, 6> = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

@vertex
fn vsRing(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> RingOut {
  let pc = pieces[ii];
  let q = QUAD[vi];
  // An oval a little larger than the footprint, lying along the ground's slope.
  let r = pd.look.y;
  var local = vec3f(q.x * pc.extra.x * r, 0.0, q.y * pc.extra.y * r);
  local.y = pc.more.y * local.x + pc.more.z * local.z + 0.004 / pc.more.x;
  var o: RingOut;
  o.pos = frame.viewProj * vec4f(turn(local * pc.more.x, pc.at.w) + pc.at.xyz, 1.0);
  o.uv = q;
  return o;
}

@fragment
fn fsRing(in: RingOut) -> @location(0) vec4f {
  let r = length(in.uv);
  // Darkest in a band just outside the stone's edge, fading out and in toward the middle (hidden
  // under the stone anyway).
  let dark = pd.look.x * (1.0 - smoothstep(0.55, 1.0, r));
  return vec4f(vec3f(1.0 - dark), 1.0);
}
