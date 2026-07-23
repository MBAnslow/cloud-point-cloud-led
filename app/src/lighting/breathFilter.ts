/**
 * Per-LED breath-filter memory: follows breath while the wave covers an
 * LED, then clears on a per-LED timer after release. `decayMaxSeconds`
 * is a hard ceiling for the slowest LEDs; spatial noise shortens hold
 * (noise=1 → instant clear, noise=0 → full decay max).
 */

import type { BreathFilterParams } from "../state";
import { fBm3, valueNoise3 } from "./noise3d";

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

/** Mask below this = wave has left this LED; release timer starts. */
const MASK_ACTIVE = 0.04;

/**
 * Hold after release before hard-clear.
 * noise=0 → full decayMaxSeconds (linger)
 * noise=1 → 0 (clear on the next frame)
 */
function holdTimeSec(noise: number, decayMaxSeconds: number): number {
  const n = clamp01(noise);
  const maxSec = Math.max(0.1, Math.min(5, decayMaxSeconds));
  if (n >= 0.999) return 0;
  // Strong curve: mid noise still clears much faster than linger LEDs.
  return maxSec * Math.pow(1 - n, 2.5);
}

/**
 * Push raw [0,1] through contrast while keeping a usable grey range.
 * Low contrast ≈ soft midtones; high contrast ≈ stronger dark/bright
 * separation (still not forced binary-only, so show-noise has greys).
 */
function applyNoiseContrast(raw: number, contrast: number): number {
  const c = Math.max(0.1, Math.min(4, contrast));
  const t = (c - 0.1) / (4 - 0.1); // 0..1
  // Gain from ~1 (gentle) to ~6 (strong) — avoids crushing everything to 0.
  const gain = 1 + t * 5;
  return clamp01(0.5 + (raw - 0.5) * gain);
}

/**
 * Build per-LED decay noise in [0,1].
 * Samples on the unit direction from the origin so opposite sides of the
 * cloud get different values regardless of world scale.
 */
export function buildCooldownRates(
  positions: Float32Array,
  n: number,
  params: Pick<
    BreathFilterParams,
    "cooldownScale" | "cooldownContrast" | "seed"
  >,
  out?: Float32Array,
): Float32Array {
  const rates = out && out.length >= n ? out : new Float32Array(n);
  const scale = Math.max(0.05, params.cooldownScale);
  const contrast = Math.max(0.1, Math.min(4, params.cooldownContrast));
  const seed = params.seed | 0;

  const t = (contrast - 0.1) / (4 - 0.1);
  const octaves = 2 + Math.round(t * 4);

  const ox = (seed & 1023) * 0.031;
  const oy = ((seed >> 10) & 1023) * 0.037;
  const oz = ((seed >> 20) & 1023) * 0.023;

  for (let i = 0; i < n; i++) {
    const i3 = i * 3;
    const x = positions[i3];
    const y = positions[i3 + 1];
    const z = positions[i3 + 2];
    const len = Math.hypot(x, y, z);
    // Prefer unit direction; if at origin, fall back to index-based sample
    // so the field is never all zeros.
    let ux: number;
    let uy: number;
    let uz: number;
    if (len > 1e-6) {
      ux = (x / len) * scale * 4 + ox;
      uy = (y / len) * scale * 4 + oy;
      uz = (z / len) * scale * 4 + oz;
    } else {
      ux = i * 0.17 + ox;
      uy = i * 0.13 + oy;
      uz = i * 0.19 + oz;
    }
    const low = fBm3(ux, uy, uz, octaves, seed);
    const hi = valueNoise3(ux * 3.1, uy * 3.1, uz * 3.1, seed + 97);
    const raw = clamp01(low * 0.55 + hi * 0.45);
    rates[i] = applyNoiseContrast(raw, contrast);
  }
  return rates;
}

/**
 * While mask active: latch up to mask, reset release age.
 * Once released: decay toward threshold; hard-clear at hold time
 * (≤ decayMaxSeconds, shortened by noise).
 */
export function updateBreathFilterMemory(
  memory: Float32Array,
  releaseAgeSec: Float32Array,
  maskFloats: Float32Array,
  cooldownRates: Float32Array,
  n: number,
  threshold: number,
  decayMaxSeconds: number,
  dtSec: number,
): void {
  const floor = clamp01(threshold);
  const maxSec = Math.max(0.1, Math.min(5, decayMaxSeconds));
  const dt = Math.max(0, Math.min(0.1, dtSec));

  for (let i = 0; i < n; i++) {
    const i3 = i * 3;
    const mask = clamp01(
      (maskFloats[i3] + maskFloats[i3 + 1] + maskFloats[i3 + 2]) / 3,
    );
    let v = memory[i];
    if (!(v >= 0) || !Number.isFinite(v)) v = floor;
    let age = releaseAgeSec[i];
    if (!(age >= 0) || !Number.isFinite(age)) age = 0;

    if (mask > MASK_ACTIVE) {
      if (mask > v) v = mask;
      age = 0;
    } else if (v > floor + 1e-4 && dt > 0) {
      age += dt;
      const noise = clamp01(cooldownRates[i] ?? 0);
      const hold = holdTimeSec(noise, maxSec);
      if (hold <= 1e-4 || age >= hold) {
        v = floor;
        age = Math.max(age, hold);
      } else {
        const k = 4 / hold;
        v = floor + (v - floor) * Math.exp(-k * dt);
        if (v < floor + 0.01) v = floor;
      }
    } else {
      v = floor;
    }

    memory[i] = Math.max(floor, clamp01(v));
    releaseAgeSec[i] = age;
  }
}

/** Effective TOD gate for one LED. */
export function breathFilterGate(
  memory: number,
  threshold: number,
): number {
  return Math.max(clamp01(threshold), clamp01(memory));
}
