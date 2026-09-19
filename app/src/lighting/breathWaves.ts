import type { BreathParams, BreathParticipant } from "../state";
import type { CloudTransform } from "../scene/cloudTransform";
import { applyCloudTransform } from "../scene/cloudTransform";
import { sampleParticipantBreath } from "./breath";
import { breathAreaInfluenceAt } from "./breathArea";
import { fogDensity, signedEdgeNoise } from "./noise3d";
import { hexToVec3 } from "./shade";
import { consumeOscExhaleTriggers, getOscBreathBinary } from "../breath/oscBreathClient";

export interface BreathWave {
  participantId: string;
  color: string;
  bornMs: number;
  /** World-space origin (participant horizon position at spawn). */
  origin: [number, number, number];
  /** Unit direction from origin through the cloud center. */
  direction: [number, number, number];
  speed: number;
  /** Safety max lifetime (missed cloud / runaway). */
  durationMs: number;
  peakStrength: number;
  /**
   * Participant fog-field seed. Fog is sampled in cloud-centered world
   * space (fixed volume); the travelling spheroid only gates it.
   */
  fogSeed: number;
  /**
   * Once true, the volume has overlapped at least one LED. Cleared from
   * the sim as soon as it later loses all LED contact.
   */
  hasTouchedLed: boolean;
}

export interface BreathLedSample {
  /** Interior fog mask [0,1] (geometry × fog density). */
  mask: number;
  /**
   * Geometric fill only (strength × radial envelope, no fog). 1 at the
   * spheroid center, 0 outside. Used for cloud-breath audio drive so
   * coverage isn't crushed by fog speckles.
   */
  solid: number;
  /** Rim shell weight [0,1] (before rimAmount). */
  rim: number;
  /** Participant colour for the winning rim wave. */
  rimR: number;
  rimG: number;
  rimB: number;
}

export interface BreathInflationVolume {
  participantId: string;
  color: string;
  /** Exact nearest mapped LED/cloud point used as the attached origin. */
  origin: [number, number, number];
  radius: number;
  strength: number;
  fogSeed: number;
}

export interface BreathExhaleEvent {
  id: number;
  participantId: string;
  bornMs: number;
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
    depth: Math.max(0, Math.min(2, params.waveDepth)),
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
 * Stateful tracker for both spatial breath modes. Travelling waves spawn
 * on exhale onset; local volumes follow continuous inhale fullness and
 * attach to the participant's nearest mapped cloud point. Trigger sources
 * remain mutually exclusive (internal oscillator or OSC).
 */
export class BreathWaveController {
  private waves: BreathWave[] = [];
  private inflations: BreathInflationVolume[] = [];
  private inhaleLevels = new Map<string, number>();
  private oscInhaleTargets = new Map<string, number>();
  private exhaleEvents: BreathExhaleEvent[] = [];
  private nextExhaleEventId = 1;
  private lastUpdateMs = 0;
  private lastPhase = new Map<string, BreathSamplePhase>();
  /** Last OSC binary per participant id (UI / debug). */
  private lastOscBinary = new Map<string, number>();

  getWaves(): BreathWave[] {
    return this.waves;
  }

  getInflations(): BreathInflationVolume[] {
    return this.inflations;
  }

