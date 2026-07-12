import type { SampleClip, SamplesParams } from "../state";

/**
 * A sample clip is a *trigger*: when the playhead crosses its
 * `startHour` the clip fires once and plays the entire sample buffer
 * to its natural end (or is torn down when the track is disabled).
 * The clip has no visual duration on the timeline — it's a fixed-size
 * block whose position is the trigger point.
 */
export interface TriggeredClip {
  clipId: string;
  sampleId: string;
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
  /** Roll gate applied at trigger time in the engine; 0..1. */
  triggerProbability: number;
}

function toActive(c: SampleClip): TriggeredClip {
  return {
    clipId: c.id,
    sampleId: c.sampleId,
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
 * Trigger threshold in decimal hours. If `hour - prevHour` exceeds
 * this the jump is treated as a scrub or a wrap-around and no clips
 * are fired. Chosen large enough that normal forward advance at fast
 * cycles (e.g. 5s/24h ≈ 4.8 h/s ≈ 0.08h/frame at 60fps) always fits,
 * small enough that a period rewind never looks like a forward step.
 */
const MAX_FORWARD_STEP_HOURS = 1.0;

/**
 * Return every clip whose `startHour` falls in the half-open interval
 * `(prevHour, hour]` — i.e. clips the playhead just crossed on this
 * frame. Only fires on normal forward micro-steps; scrubs, resets and
 * period loops (which show up as either a rewind or a large jump) do
 * not fire triggers.
 */
export function sampleClipsToTrigger(
  prevHour: number,
  hour: number,
  params: SamplesParams,
): TriggeredClip[] {
  if (prevHour < 0) return []; // first frame; nothing to compare to.
  const dh = hour - prevHour;
  if (dh <= 0 || dh > MAX_FORWARD_STEP_HOURS) return [];
  const byId = new Map(params.library.map((s) => [s.id, s]));
  const out: TriggeredClip[] = [];
  for (const c of params.clips) {
    if (!byId.has(c.sampleId)) continue;
    if (c.startHour > prevHour && c.startHour <= hour) {
      out.push(toActive(c));
    }
  }
  return out;
}
