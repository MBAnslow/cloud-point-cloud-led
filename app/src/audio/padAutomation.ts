import {
  PAD_KEYFRAME_PARAMS,
  type PadKeyframe,
  type PadKeyframeParam,
  type PadKeyframeValues,
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
};

export function padKeyframeValues(pad: PadParams): PadKeyframeValues {
  const values = {} as PadKeyframeValues;
  for (const key of PAD_KEYFRAME_PARAMS) {
    values[key] = clampPadKeyframeValue(key, pad[key]);
  }
  return values;
}

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
): PadKeyframe[] {
  return [...keyframes].sort((a, b) => a.hour - b.hour);
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

/**
 * Resolve the continuous pad patch at a point on the circular 24-hour day.
 * No keyframes preserves the static patch; one keyframe holds its snapshot
 * all day; two or more interpolate through midnight.
 */
export function samplePadAutomation(pad: PadParams, hour: number): PadParams {
  const frames = sortedPadKeyframes(pad.keyframes);
  if (frames.length === 0) return pad;
  if (frames.length === 1) {
    const values = {} as PadKeyframeValues;
    for (const param of PAD_KEYFRAME_PARAMS) {
      values[param] = clampPadKeyframeValue(
        param,
        frames[0].values[param],
      );
    }
    return { ...pad, ...values };
  }

  const h = ((Number.isFinite(hour) ? hour : 0) % 24 + 24) % 24;
  const rightIndex = frames.findIndex((frame) => frame.hour > h);
  let left: PadKeyframe;
  let right: PadKeyframe;
  let leftHour: number;
  let rightHour: number;

  if (rightIndex === 0) {
    left = frames[frames.length - 1];
    right = frames[0];
    leftHour = left.hour - 24;
    rightHour = right.hour;
  } else if (rightIndex < 0) {
    left = frames[frames.length - 1];
    right = frames[0];
    leftHour = left.hour;
    rightHour = right.hour + 24;
  } else {
    left = frames[rightIndex - 1];
    right = frames[rightIndex];
    leftHour = left.hour;
    rightHour = right.hour;
  }

  const span = Math.max(1e-9, rightHour - leftHour);
  const t = Math.max(0, Math.min(1, (h - leftHour) / span));
  const values = {} as PadKeyframeValues;
  for (const param of PAD_KEYFRAME_PARAMS) {
    values[param] = interpolateValue(
      param,
      left.values[param],
      right.values[param],
      t,
    );
  }
  return { ...pad, ...values };
}