  getExhaleEvents(): BreathExhaleEvent[] {
    return this.exhaleEvents;
  }

/**
 * Advance the simulation. Wave ages use wall-clock `nowMs`
 * (`performance.now()`). Pass `breathClockMs` for internal oscillator
 * phase sampling (may be frozen while paused).
 *
 * Call {@link syncLedContact} afterward with live LED positions so
 * waves despawn when they leave the cloud.
 */
update(
  nowMs: number,
  params: BreathParams,
  transform: CloudTransform,
  breathClockMs: number = nowMs,
): void {
  const dtSec =
    this.lastUpdateMs > 0
      ? Math.max(0, Math.min(0.25, (nowMs - this.lastUpdateMs) / 1000))
      : 0;
  this.lastUpdateMs = nowMs;
  // Safety prune only (waves that never hit the cloud).
  this.waves = this.waves.filter((w) => nowMs - w.bornMs <= w.durationMs);
  this.exhaleEvents = this.exhaleEvents.filter(
    (event) => nowMs - event.bornMs <= 30_000,
  );

  if (!params.enabled) {
    // Drop pending OSC edges while inactive so they don't burst-fire
    // when the breath window opens again.
    consumeOscExhaleTriggers();
    this.lastPhase.clear();
    this.lastOscBinary.clear();
    this.inhaleLevels.clear();
    this.oscInhaleTargets.clear();
    this.waves = [];
    this.inflations = [];
    return;
  }

  const localMode = params.effectMode === "localInflation";
  if (localMode) this.waves = [];
  else this.inflations = [];
  const center = cloudCenterWorld(transform);
  const cloudDist = Math.max(0.2, params.cloudDistance);
  const metrics = waveMetrics(params, cloudDist);
  const useOsc = params.triggerSource === "osc";

  const emitExhale = (p: BreathParticipant) => {
    this.exhaleEvents.push({
      id: this.nextExhaleEventId++,
      participantId: p.id,
      bornMs: nowMs,
    });
    if (this.exhaleEvents.length > 64) {
      this.exhaleEvents.splice(0, this.exhaleEvents.length - 64);
    }
  };

  const spawnWave = (p: BreathParticipant) => {
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
      fogSeed: p.fogSeed >>> 0,
      hasTouchedLed: false,
    });
  };

  if (useOsc) {
    // OSC mode: only rising-edge binary pulses spawn. Internal phase
    // memory is cleared so switching back doesn't inherit a stale edge.
    this.lastPhase.clear();
    const oscExhaleChannels = consumeOscExhaleTriggers();
    for (const channel of oscExhaleChannels) {
      const pi = channel - 1;
      if (pi < 0 || pi >= params.participants.length) continue;
      const p = params.participants[pi];
      if (!p.enabled) continue;
      emitExhale(p);
      if (!localMode) spawnWave(p);
    }
  } else {
    // Internal mode: discard OSC pulses so they never leak into spawns
    // (and don't pile up for a burst when switching to OSC later).
    consumeOscExhaleTriggers();
  }

