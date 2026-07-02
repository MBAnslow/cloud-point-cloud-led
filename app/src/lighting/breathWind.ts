import type { EllipsoidParams, Vec3 } from "../state";

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

export interface BreathWindField {
  origin: Vec3;
  radius: number;
  falloffExponent: number;
  maxIntensity: number;
}

export interface BreathModeInfluence {
  inhalePull: number;
  exhalePush: number;
  /** Shared magnitude where both channels overlap (for future compositing). */
  overlap: number;
  /** Signed blend: positive pushes out, negative pulls in. */
  net: number;
}

export interface BreathWindPlacement {
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
 * Compute source position around an ellipsoid by:
 * 1) choosing a direction from azimuth/elevation
 * 2) intersecting that ray with the ellipsoid surface
 * 3) offsetting outward from the surface by `distanceFromCloud`
 */
export function computeBreathWindOrigin(
  ellipsoid: EllipsoidParams,
  placement: BreathWindPlacement,
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
 * Distance-weighted wind influence with tunable radial falloff.
 *
 * Useful for later coupling to LEDs: query per-LED with an exhale scalar
 * and get a stable [0, +inf) influence value where near-source points
 * receive stronger wind than far points.
 */
export function breathWindInfluenceAt(
  position: Vec3,
  field: BreathWindField,
  exhaleIntensity: number,
): number {
  const dx = position[0] - field.origin[0];
  const dy = position[1] - field.origin[1];
  const dz = position[2] - field.origin[2];
  const distance = Math.hypot(dx, dy, dz);
  const radius = Math.max(1e-6, field.radius);
  const norm = clamp01(1 - distance / radius);
  const radial = Math.pow(norm, Math.max(0.05, field.falloffExponent));
  return Math.max(0, exhaleIntensity) * Math.max(0, field.maxIntensity) * radial;
}

export function breathWindModesAt(
  position: Vec3,
  baseField: Omit<BreathWindField, "maxIntensity">,
  inhaleIntensity: number,
  exhaleIntensity: number,
  inhaleMaxIntensity: number,
  exhaleMaxIntensity: number,
): BreathModeInfluence {
  const inhalePull = breathWindInfluenceAt(
    position,
    { ...baseField, maxIntensity: inhaleMaxIntensity },
    inhaleIntensity,
  );
  const exhalePush = breathWindInfluenceAt(
    position,
    { ...baseField, maxIntensity: exhaleMaxIntensity },
    exhaleIntensity,
  );
  const overlap = Math.min(inhalePull, exhalePush);
  return {
    inhalePull,
    exhalePush,
    overlap,
    net: exhalePush - inhalePull,
  };
}

