import type { EllipsoidParams, LightningParams } from "../state";
import { applyCloudTransform, type CloudTransform } from "../scene/cloudTransform";
import { hexToVec3 } from "./shade";

export interface BoltStrike {
  bornMs: number;
  durationMs: number;
  /** Flat [x0,y0,z0, x1,y1,z1, ...] world-space bolt polyline. */
  path: Float32Array;
  color: [number, number, number];
  /** Randomised sub-flash offsets in [0,1] within the flash window. */
  subOffsets: number[];
  /** Sampled per-strike intensity (from `intensityRange`). */
  intensity: number;
  /** Radius (m) at strike time (copied from `boltRadius`). */
  radius: number;
}

function sampleRange(range: [number, number]): number {
  const lo = Math.min(range[0], range[1]);
  const hi = Math.max(range[0], range[1]);
  if (hi <= lo) return lo;
  return lo + Math.random() * (hi - lo);
}

function rand(): number {
  return Math.random();
}

/**
 * Sample a random point within the ellipsoid's inscribed volume. Uses
 * rejection sampling in the unit sphere then scales by (rx, ry, rz).
 */
function samplePointInEllipsoid(
  ellipsoid: EllipsoidParams,
  spanScale: number,
): [number, number, number] {
  for (let attempts = 0; attempts < 16; attempts++) {
    const x = rand() * 2 - 1;
    const y = rand() * 2 - 1;
    const z = rand() * 2 - 1;
    if (x * x + y * y + z * z <= 1) {
      return [
        x * ellipsoid.rx * spanScale,
        y * ellipsoid.ry * spanScale,
        z * ellipsoid.rz * spanScale,
      ];
    }
  }
  return [0, 0, 0];
}

/**
 * Generate a jagged 3D polyline between two random endpoints. Midpoints
 * are perturbed laterally (perpendicular to the endpoint-endpoint axis)
 * for a lightning-like silhouette.
 */
function sampleBoltPath(
  ellipsoid: EllipsoidParams,
  transform: CloudTransform,
  segments: number,
  jitter: number,
  spanScale: number,
  minSpanScale: number,
): Float32Array {
  const meanR = (ellipsoid.rx + ellipsoid.ry + ellipsoid.rz) / 3;
  const minLen = Math.max(0, minSpanScale) * meanR;
  let a = samplePointInEllipsoid(ellipsoid, spanScale);
  let b = samplePointInEllipsoid(ellipsoid, spanScale);
  // Resample until the endpoints are at least `minLen` apart so bolts
  // don't degenerate into a tiny spark. Bounded retries so a degenerate
  // ellipsoid or overly-strict minimum can't spin forever.
  for (let tries = 0; tries < 12; tries++) {
    const ddx = b[0] - a[0];
    const ddy = b[1] - a[1];
    const ddz = b[2] - a[2];
    if (ddx * ddx + ddy * ddy + ddz * ddz >= minLen * minLen) break;
    a = samplePointInEllipsoid(ellipsoid, spanScale);
    b = samplePointInEllipsoid(ellipsoid, spanScale);
  }
  const ax = a[0];
  const ay = a[1];
  const az = a[2];
  const bx = b[0];
  const by = b[1];
  const bz = b[2];
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  // Pick an arbitrary vector not parallel to d, then build two lateral basis
  // vectors u, v orthogonal to d for perpendicular jitter.
  const nx = dx / len;
  const ny = dy / len;
  const nz = dz / len;
  const helper: [number, number, number] =
    Math.abs(ny) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const ux = ny * helper[2] - nz * helper[1];
  const uy = nz * helper[0] - nx * helper[2];
  const uz = nx * helper[1] - ny * helper[0];
  const uLen = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
  const ux2 = ux / uLen;
  const uy2 = uy / uLen;
  const uz2 = uz / uLen;
  const vx = ny * uz2 - nz * uy2;
  const vy = nz * ux2 - nx * uz2;
  const vz = nx * uy2 - ny * ux2;

  const count = Math.max(2, Math.floor(segments) + 1);
  const path = new Float32Array(count * 3);
  // High-frequency jaggedness (per-vertex noise).
  const lateral = jitter * len * 0.35;
  // Low-frequency wander so the bolt curves left/right/up/down along
  // its length rather than just zig-zagging along a straight axis.
  // Random amplitude, phase and 1..3 half-waves per bolt in each of
  // the two lateral basis directions.
  const waveAmpU = (rand() * 2 - 1) * jitter * len * 0.6;
  const waveAmpV = (rand() * 2 - 1) * jitter * len * 0.6;
  const waveFreqU = 1 + Math.floor(rand() * 3);
  const waveFreqV = 1 + Math.floor(rand() * 3);
  const wavePhaseU = rand() * Math.PI * 2;
  const wavePhaseV = rand() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    // Weight everything with sin(pi t) so endpoints stay anchored.
    const anchor = Math.sin(t * Math.PI);
    const w = anchor * lateral;
    const jitU = (rand() * 2 - 1) * w;
    const jitV = (rand() * 2 - 1) * w;
    const waveU = Math.sin(t * Math.PI * waveFreqU + wavePhaseU) * waveAmpU * anchor;
    const waveV = Math.sin(t * Math.PI * waveFreqV + wavePhaseV) * waveAmpV * anchor;
    const ru = jitU + waveU;
    const rv = jitV + waveV;
    const px = ax + dx * t + ux2 * ru + vx * rv;
    const py = ay + dy * t + uy2 * ru + vy * rv;
    const pz = az + dz * t + uz2 * ru + vz * rv;
    const world = applyCloudTransform([px, py, pz], transform);
    const idx = i * 3;
    path[idx] = world[0];
    path[idx + 1] = world[1];
    path[idx + 2] = world[2];
  }
  return path;
}

