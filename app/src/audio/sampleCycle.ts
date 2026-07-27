import type { SampleClip, SamplesParams } from "../state";

const HOURS = 24;

/**
 * A sample clip is a *span* on the 24h timeline. While the playhead is
 * inside `[startHour, startHour + widthHours)` the engine plays the
 * buffer at the matching offset; outside the span the voice stops.
 * `widthHours` is derived from duration × playbackRate × cycle speed
 * (same formula as the Samples panel drawing).
 */
export interface ActiveClip {
  clipId: string;
  sampleId: string;
  startHour: number;
  /** Decoded buffer length in seconds. */
  durationSec: number;
  /** Hours of sky-time the clip covers at the current cycle speed. */
  widthHours: number;
  /** Buffer read position for the current playhead, in seconds. */
  offsetSec: number;
  gain: number;
  pan: number;
  playbackRate: number;
  fadeInSec: number;
  fadeOutSec: number;
  randomPitchCents: number;
  reverbMix: number;
  reverbDecay: number;
  delayTimeSec: number;
  delayFeedback: number;
  delayMix: number;
  /** Rolled once on span enter in the engine; 0..1. */
  triggerProbability: number;
}

/** Simulated hours covered while the sample plays at cycle speed. */
export function clipWidthHours(
  durationSec: number,
  playbackRate: number,
  cycleSeconds: number,
): number {
  const playSec = durationSec / Math.max(1e-6, playbackRate);
  return playSec * (HOURS / Math.max(1, cycleSeconds));
}

/**
 * Hours elapsed since `startHour` along the forward timeline, or null
 * if `hour` is outside the clip span (handles midnight wrap).
 */
export function clipProgressHours(
  hour: number,
  startHour: number,
  widthHours: number,
): number | null {
  if (!(widthHours > 0)) return null;
  const h = ((hour % HOURS) + HOURS) % HOURS;
  const s = ((startHour % HOURS) + HOURS) % HOURS;
  let d = h - s;
  if (d < 0) d += HOURS;
  // When the span is longer than a full day, every hour is inside;
  // progress is the forward distance from start within 24h.
  if (widthHours >= HOURS) return d;
  if (d >= widthHours) return null;
  return d;
}

/** Buffer offset (seconds) for a playhead position inside the span. */
export function clipOffsetSec(
  hour: number,
  startHour: number,
  playbackRate: number,
  cycleSeconds: number,
  durationSec: number,
): number | null {
  const width = clipWidthHours(durationSec, playbackRate, cycleSeconds);
  const progress = clipProgressHours(hour, startHour, width);
  if (progress == null) return null;
  const rate = Math.max(1e-6, playbackRate);
  const offset =
    progress * (Math.max(1, cycleSeconds) / HOURS) * rate;
  return Math.max(0, Math.min(Math.max(0, durationSec - 1e-4), offset));
}

function toActive(
  c: SampleClip,
  durationSec: number,
  cycleSeconds: number,
  offsetSec: number,
  widthHours: number,
): ActiveClip {
  return {
    clipId: c.id,
    sampleId: c.sampleId,
    startHour: c.startHour,
    durationSec,
    widthHours,
    offsetSec,
    gain: c.gain,
    pan: c.pan,
    playbackRate: c.playbackRate,
    fadeInSec: c.fadeInSec,
    fadeOutSec: c.fadeOutSec,
    randomPitchCents: c.randomPitchCents ?? 0,
    reverbMix: c.reverbMix ?? 0,
    reverbDecay: c.reverbDecay ?? 0.7,
    delayTimeSec: c.delayTimeSec ?? 0.25,
    delayFeedback: c.delayFeedback ?? 0.3,
    delayMix: c.delayMix ?? 0,
    triggerProbability: Math.max(0, Math.min(1, c.triggerProbability ?? 1)),
  };
}

/**
 * Every clip whose span covers `hour` at the current day-cycle speed.
 */
export function clipsActiveAt(
  hour: number,
  params: SamplesParams,
  cycleSeconds: number,
): ActiveClip[] {
  const byId = new Map(params.library.map((s) => [s.id, s]));
  const out: ActiveClip[] = [];
  for (const c of params.clips) {
    const sample = byId.get(c.sampleId);
    if (!sample) continue;
    const width = clipWidthHours(
      sample.durationSec,
      c.playbackRate,
      cycleSeconds,
    );
    const offset = clipOffsetSec(
      hour,
      c.startHour,
      c.playbackRate,
      cycleSeconds,
      sample.durationSec,
    );
    if (offset == null) continue;
    out.push(toActive(c, sample.durationSec, cycleSeconds, offset, width));
  }
  return out;
}
