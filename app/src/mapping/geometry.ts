import type { EllipsoidParams, Vec3 } from "../state";

/**
 * A mapped LED is stored as a unit-sphere direction `dir`. The ellipsoid
 * surface point along that direction is simply the componentwise product
 * with the semi-axes: `p = (rx, ry, rz) * dir`. Because `dir` is a unit
 * vector this always lands exactly on the ellipsoid surface, and the LED
 * stays glued to the surface when the cloud is resized.
 */
export function surfacePoint(dir: Vec3, e: EllipsoidParams): Vec3 {
  return [e.rx * dir[0], e.ry * dir[1], e.rz * dir[2]];
}

/**
 * Outward-pointing unit normal of the ellipsoid at the point described by
 * `dir`. The implicit surface is (x/rx)² + (y/ry)² + (z/rz)² = 1, whose
 * gradient at `p = (rx, ry, rz)·dir` is proportional to
 * (dir.x/rx, dir.y/ry, dir.z/rz).
 */
export function surfaceNormal(dir: Vec3, e: EllipsoidParams): Vec3 {
  const v: Vec3 = [dir[0] / e.rx, dir[1] / e.ry, dir[2] / e.rz];
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * Convert a world-space point on (or near) the ellipsoid surface back to
 * the unit-sphere direction we persist. Dividing the point by the semi-axes
 * maps the ellipsoid back onto the unit sphere; normalising then removes any
 * small radial error from the raycast hit.
 */
export function dirFromSurfacePoint(p: Vec3, e: EllipsoidParams): Vec3 {
  const v: Vec3 = [p[0] / e.rx, p[1] / e.ry, p[2] / e.rz];
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Azimuth/elevation (radians) of a unit direction, y-up. */
export function dirToAzEl(dir: Vec3): { az: number; el: number } {
  const y = Math.max(-1, Math.min(1, dir[1]));
  return { az: Math.atan2(dir[2], dir[0]), el: Math.asin(y) };
}

/** Inverse of `dirToAzEl`. */
export function azElToDir(az: number, el: number): Vec3 {
  const ce = Math.cos(el);
  return [ce * Math.cos(az), Math.sin(el), ce * Math.sin(az)];
}

/**
 * Flip the mapping's up/down interpretation by mirroring the direction
 * across the XZ plane (y -> -y). This transform is its own inverse.
 */
export function applyUpDownFlip(dir: Vec3, enabled: boolean): Vec3 {
  return enabled ? [dir[0], -dir[1], dir[2]] : dir;
}

/**
 * Flip mapping left/right by mirroring across the YZ plane (x -> -x).
 * This transform is its own inverse.
 */
export function applyLeftRightFlip(dir: Vec3, enabled: boolean): Vec3 {
  return enabled ? [-dir[0], dir[1], dir[2]] : dir;
}

/** Apply all mapping orientation transforms in a stable order. */
export function applyMappingOrientation(
  dir: Vec3,
  flipUpDown: boolean,
  flipLeftRight: boolean,
): Vec3 {
  return applyLeftRightFlip(applyUpDownFlip(dir, flipUpDown), flipLeftRight);
}
