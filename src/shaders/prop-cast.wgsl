// Props into one cascade of the sun's (or moon's) shadow map (docs/06, Shadows; prop-draw.wgsl). Depth only.

// #include common

struct Prop {
  at: vec4f,
  more: vec4f,
  look: vec4f,
  shade: vec4f,
};

@group(0) @binding(0) var<uniform> cascadeViewProj: mat4x4f;   // dynamic offset per cascade
@group(0) @binding(1) var<storage, read> props: array<Prop>;

@vertex
fn vsCast(@location(0) position: vec3f, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  let pr = props[ii];
  let p = position * vec3f(1.0, pr.more.w, 1.0) * pr.more.x;
  let c = cos(pr.at.w);
  let s = sin(pr.at.w);
  return cascadeViewProj * vec4f(vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z) + pr.at.xyz, 1.0);
}
