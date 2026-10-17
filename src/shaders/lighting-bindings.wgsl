// Group 1: shared lighting resources for every lit pipeline (docs/04, 06).
// Built by src/render/lighting.js. Include this once, after `common`.

@group(1) @binding(0) var<uniform> light: LightUniforms;
@group(1) @binding(1) var transmittanceLut: texture_2d<f32>;   // rgba16float, sky-transmittance.wgsl
@group(1) @binding(2) var aerialLut: texture_3d<f32>;          // rgba16float froxels, sky-aerial.wgsl
@group(1) @binding(3) var lutSampler: sampler;                 // linear, clamp
@group(1) @binding(4) var<storage, read> skySH: array<vec4f, 9>; // sky irradiance SH9 (rgb), sh-project.wgsl
@group(1) @binding(5) var shadowMap: texture_depth_2d_array;   // one layer per cascade
@group(1) @binding(6) var shadowSampler: sampler_comparison;
