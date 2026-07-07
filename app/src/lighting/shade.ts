import type { Vec3 } from "../state";

export interface ShadeLightAmbient {
  type: "ambient";
  color: Vec3;
  intensity: number;
}

export interface ShadeLightDirectional {
  type: "directional";
  /** Unit-length direction *from the LED to the light*. */
  direction: Vec3;
  color: Vec3;
  intensity: number;
  /**
   * Angular spread of the light in [0, 1]. See `DirectionalLightParams.spread`
   * for semantics. 0 = narrow / flat Lambert, 1 = broad / half-Lambert wrap.
   */
  spread: number;
}

export interface ShadeLightPoint {
  type: "point";
  position: Vec3;
  color: Vec3;
  intensity: number;
  /**
   * Distance decay exponent, matching three.js `<pointLight>.decay`:
   * attenuation ~ 1 / max(d^decay, eps). Use `2` for physical inverse
   * square.
   */
  decay: number;
  /**
   * Cutoff distance (like three.js `<pointLight>.distance`). When > 0
   * the attenuation is multiplied by a smooth window that reaches 0 at
   * this distance. Set to 0 for unbounded.
   */
  distance: number;
  /** Same semantics as the directional light's `spread`. */
  spread: number;
}

export type ShadeLight =
  | ShadeLightAmbient
  | ShadeLightDirectional
  | ShadeLightPoint;

/**
 * Cosine exponent at `spread = 0` — the tightest the spot beam can get.
 * Mapped exponentially with `N(β) = NARROW_EXPONENT^(1 − β)` so the
 * middle of the slider feels like a moderate spot rather than already
 * extreme. Half-angles (where direct = 0.5):
 *   N =   1 (β = 1)   → 60°    (linear Lambert, broad)
 *   N =  ≈11 (β = 0.5) → ~23°   (clearly focused but still wide)
 *   N = 128 (β = 0)   → ~6°    (laser-tight spotlight)
 */
const NARROW_EXPONENT = 128;

/**
 * Per-LED irradiance from a single light, parameterised by the light's
 * angular spread (β) and the cloud's opacity (α).
 *
 *   N(β)      = NARROW_EXPONENT^(1 − β)                   // 1 … N_max, exponential
 *   direct(c) = max(0, c)^N(β)                            // Phong-style direct lobe
 *   wrap(c)   = (1 + c) / 2 − max(0, c)                   // ≥ 0, peaks at c = 0
 *   shade(c, β, α) = direct(c) + β · (1 − α) · wrap(c)
 *
 * Where c = n · ℓ̂ is the cosine of the angle between the LED's outward
 * normal and the direction to the light.
 *
 * Interpretation:
 *   - `direct` is the focused part of the light: a broad source spreads
 *     it over the whole front hemisphere with a smooth Lambert falloff,
 *     while a narrow source concentrates it into a tight forward cone.
 *     The cosine exponent N(β) controls how concentrated. Exponential
 *     mapping makes the slider feel uniform: each step roughly halves
 *     the lit half-angle.
 *   - `wrap` is the *extra* light a broad source contributes by wrapping
 *     around the LED's outward hemisphere (sky-like illumination reaching
 *     side and back LEDs). It scales with both broadness (β) and cloud
 *     transparency (1 − α): a sharp light has no wrap, and an opaque
 *     cloud blocks the wrap that would otherwise reach the back.
 *
 * Corners:
 *   shade(c, 0, α)  = max(0, c)^N_max               // narrow spot, any cloud
 *   shade(c, 1, 0)  = (1 + c) / 2                   // broad, transparent (half-Lambert)
 *   shade(c, 1, 1)  = max(0, c)                     // broad, opaque (flat Lambert)
 *   shade(c, 1, α)  = α · max(0, c) + (1 − α) · (1 + c) / 2   // = old (β = 1) formula
 *
 * So setting `β = 1` recovers the previous model exactly — existing
 * presets are visually unchanged.
 */
