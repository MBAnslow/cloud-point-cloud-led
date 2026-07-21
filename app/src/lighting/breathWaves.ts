import type { BreathParams, BreathParticipant } from "../state";
import type { CloudTransform } from "../scene/cloudTransform";
import { applyCloudTransform } from "../scene/cloudTransform";
import { sampleParticipantBreath } from "./breath";
import { fogDensity } from "./noise3d";
import { hexToVec3 } from "./shade";

export interface BreathWave {
  participantId: string;
  color: string;
  bornMs: number;
  /** World-space origin (participant horizon position at spawn). */
  origin: [number, number, number];
  /** Unit direction from origin through the cloud center. */
  direction: [number, number, number];
  speed: number;
  durationMs: number;
  peakStrength: number;
  /** Per-wave fog field seed so each breath looks different. */
  noiseSeed: number;
}

export interface BreathLedSample {
  /** Interior fog mask [0,1]. */
  mask: number;
  /** Rim shell weight [0,1] (before rimAmount). */
  rim: number;
  /** Participant colour for the winning rim wave. */
  rimR: number;
  rimG: number;
  rimB: number;
}

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

/**
 * Participant position in world space: `cloudDistance` out on the
 * horizon circle at `azimuthDeg`, raised/lowered by `horizonDistance`
 * from the horizon plane, then cloud tilt/yaw/offset applied.
 */
export function participantWorldPos(
  p: BreathParticipant,
  cloudDistance: number,
  horizonDistance: number,
  transform: CloudTransform,
): [number, number, number] {
  const az = (p.azimuthDeg * Math.PI) / 180;
  const local: [number, number, number] = [
    Math.cos(az) * cloudDistance,
    horizonDistance,
    Math.sin(az) * cloudDistance,
  ];
  return applyCloudTransform(local, transform);
}

export function cloudCenterWorld(transform: CloudTransform): [number, number, number] {
  return applyCloudTransform([0, 0, 0], transform);
}

/**
 * Wave lifetime / radius scale with the configured exhale duration so
 * longer breaths push farther and wider through the cloud. Travel time
 * across the diameter is used as a lower bound so short exhales still
 * reach the far side.
 */
function waveMetrics(
  params: BreathParams,
  cloudDistance: number,
): { durationMs: number; speed: number } {
  const speed = Math.max(0, Math.min(2, params.waveSpeed));
  const exhaleMs = Math.max(50, params.exhaleSeconds * 1000);
  // Time to travel from participant, through center, to the opposite side.
  // Zero speed → no travel; lifetime falls back to exhale length only.
  const travelMs =
    speed > 1e-6
      ? ((2 * Math.max(0.2, cloudDistance)) / speed) * 1000
      : exhaleMs;
  const durationMs = Math.max(travelMs, exhaleMs * 1.25);
  return { durationMs, speed };
}

/** Live breath-volume half-extents (editable after spawn / while paused). */
export function liveWaveExtents(params: BreathParams): {
  width: number;
  height: number;
  depth: number;
} {
  return {
    width: Math.max(0, Math.min(0.5, params.waveWidth)),
    height: Math.max(0, Math.min(0.5, params.waveHeight)),
    depth: Math.max(0, Math.min(0.5, params.waveDepth)),
  };
}

export interface WaveLocalFrame {
  /** Lateral axis (width). */
  right: [number, number, number];
  /** Vertical-ish axis (height), from world-up projected off forward. */
  up: [number, number, number];
  /** Depth axis: unit travel direction, away from the participant. */
  forward: [number, number, number];
}

/**
 * Orthonormal frame for a breath volume: depth (+Z) points along
 * `direction` (participant → cloud), height stays as upright as possible.
 */
