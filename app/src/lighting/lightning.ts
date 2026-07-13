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
): Float32Array {
  const a = samplePointInEllipsoid(ellipsoid, spanScale);
  const b = samplePointInEllipsoid(ellipsoid, spanScale);
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
      const path = sampleBoltPath(
        ellipsoid,
        transform,
        Math.max(2, Math.floor(params.boltSegments)),
        Math.max(0, params.boltJitter),
        Math.max(0.05, Math.min(1, params.spanScale)),
      );
      const subs: number[] = [];
      const subCount = Math.max(0, Math.floor(params.subFlashes));
      for (let k = 0; k < subCount; k++) {
        subs.push(0.15 + rand() * 0.7);
      }
      this.strikes.push({
        bornMs: nowMs,
        durationMs: Math.max(30, params.flashDurationMs),
        path,
        color: hexToVec3(params.color),
        subOffsets: subs,
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
    const radius = Math.max(0.01, params.boltRadius);
    const rFull = radius;
    const rFade = radius * 2;
    const rFullSq = rFull * rFull;
    const rFadeSq = rFade * rFade;
    const gain = Math.max(0, params.intensity);

    for (const s of this.strikes) {
      const age = nowMs - s.bornMs;
      const env = envelope(age, s.durationMs, s.subOffsets);
      if (env <= 0) continue;
      const scale = env * gain;
      const cr = s.color[0] * scale;
      const cg = s.color[1] * scale;
      const cb = s.color[2] * scale;
      const path = s.path;
      const totalSegs = path.length / 3 - 1;
      // Progressive travel: only the first `head` fraction of the
      // polyline emits light. LEDs beyond the tip get no contribution
      // yet, so a bolt visibly propagates rather than lighting the
      // whole path at once.
      const head = boltTravelHead(age, s.durationMs);
      const activeF = head * totalSegs;
      const fullSegs = Math.floor(activeF);
      const tipT = activeF - fullSegs;
      // Precompute tip endpoint by interpolating along the "current" segment.
      let tipX = 0, tipY = 0, tipZ = 0;
      if (fullSegs < totalSegs) {
        const a3 = fullSegs * 3;
        const b3 = a3 + 3;
        tipX = path[a3] + (path[b3] - path[a3]) * tipT;
        tipY = path[a3 + 1] + (path[b3 + 1] - path[a3 + 1]) * tipT;
        tipZ = path[a3 + 2] + (path[b3 + 2] - path[a3 + 2]) * tipT;
      }

      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        const px = positions[i3];
        const py = positions[i3 + 1];
        const pz = positions[i3 + 2];
        let minSq = Infinity;
        for (let seg = 0; seg < fullSegs; seg++) {
          const a3 = seg * 3;
          const b3 = a3 + 3;
          const d2 = pointSegmentDistSq(
            px, py, pz,
            path[a3], path[a3 + 1], path[a3 + 2],
            path[b3], path[b3 + 1], path[b3 + 2],
          );
          if (d2 < minSq) minSq = d2;
          if (minSq <= rFullSq) break;
        }
        // Partial trailing segment ending at the interpolated tip.
        if (fullSegs < totalSegs && tipT > 0 && minSq > rFullSq) {
          const a3 = fullSegs * 3;
          const d2 = pointSegmentDistSq(
            px, py, pz,
            path[a3], path[a3 + 1], path[a3 + 2],
            tipX, tipY, tipZ,
          );
          if (d2 < minSq) minSq = d2;
        }
        let prox: number;
        if (minSq <= rFullSq) prox = 1;
        else if (minSq >= rFadeSq) prox = 0;
        else {
          const d = Math.sqrt(minSq);
          const t = (d - rFull) / (rFade - rFull);
          prox = 1 - t;
        }
        if (prox <= 0) continue;
        out[i3] += cr * prox;
        out[i3 + 1] += cg * prox;
        out[i3 + 2] += cb * prox;
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
