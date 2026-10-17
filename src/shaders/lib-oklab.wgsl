// Color conversions (docs/05): sRGB transfer, OKLab and OKLCh (Bjorn Ottosson 2020), and a
// constant-lightness, constant-hue gamut clip. No bindings and no entry points, so any shader can
// `// #include lib-oklab`. Matches src/render/color/oklab.js within 1e-4.

fn srgbToLinear3(c: vec3f) -> vec3f {
  let lo = c / 12.92;
  let hi = pow((max(c, vec3f(0.0)) + 0.055) / 1.055, vec3f(2.4));
  return select(hi, lo, c <= vec3f(0.04045));
}

fn linearToSrgb3(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}

// Signed cube root (pow is undefined for negative bases).
fn oklabCbrt3(x: vec3f) -> vec3f {
  return sign(x) * pow(max(abs(x), vec3f(1e-30)), vec3f(1.0 / 3.0));
}

fn linearToOklab(c: vec3f) -> vec3f {
  let lms = vec3f(
    0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b,
    0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b,
    0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
  let q = oklabCbrt3(lms);
  return vec3f(
    0.2104542553 * q.x + 0.7936177850 * q.y - 0.0040720468 * q.z,
    1.9779984951 * q.x - 2.4285922050 * q.y + 0.4505937099 * q.z,
    0.0259040371 * q.x + 0.7827717662 * q.y - 0.8086757660 * q.z);
}

// Exact inverses of the forward matrices (as in oklab.js).
fn oklabToLinear(lab: vec3f) -> vec3f {
  let q = vec3f(
    0.99999999845 * lab.x + 0.39633779217 * lab.y + 0.21580375806 * lab.z,
    1.00000000888 * lab.x - 0.10556134232 * lab.y - 0.06385417477 * lab.z,
    1.00000005467 * lab.x - 0.08948418209 * lab.y - 1.29148553786 * lab.z);
  let lms = q * q * q;
  return vec3f(
    4.07674166135 * lms.x - 3.30771159041 * lms.y + 0.23096992873 * lms.z,
    -1.26843800409 * lms.x + 2.60975740066 * lms.y - 0.34131939631 * lms.z,
    -0.00419608654 * lms.x - 0.70341861446 * lms.y + 1.70761470093 * lms.z);
}

// [L, C, h] with h in radians.
fn oklabToOklch(lab: vec3f) -> vec3f {
  return vec3f(lab.x, length(lab.yz), atan2(lab.z, lab.y));
}

fn oklchToOklab(lch: vec3f) -> vec3f {
  return vec3f(lch.x, lch.y * cos(lch.z), lch.y * sin(lch.z));
}

fn oklabInSrgb(lab: vec3f) -> bool {
  let c = oklabToLinear(lab);
  let e = 2e-6;
  return all(c >= vec3f(-e)) && all(c <= vec3f(1.0 + e));
}

// L clamps to 0..1, then chroma shrinks at constant L and hue (bisection) until the color fits sRGB.
fn gamutClipOklab(lab: vec3f) -> vec3f {
  let L = clamp(lab.x, 0.0, 1.0);
  if (oklabInSrgb(vec3f(L, lab.yz))) { return vec3f(L, lab.yz); }
  var lo = 0.0;
  var hi = 1.0;
  for (var i = 0; i < 20; i++) {
    let mid = 0.5 * (lo + hi);
    if (oklabInSrgb(vec3f(L, lab.yz * mid))) { lo = mid; } else { hi = mid; }
  }
  return vec3f(L, lab.yz * lo);
}