export function waveLocalFrame(
  direction: [number, number, number],
): WaveLocalFrame {
  const fx = direction[0];
  const fy = direction[1];
  const fz = direction[2];
  // Seed height from world up, then remove the forward component.
  let ux = 0;
  let uy = 1;
  let uz = 0;
  const dup = ux * fx + uy * fy + uz * fz;
  ux -= dup * fx;
  uy -= dup * fy;
  uz -= dup * fz;
  let ulen = Math.hypot(ux, uy, uz);
  if (ulen < 1e-4) {
    // Travel nearly vertical — fall back to world +X.
    ux = 1;
    uy = 0;
    uz = 0;
    const dup2 = ux * fx + uy * fy + uz * fz;
    ux -= dup2 * fx;
    uy -= dup2 * fy;
    uz -= dup2 * fz;
    ulen = Math.hypot(ux, uy, uz) || 1;
  }
  ux /= ulen;
  uy /= ulen;
  uz /= ulen;
  // right = up × forward so (+X,+Y,+Z) is right-handed with +Z = forward.
  let rx = uy * fz - uz * fy;
  let ry = uz * fx - ux * fz;
  let rz = ux * fy - uy * fx;
  const rlen = Math.hypot(rx, ry, rz) || 1;
  rx /= rlen;
  ry /= rlen;
  rz /= rlen;
  // Re-orthogonalize up = forward × right.
  ux = fy * rz - fz * ry;
  uy = fz * rx - fx * rz;
  uz = fx * ry - fy * rx;
  return {
    right: [rx, ry, rz],
    up: [ux, uy, uz],
    forward: [fx, fy, fz],
  };
}

/**
 * Stateful tracker for travelling exhale waves. Spawn on exhale onset;
 * advance each frame; prune when expired.
 */
export class BreathWaveController {
  private waves: BreathWave[] = [];
  private lastPhase = new Map<string, BreathSamplePhase>();

  getWaves(): BreathWave[] {
    return this.waves;
  }

  /**
   * Advance the simulation. `transform` must match the cloud/mesh
   * transform used for LED positions so wave centers stay aligned.
   */
  update(nowMs: number, params: BreathParams, transform: CloudTransform): void {
    // Prune expired waves first.
    this.waves = this.waves.filter((w) => nowMs - w.bornMs <= w.durationMs);

    if (!params.enabled) {
      this.lastPhase.clear();
      return;
    }

    const center = cloudCenterWorld(transform);
    const cloudDist = Math.max(0.2, params.cloudDistance);
    const metrics = waveMetrics(params, cloudDist);

    for (const p of params.participants) {
      if (!p.enabled) {
        this.lastPhase.delete(p.id);
        continue;
      }
      const sample = sampleParticipantBreath(p, params, nowMs);
      const prev = this.lastPhase.get(p.id);
      this.lastPhase.set(p.id, sample.phase);

      // Spawn once on the rising edge into exhale.
      if (sample.phase === "exhale" && prev !== "exhale") {
        const origin = participantWorldPos(
          p,
          cloudDist,
          params.horizonDistance,
          transform,
        );
        const dx = center[0] - origin[0];
        const dy = center[1] - origin[1];
        const dz = center[2] - origin[2];
        const len = Math.hypot(dx, dy, dz) || 1;
        this.waves.push({
          participantId: p.id,
          color: p.color,
          bornMs: nowMs,
          origin,
          direction: [dx / len, dy / len, dz / len],
          speed: metrics.speed,
          durationMs: metrics.durationMs,
          peakStrength: 1,
          noiseSeed: (Math.random() * 0x7fffffff) | 0,
        });
      }
    }
  }

  /** World-space center of a wave at `nowMs`. */
  waveCenterAt(w: BreathWave, nowMs: number): [number, number, number] {
    const ageSec = Math.max(0, nowMs - w.bornMs) / 1000;
    const dist = w.speed * ageSec;
    return [
      w.origin[0] + w.direction[0] * dist,
      w.origin[1] + w.direction[1] * dist,
      w.origin[2] + w.direction[2] * dist,
    ];
  }

  /**
   * Soft envelope: full strength for most of the life, fade in the last
   * 25% so the wave dissolves as it exits the far side of the cloud.
   */
  waveStrength(w: BreathWave, nowMs: number): number {
    const age = nowMs - w.bornMs;
    if (age < 0 || age > w.durationMs) return 0;
    const u = age / w.durationMs;
    const fade = u < 0.75 ? 1 : 1 - (u - 0.75) / 0.25;
    return w.peakStrength * clamp01(fade);
  }
}

type BreathSamplePhase = ReturnType<typeof sampleParticipantBreath>["phase"];

/**
 * Per-LED breath sample: interior volumetric fog mask + outer rim shell
 * tinted toward the participant colour.
 *
 * The breath volume is an ellipsoid oriented so depth points along the
 * wave travel axis (away from the participant); width/height are the
 * lateral axes. Rim is a metre-thick band around that surface; only an
 * arc of `rimArcDegrees` is active on the far side.
 */
