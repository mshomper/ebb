// Shadow casters into one cascade of the shadow map (docs/06, Shadows). Depth only.
// S2 casters: the terrain. Structures, foliage and creatures join as they arrive.

// #include common
// #include lib-terrain

@group(0) @binding(0) var<uniform> cascadeViewProj: mat4x4f;   // dynamic offset per cascade
@group(0) @binding(1) var<uniform> chunks: array<TerrainChunk, 36>;
@group(0) @binding(2) var heightTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> skirtDepth: vec4f;           // x: skirt depth in meters

@vertex
fn vsTerrain(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  let p = terrainMeshVertex(heightTex, chunks[ii], vi, skirtDepth.x);
  return cascadeViewProj * vec4f(p, 1.0);
}
