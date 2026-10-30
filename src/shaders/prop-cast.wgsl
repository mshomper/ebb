// Props into one cascade of the sun's (or moon's) shadow map (docs/06, Shadows; prop-draw.wgsl). Depth only.

// #include common

struct Prop {
  at: vec4f,
  more: vec4f,
  look: vec4f,
  shade: vec4f,
  tilt: vec4f,
  burn: vec4f,
  wear: vec4f,
  dye: vec4f,
};

@group(0) @binding(0) var<uniform> cascadeViewProj: mat4x4f;   // dynamic offset per cascade
@group(0) @binding(1) var<storage, read> props: array<Prop>;

@vertex
fn vsCast(@location(0) position: vec3f, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  let pr = props[ii];
  let q = position * vec3f(pr.burn.x, pr.more.w, 1.0) * pr.more.x;
  // Tipped as prop-draw.wgsl tip(): roll about z, then pitch about x.
  let r = vec3f(cos(pr.tilt.y) * q.x - sin(pr.tilt.y) * q.y, sin(pr.tilt.y) * q.x + cos(pr.tilt.y) * q.y, q.z);
  let p = vec3f(r.x, cos(pr.tilt.x) * r.y - sin(pr.tilt.x) * r.z, sin(pr.tilt.x) * r.y + cos(pr.tilt.x) * r.z);
  let c = cos(pr.at.w);
  let s = sin(pr.at.w);
  return cascadeViewProj * vec4f(vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z) + pr.at.xyz, 1.0);
}