/**
 * Squared distance from point p to segment (a, b). Returns 0 if a == b.
 */
function pointSegmentDistSq(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;
  const ab2 = abx * abx + aby * aby + abz * abz;
  const t = ab2 > 1e-9 ? (apx * abx + apy * aby + apz * abz) / ab2 : 0;
  const tc = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + abx * tc - px;
  const cy = ay + aby * tc - py;
  const cz = az + abz * tc - pz;
  return cx * cx + cy * cy + cz * cz;
}

/**
 * Flash envelope for a strike. Rises fast to a peak then decays, with a
 * couple of secondary flickers within the window driven by subOffsets.
 * Returns a value in [0, ~1.2] which is clamped by the caller.
 */
/**
 * Fraction of the bolt polyline that is "lit" at `age` ms into the
 * flash. The tip races from the origin to the destination during the
 * first ~25% of the flash window, then stays fully deployed for the
 * remainder. Returns a value in [0, 1].
 */
export function boltTravelHead(age: number, durationMs: number): number {
  if (age < 0) return 0;
  const travelMs = Math.max(30, durationMs * 0.25);
  return Math.min(1, age / travelMs);
}

function envelope(
  age: number,
  durationMs: number,
  subOffsets: number[],
): number {
  if (age < 0 || age > durationMs) return 0;
  const u = age / durationMs;
  // Main pulse: fast attack (~10% of window) then exponential decay.
  const attack = 0.1;
  const main =
    u < attack
      ? u / attack
      : Math.exp(-4 * (u - attack) / (1 - attack));
  let sub = 0;
  for (const off of subOffsets) {
    const w = 0.12; // width of each sub pulse relative to full window
    const d = u - off;
    if (d > -w && d < w) {
      sub += Math.max(0, 1 - Math.abs(d) / w) * 0.7;
    }
  }
  return main + sub;
}

/**
 * Stateful controller that maintains active strikes and produces a
 * per-LED additive RGB contribution each frame.
 */
export class LightningController {
  private strikes: BoltStrike[] = [];
  private lastUpdateMs = 0;

  getStrikes(): BoltStrike[] {
    return this.strikes;
  }

  /** Timestamp of the last `update` tick; 0 before the first tick. */
  getLastUpdateMs(): number {
    return this.lastUpdateMs;
  }

  update(
    nowMs: number,
    params: LightningParams,
    ellipsoid: EllipsoidParams,
    transform: CloudTransform,
  ): void {
    // Prune expired strikes.
    if (this.strikes.length > 0) {
      this.strikes = this.strikes.filter(
        (s) => nowMs - s.bornMs <= s.durationMs,
      );
    }

    if (this.lastUpdateMs === 0) this.lastUpdateMs = nowMs;
    const dtMs = Math.max(0, nowMs - this.lastUpdateMs);
    this.lastUpdateMs = nowMs;

    if (!params.enabled) return;

    // Expected strikes in dt from a Poisson process at strikesPerMinute.
    const rate = Math.max(0, params.strikesPerMinute) / 60000;
    const expected = rate * dtMs;
    // Cheap approximation: probability per frame ~ expected (small values).
    // For higher rates we may spawn multiple per frame.
    let toSpawn = 0;
    let remaining = expected;
    while (remaining > 1) {
      toSpawn += 1;
      remaining -= 1;
    }
    if (rand() < remaining) toSpawn += 1;

    for (let i = 0; i < toSpawn; i++) {
      // Per-strike parameter sampling: each strike freezes a random
      // draw from every configured range so the strike keeps stable
      // values through its whole flash envelope.
      const jitter = Math.max(0, sampleRange(params.boltJitterRange));
      const duration = Math.max(30, sampleRange(params.flashDurationMsRange));
      const intensity = Math.max(0, sampleRange(params.intensityRange));
      const radius = Math.max(0.01, params.boltRadius);
      const path = sampleBoltPath(
        ellipsoid,
        transform,
        Math.max(2, Math.floor(params.boltSegments)),
        jitter,
        Math.max(0.05, Math.min(1, params.spanScale)),
        Math.max(0, Math.min(2, params.minSpanScale ?? 0)),
      );
      const subs: number[] = [];
      const subCount = Math.max(0, Math.floor(params.subFlashes));
      for (let k = 0; k < subCount; k++) {
        subs.push(0.15 + rand() * 0.7);
      }
      this.strikes.push({
        bornMs: nowMs,
        durationMs: duration,
        path,
        color: hexToVec3(params.color),
        subOffsets: subs,
        intensity,
        radius,
      });
    }
  }

