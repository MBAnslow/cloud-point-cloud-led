import {
  clampSampleAutoValue,
  type Sample,
  type SampleAutoParam,
  type SampleAutoPoint,
} from "../state";

const HOURS = 24;

export interface SampleAutoParamRange {
  min: number;
  max: number;
  /** Lerp / plot in log space (filter Hz). */
  log?: boolean;
}

export const SAMPLE_AUTO_RANGES: Record<SampleAutoParam, SampleAutoParamRange> =
  {
    gain: { min: 0, max: 1 },
    pan: { min: -1, max: 1 },
    filterHz: { min: 20, max: 20000, log: true },
    reverbMix: { min: 0, max: 1 },
    delayMix: { min: 0, max: 1 },
  };

export const SAMPLE_AUTO_LABELS: Record<SampleAutoParam, string> = {
  gain: "Vol",
  pan: "Pan",
  filterHz: "Filter",
  reverbMix: "Rev",
  delayMix: "Delay",
};

function wrapHour(hour: number): number {
  return ((hour % HOURS) + HOURS) % HOURS;
}

function staticValue(sample: Sample, param: SampleAutoParam): number {
  switch (param) {
    case "gain":
      return sample.gain ?? 1;
    case "pan":
      return sample.pan ?? 0;
    case "filterHz":
      return sample.filterHz ?? 20000;
    case "reverbMix":
      return sample.reverbMix ?? 0;
    case "delayMix":
      return sample.delayMix ?? 0;
  }
}

function toUnit(param: SampleAutoParam, value: number): number {
  const r = SAMPLE_AUTO_RANGES[param];
  if (r.log) {
    const lo = Math.log(Math.max(1e-6, r.min));
    const hi = Math.log(Math.max(1e-6, r.max));
    return (Math.log(Math.max(r.min, Math.min(r.max, value))) - lo) / (hi - lo);
  }
  return (value - r.min) / (r.max - r.min);
}

function fromUnit(param: SampleAutoParam, t: number): number {
  const r = SAMPLE_AUTO_RANGES[param];
  const u = Math.max(0, Math.min(1, t));
  if (r.log) {
    const lo = Math.log(Math.max(1e-6, r.min));
    const hi = Math.log(Math.max(1e-6, r.max));
    return Math.exp(lo + u * (hi - lo));
  }
  return r.min + u * (r.max - r.min);
}

function lerpValue(
  param: SampleAutoParam,
  a: number,
  b: number,
  t: number,
): number {
  const u = Math.max(0, Math.min(1, t));
  if (SAMPLE_AUTO_RANGES[param].log) {
    return fromUnit(param, toUnit(param, a) + (toUnit(param, b) - toUnit(param, a)) * u);
  }
  return a + (b - a) * u;
}

/** Sorted copy of points for a param lane (empty if none). */
export function sortedAutoPoints(
  sample: Sample,
  param: SampleAutoParam,
): SampleAutoPoint[] {
  const pts = sample.automation?.[param];
  if (!pts || pts.length === 0) return [];
  return [...pts].sort((a, b) => a.hour - b.hour);
}

/**
 * Sample a track automation lane at a sky hour.
 * No points → static knob. Otherwise linear lerp between neighbours
 * with midnight wrap.
 */
export function sampleTrackAutomation(
  sample: Sample,
  hour: number,
  param: SampleAutoParam,
): number {
  const sorted = sortedAutoPoints(sample, param);
  if (sorted.length === 0) {
    return clampSampleAutoValue(param, staticValue(sample, param));
  }
  if (sorted.length === 1) {
    return clampSampleAutoValue(param, sorted[0].value);
  }

  const h = wrapHour(hour);
  // Find segment: last point at/before h, or wrap from last → first.
  let i = sorted.length - 1;
  for (let k = 0; k < sorted.length; k++) {
    if (sorted[k].hour > h) {
      i = k - 1;
      break;
    }
  }

  if (i < 0) {
    // Before first point: wrap last → first across midnight.
    const a = sorted[sorted.length - 1];
    const b = sorted[0];
    const span = b.hour + HOURS - a.hour;
    const t = span > 1e-9 ? (h + HOURS - a.hour) / span : 0;
    return clampSampleAutoValue(param, lerpValue(param, a.value, b.value, t));
  }

  if (i >= sorted.length - 1) {
    // After last point: wrap last → first.
    const a = sorted[sorted.length - 1];
    const b = sorted[0];
    const span = b.hour + HOURS - a.hour;
    const t = span > 1e-9 ? (h - a.hour) / span : 0;
    return clampSampleAutoValue(param, lerpValue(param, a.value, b.value, t));
  }

  const a = sorted[i];
  const b = sorted[i + 1];
  const span = b.hour - a.hour;
  const t = span > 1e-9 ? (h - a.hour) / span : 0;
  return clampSampleAutoValue(param, lerpValue(param, a.value, b.value, t));
}

/** Map a Y fraction [0=top/max, 1=bottom/min] to a clamped param value. */
export function autoValueFromYFrac(
  param: SampleAutoParam,
  yFrac: number,
): number {
  const t = 1 - Math.max(0, Math.min(1, yFrac));
  return clampSampleAutoValue(param, fromUnit(param, t));
}

/** Map a param value to Y fraction [0=top/max, 1=bottom/min]. */
export function autoYFracFromValue(
  param: SampleAutoParam,
  value: number,
): number {
  return 1 - toUnit(param, clampSampleAutoValue(param, value));
}
