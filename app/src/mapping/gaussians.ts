import type { MappingGaussian, Vec3 } from "../state";
import { BufferGeometry, Float32BufferAttribute } from "three";

export interface DisplacedLed {
  pos: Vec3;
  normal: Vec3;
}

/** Minimum normal alignment used for ridge-aware dome wrapping. */
const RIDGE_WRAP_DOT_MIN = 0.55;
/**
 * Preserve the footprint of existing saved bumps: their width/height values
 * previously reached this radius at the clipped Gaussian boundary.
 */
export const GAUSSIAN_CUTOFF_RATIO = 0.04;
const GAUSSIAN_CUTOFF_Q = -2 * Math.log(GAUSSIAN_CUTOFF_RATIO);
export const DOME_FOOTPRINT_SCALE = Math.sqrt(GAUSSIAN_CUTOFF_Q);
const SMOOTH_UNION_POWER = 6;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function ridgeWrapWeight(surfaceNormal: Vec3, domeNormal: Vec3): number {
  const sn = Math.hypot(surfaceNormal[0], surfaceNormal[1], surfaceNormal[2]) || 1;
  const dn = Math.hypot(domeNormal[0], domeNormal[1], domeNormal[2]) || 1;
  const dot =
    (surfaceNormal[0] / sn) * (domeNormal[0] / dn) +
    (surfaceNormal[1] / sn) * (domeNormal[1] / dn) +
    (surfaceNormal[2] / sn) * (domeNormal[2] / dn);
  const t = clamp01((dot - RIDGE_WRAP_DOT_MIN) / (1 - RIDGE_WRAP_DOT_MIN));
  return t * t;
}

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

/** Height contributed by one compact dome at a mesh-local surface point. */
export function domeHeightAtPoint(
  pos: Vec3,
  dome: MappingGaussian,
  surfaceNormal?: Vec3,
): number {
  const amplitude = Math.max(0, dome.amplitude);
  if (amplitude <= 1e-8) return 0;
  const frame = gaussianTangentFrame(dome.normal, dome.rotationDeg ?? 0);
  const dx = pos[0] - dome.pos[0];
  const dy = pos[1] - dome.pos[1];
  const dz = pos[2] - dome.pos[2];
  const u = dx * frame.tW[0] + dy * frame.tW[1] + dz * frame.tW[2];
  const v = dx * frame.tH[0] + dy * frame.tH[1] + dz * frame.tH[2];
  const sw = Math.max(1e-6, dome.width);
  const sh = Math.max(1e-6, dome.height);
  const ridgeWeight = surfaceNormal
    ? ridgeWrapWeight(surfaceNormal, dome.normal)
    : 1;
  if (ridgeWeight <= 1e-5) return 0;
  const ridgeStretch = 0.15 + ridgeWeight * 0.85;
  const q = (u * u) / (sw * sw * ridgeStretch) + (v * v) / (sh * sh * ridgeStretch);
  if (q >= GAUSSIAN_CUTOFF_Q) return 0;
  const edge = 1 - q / GAUSSIAN_CUTOFF_Q;
  return amplitude * ridgeWeight * edge * edge;
}

/**
 * Lift an LED along its base normal by compact elliptical domes plus an
 * optional per-LED offset. Each dome reaches exactly zero height and slope
 * at its boundary. Overlaps use a p-norm smooth maximum: close to max-union,
 * but without abrupt normal seams where similarly-sized domes meet.
 *
 * Influence is limited to LEDs whose surface normal faces roughly the
 * same way as the dome (so the far side of a thin mesh is ignored).
 * Width/height retain the footprint of previously saved Gaussian bumps.
 */
