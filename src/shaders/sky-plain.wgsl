// Plain sky pass: a fullscreen triangle at the far plane, drawn after opaque.
// Depth compare greater-equal against a depth buffer cleared to 0 (reverse-Z),
// so it only touches pixels nothing else covered.

// #include common
// #include lib-sky-plain

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> sky: SkyPlain;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> FullscreenOut {
  return fullscreenTriangle(vi);
}

@fragment
fn fs(in: FullscreenOut) -> @location(0) vec4f {
  let ndc = vec2f(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  let far = frame.invViewProj * vec4f(ndc, 1e-7, 1.0);
  let dir = normalize(far.xyz / far.w - frame.cameraPos);
  let radiance = skyRadiance(sky, dir, frame.sunDir);
  return vec4f(radiance * frame.exposure, 1.0);
}