  for (let pi = 0; pi < params.participants.length; pi++) {
    const p = params.participants[pi];
    if (!p.enabled) {
      this.lastPhase.delete(p.id);
      this.lastOscBinary.delete(p.id);
      this.inhaleLevels.delete(p.id);
      this.oscInhaleTargets.delete(p.id);
      continue;
    }

    const channel = pi + 1;
    const oscBinary = getOscBreathBinary(channel);
    this.lastOscBinary.set(p.id, oscBinary);

    if (useOsc) {
      if (localMode) {
        let target = this.oscInhaleTargets.get(p.id) ?? 0;
        if (oscBinary <= -0.5) target = 1;
        else if (oscBinary >= 0.5) target = 0;
        this.oscInhaleTargets.set(p.id, target);
        const previous = this.inhaleLevels.get(p.id) ?? 0;
        if (!params.paused) {
          const duration =
            target >= previous
              ? Math.max(0.001, params.inhaleSeconds)
              : Math.max(0.001, params.exhaleSeconds);
          const step = dtSec / duration;
          this.inhaleLevels.set(
            p.id,
            target >= previous
              ? Math.min(target, previous + step)
              : Math.max(target, previous - step),
          );
        } else {
          this.inhaleLevels.set(p.id, previous);
        }
      }
      continue;
    }

    const sample = sampleParticipantBreath(p, params, breathClockMs);
    if (localMode) this.inhaleLevels.set(p.id, sample.inhaleIntensity);
    const prev = this.lastPhase.get(p.id);
    this.lastPhase.set(p.id, sample.phase);
    // Require a known prior phase so window open / mode switch / first
    // frame mid-exhale cannot count as a fresh onset (that was firing
    // waves far more often than one per cycle).
    if (
      prev !== undefined &&
      sample.phase === "exhale" &&
      prev !== "exhale"
    ) {
      emitExhale(p);
      if (!localMode) spawnWave(p);
    }
  }
}

  /**
   * Build participant-attached local volumes from the exact mapped LED
   * positions. Each origin is the cloud point nearest its participant.
   */
  syncLocalInflations(
    params: BreathParams,
    transform: CloudTransform,
    positions: Float32Array,
    ledCount: number,
  ): void {
    if (
      params.effectMode !== "localInflation" ||
      !params.enabled ||
      ledCount <= 0
    ) {
      this.inflations = [];
      return;
    }
    const next: BreathInflationVolume[] = [];
    for (const p of params.participants) {
      if (!p.enabled) continue;
      const level = clamp01(this.inhaleLevels.get(p.id) ?? 0);
      if (level <= 1e-5) continue;
      const participant = participantWorldPos(
        p,
        Math.max(0.2, params.cloudDistance),
        params.horizonDistance,
        transform,
      );
      let nearest = 0;
      let nearestD2 = Infinity;
      for (let i = 0; i < ledCount; i++) {
        const i3 = i * 3;
        const dx = positions[i3] - participant[0];
        const dy = positions[i3 + 1] - participant[1];
        const dz = positions[i3 + 2] - participant[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < nearestD2) {
          nearestD2 = d2;
          nearest = i3;
        }
      }
      const growth = Math.pow(
        level,
        Math.max(0.1, params.localInflationGrowthExponent),
      );
      next.push({
        participantId: p.id,
        color: p.color,
        origin: [
          positions[nearest],
          positions[nearest + 1],
          positions[nearest + 2],
        ],
        radius: Math.max(0, params.localInflationRadius) * growth,
        strength: clamp01(params.localInflationStrength) * level,
        fogSeed: p.fogSeed >>> 0,
      });
    }
    this.inflations = next;
  }

  /**
   * Mark waves that currently overlap any LED; remove waves that previously
   * touched the cloud and no longer overlap any LED.
   */
  syncLedContact(
    nowMs: number,
    positions: Float32Array,
    ledCount: number,
    width: number,
    height: number,
    depth: number,
  ): void {
    if (this.waves.length === 0 || ledCount <= 0) return;
    const rw = Math.max(1e-6, width);
    const rh = Math.max(1e-6, height);
    const rd = Math.max(1e-6, depth);

    this.waves = this.waves.filter((w) => {
      const touching = waveTouchesAnyLed(
        this,
        w,
        nowMs,
        positions,
        ledCount,
        rw,
        rh,
        rd,
      );
      if (touching) {
        w.hasTouchedLed = true;
        return true;
      }
      // Still approaching the cloud — keep. Once we've been in contact
      // and lose it, despawn immediately.
      return !w.hasTouchedLed;
    });
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

  /** Full strength while alive — lifetime ends via LED-contact prune. */
  waveStrength(w: BreathWave, _nowMs: number): number {
    return w.peakStrength;
  }
}

/** Geometric ellipsoid test: any LED with rho ≤ 1 counts as contact. */
function waveTouchesAnyLed(
  controller: BreathWaveController,
  w: BreathWave,
  nowMs: number,
  positions: Float32Array,
  ledCount: number,
  rw: number,
  rh: number,
  rd: number,
): boolean {
  const c = controller.waveCenterAt(w, nowMs);
  const frame = waveLocalFrame(w.direction);
  const [rx, ry, rz] = frame.right;
  const [ux, uy, uz] = frame.up;
  const [fx, fy, fz] = frame.forward;
  for (let i = 0; i < ledCount; i++) {
    const i3 = i * 3;
    const dx = positions[i3] - c[0];
    const dy = positions[i3 + 1] - c[1];
    const dz = positions[i3 + 2] - c[2];
    const lw = dx * rx + dy * ry + dz * rz;
    const lh = dx * ux + dy * uy + dz * uz;
    const ld = dx * fx + dy * fy + dz * fz;
    const sx = lw / rw;
    const sy = lh / rh;
    const sz = ld / rd;
    if (sx * sx + sy * sy + sz * sz <= 1) return true;
  }
  return false;
}