export function breathSampleAt(
  px: number,
  py: number,
  pz: number,
  controller: BreathWaveController,
  nowMs: number,
  falloffExponent: number,
  width: number,
  height: number,
  depth: number,
  rimThickness: number,
  rimArcDegrees: number,
  fog?: {
    scale: number;
    amount: number;
    contrast: number;
  },
): BreathLedSample {
  const waves = controller.getWaves();
  const empty: BreathLedSample = { mask: 0, rim: 0, rimR: 0, rimG: 0, rimB: 0 };
  if (waves.length === 0) return empty;
  const rw = Math.max(0, width);
  const rh = Math.max(0, height);
  const rd = Math.max(0, depth);
  if (rw <= 1e-6 || rh <= 1e-6 || rd <= 1e-6) return empty;
  const fall = Math.max(0, falloffExponent);
  const amount = fog ? clamp01(fog.amount) : 0;
  const thick = Math.max(0, rimThickness);
  const arcDeg = Math.max(0, Math.min(360, rimArcDegrees));
  const halfArcRad = (arcDeg * 0.5 * Math.PI) / 180;
  const tSec = nowMs / 1000;
  let bestMask = 0;
  let bestRim = 0;
  let rimR = 0;
  let rimG = 0;
  let rimB = 0;
  for (const w of waves) {
    const strength = controller.waveStrength(w, nowMs);
    if (strength <= 0) continue;
    const c = controller.waveCenterAt(w, nowMs);
    const dx = px - c[0];
    const dy = py - c[1];
    const dz = pz - c[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const frame = waveLocalFrame(w.direction);
    const [rx, ry, rz] = frame.right;
    const [ux, uy, uz] = frame.up;
    const [fx, fy, fz] = frame.forward;
    // Local ellipsoid coords: width / height / depth.
    const lw = dx * rx + dy * ry + dz * rz;
    const lh = dx * ux + dy * uy + dz * uz;
    const ld = dx * fx + dy * fy + dz * fz;

    // Ellipsoidal radius: 0 at center, 1 on surface.
    const sx = lw / rw;
    const sy = lh / rh;
    const sz = ld / rd;
    const rho = Math.sqrt(sx * sx + sy * sy + sz * sz);

    // --- Interior fog mask (inside ellipsoid only) ---
    const prox = clamp01(1 - rho);
    if (prox > 0) {
      const envelope = fall <= 0 ? 1 : Math.pow(prox, fall);
      let densityBlend = 1;
      if (amount > 0 && fog) {
        const density = fogDensity(
          sx,
          sy,
          sz,
          fog.scale,
          fog.contrast,
          tSec,
          w.noiseSeed,
        );
        densityBlend = 1 + amount * (density - 1);
      }
      const mask = strength * envelope * densityBlend;
      if (mask > bestMask) bestMask = mask;
    }

    // --- Outer rim shell (band around ellipsoid surface, far-side arc) ---
    if (thick > 1e-6 && halfArcRad > 1e-6 && d > 1e-6 && rho > 1e-6) {
      // World-space distance to the ellipsoid surface along this ray.
      const surfaceDist = d / rho;
      const edge = Math.abs(d - surfaceDist);
      const shell = clamp01(1 - edge / thick);
      if (shell > 0) {
        // Angle from the far-side axis (depth / travel direction).
        const cosA = (dx * fx + dy * fy + dz * fz) / d;
        const angle = Math.acos(Math.max(-1, Math.min(1, cosA)));
        const arcGate =
          halfArcRad >= Math.PI - 1e-6
            ? 1
            : clamp01(1 - angle / halfArcRad);
        if (arcGate > 0) {
          const rim = strength * shell * arcGate;
          if (rim > bestRim) {
            bestRim = rim;
            const col = hexToVec3(w.color);
            rimR = col[0];
            rimG = col[1];
            rimB = col[2];
          }
        }
      }
    }
  }
  return {
    mask: clamp01(bestMask),
    rim: clamp01(bestRim),
    rimR,
    rimG,
    rimB,
  };
}

/** @deprecated Prefer breathSampleAt — kept for any external callers. */
export function breathMaskAt(
  px: number,
  py: number,
  pz: number,
  controller: BreathWaveController,
  nowMs: number,
  falloffExponent: number,
  width: number,
  height: number,
  depth: number,
  fog?: {
    scale: number;
    amount: number;
    contrast: number;
  },
): number {
  return breathSampleAt(
    px,
    py,
    pz,
    controller,
    nowMs,
    falloffExponent,
    width,
    height,
    depth,
    0,
    0,
    fog,
  ).mask;
}

/** Shared singleton so LEDs + BreathArea viz see the same waves. */
export const sharedBreathWaveController = new BreathWaveController();
