/**
 * Shared helpers for transforming points and directions from cloud-local
 * space into world space using the current cloud tilt (X), yaw (Y) and
 * planar XZ offset. Kept in one place so LEDs, breath area, lightning,
 * and any other scene consumers stay in sync.
 */
export function rotateY(
  v: [number, number, number],
  radians: number,
): [number, number, number] {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

export function rotateX(
  v: [number, number, number],
  radians: number,
): [number, number, number] {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}

export function rotateCloud(
  v: [number, number, number],
  tiltRad: number,
  yawRad: number,
): [number, number, number] {
  // Match three.js default Euler order "XYZ" on the ellipsoid mesh:
  // the composed matrix is Rx * Ry * Rz, so a vector sees yaw applied
  // first, then tilt. Getting this order wrong makes LEDs, lightning
  // paths, and the breath area diverge from the visible mesh at large
  // tilt angles.
  return rotateX(rotateY(v, yawRad), tiltRad);
}

export function offsetXZ(
  v: [number, number, number],
  x: number,
  z: number,
): [number, number, number] {
  return [v[0] + x, v[1], v[2] + z];
}

export interface CloudTransform {
  tiltRad: number;
  yawRad: number;
  offsetX: number;
  offsetZ: number;
}

export function applyCloudTransform(
  v: [number, number, number],
  t: CloudTransform,
): [number, number, number] {
  return offsetXZ(rotateCloud(v, t.tiltRad, t.yawRad), t.offsetX, t.offsetZ);
}
