import type {
  DroneParams,
  PadParams,
  SamplesParams,
  SimState,
} from "../state";
import { isBreathActive } from "../state";
import { getBreathEffectDrive } from "../lighting/breathEffectDrive";

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
  "pad.unisonDetuneCents": { min: 0, max: 50 },
  "pad.filters.lp.hz": { min: 20, max: 20000, log: true },
  "pad.filters.hp.hz": { min: 20, max: 20000, log: true },
  "samples.master": { min: 0, max: 3 },
  "samples.filters.lp.hz": { min: 20, max: 20000, log: true },
  "samples.filters.hp.hz": { min: 20, max: 20000, log: true },
};

/**
 * Invert mapping: slider `base` is the reveal=1 target; % amount is the
 * reveal=0 rest offset. Live = lerp(offset → base, reveal).
 *
 *   offset = clamp(base + amount * range)
 *   live   = base + amount * range * (1 - reveal)
 */
function apply(
  base: number,
  r: ParamRange,
  amount: number,
  reveal: number,
): number {
  if (amount === 0) return base;
  const t = reveal < 0 ? 0 : reveal > 1 ? 1 : reveal;
  if (r.log) {
    const lo = Math.log(Math.max(1e-6, r.min));
    const hi = Math.log(Math.max(1e-6, r.max));
    const bLog = Math.log(Math.max(1e-6, base));
    const next = bLog + amount * (1 - t) * (hi - lo);
    return Math.exp(Math.max(lo, Math.min(hi, next)));
  }
  return Math.max(
    r.min,
    Math.min(r.max, base + amount * (1 - t) * (r.max - r.min)),
  );
}

/** Floor for reveal ceiling so division stays stable. */
export const BREATH_MOD_REVEAL_CEILING_MIN = 0.05;

/**
 * Remap raw mean LED reveal so audio saturates at `ceiling` instead of 1.
 * ceiling=1 → identity; ceiling=0.4 → raw 0.4 already drives mod to 1.
 */
export function scaleBreathModReveal(raw: number, ceiling: number): number {
  const r = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  const c = Math.max(
    BREATH_MOD_REVEAL_CEILING_MIN,
    Math.min(1, Number.isFinite(ceiling) ? ceiling : 1),
  );
  const t = r / c;
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

/** True when cloud breath mod may move params (enabled + breath window). */
export function isBreathModActive(state: SimState): boolean {
  return (
    state.breathModEnabled &&
    isBreathActive(state.breath, state.sky.timeHours)
  );
}

/**
 * Breath-mod drive = mean per-LED TOD reveal, remapped by reveal ceiling.
 * 0 when mod off / outside breath period; otherwise [0,1] after ceiling.
 */
export function currentBreathDrive(state: SimState, _nowMs?: number): number {
  if (!isBreathModActive(state)) return 0;
  return scaleBreathModReveal(
    getBreathEffectDrive(),
    state.breathModRevealCeiling,
  );
}

/**
 * Effective engine payloads with inverted breath modulation.
 *
 * Checkbox off, or outside the breath Start→End window → exact stored
 * master-slider params (yellow). No offset, no lerp.
 * Inside the window with mod on → lerp offset (reveal 0) → slider (reveal 1).
 */
export function modulatedEngineParams(
  state: SimState,
  nowMs: number,
): { drone: DroneParams; pad: PadParams; samples: SamplesParams } {
  void nowMs;
  // Hard bypass first: disabled means plain slider levels, always.
  if (!state.breathModEnabled) {
    return { drone: state.drone, pad: state.pad, samples: state.samples };
  }
  if (!isBreathActive(state.breath, state.sky.timeHours)) {
    return { drone: state.drone, pad: state.pad, samples: state.samples };
  }
  const reveal = scaleBreathModReveal(
    getBreathEffectDrive(),
    state.breathModRevealCeiling,
  );
  const bm = state.breathMod;
  const g = (k: string): number => bm[k] ?? 0;
  const drone: DroneParams = {
    ...state.drone,
    masterGain: apply(
      state.drone.masterGain,
      BREATH_MOD_PARAMS["drone.masterGain"],
      g("drone.masterGain"),
      reveal,
    ),
    saturation: apply(
      state.drone.saturation,
      BREATH_MOD_PARAMS["drone.saturation"],
      g("drone.saturation"),
      reveal,
    ),
    tremoloRateHz: apply(
      state.drone.tremoloRateHz,
      BREATH_MOD_PARAMS["drone.tremoloRateHz"],
      g("drone.tremoloRateHz"),
      reveal,
    ),
    tremoloDepth: apply(
      state.drone.tremoloDepth,
      BREATH_MOD_PARAMS["drone.tremoloDepth"],
      g("drone.tremoloDepth"),
      reveal,
    ),
    filters: {
      lp: {
        ...state.drone.filters.lp,
        hz: apply(
          state.drone.filters.lp.hz,
          BREATH_MOD_PARAMS["drone.filters.lp.hz"],
          g("drone.filters.lp.hz"),
          reveal,
        ),
      },
      hp: {
        ...state.drone.filters.hp,
        hz: apply(
          state.drone.filters.hp.hz,
          BREATH_MOD_PARAMS["drone.filters.hp.hz"],
          g("drone.filters.hp.hz"),
          reveal,
        ),
      },
    },
  };
  const pad: PadParams = {
    ...state.pad,
    master: apply(
      state.pad.master,
      BREATH_MOD_PARAMS["pad.master"],
      g("pad.master"),
      reveal,
    ),
    saturation: apply(
      state.pad.saturation,
      BREATH_MOD_PARAMS["pad.saturation"],
      g("pad.saturation"),
      reveal,
    ),
    unisonDetuneCents: apply(
      state.pad.unisonDetuneCents,
      BREATH_MOD_PARAMS["pad.unisonDetuneCents"],
      g("pad.unisonDetuneCents"),
      reveal,
    ),
    filters: {
      lp: {
        ...state.pad.filters.lp,
        hz: apply(
          state.pad.filters.lp.hz,
          BREATH_MOD_PARAMS["pad.filters.lp.hz"],
          g("pad.filters.lp.hz"),
          reveal,
        ),
      },
      hp: {
        ...state.pad.filters.hp,
        hz: apply(
          state.pad.filters.hp.hz,
          BREATH_MOD_PARAMS["pad.filters.hp.hz"],
          g("pad.filters.hp.hz"),
          reveal,
        ),
      },
    },
  };
  const samples: SamplesParams = {
    ...state.samples,
    master: apply(
      state.samples.master,
      BREATH_MOD_PARAMS["samples.master"],
      g("samples.master"),
      reveal,
    ),
    filters: {
      lp: {
        ...state.samples.filters.lp,
        hz: apply(
          state.samples.filters.lp.hz,
          BREATH_MOD_PARAMS["samples.filters.lp.hz"],
          g("samples.filters.lp.hz"),
          reveal,
        ),
      },
      hp: {
        ...state.samples.filters.hp,
        hz: apply(
          state.samples.filters.hp.hz,
          BREATH_MOD_PARAMS["samples.filters.hp.hz"],
          g("samples.filters.hp.hz"),
          reveal,
        ),
      },
    },
  };
  return { drone, pad, samples };
}