  /**
   * Additively write per-LED RGB contribution into `out`.
   * Also zeroes `out` first so callers don't have to.
   */
  contribute(
    positions: Float32Array,
    n: number,
    out: Float32Array,
    nowMs: number,
    params: LightningParams,
  ): void {
    out.fill(0);
    if (!params.enabled || this.strikes.length === 0) return;

    for (const s of this.strikes) {
      const age = nowMs - s.bornMs;
      if (age < 0 || age > s.durationMs) continue;
      // Per-strike radius + intensity (sampled at birth from ranges).
      const radius = Math.max(0.01, s.radius);
      const rFull = radius;
      const rFade = radius * 2;
      const rFullSq = rFull * rFull;
      const rFadeSq = rFade * rFade;
      const path = s.path;
      const totalSegs = path.length / 3 - 1;
      if (totalSegs <= 0) continue;

      // Progressive travel: the tip races along the polyline during the
      // first ~25% of the flash. Each segment "ignites" as the tip enters
      // it and then fades independently until the strike expires. This
      // gives the visual of a spark travelling with a fading trail.
      const travelMs = Math.max(30, s.durationMs * 0.25);
      const segTravel = travelMs / totalSegs;

      // Sub-flashes act as a global brightness pulse on the whole
      // currently-lit channel (all lit segments brighten together).
      let subBump = 0;
      const u = age / s.durationMs;
      for (const off of s.subOffsets) {
        const w = 0.12;
        const d = u - off;
        if (d > -w && d < w) {
          subBump += Math.max(0, 1 - Math.abs(d) / w) * 0.7;
        }
      }
      const brightness = 1 + subBump;
      const strikeGain = Math.max(0, s.intensity) * brightness;
      const cr0 = s.color[0] * strikeGain;
      const cg0 = s.color[1] * strikeGain;
      const cb0 = s.color[2] * strikeGain;

      // Precompute per-segment envelope so the inner LED loop only does
      // distance + multiply-add work.
      const litSegs =
        Math.min(totalSegs, Math.ceil(age / Math.max(1e-3, segTravel)));
      if (litSegs <= 0) continue;
      const segEnv = new Float32Array(litSegs);
      const attack = 0.06;
      for (let seg = 0; seg < litSegs; seg++) {
        const arrival = seg * segTravel; // tip enters this segment
        const localAge = age - arrival;
        const localLife = Math.max(1, s.durationMs - arrival);
        const lu = localAge / localLife;
        if (lu < 0 || lu > 1) {
          segEnv[seg] = 0;
          continue;
        }
        segEnv[seg] =
          lu < attack
            ? lu / attack
            : Math.exp(-3.5 * (lu - attack) / (1 - attack));
      }

      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        const px = positions[i3];
        const py = positions[i3 + 1];
        const pz = positions[i3 + 2];
        // Accumulate contributions from every lit segment so overlapping
        // segments (bends, jitter loops) produce a bright, continuous
        // channel rather than intermittent gaps.
        let acc = 0;
        for (let seg = 0; seg < litSegs; seg++) {
          const e = segEnv[seg];
          if (e <= 1e-3) continue;
          const a3 = seg * 3;
          const b3 = a3 + 3;
          const d2 = pointSegmentDistSq(
            px, py, pz,
            path[a3], path[a3 + 1], path[a3 + 2],
            path[b3], path[b3 + 1], path[b3 + 2],
          );
          if (d2 >= rFadeSq) continue;
          let prox: number;
          if (d2 <= rFullSq) prox = 1;
          else {
            const d = Math.sqrt(d2);
            prox = 1 - (d - rFull) / (rFade - rFull);
          }
          acc += e * prox;
        }
        if (acc <= 0) continue;
        // Soft clamp so heavy overlap doesn't blow past ~1 core intensity.
        const k = acc > 1 ? 1 + Math.log(acc) * 0.35 : acc;
        out[i3] += cr0 * k;
        out[i3 + 1] += cg0 * k;
        out[i3 + 2] += cb0 * k;
      }
    }
  }

  /**
   * Envelope value at `nowMs` for a given strike, used for 3D visualisation
   * opacity so the drawn bolt fades along the same curve as the LEDs.
   */
  strikeEnvelope(strike: BoltStrike, nowMs: number): number {
    const age = nowMs - strike.bornMs;
    return envelope(age, strike.durationMs, strike.subOffsets);
  }
}

/**
 * Module-scoped controller shared between the LED shading pipeline and
 * the 3D bolt visualisation so both see the same active strikes.
 */
export const sharedLightningController = new LightningController();
