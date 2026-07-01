import type { StartDirection, Vec3 } from "../state";
import { START_AXIS } from "../state";

export interface LedSample {
  /** World-space position of the LED on the ellipsoid surface (metres). */
  position: Vec3;
  /** Outward-pointing unit normal of the ellipsoid surface at this point. */
  normal: Vec3;
}

export interface SpiralParams {
  rx: number;
  ry: number;
  rz: number;
  count: number;
  turns: number;
  start: StartDirection;
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Build an orthonormal basis (u, v, w) where u is the "spiral axis" (pointing
 * from the centre to the start pole). v and w form the equatorial plane of
 * the spiral.
 */
function localFrame(u: Vec3): { u: Vec3; v: Vec3; w: Vec3 } {
  const ref: Vec3 = Math.abs(u[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const d = ref[0] * u[0] + ref[1] * u[1] + ref[2] * u[2];
  const v = normalize([
    ref[0] - d * u[0],
    ref[1] - d * u[1],
    ref[2] - d * u[2],
  ]);
  const w = cross(u, v);
  return { u, v, w };
}

/**
 * Spiral curve parameterised by t ∈ [0, 1].
 *
 * At t=0 the point sits near the start pole; at t=1 near the antipode.
 * The path is built on a unit sphere in the local (u, v, w) frame, then
 * scaled to the ellipsoid by multiplying each world component by the
 * corresponding semi-axis.
 *
 * The same maths is used for the dense oversampling pass (to estimate
 * arc-length) and for the final LED sample evaluation.
 */
function curveAt(
  t: number,
  turns: number,
  rx: number,
  ry: number,
  rz: number,
  u: Vec3,
  v: Vec3,
  w: Vec3,
): LedSample {
  const eps = 0.005;
  const phi = eps + t * (Math.PI - 2 * eps);
  const theta = t * turns * 2 * Math.PI;

  const sp = Math.sin(phi);
  const cp = Math.cos(phi);
  const ct = Math.cos(theta);
  const st = Math.sin(theta);

  const px = cp * u[0] + sp * (ct * v[0] + st * w[0]);
  const py = cp * u[1] + sp * (ct * v[1] + st * w[1]);
  const pz = cp * u[2] + sp * (ct * v[2] + st * w[2]);

  const x = rx * px;
  const y = ry * py;
  const z = rz * pz;

  const normal = normalize([px / rx, py / ry, pz / rz]);
  return { position: [x, y, z], normal };
}

/**
 * Generate LED samples along a spiral wrapped around an ellipsoid, starting
 * at the chosen cardinal pole and ending at the antipode, with the LEDs
 * **equidistant in 3D arc length**.
 *
 * Algorithm:
 *  1. Densely sample the parametric curve in t (K ≈ 32 × count + 256 points).
 *  2. Compute the cumulative chord length s_k between consecutive samples.
 *  3. For each LED index i ∈ [0, n-1] compute its target s = i × s_total/(n-1)
 *     and locate the bracketing segment in the prefix-sum table.
 *  4. Linearly interpolate t between the two bracket points, then evaluate
 *     the curve at that t to get the final position + normal.
 *
 * Chord-length approximation converges very quickly with K → arc length; for
 * a typical 120-LED strand with K ≈ 4096 the spacing error is well below the
 * physical bead spacing of any real WS281x strip.
 */
export function buildSpiral(p: SpiralParams): LedSample[] {
  const n = Math.max(2, Math.floor(p.count));
  const { u, v, w } = localFrame(START_AXIS[p.start]);
  const ax = p.rx;
  const ay = p.ry;
  const az = p.rz;

  // Dense oversampling for arc-length estimation.
  const K = Math.max(2048, n * 32 + 256);

  // Store positions of the dense samples in flat arrays and the cumulative
  // arc length up to each. cum[0] = 0.
  const xs = new Float64Array(K + 1);
  const ys = new Float64Array(K + 1);
  const zs = new Float64Array(K + 1);
  const cum = new Float64Array(K + 1);

  // Seed first sample.
  {
    const s0 = curveAt(0, p.turns, ax, ay, az, u, v, w);
    xs[0] = s0.position[0];
    ys[0] = s0.position[1];
    zs[0] = s0.position[2];
    cum[0] = 0;
  }

  for (let k = 1; k <= K; k++) {
    const t = k / K;
    const s = curveAt(t, p.turns, ax, ay, az, u, v, w);
    xs[k] = s.position[0];
    ys[k] = s.position[1];
    zs[k] = s.position[2];
    const dx = xs[k] - xs[k - 1];
    const dy = ys[k] - ys[k - 1];
    const dz = zs[k] - zs[k - 1];
    cum[k] = cum[k - 1] + Math.hypot(dx, dy, dz);
  }

  const total = cum[K];

  // Resample by arc length.
  const out: LedSample[] = new Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const target = (i / (n - 1)) * total;

    // Advance k while cum[k+1] <= target. cum is non-decreasing.
    while (k < K && cum[k + 1] < target) k++;

    // Now cum[k] <= target <= cum[k+1] (or we're at the end).
    let t: number;
    if (k >= K) {
      t = 1;
    } else {
      const segLen = cum[k + 1] - cum[k];
      const frac = segLen > 1e-12 ? (target - cum[k]) / segLen : 0;
      t = (k + frac) / K;
    }
    out[i] = curveAt(t, p.turns, ax, ay, az, u, v, w);
  }

  return out;
}