function shade(c: number, spread: number, alpha: number): number {
  const cPos = c > 0 ? c : 0;
  const n = spread >= 1 ? 1 : Math.pow(NARROW_EXPONENT, 1 - spread);
  const direct = n === 1 ? cPos : Math.pow(cPos, n);
  const wrap = (1 + c) * 0.5 - cPos;
  const v = direct + spread * (1 - alpha) * wrap;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Compress highlights while preserving hue/chroma.
 *
 * Per-channel clamping (`min(1, c)`) tends to bleach warm sunsets toward
 * white whenever multiple lights stack above 1.0. We instead normalize by
 * the brightest channel first (so RGB ratios stay intact), then apply a
 * gentle Reinhard roll-off. This keeps oranges/reds visibly saturated at
 * high brightness.
 */
function toneMapPreserveHue(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const peak = Math.max(r, g, b);
  if (peak <= 0) return [0, 0, 0];
  const scale = peak > 1 ? 1 / peak : 1;
  const rn = r * scale;
  const gn = g * scale;
  const bn = b * scale;
  const exposure = 1.35;
  const rr = 1 - Math.exp(-rn * exposure);
  const gg = 1 - Math.exp(-gn * exposure);
  const bb = 1 - Math.exp(-bn * exposure);
  return [clamp01(rr), clamp01(gg), clamp01(bb)];
}

/**
 * Shade `n` LEDs from a flat positions/normals buffer.
 *
 * - `positions` and `normals` are tightly-packed Float32Arrays of length n*3.
 * - `outBytes` is a Uint8Array of length n*3 receiving 0-255 RGB values
 *   (this is what we forward to WLED).
 * - `outFloats` is an optional Float32Array of length n*3 that, if provided,
 *   receives linear [0,1] RGB used to drive the on-screen InstancedMesh
 *   colors so what you see matches what's sent.
 */
export function shadeLeds(
  positions: Float32Array,
  normals: Float32Array,
  n: number,
  lights: ShadeLight[],
  cloudOpacity: number,
  outBytes: Uint8Array,
  outFloats?: Float32Array,
  options?: { hemisphereAverage?: boolean; hemisphereFocusExponent?: number },
): void {
  const hemisphereAverage = options?.hemisphereAverage ?? false;
  const focusExp = Math.max(0, options?.hemisphereFocusExponent ?? 0);
  // Deterministic, near-uniform-area local +Z hemisphere samples
  // (camera-independent). This avoids pole-biased averages.
  const HEMI_SAMPLES = buildUniformHemisphereSamples(32);

  for (let i = 0; i < n; i++) {
    const i3 = i * 3;
    const px = positions[i3];
    const py = positions[i3 + 1];
    const pz = positions[i3 + 2];
    const nx = normals[i3];
    const ny = normals[i3 + 1];
    const nz = normals[i3 + 2];

    let r = 0;
    let g = 0;
    let b = 0;

    // Build an orthonormal basis around the sensor axis `n` when averaging.
    let tx = 1;
    let ty = 0;
    let tz = 0;
    if (hemisphereAverage) {
      // Pick a helper axis least aligned with n to avoid degeneracy.
      const ax = Math.abs(nx) < 0.7 ? 1 : 0;
      const ay = Math.abs(nx) < 0.7 ? 0 : 1;
      const az = 0;
      // t = normalize(a x n)
      tx = ay * nz - az * ny;
      ty = az * nx - ax * nz;
      tz = ax * ny - ay * nx;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
    }
    // b = n x t
    const bx = ny * tz - nz * ty;
    const by = nz * tx - nx * tz;
    const bz = nx * ty - ny * tx;

    for (let li = 0; li < lights.length; li++) {
      const L = lights[li];
      if (L.type === "ambient") {
        r += L.color[0] * L.intensity;
        g += L.color[1] * L.intensity;
        b += L.color[2] * L.intensity;
      } else if (L.type === "directional") {
        let k: number;
        if (!hemisphereAverage) {
          const c =
            nx * L.direction[0] + ny * L.direction[1] + nz * L.direction[2];
          k = L.intensity * shade(c, L.spread, cloudOpacity);
        } else {
          let accum = 0;
          let wsum = 0;
          for (let si = 0; si < HEMI_SAMPLES.length; si++) {
            const s = HEMI_SAMPLES[si];
            const w = focusExp > 0 ? Math.pow(s[2], focusExp) : 1;
            // local sample (x,y,z) mapped to world: x*t + y*b + z*n
            const sx = s[0] * tx + s[1] * bx + s[2] * nx;
            const sy = s[0] * ty + s[1] * by + s[2] * ny;
            const sz = s[0] * tz + s[1] * bz + s[2] * nz;
            const c = sx * L.direction[0] + sy * L.direction[1] + sz * L.direction[2];
            accum += shade(c, L.spread, cloudOpacity) * w;
            wsum += w;
          }
          k = L.intensity * accum / Math.max(wsum, 1e-6);
        }
        r += L.color[0] * k;
        g += L.color[1] * k;
        b += L.color[2] * k;
      } else {
        const dx = L.position[0] - px;
        const dy = L.position[1] - py;
        const dz = L.position[2] - pz;
        const dist = Math.hypot(dx, dy, dz) || 1e-6;
        const invDist = 1 / dist;
        const lx = dx * invDist;
        const ly = dy * invDist;
        const lz = dz * invDist;
        // Match three.js physically-correct point-light attenuation:
        //   distanceFalloff = 1 / max(d^decay, 0.01)
        //   if (cutoff > 0) *= pow2(saturate(1 - pow4(d / cutoff)))
        const distFall = 1 / Math.max(Math.pow(dist, L.decay), 0.01);
        let window = 1;
        if (L.distance > 0) {
          const t = dist / L.distance;
          const s = 1 - Math.min(1, t * t * t * t);
          window = s * s;
        }
        const atten = distFall * window;
        let k: number;
        if (!hemisphereAverage) {
          const c = nx * lx + ny * ly + nz * lz;
          k = L.intensity * shade(c, L.spread, cloudOpacity) * atten;
        } else {
          let accum = 0;
          let wsum = 0;
          for (let si = 0; si < HEMI_SAMPLES.length; si++) {
            const s = HEMI_SAMPLES[si];
            const w = focusExp > 0 ? Math.pow(s[2], focusExp) : 1;
            const sx = s[0] * tx + s[1] * bx + s[2] * nx;
            const sy = s[0] * ty + s[1] * by + s[2] * ny;
            const sz = s[0] * tz + s[1] * bz + s[2] * nz;
            const c = sx * lx + sy * ly + sz * lz;
            accum += shade(c, L.spread, cloudOpacity) * w;
            wsum += w;
          }
          k = L.intensity * (accum / Math.max(wsum, 1e-6)) * atten;
        }
        r += L.color[0] * k;
        g += L.color[1] * k;
        b += L.color[2] * k;
      }
    }

    const [cr, cg, cb] = toneMapPreserveHue(r, g, b);

    if (outFloats) {
      outFloats[i3] = cr;
      outFloats[i3 + 1] = cg;
      outFloats[i3 + 2] = cb;
    }

    outBytes[i3] = (cr * 255 + 0.5) | 0;
    outBytes[i3 + 1] = (cg * 255 + 0.5) | 0;
    outBytes[i3 + 2] = (cb * 255 + 0.5) | 0;
  }
}

function buildUniformHemisphereSamples(count: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const ga = Math.PI * (3 - Math.sqrt(5)); // golden angle
  for (let i = 0; i < count; i++) {
    // Uniform-in-area over hemisphere => z is uniform in [0,1].
    const z = (i + 0.5) / count;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const a = ga * i;
    out.push([Math.cos(a) * r, Math.sin(a) * r, z]);
  }
  return out;
}

/**
 * Parse a hex color string like "#rrggbb" or "#rgb" to a Vec3 in [0,1].
 */
export function hexToVec3(hex: string): Vec3 {
  const h = hex.replace("#", "");
  let r: number, g: number, b: number;
  if (h.length === 3) {
    r = parseInt(h[0] + h[0], 16);
    g = parseInt(h[1] + h[1], 16);
    b = parseInt(h[2] + h[2], 16);
  } else {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  }
  return [r / 255, g / 255, b / 255];
}
