import {
  PAD_KEYFRAME_PARAMS,
  type PadKeyframe,
  type PadKeyframeParam,
  type PadParams,
} from "../state";

export interface PadAutomationMeta {
  label: string;
  min: number;
  max: number;
  step: number;
  log?: boolean;
}

export const PAD_AUTOMATION_META: Record<
  PadKeyframeParam,
  PadAutomationMeta
> = {
  master: { label: "Master", min: 0, max: 1, step: 0.01 },
  unisonDetuneCents: { label: "Spread", min: 0, max: 50, step: 0.5 },
  stereoWidth: { label: "Stereo width", min: 0, max: 1, step: 0.01 },
  driftRateHz: {
    label: "Drift rate",
    min: 0.02,
    max: 6,
    step: 0.01,
    log: true,
  },
  driftDepthCents: {
    label: "Drift depth",
    min: 0,
    max: 30,
    step: 0.5,
  },
  attack: { label: "Attack", min: 0.01, max: 8, step: 0.01, log: true },
  decay: { label: "Decay", min: 0.01, max: 5, step: 0.01, log: true },
  sustain: { label: "Sustain", min: 0, max: 1, step: 0.01 },
  release: { label: "Release", min: 0.01, max: 12, step: 0.01, log: true },
  filterHz: {
    label: "Cutoff",
    min: 80,
    max: 18000,
    step: 1,
    log: true,
  },
  filterQ: { label: "Filter Q", min: 0.1, max: 12, step: 0.05 },
  filterEnvAmount: {
    label: "Filter env",
    min: 0,
    max: 5000,
    step: 10,
  },
  filterLfoRateHz: {
    label: "Filter LFO rate",
    min: 0.02,
    max: 8,
    step: 0.01,
    log: true,
  },
  filterLfoDepth: {
    label: "Filter LFO depth",
    min: 0,
    max: 1,
    step: 0.01,
  },
  saturation: { label: "Saturation", min: 0, max: 1, step: 0.01 },
  chorusRateHz: {
    label: "Chorus rate",
    min: 0.05,
    max: 4,
    step: 0.01,
    log: true,
  },
  chorusDepth: { label: "Chorus depth", min: 0, max: 1, step: 0.01 },
  reverbMix: { label: "Reverb mix", min: 0, max: 1, step: 0.01 },
  reverbRoomSize: {
    label: "Reverb room",
    min: 0,
    max: 0.99,
    step: 0.01,
  },
  reverbDampingHz: {
    label: "Reverb tail tone",
    min: 200,
    max: 12000,
    step: 10,
    log: true,
  },
  reverbPreDelaySec: {
    label: "Reverb pre-delay",
    min: 0,
    max: 0.2,
    step: 0.001,
  },
  delayMix: { label: "Delay mix", min: 0, max: 0.6, step: 0.01 },
  delayTimeSec: {
    label: "Delay time",
    min: 0.05,
    max: 1.5,
    step: 0.005,
    log: true,
  },
  delayFeedback: {
    label: "Delay feedback",
    min: 0,
    max: 0.75,
    step: 0.01,
  },
};

export function clampPadKeyframeValue(
  param: PadKeyframeParam,
  value: number,
): number {
  const meta = PAD_AUTOMATION_META[param];
  const safe = Number.isFinite(value) ? value : meta.min;
  return Math.max(meta.min, Math.min(meta.max, safe));
}

export function sortedPadKeyframes(
  keyframes: readonly PadKeyframe[],
  param?: PadKeyframeParam,
): PadKeyframe[] {
  return keyframes
    .filter((frame) => !param || frame.param === param)
    .sort(
      (a, b) =>
        a.hour - b.hour ||
        PAD_KEYFRAME_PARAMS.indexOf(a.param) -
          PAD_KEYFRAME_PARAMS.indexOf(b.param),
    );
}

function interpolateValue(
  param: PadKeyframeParam,
  a: number,
  b: number,
  t: number,
): number {
  const meta = PAD_AUTOMATION_META[param];
  const av = clampPadKeyframeValue(param, a);
  const bv = clampPadKeyframeValue(param, b);
  if (meta.log && av > 0 && bv > 0) {
    return Math.exp(Math.log(av) + (Math.log(bv) - Math.log(av)) * t);
  }
  return av + (bv - av) * t;
}

/** Resolve one independent parameter lane at a point in the 24-hour track. */
export function samplePadParamAutomation(
  pad: PadParams,
  param: PadKeyframeParam,
  hour: number,
): number {
  const frames = sortedPadKeyframes(pad.keyframes, param);
  const base = clampPadKeyframeValue(param, pad[param]);
  if (frames.length === 0) return base;
  const h = ((Number.isFinite(hour) ? hour : 0) % 24 + 24) % 24;
  if (h < frames[0].hour) return base;
  const rightIndex = frames.findIndex((frame) => frame.hour > h);
  if (rightIndex < 0) {
    return clampPadKeyframeValue(
      param,
      frames[frames.length - 1].value,
    );
  }
  const left = frames[rightIndex - 1];
  const right = frames[rightIndex];
  const span = Math.max(1e-9, right.hour - left.hour);
  const t = Math.max(0, Math.min(1, (h - left.hour) / span));
  return interpolateValue(param, left.value, right.value, t);
}

/**
 * Resolve every independent pad lane at a point in the 24-hour track.
 * Lanes without points use the base patch. Before a lane's first point the
 * base value is held; after its last point the last value is held.
 */
export function samplePadAutomation(pad: PadParams, hour: number): PadParams {
  if (pad.keyframes.length === 0) return pad;
  const values = {} as Record<PadKeyframeParam, number>;
  for (const param of PAD_KEYFRAME_PARAMS) {
    values[param] = samplePadParamAutomation(pad, param, hour);
  }
  return { ...pad, ...values };
}