export function displaceLed(
  pos: Vec3,
  normal: Vec3,
  gaussians: MappingGaussian[],
  perLedOffset = 0,
  additivity = 0,
): DisplacedLed {
  const nx = normal[0];
  const ny = normal[1];
  const nz = normal[2];
  const nLen = Math.hypot(nx, ny, nz) || 1;
  const n0x = nx / nLen;
  const n0y = ny / nLen;
  const n0z = nz / nLen;

  const manualOffset = Math.max(0, perLedOffset);
  let sumHeightP = 0;
  let sumGradientX = 0;
  let sumGradientY = 0;
  let sumGradientZ = 0;
  let additiveHeight = 0;
  let additiveGradientX = 0;
  let additiveGradientY = 0;
  let additiveGradientZ = 0;

  for (const g of gaussians) {
    const A = Math.max(0, g.amplitude);
    if (A <= 1e-8) continue;

    const ridgeWeight = ridgeWrapWeight([n0x, n0y, n0z], g.normal);
    if (ridgeWeight <= 1e-5) continue;

    const sw = Math.max(1e-6, g.width);
    const sh = Math.max(1e-6, g.height);
    const frame = gaussianTangentFrame(g.normal, g.rotationDeg ?? 0);
    const dx = pos[0] - g.pos[0];
    const dy = pos[1] - g.pos[1];
    const dz = pos[2] - g.pos[2];
    const u = dx * frame.tW[0] + dy * frame.tW[1] + dz * frame.tW[2];
    const v = dx * frame.tH[0] + dy * frame.tH[1] + dz * frame.tH[2];
    const ridgeStretch = 0.15 + ridgeWeight * 0.85;
    const q = (u * u) / (sw * sw * ridgeStretch) + (v * v) / (sh * sh * ridgeStretch);
    if (q >= GAUSSIAN_CUTOFF_Q) continue;
    const edge = 1 - q / GAUSSIAN_CUTOFF_Q;
    const hi = A * ridgeWeight * edge * edge;
    if (hi <= 1e-10) continue;
    const dhu =
      (-4 * A * ridgeWeight * edge * u) /
      (GAUSSIAN_CUTOFF_Q * sw * sw * ridgeStretch);
    const dhv =
      (-4 * A * ridgeWeight * edge * v) /
      (GAUSSIAN_CUTOFF_Q * sh * sh * ridgeStretch);
    const weight = Math.pow(hi, SMOOTH_UNION_POWER - 1);
    sumHeightP += weight * hi;
    const gradientX = dhu * frame.tW[0] + dhv * frame.tH[0];
    const gradientY = dhu * frame.tW[1] + dhv * frame.tH[1];
    const gradientZ = dhu * frame.tW[2] + dhv * frame.tH[2];
    sumGradientX += weight * gradientX;
    sumGradientY += weight * gradientY;
    sumGradientZ += weight * gradientZ;
    additiveHeight += hi;
    additiveGradientX += gradientX;
    additiveGradientY += gradientY;
    additiveGradientZ += gradientZ;
  }

  const smoothUnionHeight =
    sumHeightP > 0 ? Math.pow(sumHeightP, 1 / SMOOTH_UNION_POWER) : 0;
  const smoothGradientScale =
    sumHeightP > 0
      ? Math.pow(sumHeightP, 1 / SMOOTH_UNION_POWER - 1)
      : 0;
  const blend = Math.max(0, Math.min(1, additivity));
  const bumpHeight =
    smoothUnionHeight + (additiveHeight - smoothUnionHeight) * blend;
  const gx =
    sumGradientX * smoothGradientScale * (1 - blend) +
    additiveGradientX * blend;
  const gy =
    sumGradientY * smoothGradientScale * (1 - blend) +
    additiveGradientY * blend;
  const gz =
    sumGradientZ * smoothGradientScale * (1 - blend) +
    additiveGradientZ * blend;
  const h = manualOffset + bumpHeight;
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

/** Build a single mesh-local surface from all domes. */
export function buildBakedDomeSurface(
  gaussians: MappingGaussian[],
  additivity: number,
  detail?: { radialSteps?: number; angularSteps?: number },
): BufferGeometry | null {
  if (!gaussians.length) return null;
  const radialSteps = Math.max(4, Math.floor(detail?.radialSteps ?? 16));
  const angularSteps = Math.max(12, Math.floor(detail?.angularSteps ?? 48));
  const extent = DOME_FOOTPRINT_SCALE;
  const vertices: number[] = [];
  const indices: number[] = [];
  for (const g of gaussians) {
    const frame = gaussianTangentFrame(g.normal, g.rotationDeg ?? 0);
    const domeStart = vertices.length / 3;
    const pushVertex = (ux: number, vy: number) => {
      const u = ux * g.width;
      const v = vy * g.height;
      const base: Vec3 = [
        g.pos[0] + frame.tW[0] * u + frame.tH[0] * v,
        g.pos[1] + frame.tW[1] * u + frame.tH[1] * v,
        g.pos[2] + frame.tW[2] * u + frame.tH[2] * v,
      ];
      const displaced = displaceLed(base, g.normal, gaussians, 0, additivity).pos;
      vertices.push(displaced[0], displaced[1], displaced[2]);
    };
    pushVertex(0, 0);
    for (let ring = 1; ring <= radialSteps; ring++) {
      const radius = (ring / radialSteps) * extent;
      for (let segment = 0; segment < angularSteps; segment++) {
        const a = (segment / angularSteps) * Math.PI * 2;
        pushVertex(Math.cos(a) * radius, Math.sin(a) * radius);
      }
    }
    for (let segment = 0; segment < angularSteps; segment++) {
      indices.push(
        domeStart,
        domeStart + 1 + segment,
        domeStart + 1 + ((segment + 1) % angularSteps),
      );
    }
    for (let ring = 1; ring < radialSteps; ring++) {
      const inner = domeStart + 1 + (ring - 1) * angularSteps;
      const outer = domeStart + 1 + ring * angularSteps;
      for (let segment = 0; segment < angularSteps; segment++) {
        const next = (segment + 1) % angularSteps;
        indices.push(
          inner + segment,
          outer + segment,
          inner + next,
          inner + next,
          outer + segment,
          outer + next,
        );
      }
    }
  }
  if (!indices.length || !vertices.length) return null;
  const surface = new BufferGeometry();
  surface.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  surface.setIndex(indices);
  surface.computeVertexNormals();
  return surface;
}

/**
 * Return direct-light transmission from a ray through the compact dome
 * surfaces. Inputs and domes must be in the same coordinate space.
 * `maxDistance` is finite for a point light and Infinity for sun/moon rays.
 */
export function gaussianRayTransmission(
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
  gaussians: MappingGaussian[],
  opacity: number,
  originNormal?: Vec3,
): number {
  const blocked = Math.max(0, Math.min(1, opacity));
  if (blocked <= 0 || gaussians.length === 0) return 1;
  const dl = Math.hypot(direction[0], direction[1], direction[2]) || 1;
  const dx = direction[0] / dl;
  const dy = direction[1] / dl;
  const dz = direction[2] / dl;
  const rayMax = Number.isFinite(maxDistance)
    ? Math.max(0, maxDistance)
    : Number.POSITIVE_INFINITY;
  const originEpsilon = 1e-3;

  for (const g of gaussians) {
    if (g.amplitude <= 1e-8) continue;
    const ridgeWeight = originNormal
      ? ridgeWrapWeight(originNormal, g.normal)
      : 1;
    if (ridgeWeight <= 1e-5) continue;
    const frame = gaussianTangentFrame(g.normal, g.rotationDeg ?? 0);
    const ox = origin[0] - g.pos[0];
    const oy = origin[1] - g.pos[1];
    const oz = origin[2] - g.pos[2];
    const radius = Math.hypot(
      Math.max(g.width, g.height) * Math.sqrt(GAUSSIAN_CUTOFF_Q),
      g.amplitude,
    );
    const along = -(ox * dx + oy * dy + oz * dz);
    const closestX = ox + dx * along;
    const closestY = oy + dy * along;
    const closestZ = oz + dz * along;
    const closestSq =
      closestX * closestX + closestY * closestY + closestZ * closestZ;
    if (closestSq > radius * radius) continue;
    const half = Math.sqrt(Math.max(0, radius * radius - closestSq));
    const start = Math.max(originEpsilon, along - half);
    const end = Math.min(rayMax, along + half);
    if (!(end > start)) continue;

    let previous: number | null = null;
    const samples = 36;
    for (let i = 0; i <= samples; i++) {
      const t = start + ((end - start) * i) / samples;
      const px = ox + dx * t;
      const py = oy + dy * t;
      const pz = oz + dz * t;
      const u =
        px * frame.tW[0] + py * frame.tW[1] + pz * frame.tW[2];
      const v =
        px * frame.tH[0] + py * frame.tH[1] + pz * frame.tH[2];
      const q =
        (u * u) /
          Math.max(1e-12, g.width * g.width * (0.15 + ridgeWeight * 0.85)) +
        (v * v) /
          Math.max(1e-12, g.height * g.height * (0.15 + ridgeWeight * 0.85));
      if (q > GAUSSIAN_CUTOFF_Q) {
        previous = null;
        continue;
      }
      const n = px * frame.n[0] + py * frame.n[1] + pz * frame.n[2];
      const edge = 1 - q / GAUSSIAN_CUTOFF_Q;
      const surface = g.amplitude * ridgeWeight * edge * edge;
      const signed = n - surface;
      if (
        previous !== null &&
        ((previous < 0 && signed >= 0) || (previous > 0 && signed <= 0))
      ) {
        return 1 - blocked;
      }
      previous = signed;
    }
  }
  return 1;
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