type BreathSamplePhase = ReturnType<typeof sampleParticipantBreath>["phase"];

/**
 * Per-LED breath sample: interior volumetric fog mask + outer rim shell
 * tinted toward the participant colour.
 *
 * The travelling spheroid is an ellipsoid oriented so depth points along
 * the wave travel axis; it only gates / envelopes intensity. Fog density
 * and edge scalloping are sampled from a **fixed volume around the cloud
 * center**, using each participant's `fogSeed` (shared scale/amount/
 * contrast/edge params).
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
    /** Warps the ellipsoidal isosurface (rho units). */
    edgeNoise?: number;
  },
  /** World-space cloud center — fog is fixed relative to this point. */
  cloudCenter: [number, number, number] = [0, 0, 0],
): BreathLedSample {
  const waves = controller.getWaves();
  const empty: BreathLedSample = {
    mask: 0,
    solid: 0,
    rim: 0,
    rimR: 0,
    rimG: 0,
    rimB: 0,
  };
  if (waves.length === 0) return empty;
  const rw = Math.max(0, width);
  const rh = Math.max(0, height);
  const rd = Math.max(0, depth);
  if (rw <= 1e-6 || rh <= 1e-6 || rd <= 1e-6) return empty;
  const fall = Math.max(0, falloffExponent);
  const amount = fog ? clamp01(fog.amount) : 0;
  const edgeAmt = fog ? Math.max(0, Math.min(2, fog.edgeNoise ?? 0)) : 0;
  const thick = Math.max(0, rimThickness);
  const arcDeg = Math.max(0, Math.min(360, rimArcDegrees));
  const halfArcRad = (arcDeg * 0.5 * Math.PI) / 180;
  const tSec = nowMs / 1000;
  // Cloud-centered world offset — shared fog volume for all waves.
  const fox = px - cloudCenter[0];
  const foy = py - cloudCenter[1];
  const foz = pz - cloudCenter[2];
  let bestMask = 0;
  let bestSolid = 0;
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
    // Local ellipsoid coords: width / height / depth (spheroid gate only).
    const lw = dx * rx + dy * ry + dz * rz;
    const lh = dx * ux + dy * uy + dz * uz;
    const ld = dx * fx + dy * fy + dz * fz;

    // Ellipsoidal radius: 0 at center, 1 on surface.
    const sx = lw / rw;
    const sy = lh / rh;
    const sz = ld / rd;
    const rho = Math.sqrt(sx * sx + sy * sy + sz * sz);

    const fogSeed = w.fogSeed >>> 0;

    // Jagged silhouette from cloud-fixed fog: strongest at the surface,
    // falling off toward the center so scallops reach deep into the volume
    // (not just a thin outer shell).
    let rhoEff = rho;
    if (edgeAmt > 1e-6 && fog && rho < 1.5) {
      const amp = 0.22 * edgeAmt; // slider 0..2 → ±0..0.44 rho at the surface
      // Reach from the surface all the way to the center (dist = 1 − rho).
      const distFromSurface = Math.max(0, 1 - rho);
      const band = 1; // full interior depth
      if (distFromSurface < band) {
        const n = signedEdgeNoise(
          fox,
          foy,
          foz,
          fog.scale,
          tSec,
          (fogSeed ^ 0x9e3779b9) >>> 0,
        );
        const t = 1 - distFromSurface / band;
        // Gentler than smoothstep so mid-depth still carries clear scallops.
        const wgt = t * t * (2 - t);
        rhoEff = rho - n * amp * wgt;
      }
    }

    // --- Interior fog mask (geometric core + cloud-fixed fog density) ---
    const prox = clamp01(1 - rhoEff);
    if (prox > 0) {
      const envelope = fall <= 0 ? 1 : Math.pow(prox, fall);
      const solid = strength * envelope;
      if (solid > bestSolid) bestSolid = solid;
      let densityBlend = 1;
      if (amount > 0 && fog) {
        const density = fogDensity(
          fox,
          foy,
          foz,
          fog.scale,
          fog.contrast,
          tSec,
          fogSeed,
        );
        densityBlend = 1 + amount * (density - 1);
      }
      const mask = solid * densityBlend;
      if (mask > bestMask) bestMask = mask;
    }

    // --- Outer rim shell (band around warped surface, far-side arc) ---
    if (thick > 1e-6 && halfArcRad > 1e-6 && d > 1e-6 && rho > 1e-6) {
      // World-space distance to the (warped) ellipsoid surface along this ray.
      const surfaceDist = d / rho;
      const edge = Math.abs(rhoEff - 1) * surfaceDist;
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
    solid: clamp01(bestSolid),
    rim: clamp01(bestRim),
    rimR,
    rimG,
    rimB,
  };
}

