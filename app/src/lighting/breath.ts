import type { BreathParams, BreathParticipant } from "../state";

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
  /** Lung fullness envelope in [0,1] over the whole cycle. */
  level: number;
  /** Inhale (fullness) driver in [0,1]. 0 = empty lungs, 1 = full lungs. */
  inhaleIntensity: number;
  /** Exhale (emptiness) driver in [0,1]. 0 = full lungs, 1 = empty lungs. */
  exhaleIntensity: number;
  phase: "inhale" | "holdPeak" | "exhale" | "holdTrough";
}

/**
 * Shared breath simulation clock. Advances only while breath is not
 * paused, so sampling, waves, and UI all freeze together. Safe to call
 * multiple times per frame — subsequent calls with the same `realNow`
 * add ~0 dt.
 */
let breathClockMs = 0;
let breathClockLastReal = performance.now();

export function tickBreathClock(realNow: number, paused: boolean): number {
  const dt = Math.max(0, realNow - breathClockLastReal);
  breathClockLastReal = realNow;
  if (!paused) breathClockMs += dt;
  return breathClockMs;
}

export function getBreathClockMs(): number {
  return breathClockMs;
}

/**
 * Jump the shared clock to a position within the cycle (or absolute ms).
 * Resets the real-time anchor so the next tick doesn't apply a huge dt.
 */
export function seekBreathClock(ms: number): void {
  breathClockMs = Math.max(0, ms);
  breathClockLastReal = performance.now();
}

export function breathCycleMs(params: BreathParams): number {
  return (
    Math.max(0, params.inhaleSeconds) * 1000 +
    Math.max(0, params.holdPeakSeconds) * 1000 +
    Math.max(0, params.exhaleSeconds) * 1000 +
    Math.max(0, params.holdTroughSeconds) * 1000
  );
}

/**
 * Breath cycle progress in [0,1], shaped with separate inhale/exhale and
 * explicit holds at peak/trough.
 *
 * The returned `level` is the smooth lung-fullness envelope. The two
 * intensity channels are simple derivations of it:
 *   inhaleIntensity = level        (peaks at full lungs, held through holdPeak)
 *   exhaleIntensity = 1 - level    (peaks at empty lungs, held through holdTrough)
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
      exhaleIntensity: 1,
      phase: "holdTrough",
    };
  }

  let t = nowMs % cycleMs;
  if (t < 0) t += cycleMs;

  let level: number;
  let phase: BreathSample["phase"];

  if (t < inhaleMs) {
    const x = inhaleMs > 0 ? t / inhaleMs : 1;
    level = easeInOutSine(x);
    phase = "inhale";
  } else if (t < inhaleMs + holdPeakMs) {
    level = 1;
    phase = "holdPeak";
  } else if (t < inhaleMs + holdPeakMs + exhaleMs) {
    const x = exhaleMs > 0
      ? clamp01((t - inhaleMs - holdPeakMs) / exhaleMs)
      : 1;
    level = 1 - easeOutCubic(x);
    phase = "exhale";
  } else {
    level = 0;
    phase = "holdTrough";
  }

  return {
    level,
    inhaleIntensity: level,
    exhaleIntensity: 1 - level,
    phase,
  };
}

/**
 * Sample one participant's breath. Today this is the shared oscillator
 * shifted by `phaseOffset`. Later this can read a live sensor level
 * without changing the wave / LED pipeline.
 */
export function sampleParticipantBreath(
  participant: BreathParticipant,
  params: BreathParams,
  nowMs: number,
): BreathSample {
  const cycle = breathCycleMs(params);
  const shifted = nowMs + participant.phaseOffset * cycle;
  return sampleBreathAt(params, shifted);
}

export function breathLevelAt(params: BreathParams, nowMs: number): number {
  return sampleBreathAt(params, nowMs).level;
}
