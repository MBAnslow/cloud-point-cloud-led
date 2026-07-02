import type { BreathParams } from "../state";

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function easeInOutSine(t: number): number {
  const x = clamp01(t);
  return 0.5 - 0.5 * Math.cos(Math.PI * x);
}

function easeOutCubic(t: number): number {
  const x = clamp01(t);
  const inv = 1 - x;
  return 1 - inv * inv * inv;
}

export interface BreathSample {
  /** Overall inhale/exhale envelope in [0,1]. */
  level: number;
  /** Non-zero only during inhale; tracks inbreath pull strength in [0,1]. */
  inhaleIntensity: number;
  /** Non-zero only during exhale; tracks outbreath strength in [0,1]. */
  exhaleIntensity: number;
  phase: "inhale" | "holdPeak" | "exhale" | "holdTrough";
}

/**
 * Breath cycle progress in [0,1], shaped with separate inhale/exhale and
 * explicit holds at peak/trough. Exhale is expected to be longer in normal
 * settings, but all segment durations are fully user-controlled.
 */
export function sampleBreathAt(params: BreathParams, nowMs: number): BreathSample {
  const inhaleMs = Math.max(0, params.inhaleSeconds) * 1000;
  const holdPeakMs = Math.max(0, params.holdPeakSeconds) * 1000;
  const exhaleMs = Math.max(0, params.exhaleSeconds) * 1000;
  const holdTroughMs = Math.max(0, params.holdTroughSeconds) * 1000;
  const cycleMs = inhaleMs + holdPeakMs + exhaleMs + holdTroughMs;
  if (cycleMs <= 1e-6) {
    return {
      level: 0,
      inhaleIntensity: 0,
      exhaleIntensity: 0,
      phase: "holdTrough",
    };
  }

  let t = nowMs % cycleMs;
  if (t < 0) t += cycleMs;

  if (t < inhaleMs) {
    // Inhale: smooth physiological rise (not linear).
    return {
      level: inhaleMs > 0 ? easeInOutSine(t / inhaleMs) : 1,
      inhaleIntensity: inhaleMs > 0 ? easeInOutSine(t / inhaleMs) : 1,
      exhaleIntensity: 0,
      phase: "inhale",
    };
  }
  t -= inhaleMs;
  if (t < holdPeakMs) {
    return {
      level: 1,
      inhaleIntensity: 0,
      exhaleIntensity: 0,
      phase: "holdPeak",
    };
  }

  t -= holdPeakMs;
  if (t < exhaleMs) {
    const exhaleT = exhaleMs > 0 ? clamp01(t / exhaleMs) : 1;
    // Exhale: stronger early release that eases into the trough.
    return {
      level: exhaleMs > 0 ? clamp01(1 - easeOutCubic(exhaleT)) : 0,
      inhaleIntensity: 0,
      exhaleIntensity: exhaleMs > 0 ? easeOutCubic(exhaleT) : 1,
      phase: "exhale",
    };
  }
  return {
    level: 0,
    inhaleIntensity: 0,
    exhaleIntensity: 0,
    phase: "holdTrough",
  };
}

export function breathLevelAt(params: BreathParams, nowMs: number): number {
  return sampleBreathAt(params, nowMs).level;
}

