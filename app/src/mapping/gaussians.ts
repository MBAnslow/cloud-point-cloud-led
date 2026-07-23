import type { MappingGaussian, Vec3 } from "../state";

export interface DisplacedLed {
  pos: Vec3;
  normal: Vec3;
}

/** Minimum normal alignment to receive a bump (same surface side). */
const SAME_SIDE_DOT = 0.25;

/**
 * Orthonormal tangent frame for a surface normal: width axis (tW) and
 * height axis (tH). Prefer world-up for the height axis when possible.
 * `rotationDeg` spins the frame around the normal (elliptical axes).
 */
export function gaussianTangentFrame(
  normal: Vec3,
  rotationDeg = 0,
): {
  tW: Vec3;
  tH: Vec3;
  n: Vec3;
} {
  const nx = normal[0];
  const ny = normal[1];
  const nz = normal[2];
  const nLen = Math.hypot(nx, ny, nz) || 1;
  const n0x = nx / nLen;
  const n0y = ny / nLen;
  const n0z = nz / nLen;
  // Seed height from world up, remove normal component.
  let hx = 0;
  let hy = 1;
  let hz = 0;
  const dup = hx * n0x + hy * n0y + hz * n0z;
  hx -= dup * n0x;
  hy -= dup * n0y;
  hz -= dup * n0z;
  let hl = Math.hypot(hx, hy, hz);
  if (hl < 1e-4) {
    hx = 1;
    hy = 0;
    hz = 0;
    const dup2 = hx * n0x + hy * n0y + hz * n0z;
    hx -= dup2 * n0x;
    hy -= dup2 * n0y;
    hz -= dup2 * n0z;
    hl = Math.hypot(hx, hy, hz) || 1;
  }
  hx /= hl;
  hy /= hl;
  hz /= hl;
  // Width = height × normal (right-handed with +N outward).
  let wx = hy * n0z - hz * n0y;
  let wy = hz * n0x - hx * n0z;
  let wz = hx * n0y - hy * n0x;
  const wl = Math.hypot(wx, wy, wz) || 1;
  wx /= wl;
  wy /= wl;
  wz /= wl;
  // Re-orthogonalize height = normal × width.
  hx = n0y * wz - n0z * wy;
  hy = n0z * wx - n0x * wz;
  hz = n0x * wy - n0y * wx;
  // Rotate width/height around the normal.
  const ang = ((rotationDeg % 360) * Math.PI) / 180;
  if (Math.abs(ang) > 1e-8) {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const rwx = wx * c + hx * s;
    const rwy = wy * c + hy * s;
    const rwz = wz * c + hz * s;
    const rhx = -wx * s + hx * c;
    const rhy = -wy * s + hy * c;
    const rhz = -wz * s + hz * c;
    wx = rwx;
    wy = rwy;
    wz = rwz;
    hx = rhx;
    hy = rhy;
    hz = rhz;
  }
  return {
    n: [n0x, n0y, n0z],
    tW: [wx, wy, wz],
    tH: [hx, hy, hz],
  };
}

/**
 * Lift an LED along its base normal by the sum of elliptical Gaussian
 * bumps plus an optional per-LED offset, and tilt the normal from the
 * bump slope.
 *
 * Influence is limited to LEDs whose surface normal faces roughly the
 * same way as the Gaussian (so the far side of a thin mesh is ignored).
 * Falloff uses tangent-plane width/height axes at the Gaussian centre.
 */
export function displaceLed(
  pos: Vec3,
  normal: Vec3,
  gaussians: MappingGaussian[],
  perLedOffset = 0,
): DisplacedLed {
  const nx = normal[0];
  const ny = normal[1];
  const nz = normal[2];
  const nLen = Math.hypot(nx, ny, nz) || 1;
  const n0x = nx / nLen;
  const n0y = ny / nLen;
  const n0z = nz / nLen;

  let h = Math.max(0, perLedOffset);
  let gx = 0;
  let gy = 0;
  let gz = 0;

  for (const g of gaussians) {
    const A = Math.max(0, g.amplitude);
    if (A <= 1e-8) continue;

    const gn = g.normal;
    const gnLen = Math.hypot(gn[0], gn[1], gn[2]) || 1;
    const gnx = gn[0] / gnLen;
    const gny = gn[1] / gnLen;
    const gnz = gn[2] / gnLen;
    // Same-side gate: skip LEDs on the opposite face of the mesh.
    const side = n0x * gnx + n0y * gny + n0z * gnz;
    if (side < SAME_SIDE_DOT) continue;

    const sw = Math.max(1e-6, g.width);
    const sh = Math.max(1e-6, g.height);
    const frame = gaussianTangentFrame(g.normal, g.rotationDeg ?? 0);
    const dx = pos[0] - g.pos[0];
    const dy = pos[1] - g.pos[1];
    const dz = pos[2] - g.pos[2];
    const u = dx * frame.tW[0] + dy * frame.tW[1] + dz * frame.tW[2];
    const v = dx * frame.tH[0] + dy * frame.tH[1] + dz * frame.tH[2];
    const q = (u * u) / (sw * sw) + (v * v) / (sh * sh);
    const hi = A * Math.exp(-0.5 * q);
    if (hi <= 1e-10) continue;
    h += hi;
    // Tangential gradient of the height field (∂h/∂u, ∂h/∂v).
    const dhu = hi * (-u / (sw * sw));
    const dhv = hi * (-v / (sh * sh));
    gx += dhu * frame.tW[0] + dhv * frame.tH[0];
    gy += dhu * frame.tW[1] + dhv * frame.tH[1];
    gz += dhu * frame.tW[2] + dhv * frame.tH[2];
  }

  const outPos: Vec3 = [
    pos[0] + n0x * h,
    pos[1] + n0y * h,
    pos[2] + n0z * h,
  ];
  let nnx = n0x - gx;
  let nny = n0y - gy;
  let nnz = n0z - gz;
  const nl = Math.hypot(nnx, nny, nnz) || 1;
  nnx /= nl;
  nny /= nl;
  nnz /= nl;
  return { pos: outPos, normal: [nnx, nny, nnz] };
}

/** Apply orientation flips to a Gaussian list (same space as LED pos/normal). */
export function orientGaussians(
  gaussians: MappingGaussian[],
  flipUpDown: boolean,
  flipLeftRight: boolean,
  applyPoint: (p: Vec3, upDown: boolean, leftRight: boolean) => Vec3,
): MappingGaussian[] {
  if (!flipUpDown && !flipLeftRight) return gaussians;
  return gaussians.map((g) => ({
    ...g,
    pos: applyPoint(g.pos, flipUpDown, flipLeftRight),
    normal: applyPoint(g.normal, flipUpDown, flipLeftRight),
  }));
}
