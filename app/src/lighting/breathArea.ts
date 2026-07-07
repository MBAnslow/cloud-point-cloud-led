import type { EllipsoidParams, Vec3 } from "../state";

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

export interface BreathAreaField {
  origin: Vec3;
  radius: number;
  falloffExponent: number;
}

export interface BreathAreaPlacement {
  sourceAzimuthDeg: number;
  sourceElevationDeg: number;
  distanceFromCloud: number;
}

function directionFromAzEl(
  azimuthDeg: number,
  elevationDeg: number,
): Vec3 {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const ce = Math.cos(el);
  const x = ce * Math.cos(az);
  const y = Math.sin(el);
  const z = ce * Math.sin(az);
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

/**
 * Compute the area-of-effect origin around the ellipsoid:
 *   1. pick a direction from azimuth/elevation
 *   2. intersect that ray with the ellipsoid surface
 *   3. push outward from the surface by `distanceFromCloud`
 */
export function computeBreathAreaOrigin(
  ellipsoid: EllipsoidParams,
  placement: BreathAreaPlacement,
): Vec3 {
  const dir = directionFromAzEl(
    placement.sourceAzimuthDeg,
    placement.sourceElevationDeg,
  );
  const denom =
    (dir[0] * dir[0]) / Math.max(1e-6, ellipsoid.rx * ellipsoid.rx) +
    (dir[1] * dir[1]) / Math.max(1e-6, ellipsoid.ry * ellipsoid.ry) +
    (dir[2] * dir[2]) / Math.max(1e-6, ellipsoid.rz * ellipsoid.rz);
  if (denom <= 1e-12) return [0, -ellipsoid.ry, 0];

  const surfaceScale = 1 / Math.sqrt(denom);
  const scale = surfaceScale + Math.max(0, placement.distanceFromCloud);
  return [dir[0] * scale, dir[1] * scale, dir[2] * scale];
}

/**
 * Normalized influence in [0,1] of a soft-falloff sphere centered at
 * `field.origin`: 1 at the center, 0 at or beyond `radius`. The
 * `falloffExponent` shapes how quickly it drops (>1 concentrates near the
 * center, <1 broadens).
 */
export function breathAreaInfluenceAt(
  position: Vec3,
  field: BreathAreaField,
): number {
  const dx = position[0] - field.origin[0];
  const dy = position[1] - field.origin[1];
  const dz = position[2] - field.origin[2];
  const distance = Math.hypot(dx, dy, dz);
  const radius = Math.max(1e-6, field.radius);
  const norm = clamp01(1 - distance / radius);
  return Math.pow(norm, Math.max(0.05, field.falloffExponent));
}
