import type { Sample, SampleClip, SamplesParams } from "../state";

export interface ActiveSampleClip {
  clipId: string;
  sampleId: string;
  /** Offset into the sample buffer, seconds. */
  offsetSec: number;
  gain: number;
  pan: number;
  playbackRate: number;
  fadeInSec: number;
  fadeOutSec: number;
  /** Seconds remaining until the clip's natural end. */
  remainingSec: number;
  /** Max ±random detune, cents. 0 disables. */
  randomPitchCents: number;
  reverbMix: number;
  reverbDecay: number;
  delayTimeSec: number;
  delayFeedback: number;
  delayMix: number;
}

function normalizeHour(hour: number): number {
  const h = hour % 24;
  return h < 0 ? h + 24 : h;
}

/**
 * Clip width in decimal hours, given the current day-cycle length.
 *
 * The sky clock advances `24/cycleSeconds` hours per real second.
 * An audio clip that plays for `durationSec / playbackRate` real
 * seconds therefore occupies that many real seconds × `hoursPerSec`
 * on the timeline. Longer cycles => clips look shorter on the roll,
 * and vice-versa.
 */
export function clipWidthHours(
  sample: Pick<Sample, "durationSec">,
  clip: Pick<SampleClip, "playbackRate">,
  cycleSeconds: number,
): number {
  const hoursPerSec = 24 / Math.max(1, cycleSeconds);
  const realSec = sample.durationSec / Math.max(0.05, clip.playbackRate);
  return realSec * hoursPerSec;
}

/**
 * Return every clip whose time-window contains `hour`. `offsetSec` is
 * the position into the buffer that should be sounding right now
 * (used when a clip is started mid-way after a scrub).
 */
export function activeSampleClipsAt(
  hour: number,
  params: SamplesParams,
  cycleSeconds: number,
): ActiveSampleClip[] {
  const h = normalizeHour(hour);
  const out: ActiveSampleClip[] = [];
  const byId = new Map(params.library.map((s) => [s.id, s]));
  const hoursPerSec = 24 / Math.max(1, cycleSeconds);
  const secsPerHour = 1 / hoursPerSec;
  for (const c of params.clips) {
    const sample = byId.get(c.sampleId);
    if (!sample) continue;
    const width = clipWidthHours(sample, c, cycleSeconds);
    if (h < c.startHour || h >= c.startHour + width) continue;
    const hoursSinceStart = h - c.startHour;
    // Offset into the buffer (in original-sample seconds):
    //   elapsed real seconds since clip start × playbackRate.
    const elapsedRealSec = hoursSinceStart * secsPerHour;
    const offsetSec = Math.max(
      0,
      Math.min(sample.durationSec - 0.001, elapsedRealSec * c.playbackRate),
    );
    const remainingSec = Math.max(0, sample.durationSec - offsetSec);
    out.push({
      clipId: c.id,
      sampleId: c.sampleId,
      offsetSec,
      gain: c.gain,
      pan: c.pan,
      playbackRate: c.playbackRate,
      fadeInSec: c.fadeInSec,
      fadeOutSec: c.fadeOutSec,
      remainingSec,
      randomPitchCents: c.randomPitchCents ?? 0,
      reverbMix: c.reverbMix ?? 0,
      reverbDecay: c.reverbDecay ?? 0.7,
      delayTimeSec: c.delayTimeSec ?? 0.25,
      delayFeedback: c.delayFeedback ?? 0.3,
      delayMix: c.delayMix ?? 0,
    });
  }
  return out;
}
