import type {
  DroneParams,
  PadParams,
  SamplesParams,
  SimState,
} from "../state";
import { sampleBreathAt } from "../lighting/breath";

interface ParamRange {
  min: number;
  max: number;
  log?: boolean;
}

/**
 * Slider ranges must mirror what MasterFrequencyPanel renders so the
 * modulation percentage maps onto the same visual span the user set it
 * against. If a slider's `min`/`max`/`logScale` changes there, update
 * the matching entry here too.
 */
export const BREATH_MOD_PARAMS: Record<string, ParamRange> = {
  "drone.masterGain": { min: 0, max: 1 },
  "drone.saturation": { min: 0, max: 1 },
  "drone.tremoloRateHz": { min: 0.05, max: 20 },
  "drone.tremoloDepth": { min: 0, max: 1 },
  "drone.filters.lp.hz": { min: 20, max: 20000, log: true },
  "drone.filters.hp.hz": { min: 20, max: 20000, log: true },
  "pad.master": { min: 0, max: 1 },
  "pad.saturation": { min: 0, max: 1 },
  "pad.filters.lp.hz": { min: 20, max: 20000, log: true },
  "pad.filters.hp.hz": { min: 20, max: 20000, log: true },
  "samples.master": { min: 0, max: 3 },
  "samples.filters.lp.hz": { min: 20, max: 20000, log: true },
  "samples.filters.hp.hz": { min: 20, max: 20000, log: true },
};

function apply(base: number, r: ParamRange, amount: number, intensity: number): number {
  if (amount === 0 || intensity <= 0) return base;
  if (r.log) {
    const lo = Math.log(Math.max(1e-6, r.min));
    const hi = Math.log(Math.max(1e-6, r.max));
    const bLog = Math.log(Math.max(1e-6, base));
    const next = bLog + intensity * amount * (hi - lo);
    return Math.exp(Math.max(lo, Math.min(hi, next)));
  }
  return Math.max(
    r.min,
    Math.min(r.max, base + intensity * amount * (r.max - r.min)),
  );
}

/**
 * Compute the current breath drive intensity (0 = inhale rest, 1 = full
 * exhale) — the multiplier applied to each per-slider mod amount before
 * it deviates the base value.
 */
export function currentBreathDrive(state: SimState, nowMs: number): number {
  if (!state.breathModEnabled) return 0;
  return sampleBreathAt(state.breath, nowMs).exhaleIntensity;
}

/**
 * Return effective engine payloads with per-slider breath modulation
 * applied. When modulation is disabled or nothing is modulated, the
 * original references are returned so downstream code stays cheap.
 */
export function modulatedEngineParams(
  state: SimState,
  nowMs: number,
): { drone: DroneParams; pad: PadParams; samples: SamplesParams } {
  const drive = currentBreathDrive(state, nowMs);
  if (drive <= 0) {
    return { drone: state.drone, pad: state.pad, samples: state.samples };
  }
  const bm = state.breathMod;
  const g = (k: string): number => bm[k] ?? 0;
  const drone: DroneParams = {
    ...state.drone,
    masterGain: apply(state.drone.masterGain, BREATH_MOD_PARAMS["drone.masterGain"], g("drone.masterGain"), drive),
    saturation: apply(state.drone.saturation, BREATH_MOD_PARAMS["drone.saturation"], g("drone.saturation"), drive),
    tremoloRateHz: apply(state.drone.tremoloRateHz, BREATH_MOD_PARAMS["drone.tremoloRateHz"], g("drone.tremoloRateHz"), drive),
    tremoloDepth: apply(state.drone.tremoloDepth, BREATH_MOD_PARAMS["drone.tremoloDepth"], g("drone.tremoloDepth"), drive),
    filters: {
      lp: {
        ...state.drone.filters.lp,
        hz: apply(state.drone.filters.lp.hz, BREATH_MOD_PARAMS["drone.filters.lp.hz"], g("drone.filters.lp.hz"), drive),
      },
      hp: {
        ...state.drone.filters.hp,
        hz: apply(state.drone.filters.hp.hz, BREATH_MOD_PARAMS["drone.filters.hp.hz"], g("drone.filters.hp.hz"), drive),
      },
    },
  };
  const pad: PadParams = {
    ...state.pad,
    master: apply(state.pad.master, BREATH_MOD_PARAMS["pad.master"], g("pad.master"), drive),
    saturation: apply(state.pad.saturation, BREATH_MOD_PARAMS["pad.saturation"], g("pad.saturation"), drive),
    filters: {
      lp: {
        ...state.pad.filters.lp,
        hz: apply(state.pad.filters.lp.hz, BREATH_MOD_PARAMS["pad.filters.lp.hz"], g("pad.filters.lp.hz"), drive),
      },
      hp: {
        ...state.pad.filters.hp,
        hz: apply(state.pad.filters.hp.hz, BREATH_MOD_PARAMS["pad.filters.hp.hz"], g("pad.filters.hp.hz"), drive),
      },
    },
  };
  const samples: SamplesParams = {
    ...state.samples,
    master: apply(state.samples.master, BREATH_MOD_PARAMS["samples.master"], g("samples.master"), drive),
    filters: {
      lp: {
        ...state.samples.filters.lp,
        hz: apply(state.samples.filters.lp.hz, BREATH_MOD_PARAMS["samples.filters.lp.hz"], g("samples.filters.lp.hz"), drive),
      },
      hp: {
        ...state.samples.filters.hp,
        hz: apply(state.samples.filters.hp.hz, BREATH_MOD_PARAMS["samples.filters.hp.hz"], g("samples.filters.hp.hz"), drive),
      },
    },
  };
  return { drone, pad, samples };
}
