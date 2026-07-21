/**
 * Tiny deterministic 3D value noise + fBm for volumetric fog.
 * No external deps — cheap enough for per-LED sampling each frame.
 * Pass a per-wave `seed` so each breath looks different.
 */

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function fade(t: number): number {
  // Smoothstep quintic for C2 continuity.
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Integer hash → [0, 1). `seed` offsets the lattice so fields differ. */
function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let n =
    ix * 374761393 +
    iy * 668265263 +
    iz * 2147483647 +
    (seed | 0) * 1442695041;
  n = (n ^ (n >> 13)) * 1274126177;
  n = n ^ (n >> 16);
  return (n >>> 0) / 4294967296;
}

/** Trilinear value noise in [0, 1]. */
export function valueNoise3(
  x: number,
  y: number,
  z: number,
  seed = 0,
): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const fz = fade(z - z0);

  const n000 = hash3(x0, y0, z0, seed);
  const n100 = hash3(x0 + 1, y0, z0, seed);
  const n010 = hash3(x0, y0 + 1, z0, seed);
  const n110 = hash3(x0 + 1, y0 + 1, z0, seed);
  const n001 = hash3(x0, y0, z0 + 1, seed);
  const n101 = hash3(x0 + 1, y0, z0 + 1, seed);
  const n011 = hash3(x0, y0 + 1, z0 + 1, seed);
  const n111 = hash3(x0 + 1, y0 + 1, z0 + 1, seed);

  const nx00 = lerp(n000, n100, fx);
  const nx10 = lerp(n010, n110, fx);
  const nx01 = lerp(n001, n101, fx);
  const nx11 = lerp(n011, n111, fx);
  const nxy0 = lerp(nx00, nx10, fy);
  const nxy1 = lerp(nx01, nx11, fy);
  return lerp(nxy0, nxy1, fz);
}

/**
 * Fractional Brownian motion — sum of octaves of value noise.
 * Returns roughly [0, 1] (slightly less after amplitude decay).
 */
export function fBm3(
  x: number,
  y: number,
  z: number,
  octaves = 3,
  seed = 0,
): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  const n = Math.max(1, Math.min(6, Math.floor(octaves)));
  for (let i = 0; i < n; i++) {
    sum += amp * valueNoise3(x * freq, y * freq, z * freq, seed + i * 1013);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

/**
 * Fog density in [0, 1] from local-space fBm, with contrast remapping.
 * `contrast` > 1 pushes midtones apart (sharper blobs); 1 = linear.
 * `seed` selects a unique fog field (new seed per breath wave).
 */
export function fogDensity(
  x: number,
  y: number,
  z: number,
  scale: number,
  contrast: number,
  timeSec = 0,
  seed = 0,
): number {
  const s = Math.max(0.05, scale);
  // Slow drift so fog feels alive while the clock runs; still when paused.
  const drift = timeSec * 0.08;
  // Seed also offsets sample origin so fields don't just rehash the same lattice.
  const ox = (seed & 1023) * 0.017;
  const oy = ((seed >> 10) & 1023) * 0.019;
  const oz = ((seed >> 20) & 1023) * 0.023;
  const n = fBm3(
    x * s + drift + ox,
    y * s + drift * 0.7 + oy,
    z * s - drift * 0.4 + oz,
    3,
    seed,
  );
  const c = Math.max(0.05, contrast);
  // Remap around 0.5 with contrast: denser peaks, emptier troughs.
  const centered = (n - 0.5) * c + 0.5;
  return clamp01(centered);
}