/**
 * Per-LED sample for participant-attached inhale volumes. The volume
 * center is the nearest mapped cloud point, while radius and strength
 * follow that participant's lung fullness.
 */
export function localBreathSampleAt(
  px: number,
  py: number,
  pz: number,
  controller: BreathWaveController,
  nowMs: number,
  falloffExponent: number,
  rimThickness: number,
  fog?: {
    scale: number;
    amount: number;
    contrast: number;
    edgeNoise?: number;
  },
  cloudCenter: [number, number, number] = [0, 0, 0],
): BreathLedSample {
  const volumes = controller.getInflations();
  const empty: BreathLedSample = {
    mask: 0,
    solid: 0,
    rim: 0,
    rimR: 0,
    rimG: 0,
    rimB: 0,
  };
  if (volumes.length === 0) return empty;

  const fall = Math.max(0, falloffExponent);
  const amount = fog ? clamp01(fog.amount) : 0;
  const edgeAmount = fog
    ? Math.max(0, Math.min(2, fog.edgeNoise ?? 0))
    : 0;
  const thick = Math.max(0, rimThickness);
  const fox = px - cloudCenter[0];
  const foy = py - cloudCenter[1];
  const foz = pz - cloudCenter[2];
  const tSec = nowMs / 1000;

  let bestMask = 0;
  let bestSolid = 0;
  let bestRim = 0;
  let rimR = 0;
  let rimG = 0;
  let rimB = 0;

  for (const volume of volumes) {
    if (volume.radius <= 1e-6 || volume.strength <= 1e-6) continue;
    const dx = px - volume.origin[0];
    const dy = py - volume.origin[1];
    const dz = pz - volume.origin[2];
    const distance = Math.hypot(dx, dy, dz);
    let adjustedRadius = volume.radius;
    if (edgeAmount > 1e-6 && fog && distance < volume.radius * 1.5) {
      const edge = signedEdgeNoise(
        fox,
        foy,
        foz,
        fog.scale,
        tSec,
        (volume.fogSeed ^ 0x9e3779b9) >>> 0,
      );
      adjustedRadius *= Math.max(0.1, 1 + edge * 0.22 * edgeAmount);
    }
    const proximity = breathAreaInfluenceAt(
      [px, py, pz],
      {
        origin: volume.origin,
        radius: adjustedRadius,
        falloffExponent: 1,
      },
    );
    const influence =
      fall <= 0 ? (proximity > 0 ? 1 : 0) : Math.pow(proximity, fall);
    if (influence > 0) {
      const solid = volume.strength * influence;
      if (solid > bestSolid) bestSolid = solid;
      let densityBlend = 1;
      if (amount > 0 && fog) {
        const density = fogDensity(
          fox,
          foy,
          foz,
          fog.scale,
          fog.contrast,
          tSec,
          volume.fogSeed,
        );
        densityBlend = 1 + amount * (density - 1);
      }
      const mask = solid * densityBlend;
      if (mask > bestMask) bestMask = mask;
    }

    if (thick > 1e-6) {
      const shell = clamp01(
        1 - Math.abs(distance - adjustedRadius) / thick,
      );
      const rim = volume.strength * shell;
      if (rim > bestRim) {
        bestRim = rim;
        const color = hexToVec3(volume.color);
        rimR = color[0];
        rimG = color[1];
        rimB = color[2];
      }
    }
  }

  return {
    mask: clamp01(bestMask),
    solid: clamp01(bestSolid),
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
