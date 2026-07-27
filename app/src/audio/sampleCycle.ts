import {
  sampleTrimRange,
  type Sample,
  type SampleClip,
  type SamplesParams,
} from "../state";

const HOURS = 24;

/**
 * A sample clip is a *span* on the 24h timeline. While the playhead is
 * inside `[startHour, startHour + widthHours)` the engine plays the
 * trimmed buffer region at the matching offset; outside the span the
 * voice stops. Sound params come from the parent library `Sample`
 * (track); width uses that track's playable duration × playbackRate
 * × cycle speed.
 */
export interface ActiveClip {
  clipId: string;
  sampleId: string;
  startHour: number;
  /** Playable (trimmed) length in seconds. */
  durationSec: number;
  /** Absolute buffer offset where the trim region begins. */
  bufferStartSec: number;
  /** Hours of sky-time the clip covers at the current cycle speed. */
  widthHours: number;
  /** Read position within the trimmed region, in seconds. */
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
  if (widthHours >= HOURS) return d;
  if (d >= widthHours) return null;
  return d;
}

/** Offset within the trimmed play region for a playhead inside the span. */
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
  sample: Sample,
  offsetSec: number,
  widthHours: number,
  playSec: number,
  bufferStartSec: number,
): ActiveClip {
  return {
    clipId: c.id,
    sampleId: c.sampleId,
    startHour: c.startHour,
    durationSec: playSec,
    bufferStartSec,
    widthHours,
    offsetSec,
    gain: sample.gain,
    pan: sample.pan,
    playbackRate: sample.playbackRate,
    fadeInSec: sample.fadeInSec,
    fadeOutSec: sample.fadeOutSec,
    randomPitchCents: sample.randomPitchCents,
    reverbMix: sample.reverbMix,
    reverbDecay: sample.reverbDecay,
    delayTimeSec: sample.delayTimeSec,
    delayFeedback: sample.delayFeedback,
    delayMix: sample.delayMix,
    triggerProbability: Math.max(
      0,
      Math.min(1, sample.triggerProbability),
    ),
  };
}

/**
 * Every clip whose span covers `hour` at the current day-cycle speed.
 * Params are taken from the library track (`Sample`), not the clip.
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
    const { start, playSec } = sampleTrimRange(sample);
    const width = clipWidthHours(
      playSec,
      sample.playbackRate,
      cycleSeconds,
    );
    const offset = clipOffsetSec(
      hour,
      c.startHour,
      sample.playbackRate,
      cycleSeconds,
      playSec,
    );
    if (offset == null) continue;
    out.push(toActive(c, sample, offset, width, playSec, start));
  }
  return out;
}
