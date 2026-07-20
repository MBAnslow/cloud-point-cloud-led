import { create } from "zustand";
import { CUSTOM_SWATCH_ID, getSwatch } from "./lighting/swatches";
import { loadSnapshot, type Snapshot } from "./state/persistence";

export type Vec3 = [number, number, number];

export type LedViewMode =
  | "breathIntensity"
  | "timeOfDay"
  | "breathPlusTimeOfDay";

/**
 * How the per-LED points are visualized in the 3D scene:
 *   "sensors" — matte spheres that sample lighting at their surface
 *               position. Represents the sampling side of the rendering
 *               pipeline (what the app uses internally to decide colors).
 *   "leds"    — narrow oriented hemispheres with additive blending that
 *               emit their per-LED stream color. Represents what actually
 *               gets streamed to WLED.
 */
export type LedDisplayMode = "sensors" | "leds";
export type BreathTimeCombineMode = "revealOnInhale" | "linearMix";

export interface LedStreamPipeline {
  /** Enables the base time-of-day lighting stage. */
  timeOfDayStage: boolean;
  /** Enables breath masking/compositing stages. */
  breathStage: boolean;
  /** Enables additive lightning contribution stage. */
  lightningStage: boolean;
  /** Enables locator hard override in streamed output. */
  locatorOverrideStage: boolean;
}

export interface LightningParams {
  enabled: boolean;
  /**
   * Three bolt tint colors. Each strike shuffles the order and
   * interpolates through them across its flash so the color varies
   * mid-strike (start → mid → end).
   */
  colors: [string, string, string];
  /**
   * Per-strike additive gain range applied to the per-LED
   * contribution. Each strike samples a random value from this
   * `[min, max]` window at birth time.
   */
  intensityRange: [number, number];
  /** Average number of strikes per minute (Poisson-ish scheduling). */
  strikesPerMinute: number;
  /**
   * Characteristic distance (m) over which an LED's contribution from a
   * lit segment drops by 1/e. Continuous exponential falloff — every
   * LED receives some light, larger values = more diffuse glow through
   * the cloud.
   */
  falloffDistance: number;
  /** Number of samples in a bolt polyline (jaggedness). */
  boltSegments: number;
  /** Per-strike lateral randomness range, [0,1]. Sampled per strike. */
  boltJitterRange: [number, number];
  /**
   * Per-strike bolt tip travel speed range, in world metres per second.
   * The flash duration is derived from `path_length / speed * 4` so
   * longer bolts and slower speeds automatically produce longer flashes.
   * The `* 4` factor preserves the historical ~25% travel / ~75% fade
   * envelope split.
   */
  travelSpeedRange: [number, number];
  /** Number of flicker sub-pulses within a single strike. */
  subFlashes: number;
  /** Max portion of the ellipsoid extents the bolt endpoints span, [0,1]. */
  spanScale: number;
  /**
   * Minimum bolt length as a fraction of the mean ellipsoid radius.
   * If randomly sampled endpoints fall closer than this, we resample
   * so bolts don't degenerate into a tiny spark.
   */
  minSpanScale: number;
  /** Hour in [0, 24) at which lightning activity switches on. */
  activeStartHour: number;
  /** Hour in [0, 24) at which lightning activity switches off. */
  activeEndHour: number;
  /** Uploaded bolt-sound library. One is chosen at random per strike. */
  boltSamples: LightningSample[];
  /** Optional looping background ambience (rain, thunder rumble, …). */
  backgroundSample: LightningSample | null;
  /**
   * Base playback gain for bolt sounds. The actual per-trigger gain
   * is scaled by the strike's sampled intensity so louder flashes get
   * louder bolts and gentler flashes fade toward this floor.
   */
  boltGain: number;
  /** Playback gain for the background loop, [0, 1]. */
  backgroundGain: number;
  /**
   * ± range in cents for a random pitch shift applied to each bolt
   * trigger (uniform in [-range, +range]). 0 = deterministic.
   */
  boltPitchJitterCents: number;
  /**
   * Delay in milliseconds between the visual bolt spawning and the
   * bolt sample being triggered. Mimics thunder arriving after the
   * flash (sound travels ~340 m/s vs. instantaneous light). 0 = fire
   * simultaneously. Clamped to [0, 10000] on load.
   */
  thunderDelayMs: number;
  /**
   * Target simulation FPS for lightning updates + LED contribution.
   * Lower values create a stroboscopic, film-like flicker by
   * refreshing bolt state less often than the render loop.
   * Range 1..60.
   */
  simFps: number;
}

/**
 * Metadata for a lightning audio asset. The binary blob lives in
 * IndexedDB (shared with the samples panel storage) keyed by `id`;
 * only these lightweight fields make it into the localStorage
 * snapshot. `durationSec` is optional (background loop doesn't need
 * it) and populated at upload time when known.
 */
export interface LightningSample {
  id: string;
  name: string;
  durationSec?: number;
}

/** Ellipsoid semi-axes in metres. */
export interface EllipsoidParams {
  rx: number;
  ry: number;
  rz: number;
}

export interface CloudParams {
  /**
   * Cloud opacity, in [0, 1]:
   *   0 — fully transparent; the cloud blocks no light, every LED gets the
   *       same hemispherical irradiance regardless of which side it's on.
   *   1 — fully opaque; LEDs on the far side of the cloud relative to a
   *       light source receive nothing (the original half-Lambert response).
   * Values in between fade smoothly between the two extremes.
   */
  opacity: number;
  /**
   * Whether the ellipsoid mesh is rendered in the 3D view. The LED shading
   * always uses `opacity` regardless of this flag — toggling it just hides
   * or shows the visual representation of the cloud body.
   */
  showOpacity: boolean;
  /** Rotation of the cloud around world up axis, in degrees. */
  rotationYDeg: number;
  /** Tilt of the cloud around world X axis, in degrees. */
  rotationXDeg: number;
  /** World-space X offset of the cloud center, in metres. */
  offsetX: number;
  /** World-space Y offset of the cloud center, in metres. Positive
   * values lift the whole cloud (mesh + LEDs) up off the ground. */
  offsetY: number;
  /** World-space Z offset of the cloud center, in metres. */
  offsetZ: number;
}

export interface StrandParams {
  /** Bead size for each rendered LED, in metres. */
  ledSize: number;
  /**
   * Hemisphere averaging focus for sensor sampling.
   * 0 = uniform hemisphere average; higher values bias samples toward the
   * sensor normal (head-on light contributes more than grazing light).
   */
  sensorHemisphereFocus: number;
}

export interface AmbientLightParams {
  color: string;
  intensity: number;
}

export interface DirectionalLightParams {
  color: string;
  intensity: number;
  /** World-space position of the directional light source (metres). */
  position: Vec3;
  /**
   * Angular spread of the light in [0, 1]:
   *   0 — perfectly narrow / point-source / "laser": only the half of the
   *       cloud facing the light is illuminated, with a hard terminator at
   *       the equator (flat Lambert `max(0, n · ℓ)` regardless of cloud
   *       opacity).
   *   1 — fully broad / hemispherical "sky": light wraps around the LED's
   *       outward hemisphere, side LEDs get partial illumination, and
   *       cloud opacity controls how much of that wrap reaches the back.
   * Values in between blend linearly. With `spread = 1` the shading model
   * is identical to the previous behavior, so this parameter cleanly
   * extends the old one without changing existing presets.
   */
  spread: number;
}

/** Which sky channel a stop belongs to. */
export type SkyChannel = "sun" | "moon" | "ambient";

/**
 * A single stop on one sky channel's timeline. Pins a single color
 * (only for its channel) at a specific hour. Each channel has its own
 * independent list of stops, so you can shape sun, moon, and ambient
 * colors on completely different schedules.
 *
 * `swatchId` references either a named preset in `SKY_SWATCHES` or the
 * sentinel value `"custom"`. It's UI-only metadata used to display the
 * swatch name and to detect when a user has hand-edited a stop away
 * from its preset. The actual color on the stop is the source of
 * truth for the shading model.
 */
export interface SkyChannelStop {
  id: string;
  /** Time of day in decimal hours, in [0, 24). */
  timeHours: number;
  /** Preset id from `SKY_SWATCHES`, or "custom". */
  swatchId: string;
  color: string;
}

export interface SkyParams {
  /** Enables the sun/moon 24-hour sky sequence. */
  enabled: boolean;
  /** Master amount of the time-of-day visualization effect. */
  visualizationAmount: number;
  /** Advances `timeHours` automatically every frame. */
  autoPlay: boolean;
  /** Time of day in decimal hours [0, 24). */
  timeHours: number;
  /** How many real-time seconds one full 24h sky cycle takes. */
  cycleSeconds: number;
  /** Global intensity scale for the sky ambient component. */
  ambientScale: number;
  /** Global intensity scale for sun contribution. */
  sunScale: number;
  /** Global intensity scale for moon contribution. */
  moonScale: number;
  /** Angular spread of sun light (0 = tight hotspot, 1 = broad sky-like). */
  sunSpread: number;
  /** Angular spread of moon light (0 = tight hotspot, 1 = broad sky-like). */
  moonSpread: number;
  /**
   * Altitude (deg) where horizon occlusion starts opening.
   * Negative values allow a bit of under-horizon twilight.
   */
  horizonCutoffDeg: number;
  /** Soft transition width (deg) for horizon occlusion. */
  horizonSoftnessDeg: number;
  /**
   * Draggable timeline of sun-color stops across the 24-hour day. The
   * sky cycle sorts stops by `timeHours` internally and interpolates
   * linearly between neighbours (wrapping midnight → next stop + 24h).
   */
  sunStops: SkyChannelStop[];
  /** Draggable moon-color timeline (independent from sun and ambient). */
  moonStops: SkyChannelStop[];
  /** Draggable ambient-color timeline (independent from sun and moon). */
  ambientStops: SkyChannelStop[];
}

/** Legacy single-list stop, kept only for one-shot snapshot migration. */
interface LegacyTriStop {
  id: string;
  timeHours: number;
  swatchId: string;
  ambientColor: string;
  sunColor: string;
  moonColor: string;
}

export type DroneWaveform = "sine" | "triangle" | "sawtooth" | "square";

/**
 * A single note placed on the 24h piano roll. Voiced continuously
 * while `startHour <= sky.timeHours < endHour`. Notes are named
 * (e.g. "C3", "F#4") for direct Tone.js frequency lookup and can
 * overlap freely (each is an independent voice, keyed by id).
 *
 * Times are clamped to `[0, 24)` and `startHour < endHour`. No wrap
 * across midnight — draw two notes if you want that.
 */
export interface DroneNote {
  id: string;
  note: string;
  /** Note-on time in decimal hours, in [0, 24). */
  startHour: number;
  /** Note-off time in decimal hours, in (0, 24]. */
  endHour: number;
  /**
   * Per-note gain multiplier, [0, 1]. Applied on top of `masterGain`
   * and the ADSR envelope. Optional for backward-compat with older
   * saved snapshots — resolves to 1 when missing.
   */
  gain?: number;
  /** Per-note pitch offset in cents. Defaults to 0. */
  detuneCents?: number;
  /** Number of stacked oscillators for this note (unison). 1..8. */
  unisonCount?: number;
  /** Symmetric detune spread across the unison stack, in cents. */
  unisonDetuneCents?: number;
  /**
   * Peak per-oscillator pitch drift in cents. Each unison osc gets its
   * own slow LFO wandering its detune by ±this amount; 0 disables drift.
   */
  unisonDriftCents?: number;
  /** Drift LFO base rate, Hz. Each osc jitters slightly around this. */
  unisonDriftRateHz?: number;
  // --- Per-note effects. All optional; unset means "transparent"
  // (no tremolo, filter fully open, no wobble) so old notes keep
  // working. These stack on top of the master effects in the chain:
  //   osc -> perNoteFilter -> env -> perNoteTremolo
  //       -> bus -> masterFilter -> masterTremolo -> distortion -> reverb
  /** Per-note tremolo rate in Hz. */
  tremoloRateHz?: number;
  /** Per-note tremolo depth, [0, 1]. */
  tremoloDepth?: number;
  tremoloShape?: DroneLfoShape;
  /** Per-note filter cutoff in Hz. */
  filterHz?: number;
  filterQ?: number;
  filterLfoRateHz?: number;
  filterLfoDepth?: number;
  filterLfoShape?: DroneLfoShape;
  /**
   * Layer voices around the fundamental:
   *   octave layers: -2, -1, 0, +1, +2, +3
   *   extension layers: ext1, ext2, ext3 (user-choosable semitone offsets)
   * Each voice is an independent sine oscillator with level, tremolo and
   * drift controls. Undefined = fully silent layers.
   *
   * Backward compatibility: a plain `number[]` is still accepted and mapped
   * to levels with default interval offsets.
   */
  harmonics?: (HarmonicVoice | number | undefined)[];
}

export const HARMONIC_OCTAVE_OFFSETS = [-12, 0, 12, 24, 36] as const;
export const HARMONIC_EXTENSION_DEFAULTS = [4, 7, 10] as const;
export const HARMONIC_COUNT =
  HARMONIC_OCTAVE_OFFSETS.length + HARMONIC_EXTENSION_DEFAULTS.length;

export function harmonicLayerDefaultSemitones(index: number): number {
  if (index < HARMONIC_OCTAVE_OFFSETS.length) return HARMONIC_OCTAVE_OFFSETS[index];
  const ext = index - HARMONIC_OCTAVE_OFFSETS.length;
  return HARMONIC_EXTENSION_DEFAULTS[ext] ?? 0;
}

/**
 * Per-harmonic modulated oscillator. `level` is the direct gain
 * multiplier feeding the summing bus. `tremDepth` amplitude-modulates
 * the harmonic at `tremRateHz`; `driftDepth` frequency-modulates it
 * (in cents) at `driftRateHz`. All defaults are 0 so an untouched
 * harmonic is silent and transparent.
 */
export interface HarmonicVoice {
  level: number;
  /** Pitch offset from base note in semitones. */
  intervalSemitones: number;
  tremRateHz: number;
  tremDepth: number;
  driftCents: number;
  driftRateHz: number;
  /**
   * Overtone amount in [0, 1]. 0 = pure sine, 1 = sawtooth-like bright
   * spectrum built from a decaying partials series. Adds harmonic
   * content to break sine-vs-sine beating and give the layer body.
   */
  overtones: number;
}

export const HARMONIC_VOICE_DEFAULTS: HarmonicVoice = {
  level: 0,
  intervalSemitones: 0,
  tremRateHz: 4,
  tremDepth: 0,
  driftCents: 0,
  driftRateHz: 0.3,
  overtones: 0,
};

/**
 * Fully-resolved per-note effect params. `undefined` fields on a
 * `DroneNote` fall through to defaults that make the per-voice fx
 * chain transparent.
 */
export interface NoteFx {
  gain: number;
  detuneCents: number;
  unisonCount: number;
  unisonDetuneCents: number;
  unisonDriftCents: number;
  unisonDriftRateHz: number;
  tremoloRateHz: number;
  tremoloDepth: number;
  tremoloShape: DroneLfoShape;
  filterHz: number;
  filterQ: number;
  filterLfoRateHz: number;
  filterLfoDepth: number;
  filterLfoShape: DroneLfoShape;
  /** Fully-resolved per-partial voices, length == HARMONIC_COUNT. */
  harmonics: HarmonicVoice[];
}

export const NOTE_FX_DEFAULTS: NoteFx = {
  gain: 0,
  detuneCents: 0,
  unisonCount: 1,
  unisonDetuneCents: 0,
  unisonDriftCents: 0,
  unisonDriftRateHz: 0.3,
  tremoloRateHz: 4,
  tremoloDepth: 0,
  tremoloShape: "sine",
  // 20 kHz cutoff is above the audible band, so the biquad is
  // effectively bypassed until the user dials it down.
  filterHz: 20000,
  filterQ: 0.7,
  filterLfoRateHz: 2,
  filterLfoDepth: 0,
  filterLfoShape: "sine",
  harmonics: Array.from({ length: HARMONIC_COUNT }, (_, i) => ({
    ...HARMONIC_VOICE_DEFAULTS,
    intervalSemitones: harmonicLayerDefaultSemitones(i),
  })),
};

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function clamp01(n: number | undefined): number {
  if (n === undefined || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function resolveHarmonicVoice(
  index: number,
  h: HarmonicVoice | number | undefined,
): HarmonicVoice {
  const base = harmonicLayerDefaultSemitones(index);
  if (h === undefined) return { ...HARMONIC_VOICE_DEFAULTS, intervalSemitones: base };
  if (typeof h === "number") {
    // Backward compat with the older scalar-level schema.
    return {
      ...HARMONIC_VOICE_DEFAULTS,
      level: clamp01(h),
      intervalSemitones: base,
    };
  }
  return {
    level: clamp01(h.level),
    intervalSemitones: clampInt(
      h.intervalSemitones ?? base,
      -36,
      36,
    ),
    tremRateHz: h.tremRateHz ?? HARMONIC_VOICE_DEFAULTS.tremRateHz,
    tremDepth: clamp01(h.tremDepth),
    driftCents: h.driftCents ?? HARMONIC_VOICE_DEFAULTS.driftCents,
    driftRateHz: h.driftRateHz ?? HARMONIC_VOICE_DEFAULTS.driftRateHz,
    overtones: clamp01(h.overtones),
  };
}

function resolveHarmonics(
  h: (HarmonicVoice | number | undefined)[] | undefined,
): HarmonicVoice[] {
  const out: HarmonicVoice[] = [];
  for (let i = 0; i < HARMONIC_COUNT; i++) {
    out.push(resolveHarmonicVoice(i, h?.[i]));
  }
  return out;
}

export function resolveNoteFx(note: DroneNote): NoteFx {
  return {
    gain: note.gain ?? NOTE_FX_DEFAULTS.gain,
    detuneCents: note.detuneCents ?? NOTE_FX_DEFAULTS.detuneCents,
    unisonCount: clampInt(
      note.unisonCount ?? NOTE_FX_DEFAULTS.unisonCount,
      1,
      8,
    ),
    unisonDetuneCents:
      note.unisonDetuneCents ?? NOTE_FX_DEFAULTS.unisonDetuneCents,
    unisonDriftCents:
      note.unisonDriftCents ?? NOTE_FX_DEFAULTS.unisonDriftCents,
    unisonDriftRateHz:
      note.unisonDriftRateHz ?? NOTE_FX_DEFAULTS.unisonDriftRateHz,
    harmonics: resolveHarmonics(note.harmonics),
    tremoloRateHz: note.tremoloRateHz ?? NOTE_FX_DEFAULTS.tremoloRateHz,
    tremoloDepth: note.tremoloDepth ?? NOTE_FX_DEFAULTS.tremoloDepth,
    tremoloShape: note.tremoloShape ?? NOTE_FX_DEFAULTS.tremoloShape,
    filterHz: note.filterHz ?? NOTE_FX_DEFAULTS.filterHz,
    filterQ: note.filterQ ?? NOTE_FX_DEFAULTS.filterQ,
    filterLfoRateHz: note.filterLfoRateHz ?? NOTE_FX_DEFAULTS.filterLfoRateHz,
    filterLfoDepth: note.filterLfoDepth ?? NOTE_FX_DEFAULTS.filterLfoDepth,
    filterLfoShape: note.filterLfoShape ?? NOTE_FX_DEFAULTS.filterLfoShape,
  };
}

export type DroneLfoShape = "sine" | "triangle" | "square" | "sawtooth";

/** One-pole biquad configuration reused by per-engine HPF/LPF slots. */
export interface FilterParams {
  enabled: boolean;
  hz: number;
  q: number;
}
export interface FilterChain {
  lp: FilterParams;
  hp: FilterParams;
}

export const DEFAULT_FILTER_CHAIN: FilterChain = {
  lp: { enabled: false, hz: 12000, q: 0.7 },
  hp: { enabled: false, hz: 60, q: 0.7 },
};

function resolveFilterChain(input: unknown): FilterChain {
  const d = DEFAULT_FILTER_CHAIN;
  const src = (input && typeof input === "object" ? input : {}) as Partial<FilterChain>;
  const one = (
    slot: Partial<FilterParams> | undefined,
    def: FilterParams,
  ): FilterParams => ({
    enabled: typeof slot?.enabled === "boolean" ? slot.enabled : def.enabled,
    hz:
      typeof slot?.hz === "number"
        ? Math.max(10, Math.min(22000, slot.hz))
        : def.hz,
    q:
      typeof slot?.q === "number"
        ? Math.max(0.1, Math.min(20, slot.q))
        : def.q,
  });
  return { lp: one(src.lp, d.lp), hp: one(src.hp, d.hp) };
}

export interface DroneParams {
  enabled: boolean;
  /** Master output gain, [0, 1]. */
  masterGain: number;
  waveform: DroneWaveform;
  /** Attack time, seconds (0.001–5). */
  attack: number;
  /** Decay time, seconds (0.001–5). */
  decay: number;
  /** Sustain level, [0, 1]. */
  sustain: number;
  /** Release time, seconds (0.001–8). */
  release: number;
  /** Amplitude LFO ("tremolo") rate, Hz. */
  tremoloRateHz: number;
  /** Tremolo depth, [0, 1]. 0 = off, 1 = full modulation to silence. */
  tremoloDepth: number;
  tremoloShape: DroneLfoShape;
  /** Master saturation amount, [0, 1]. 0 = clean, 1 = fully saturated. */
  saturation: number;
  /** Post-FX: distortion (single soft-clip waveshaper). */
  distortionEnabled: boolean;
  /** Distortion drive amount, [0, 1]. */
  distortionDrive: number;
  /** Distortion wet mix, [0, 1]. */
  distortionMix: number;
  /** Per-engine HPF+LPF chain applied on the master before output. */
  filters: FilterChain;
  notes: DroneNote[];
}

/**
 * A single warm-pad note placed on its own 24h piano roll. Deliberately
 * leaner than `DroneNote`: pads use a single global synth patch so no
 * per-note tremolo/filter/harmonics/unison are exposed.
 */
export interface PadNote {
  id: string;
  note: string;
  /** Note-on time in decimal hours, in [0, 24). */
  startHour: number;
  /** Note-off time in decimal hours, in (0, 24]. */
  endHour: number;
  /** Per-note gain multiplier, [0, 1]. Optional; defaults to 1. */
  gain?: number;
  /** Per-note pitch offset in cents. Defaults to 0. */
  detuneCents?: number;
  /**
   * Probability the note will actually fire when the playhead enters
   * its window. The roll happens once per entry; if it fails the note
   * stays silent for that whole pass and re-rolls on the next entry.
   * Undefined = 1 (always fire).
   */
  triggerProbability?: number;
}

export type PadWaveform = "sine" | "sawtooth" | "square" | "triangle";

/**
 * Warm-pad synth patch. One instance per track — the pad engine is
 * intentionally simpler than the drone engine: unison-detuned voices,
 * ADSR, low-pass with env amount, chorus for width, reverb for space.
 */
export interface PadParams {
  enabled: boolean;
  /** Master output gain, [0, 1]. */
  master: number;
  waveform: PadWaveform;
  /** Number of stacked unison oscillators per voice, 1..8. */
  unisonCount: number;
  /** Symmetric detune spread across the unison stack, cents. */
  unisonDetuneCents: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** Base cutoff of the low-pass, Hz (20–20000). */
  filterHz: number;
  filterQ: number;
  /**
   * Filter envelope amount in cents (0..5000). ADSR opens the cutoff
   * up by this many cents above `filterHz` at note-on, tracking sustain.
   */
  filterEnvAmount: number;
  /** Chorus LFO rate, Hz. */
  chorusRateHz: number;
  /** Chorus wet mix, [0, 1]. */
  chorusDepth: number;
  /**
   * Per-oscillator pitch-drift LFO rate, Hz. Each unison osc gets its
   * own randomised phase so drift feels organic rather than in lock-step.
   */
  driftRateHz: number;
  /** Peak drift depth, cents. 0 disables. */
  driftDepthCents: number;
  /** Filter cutoff LFO rate, Hz. */
  filterLfoRateHz: number;
  /**
   * Filter cutoff LFO depth, [0, 1]. 1 sweeps the cutoff down by a
   * full octave from the base at the LFO's trough; 0 disables.
   */
  filterLfoDepth: number;
  /** Waveshaper drive, [0, 1]. 0 = clean. */
  saturation: number;
  /** Per-engine HPF+LPF chain applied on the master before output. */
  filters: FilterChain;
  notes: PadNote[];
}

/**
 * Uploaded audio-sample metadata. The actual binary blob lives in
 * IndexedDB keyed by `id`; only these lightweight fields go into the
 * localStorage snapshot.
 */
export interface Sample {
  id: string;
  name: string;
  /** Duration of the decoded buffer in seconds. */
  durationSec: number;
}

/**
 * A single placed sample clip on the 24h arrangement timeline. Its
 * on-screen width is derived (not stored):
 *   widthHours = (sample.durationSec / playbackRate) * (24 / cycleSeconds)
 * so changing `sky.cycleSeconds` rescales all clips correctly.
 */
export interface SampleClip {
  id: string;
  sampleId: string;
  /** Trigger time in decimal hours, [0, 24). */
  startHour: number;
  /** Linear gain multiplier, [0, 1]. */
  gain: number;
  /** Stereo pan, [-1, 1]. */
  pan: number;
  /** Playback rate (>0). 1 = normal, 2 = double speed / octave up. */
  playbackRate: number;
  /** Fade-in duration in seconds. */
  fadeInSec: number;
  /** Fade-out duration in seconds. */
  fadeOutSec: number;
  /**
   * On each trigger, pick a random detune in [-randomPitchCents,
   * +randomPitchCents] and hold it for the whole playback. 0 disables.
   * Applied as a multiplier on the base playback rate.
   */
  randomPitchCents?: number;
  /** Per-clip reverb wet mix, [0, 1]. Uses an algorithmic Freeverb. */
  reverbMix?: number;
  /** Freeverb roomSize, [0, 1]. Longer = "bigger" tail. */
  reverbDecay?: number;
  /** Delay time in seconds (0..2). */
  delayTimeSec?: number;
  /** Delay feedback amount [0, 0.95). */
  delayFeedback?: number;
  /** Delay wet mix, [0, 1]. */
  delayMix?: number;
  /**
   * Probability the clip fires when the playhead crosses `startHour`.
   * Rolled per crossing. Undefined = 1 (always fire).
   */
  triggerProbability?: number;
}

/**
 * Samples track params. `library` is the uploaded audio set (metadata
 * only); `clips` is the arrangement placed on top of it. One horizontal
 * lane per library entry in the UI.
 */
export interface SamplesParams {
  enabled: boolean;
  /** Master gain for the samples bus, [0, 3]. */
  master: number;
  /** Global pitch offset in cents applied to every trigger. */
  pitchCents: number;
  /** Rate (Hz) of the master pitch LFO. */
  pitchLfoRateHz: number;
  /** Depth (cents) of the master pitch LFO around `pitchCents`. */
  pitchLfoDepthCents: number;
  /** Waveform shape for the master pitch LFO. */
  pitchLfoShape: DroneLfoShape;
  /** Master reverb wet mix, [0, 1] (send from all clips). */
  reverbMix: number;
  /** Master reverb roomSize, [0, 0.99]. */
  reverbDecay: number;
  /** Master delay wet mix, [0, 1]. */
  delayMix: number;
  /** Master delay time (s), [0, 2]. */
  delayTimeSec: number;
  /** Master delay feedback, [0, 0.9]. */
  delayFeedback: number;
  /** Per-engine HPF+LPF chain applied on the master before output. */
  filters: FilterChain;
  library: Sample[];
  clips: SampleClip[];
}

/**
 * A named contiguous slice of the 24h day. `endHour < startHour`
 * means the period wraps midnight (e.g. Night = 20 → 5).
 * Two adjacent periods share an edge — the "next" period always
 * begins where the previous one ends.
 */
export interface DayPeriod {
  id: string;
  name: string;
  startHour: number;
  endHour: number;
  /** Display swatch on the day-cycle bar and scrubber overlay. */
  color: string;
}

export interface DayCycleParams {
  periods: DayPeriod[];
  activePeriodId: string;
  /**
   * When true and `sky.autoPlay` is on, the clock advances into the
   * next period at the end of the current one instead of looping
   * inside it. Off = classic behaviour (loop within period until the
   * user clicks Next).
   */
  autoNext: boolean;
}

/**
 * Shared master frequency processing applied downstream of each
 * instrument's own master gain. A single HPF + LPF is shared by all
 * engines that opt in via the corresponding `applyTo*` flag; opted-out
 * engines route around the EQ to a direct destination path.
 */
export interface MasterFxParams {
  /** Low-pass filter enabled. */
  lpEnabled: boolean;
  /** Low-pass cutoff, Hz (20–20000). */
  lpHz: number;
  /** Low-pass Q, 0.1–12. */
  lpQ: number;
  /** High-pass filter enabled. */
  hpEnabled: boolean;
  /** High-pass cutoff, Hz (20–20000). */
  hpHz: number;
  /** High-pass Q, 0.1–12. */
  hpQ: number;
  /** Route drone through the shared EQ chain. */
  applyToDrone: boolean;
  /** Route pad through the shared EQ chain. */
  applyToPad: boolean;
  /** Route samples through the shared EQ chain. */
  applyToSamples: boolean;
}

/** Length of a period in decimal hours, handling wrap-around. */
export function periodLengthHours(p: DayPeriod): number {
  return p.endHour >= p.startHour
    ? p.endHour - p.startHour
    : 24 - p.startHour + p.endHour;
}

/**
 * Whether the given hour is inside `[startHour, endHour)` on a cyclic
 * 24h axis (handling `end < start` wrap).
 */
export function periodContainsHour(p: DayPeriod, hour: number): boolean {
  const n = ((hour % 24) + 24) % 24;
  return p.endHour >= p.startHour
    ? n >= p.startHour && n < p.endHour
    : n >= p.startHour || n < p.endHour;
}

/**
 * True when `hour` sits inside `[startHour, endHour)` on the cyclic
 * 24h axis. When `endHour < startHour` the range wraps midnight
 * (e.g. 20 → 4 covers 20..24 and 0..4).
 */
export function hourInRange(
  hour: number,
  startHour: number,
  endHour: number,
): boolean {
  const n = ((hour % 24) + 24) % 24;
  if (endHour === startHour) return false;
  return endHour > startHour
    ? n >= startHour && n < endHour
    : n >= startHour || n < endHour;
}

export interface WledParams {
  host: string;
  fps: number;
  enabled: boolean;
}

export interface Breather {
  id: string;
  color: string;
  /**
   * Normalized phase shift in cycles, [0, 1). Lets multiple breathers
   * run the same waveform but offset in time.
   */
  phaseOffset: number;
}

export interface BreathParams {
  enabled: boolean;
  /** Duration of inhale ramp (seconds). */
  inhaleSeconds: number;
  /** Duration of hold at the inhalation peak (seconds). */
  holdPeakSeconds: number;
  /** Duration of exhale ramp (seconds). */
  exhaleSeconds: number;
  /** Duration of hold at the exhalation trough (seconds). */
  holdTroughSeconds: number;
  /**
   * Area of effect anchored near the cloud surface. Defines where the
   * breath influence is applied and how it falls off with distance.
   */
  area: BreathAreaParams;
  breathers: Breather[];
}

export interface BreathAreaParams {
  /** Source direction around cloud center, in degrees. */
  sourceAzimuthDeg: number;
  /** Source elevation in degrees (-90 = below, +90 = above). */
  sourceElevationDeg: number;
  /** Distance from cloud surface along source direction (metres). */
  distanceFromCloud: number;
  /** Radius in metres where influence tapers to zero. */
  radius: number;
  /** Falloff exponent (>1 concentrates near source, <1 broadens). */
  falloffExponent: number;
  /** Visualization color for breath area markers in Breath view. */
  tintColor: string;
  /** Visualization intensity for breath area markers in Breath view. */
  tintAmount: number;
  /** Blend in combined mode: 0 = time of day, 1 = breath. */
  breathVsTimeMix: number;
}

type BreathPatch = Partial<Omit<BreathParams, "area">> & {
  area?: Partial<BreathAreaParams>;
};

export interface SimState {
  ellipsoid: EllipsoidParams;
  cloud: CloudParams;
  strand: StrandParams;
  ambient: AmbientLightParams;
  directional: DirectionalLightParams;
  sky: SkyParams;
  wled: WledParams;
  breath: BreathParams;
  lightning: LightningParams;
  drone: DroneParams;
  pad: PadParams;
  samples: SamplesParams;
  dayCycle: DayCycleParams;
  masterFx: MasterFxParams;
  /**
   * Per-parameter breath-modulation amount, signed in [-1, 1]. Keyed by
   * a stable slider ID (e.g. "drone.masterGain"). Positive = base value
   * moves up on exhale, negative = moves down; magnitude is the fraction
   * of the slider's range applied at full exhale. UI-only for now.
   */
  breathMod: Record<string, number>;
  /** When true, `breathMod` values are applied every frame to the running engines. */
  breathModEnabled: boolean;
  ledViewMode: LedViewMode;
  ledDisplayMode: LedDisplayMode;
  breathTimeCombineMode: BreathTimeCombineMode;
  ledStreamPipeline: LedStreamPipeline;
  ledLocator: LedLocatorState;
  mapping: MappingParams;
  mesh: MeshTargetParams;
  ui: UiParams;
  setEllipsoid: (e: Partial<EllipsoidParams>) => void;
  setCloud: (c: Partial<CloudParams>) => void;
  setStrand: (s: Partial<StrandParams>) => void;
  setAmbient: (a: Partial<AmbientLightParams>) => void;
  setDirectional: (d: Partial<DirectionalLightParams>) => void;
  setSky: (sk: Partial<SkyParams>) => void;
  setWled: (w: Partial<WledParams>) => void;
  setBreath: (b: BreathPatch) => void;
  setLightning: (l: Partial<LightningParams>) => void;
  setDrone: (d: Partial<DroneParams>) => void;
  addDroneNote: (note: DroneNote) => void;
  updateDroneNote: (id: string, patch: Partial<DroneNote>) => void;
  removeDroneNote: (id: string) => void;
  clearDroneNotes: () => void;
  setPad: (p: Partial<PadParams>) => void;
  addPadNote: (note: PadNote) => void;
  updatePadNote: (id: string, patch: Partial<PadNote>) => void;
  removePadNote: (id: string) => void;
  clearPadNotes: () => void;
  setSamples: (p: Partial<SamplesParams>) => void;
  addSample: (sample: Sample) => void;
  removeSample: (id: string) => void;
  addSampleClip: (clip: SampleClip) => void;
  updateSampleClip: (id: string, patch: Partial<SampleClip>) => void;
  removeSampleClip: (id: string) => void;
  clearSampleClips: () => void;
  setDayCycle: (patch: Partial<DayCycleParams>) => void;
  setMasterFx: (patch: Partial<MasterFxParams>) => void;
  setBreathMod: (key: string, value: number) => void;
  setBreathModEnabled: (v: boolean) => void;
  updateDayPeriod: (id: string, patch: Partial<DayPeriod>) => void;
  setActivePeriod: (id: string) => void;
  advancePeriod: () => void;
  previousPeriod: () => void;
  setLedViewMode: (mode: LedViewMode) => void;
  setLedDisplayMode: (mode: LedDisplayMode) => void;
  setBreathTimeCombineMode: (mode: BreathTimeCombineMode) => void;
  setLedStreamPipeline: (patch: Partial<LedStreamPipeline>) => void;
  setLedLocator: (patch: Partial<LedLocatorState>) => void;
  toggleLocatedLed: (index: number) => void;
  clearLocatedLeds: () => void;
  setMapping: (m: Partial<MappingParams>) => void;
  setMesh: (m: Partial<MeshTargetParams>) => void;
  setUi: (u: Partial<UiParams>) => void;
  addMappedLed: (dir: Vec3, pos?: Vec3, normal?: Vec3) => void;
  moveMappedLed: (index: number, dir: Vec3, pos?: Vec3, normal?: Vec3) => void;
  removeLastMappedLed: () => void;
  clearMappedLeds: () => void;
}

export interface LedLocatorState {
  enabled: boolean;
  highlighted: number[];
  color: string;
}

/**
 * A single manually-placed LED in the mapping app. Its location is stored
 * as a unit-sphere direction so it stays glued to the ellipsoid surface
 * when the cloud dimensions change: the surface point is simply
 * `(rx, ry, rz) * dir`.
 */
export interface MappedLed {
  /**
   * Unit-sphere direction used in ellipsoid mode. In mesh mode a `dir` is
   * still stored (the normalised `pos` from origin) so the flip/orientation
   * helpers continue to work uniformly, but bead placement uses `pos`.
   */
  dir: Vec3;
  /** World-space surface point on the uploaded mesh (mesh mode only). */
  pos?: Vec3;
  /** Outward-pointing surface normal at `pos` (mesh mode only). */
  normal?: Vec3;
}

/**
 * Persisted UI toggles for the floating panels on the simulator page.
 * Kept in the store (rather than component-local `useState`) so they
 * round-trip through the snapshot save/load like every other choice.
 */
export interface UiParams {
  showMaster: boolean;
  showBreath: boolean;
  showLightning: boolean;
  showStream: boolean;
}

export type MappingMode = "ellipsoid" | "mesh";

export interface MeshTargetParams {
  /** IndexedDB blob id, or null if no mesh is loaded. */
  id: string | null;
  /** Display name (usually the source filename). */
  name: string;
  /** Uniform scale applied to the imported mesh. */
  scale: number;
  /** Rotation around the vertical (Y) axis, degrees. */
  yawDeg: number;
  /** Rotation around the X axis, degrees. */
  tiltDeg: number;
  /** Vertical offset from origin, metres. */
  offsetY: number;
}

export interface MappingParams {
  /** LEDs in the order they were placed on the strand. */
  leds: MappedLed[];
  /** Which surface the mapping app targets — the ellipsoid or an uploaded mesh. */
  mode: MappingMode;
  /** Mirror mapping orientation vertically (swap top/bottom). */
  flipUpDown: boolean;
  /** Mirror mapping orientation horizontally (swap left/right). */
  flipLeftRight: boolean;
  /**
   * When true, the logical sequence (LED numbering + the order streamed to
   * the simulator/WLED) is the reverse of the placement order — i.e. the
   * last-placed bead becomes #1. Flips which physical end counts as the
   * start of the string.
   */
  reversed: boolean;
  /** Bead display size in the mapping view (metres). */
  ledSize: number;
  /**
   * Maximum world-space distance the next LED can sit from the previous
   * one, in metres. Modelled as an upper bound on the length of each
   * strand segment: clicks farther than this from the last placed bead
   * are rejected and the hover preview turns red. Ignored for the first
   * bead in the strand.
   */
  maxSegmentLength: number;
}

/**
 * The default seed spread across the 24-hour day, per channel. The
 * sun channel emphasises daytime transitions (dawn → noon → sunset),
 * the moon channel emphasises night/twilight, and ambient covers the
 * whole cycle. Users can freely add, delete, and move stops in each
 * track after loading. Declared before `DEFAULTS` so it's out of the
 * temporal dead zone by the time `DEFAULTS` seeds itself.
 */
type ChannelSeed = Array<[number, string]>;

const SUN_SEED: ChannelSeed = [
  [4.5, "blueHour"],
  [6, "azureTwilight"],
  [6.75, "roseDawn"],
  [8, "goldenPeach"],
  [12, "noonSky"],
  [16, "warmDay"],
  [18.25, "emberSunset"],
  [19, "crimsonSunset"],
];

const MOON_SEED: ChannelSeed = [
  [0, "moonlitBlue"],
  [4.5, "blueHour"],
  [7, "roseDawn"],
  [18.5, "emberSunset"],
  [20.5, "violetDusk"],
  [22, "blueHour"],
];

const AMBIENT_SEED: ChannelSeed = [
  [0, "moonlitBlue"],
  [5, "blueHour"],
  [7, "roseDawn"],
  [12, "noonSky"],
  [17, "warmDay"],
  [19, "emberSunset"],
  [21, "violetDusk"],
];

function seedColorFromSwatch(channel: SkyChannel, swatchId: string): string {
  const s = getSwatch(swatchId);
  return channel === "sun"
    ? s.sunColor
    : channel === "moon"
      ? s.moonColor
      : s.ambientColor;
}

export function buildDefaultChannelStops(channel: SkyChannel): SkyChannelStop[] {
  const seed =
    channel === "sun" ? SUN_SEED : channel === "moon" ? MOON_SEED : AMBIENT_SEED;
  return seed.map(([hour, swatchId], i) => ({
    id: `${channel}-${i}-${swatchId}`,
    timeHours: hour,
    swatchId,
    color: seedColorFromSwatch(channel, swatchId),
  }));
}

const DEFAULTS = {
  ellipsoid: { rx: 1.2, ry: 0.8, rz: 1.0 } as EllipsoidParams,
  cloud: {
    opacity: 0.6,
    showOpacity: true,
    rotationXDeg: 0,
    rotationYDeg: 0,
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
  } as CloudParams,
  strand: {
    ledSize: 0.04,
    sensorHemisphereFocus: 0,
  } as StrandParams,
  ambient: { color: "#262830", intensity: 0.25 } as AmbientLightParams,
  directional: {
    color: "#ffffff",
    intensity: 1.0,
    position: [3, 4, 2],
    spread: 1.0,
  } as DirectionalLightParams,
  sky: {
    enabled: true,
    visualizationAmount: 1,
    autoPlay: true,
    timeHours: 12,
    cycleSeconds: 180,
    ambientScale: 1,
    sunScale: 1,
    moonScale: 1,
    sunSpread: 0.9,
    moonSpread: 0.9,
    horizonCutoffDeg: -7,
    horizonSoftnessDeg: 19,
    sunStops: buildDefaultChannelStops("sun"),
    moonStops: buildDefaultChannelStops("moon"),
    ambientStops: buildDefaultChannelStops("ambient"),
  } as SkyParams,
  wled: { host: "192.168.1.50", fps: 30, enabled: false } as WledParams,
  breath: {
    enabled: true,
    inhaleSeconds: 2.5,
    holdPeakSeconds: 0.8,
    exhaleSeconds: 3.5,
    holdTroughSeconds: 0.9,
    area: {
      sourceAzimuthDeg: 0,
      sourceElevationDeg: -90,
      distanceFromCloud: 0.28,
      radius: 1.2,
      falloffExponent: 2.1,
      tintColor: "#8fd8ff",
      tintAmount: 1.2,
      breathVsTimeMix: 0.5,
    },
    breathers: [{ id: "breather-0", color: "#77d5ff", phaseOffset: 0 }],
  } as BreathParams,
  lightning: {
    enabled: false,
    colors: ["#cfe7ff", "#a8c8ff", "#fff2c9"],
    intensityRange: [0.9, 1.5],
    strikesPerMinute: 12,
    falloffDistance: 0.6,
    boltSegments: 10,
    boltJitterRange: [0.25, 0.55],
    travelSpeedRange: [0.5, 2],
    subFlashes: 2,
    spanScale: 0.85,
    minSpanScale: 0.5,
    activeStartHour: 20,
    activeEndHour: 4,
    boltSamples: [],
    backgroundSample: null,
    boltGain: 0.8,
    backgroundGain: 0.35,
    boltPitchJitterCents: 200,
    thunderDelayMs: 800,
    simFps: 60,
  } as LightningParams,
  drone: {
    enabled: false,
    // Sensible pad defaults: fully open filter so the raw tone is
    // audible without further tweaking, gentle ADSR, no modulation.
    masterGain: 0.4,
    waveform: "triangle",
    attack: 0.6,
    decay: 0.8,
    sustain: 0.9,
    release: 1.5,
    tremoloRateHz: 4,
    tremoloDepth: 0,
    tremoloShape: "sine",
    saturation: 0,
    distortionEnabled: false,
    distortionDrive: 0.5,
    distortionMix: 0.5,
    filters: DEFAULT_FILTER_CHAIN,
    // A single C1 sustained through the whole 24h so the app makes
    // sound out of the box; users layer more notes on top.
    notes: [
      {
        id: "drone-n0",
        note: "C1",
        startHour: 0,
        endHour: 24,
        gain: 0,
        filterHz: 20000,
      },
    ],
  } as DroneParams,
  pad: {
    enabled: false,
    // Warm-pad defaults: slow attack + release, saw + subtle unison spread,
    // moderately closed low-pass with a gentle envelope, slow chorus, and
    // a comfortable amount of reverb.
    master: 0.35,
    waveform: "sawtooth",
    unisonCount: 3,
    unisonDetuneCents: 12,
    attack: 1.5,
    decay: 0.4,
    sustain: 0.8,
    release: 3.0,
    filterHz: 900,
    filterQ: 0.7,
    filterEnvAmount: 1200,
    chorusRateHz: 0.3,
    chorusDepth: 0.4,
    driftRateHz: 0.25,
    driftDepthCents: 4,
    filterLfoRateHz: 0.4,
    filterLfoDepth: 0,
    saturation: 0.15,
    filters: DEFAULT_FILTER_CHAIN,
    notes: [],
  } as PadParams,
  samples: {
    enabled: false,
    master: 1.2,
    pitchCents: 0,
    pitchLfoRateHz: 1,
    pitchLfoDepthCents: 0,
    pitchLfoShape: "sine",
    reverbMix: 0,
    reverbDecay: 0.7,
    delayMix: 0,
    delayTimeSec: 0.25,
    delayFeedback: 0.3,
    filters: DEFAULT_FILTER_CHAIN,
    library: [],
    clips: [],
  } as SamplesParams,
  dayCycle: {
    periods: [
      { id: "dawn", name: "Dawn", startHour: 5, endHour: 8, color: "#f472b6" },
      { id: "day", name: "Day", startHour: 8, endHour: 17, color: "#facc15" },
      { id: "dusk", name: "Dusk", startHour: 17, endHour: 20, color: "#fb923c" },
      { id: "night", name: "Night", startHour: 20, endHour: 5, color: "#6366f1" },
    ],
    activePeriodId: "dawn",
    autoNext: false,
  } as DayCycleParams,
  masterFx: {
    lpEnabled: false,
    lpHz: 20000,
    lpQ: 0.7,
    hpEnabled: false,
    hpHz: 40,
    hpQ: 0.7,
    applyToDrone: true,
    applyToPad: true,
    applyToSamples: true,
  } as MasterFxParams,
  breathMod: {} as Record<string, number>,
  breathModEnabled: false,
  ledViewMode: "breathPlusTimeOfDay" as LedViewMode,
  ledDisplayMode: "sensors" as LedDisplayMode,
  breathTimeCombineMode: "revealOnInhale" as BreathTimeCombineMode,
  ledStreamPipeline: {
    timeOfDayStage: true,
    breathStage: true,
    lightningStage: true,
    locatorOverrideStage: true,
  } as LedStreamPipeline,
  ledLocator: {
    enabled: false,
    highlighted: [],
    color: "#ffe14d",
  } as LedLocatorState,
  mapping: {
    leds: [],
    mode: "ellipsoid",
    flipUpDown: false,
    flipLeftRight: false,
    reversed: false,
    ledSize: 0.01,
    maxSegmentLength: 0.05,
  } as MappingParams,
  mesh: {
    id: null,
    name: "",
    scale: 1,
    yawDeg: 0,
    tiltDeg: 0,
    offsetY: 0,
  } as MeshTargetParams,
  ui: {
    showMaster: true,
    showBreath: true,
    showLightning: false,
    showStream: false,
  } as UiParams,
};

function normalizeLedViewMode(mode: unknown): LedViewMode {
  if (mode === "lightOnly") return "timeOfDay";
  if (mode === "breathPlusLight") return "breathPlusTimeOfDay";
  if (
    mode === "breathIntensity" ||
    mode === "timeOfDay" ||
    mode === "breathPlusTimeOfDay"
  ) {
    return mode;
  }
  return DEFAULTS.ledViewMode;
}

/**
 * Migration from the previous tri-color stop model where each stop
 * pinned sun/moon/ambient together. We just fan each old stop out into
 * one channel stop for each of the three lists at the same hour.
 */
function channelsFromLegacyStops(
  stops: LegacyTriStop[],
): Pick<SkyParams, "sunStops" | "moonStops" | "ambientStops"> {
  const mk = (channel: SkyChannel): SkyChannelStop[] =>
    stops.map((s, i) => ({
      id: `${channel}-legacy-${i}-${s.id}`,
      timeHours: s.timeHours,
      swatchId: s.swatchId,
      color:
        channel === "sun"
          ? s.sunColor
          : channel === "moon"
            ? s.moonColor
            : s.ambientColor,
    }));
  return {
    sunStops: mk("sun"),
    moonStops: mk("moon"),
    ambientStops: mk("ambient"),
  };
}

/**
 * Older-still snapshots stored a fixed-phase palette. Convert it to
 * three independent channel timelines by iterating the phase → hour
 * mapping and pulling the matching channel color from each entry.
 */
function channelsFromLegacyPalette(
  palette: Record<string, { ambientColor?: string; sunColor?: string; moonColor?: string }>,
): Pick<SkyParams, "sunStops" | "moonStops" | "ambientStops"> {
  const phaseToHour: Record<string, number> = {
    night: 0,
    preDawn: 4.5,
    blueHour: 6,
    sunrise: 6.75,
    goldenHour: 8,
    day: 12,
    afternoon: 16,
    sunset: 18.5,
    twilight: 20,
  };
  const mk = (channel: SkyChannel): SkyChannelStop[] => {
    const out: SkyChannelStop[] = [];
    let i = 0;
    for (const [phaseId, hour] of Object.entries(phaseToHour)) {
      const p = palette[phaseId];
      if (!p) continue;
      const c =
        channel === "sun"
          ? p.sunColor
          : channel === "moon"
            ? p.moonColor
            : p.ambientColor;
      out.push({
        id: `${channel}-legacy-${i++}-${phaseId}`,
        timeHours: hour,
        swatchId: CUSTOM_SWATCH_ID,
        color: c ?? "#101828",
      });
    }
    return out;
  };
  const sun = mk("sun");
  return sun.length > 0
    ? { sunStops: sun, moonStops: mk("moon"), ambientStops: mk("ambient") }
    : {
        sunStops: buildDefaultChannelStops("sun"),
        moonStops: buildDefaultChannelStops("moon"),
        ambientStops: buildDefaultChannelStops("ambient"),
      };
}

/**
 * Resolve a saved sky payload (which may be from any historical schema
 * version) into three channel arrays. Preference order: existing
 * per-channel arrays → legacy `stops` list → older-still `palette` map
 * → hardcoded defaults.
 */
function resolveChannelStops(
  savedSky: Partial<SkyParams> & {
    stops?: LegacyTriStop[];
    palette?: Record<string, unknown>;
  },
): Pick<SkyParams, "sunStops" | "moonStops" | "ambientStops"> {
  const hasChannel =
    Array.isArray(savedSky.sunStops) &&
    savedSky.sunStops.length > 0 &&
    Array.isArray(savedSky.moonStops) &&
    Array.isArray(savedSky.ambientStops);
  if (hasChannel) {
    return {
      sunStops: savedSky.sunStops!,
      moonStops: savedSky.moonStops!,
      ambientStops: savedSky.ambientStops!,
    };
  }
  if (Array.isArray(savedSky.stops) && savedSky.stops.length > 0) {
    return channelsFromLegacyStops(savedSky.stops);
  }
  if (savedSky.palette && typeof savedSky.palette === "object") {
    return channelsFromLegacyPalette(
      savedSky.palette as Record<
        string,
        { ambientColor?: string; sunColor?: string; moonColor?: string }
      >,
    );
  }
  return {
    sunStops: DEFAULTS.sky.sunStops,
    moonStops: DEFAULTS.sky.moonStops,
    ambientStops: DEFAULTS.sky.ambientStops,
  };
}

/**
 * Reconcile a saved `drone` payload against the current shape. Merges
 * legacy schemas (flat timbre fields, or the timbre-stops variant) by
 * taking the first timbre stop or the flat fields as the current
 * global synth patch. Missing fields fall back to defaults.
 */
function resolveDroneParams(
  saved: (Partial<DroneParams> & Record<string, unknown>) | undefined,
): DroneParams {
  if (!saved) return DEFAULTS.drone;
  const notes = Array.isArray(saved.notes)
    ? (saved.notes as DroneNote[])
    : DEFAULTS.drone.notes;
  const legacyStops = saved.timbreStops as
    | Array<{ timbre?: Partial<DroneParams> }>
    | undefined;
  const legacyTimbre = legacyStops?.[0]?.timbre ?? undefined;
  const pick = <K extends keyof DroneParams>(k: K): DroneParams[K] => {
    const v =
      (saved as Record<string, unknown>)[k] ??
      (legacyTimbre as Record<string, unknown> | undefined)?.[k];
    return (v ?? DEFAULTS.drone[k]) as DroneParams[K];
  };
  const attackLegacy = (saved as Record<string, unknown>).attackSec;
  const releaseLegacy = (saved as Record<string, unknown>).releaseSec;
  return {
    enabled:
      typeof saved.enabled === "boolean" ? saved.enabled : DEFAULTS.drone.enabled,
    masterGain: pick("masterGain"),
    waveform: pick("waveform"),
    attack:
      typeof attackLegacy === "number" ? attackLegacy : pick("attack"),
    decay: pick("decay"),
    sustain: pick("sustain"),
    release:
      typeof releaseLegacy === "number" ? releaseLegacy : pick("release"),
    tremoloRateHz: pick("tremoloRateHz"),
    tremoloDepth: pick("tremoloDepth"),
    tremoloShape: pick("tremoloShape"),
    saturation:
      typeof saved.saturation === "number"
        ? saved.saturation
        : DEFAULTS.drone.saturation,
    distortionEnabled: pick("distortionEnabled"),
    distortionDrive: pick("distortionDrive"),
    distortionMix: pick("distortionMix"),
    filters: resolveFilterChain((saved as Record<string, unknown>).filters),
    notes,
  };
}

/**
 * Reconcile a saved `pad` payload against the current shape. Missing
 * fields fall back to defaults; unknown fields are ignored.
 */
function resolvePadParams(
  saved: (Partial<PadParams> & Record<string, unknown>) | undefined,
): PadParams {
  if (!saved) return DEFAULTS.pad;
  const notes = Array.isArray(saved.notes)
    ? (saved.notes as PadNote[])
    : DEFAULTS.pad.notes;
  const pick = <K extends keyof PadParams>(k: K): PadParams[K] => {
    const v = (saved as Record<string, unknown>)[k];
    return (v ?? DEFAULTS.pad[k]) as PadParams[K];
  };
  return {
    enabled:
      typeof saved.enabled === "boolean" ? saved.enabled : DEFAULTS.pad.enabled,
    master: pick("master"),
    waveform: pick("waveform"),
    unisonCount: pick("unisonCount"),
    unisonDetuneCents: pick("unisonDetuneCents"),
    attack: pick("attack"),
    decay: pick("decay"),
    sustain: pick("sustain"),
    release: pick("release"),
    filterHz: pick("filterHz"),
    filterQ: pick("filterQ"),
    filterEnvAmount: pick("filterEnvAmount"),
    chorusRateHz: pick("chorusRateHz"),
    chorusDepth: pick("chorusDepth"),
    driftRateHz: pick("driftRateHz"),
    driftDepthCents: pick("driftDepthCents"),
    filterLfoRateHz: pick("filterLfoRateHz"),
    filterLfoDepth: pick("filterLfoDepth"),
    saturation: pick("saturation"),
    filters: resolveFilterChain((saved as Record<string, unknown>).filters),
    notes,
  };
}

/**
 * Reconcile a saved `samples` payload against the current shape.
 * Coerces malformed entries to defaults. Drops clips whose `sampleId`
 * doesn't exist in the loaded library — the referenced blob may have
 * been evicted from IndexedDB.
 */
function resolveSamplesParams(
  saved: (Partial<SamplesParams> & Record<string, unknown>) | undefined,
): SamplesParams {
  if (!saved) return DEFAULTS.samples;
  const library: Sample[] = Array.isArray(saved.library)
    ? (saved.library as Sample[]).filter(
        (s) => s && typeof s.id === "string" && typeof s.name === "string",
      )
    : DEFAULTS.samples.library;
  const libIds = new Set(library.map((s) => s.id));
  const clips: SampleClip[] = Array.isArray(saved.clips)
    ? (saved.clips as SampleClip[])
        .filter((c) => c && typeof c.id === "string" && libIds.has(c.sampleId))
        .map((c) => ({
          id: c.id,
          sampleId: c.sampleId,
          startHour: Math.max(0, Math.min(24, c.startHour ?? 0)),
          gain: Math.max(0, Math.min(1, c.gain ?? 1)),
          pan: Math.max(-1, Math.min(1, c.pan ?? 0)),
          playbackRate: Math.max(0.05, Math.min(8, c.playbackRate ?? 1)),
          fadeInSec: Math.max(0, c.fadeInSec ?? 0),
          fadeOutSec: Math.max(0, c.fadeOutSec ?? 0),
          randomPitchCents: Math.max(0, Math.min(1200, c.randomPitchCents ?? 0)),
          reverbMix: Math.max(0, Math.min(1, c.reverbMix ?? 0)),
          reverbDecay: Math.max(0, Math.min(1, c.reverbDecay ?? 0.7)),
          delayTimeSec: Math.max(0, Math.min(2, c.delayTimeSec ?? 0.25)),
          delayFeedback: Math.max(0, Math.min(0.95, c.delayFeedback ?? 0.3)),
          delayMix: Math.max(0, Math.min(1, c.delayMix ?? 0)),
        }))
    : DEFAULTS.samples.clips;
  return {
    enabled:
      typeof saved.enabled === "boolean"
        ? saved.enabled
        : DEFAULTS.samples.enabled,
    master:
      typeof saved.master === "number"
        ? Math.max(0, Math.min(3, saved.master))
        : DEFAULTS.samples.master,
    pitchCents:
      typeof saved.pitchCents === "number"
        ? Math.max(-1200, Math.min(1200, saved.pitchCents))
        : DEFAULTS.samples.pitchCents,
    pitchLfoRateHz:
      typeof saved.pitchLfoRateHz === "number"
        ? Math.max(0, Math.min(20, saved.pitchLfoRateHz))
        : DEFAULTS.samples.pitchLfoRateHz,
    pitchLfoDepthCents:
      typeof saved.pitchLfoDepthCents === "number"
        ? Math.max(0, Math.min(1200, saved.pitchLfoDepthCents))
        : DEFAULTS.samples.pitchLfoDepthCents,
    pitchLfoShape:
      saved.pitchLfoShape === "triangle" ||
      saved.pitchLfoShape === "square" ||
      saved.pitchLfoShape === "sawtooth" ||
      saved.pitchLfoShape === "sine"
        ? saved.pitchLfoShape
        : DEFAULTS.samples.pitchLfoShape,
    reverbMix:
      typeof saved.reverbMix === "number"
        ? Math.max(0, Math.min(1, saved.reverbMix))
        : DEFAULTS.samples.reverbMix,
    reverbDecay:
      typeof saved.reverbDecay === "number"
        ? Math.max(0, Math.min(0.99, saved.reverbDecay))
        : DEFAULTS.samples.reverbDecay,
    delayMix:
      typeof saved.delayMix === "number"
        ? Math.max(0, Math.min(1, saved.delayMix))
        : DEFAULTS.samples.delayMix,
    delayTimeSec:
      typeof saved.delayTimeSec === "number"
        ? Math.max(0, Math.min(2, saved.delayTimeSec))
        : DEFAULTS.samples.delayTimeSec,
    delayFeedback:
      typeof saved.delayFeedback === "number"
        ? Math.max(0, Math.min(0.9, saved.delayFeedback))
        : DEFAULTS.samples.delayFeedback,
    filters: resolveFilterChain((saved as Record<string, unknown>).filters),
    library,
    clips,
  };
}

/**
 * Reconcile a saved `dayCycle` payload. Falls back to defaults for a
 * missing or malformed slice; unknown activeId → first period.
 */
function resolveDayCycle(
  saved: Partial<DayCycleParams> | undefined,
): DayCycleParams {
  if (!saved) return DEFAULTS.dayCycle;
  const periods: DayPeriod[] = Array.isArray(saved.periods) && saved.periods.length > 0
    ? saved.periods
        .filter((p): p is DayPeriod =>
          !!p &&
          typeof p.id === "string" &&
          typeof p.name === "string" &&
          typeof p.startHour === "number" &&
          typeof p.endHour === "number" &&
          typeof p.color === "string",
        )
        .map((p) => ({
          id: p.id,
          name: p.name,
          startHour: Math.max(0, Math.min(24, p.startHour)),
          endHour: Math.max(0, Math.min(24, p.endHour)),
          color: p.color,
        }))
    : DEFAULTS.dayCycle.periods;
  const activePeriodId =
    saved.activePeriodId && periods.some((p) => p.id === saved.activePeriodId)
      ? saved.activePeriodId
      : periods[0].id;
  const autoNext =
    typeof saved.autoNext === "boolean" ? saved.autoNext : DEFAULTS.dayCycle.autoNext;
  return { periods, activePeriodId, autoNext };
}

/**
 * Reconcile a saved `masterFx` payload. If missing, tries to migrate
 * values from the legacy drone-scoped LPF/HPF fields so users don't
 * lose their previously-tuned master EQ. Peak filter fields are
 * dropped entirely.
 */
function resolveMasterFx(
  saved: Partial<MasterFxParams> | undefined,
  legacyDrone?: Record<string, unknown>,
): MasterFxParams {
  const d = DEFAULTS.masterFx;
  const pickBool = (
    v: unknown,
    fallback: boolean,
  ): boolean => (typeof v === "boolean" ? v : fallback);
  const pickNum = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  if (saved && typeof saved === "object") {
    return {
      lpEnabled: pickBool(saved.lpEnabled, d.lpEnabled),
      lpHz: pickNum(saved.lpHz, d.lpHz),
      lpQ: pickNum(saved.lpQ, d.lpQ),
      hpEnabled: pickBool(saved.hpEnabled, d.hpEnabled),
      hpHz: pickNum(saved.hpHz, d.hpHz),
      hpQ: pickNum(saved.hpQ, d.hpQ),
      applyToDrone: pickBool(saved.applyToDrone, d.applyToDrone),
      applyToPad: pickBool(saved.applyToPad, d.applyToPad),
      applyToSamples: pickBool(saved.applyToSamples, d.applyToSamples),
    };
  }
  if (legacyDrone) {
    return {
      lpEnabled: pickBool(legacyDrone.filterEnabled, d.lpEnabled),
      lpHz: pickNum(legacyDrone.filterHz, d.lpHz),
      lpQ: pickNum(legacyDrone.filterQ, d.lpQ),
      hpEnabled: pickBool(legacyDrone.highPassEnabled, d.hpEnabled),
      hpHz: pickNum(legacyDrone.highPassHz, d.hpHz),
      hpQ: pickNum(legacyDrone.highPassQ, d.hpQ),
      applyToDrone: d.applyToDrone,
      applyToPad: d.applyToPad,
      applyToSamples: d.applyToSamples,
    };
  }
  return d;
}

/**
 * Reconcile a saved `lightning` payload. Any missing range field is
 * back-filled from its legacy scalar so previously-saved snapshots
 * (before the ranges existed) keep working with sensible values.
 */
function resolveLightning(input: unknown): LightningParams {
  const d = DEFAULTS.lightning;
  if (!input || typeof input !== "object") return d;
  const saved = input as Partial<LightningParams> & Record<string, unknown>;
  const asPair = (
    v: unknown,
    fallback: [number, number],
  ): [number, number] => {
    if (Array.isArray(v) && v.length === 2 &&
        typeof v[0] === "number" && typeof v[1] === "number") {
      return [Math.min(v[0], v[1]), Math.max(v[0], v[1])];
    }
    return fallback;
  };
  const asPairFromScalar = (
    rangeKey: keyof LightningParams,
    legacyKey: string,
    fallback: [number, number],
  ): [number, number] => {
    const explicit = (saved as Record<string, unknown>)[rangeKey as string];
    if (Array.isArray(explicit)) return asPair(explicit, fallback);
    const scalar = (saved as Record<string, unknown>)[legacyKey];
    if (typeof scalar === "number") return [scalar, scalar];
    return fallback;
  };
  return {
    ...d,
    ...saved,
    colors: (() => {
      const c = (saved as Record<string, unknown>).colors;
      if (
        Array.isArray(c) &&
        c.length === 3 &&
        typeof c[0] === "string" &&
        typeof c[1] === "string" &&
        typeof c[2] === "string"
      ) {
        return [c[0], c[1], c[2]] as [string, string, string];
      }
      const legacy = (saved as Record<string, unknown>).color;
      if (typeof legacy === "string") {
        return [legacy, legacy, legacy] as [string, string, string];
      }
      return d.colors;
    })(),
    intensityRange: asPairFromScalar(
      "intensityRange",
      "intensity",
      d.intensityRange,
    ),
    falloffDistance: (() => {
      const rec = saved as Record<string, unknown>;
      const explicit = rec.falloffDistance;
      if (typeof explicit === "number" && Number.isFinite(explicit)) {
        return Math.max(0.02, explicit);
      }
      // Migration from the old fixed-radius model.
      const legacy = rec.boltRadius;
      if (typeof legacy === "number" && Number.isFinite(legacy)) {
        return Math.max(0.02, legacy);
      }
      const range = rec.boltRadiusRange;
      if (
        Array.isArray(range) &&
        typeof range[0] === "number" &&
        typeof range[1] === "number"
      ) {
        return Math.max(0.02, (range[0] + range[1]) / 2);
      }
      return d.falloffDistance;
    })(),
    boltJitterRange: asPairFromScalar(
      "boltJitterRange",
      "boltJitter",
      d.boltJitterRange,
    ),
    travelSpeedRange: asPairFromScalar(
      "travelSpeedRange",
      "travelSpeed",
      d.travelSpeedRange,
    ),
    thunderDelayMs: (() => {
      const v = (saved as Record<string, unknown>).thunderDelayMs;
      if (typeof v !== "number" || !Number.isFinite(v)) return d.thunderDelayMs;
      return Math.max(0, Math.min(10000, v));
    })(),
  };
}

/** Seed the store from a localStorage snapshot if one exists. */
function initialState() {
  const saved = loadSnapshot();
  if (!saved) return DEFAULTS;
  const savedSky = (saved.sky ?? {}) as Partial<SkyParams> & {
    stops?: LegacyTriStop[];
    palette?: Record<string, unknown>;
  };
  const channels = resolveChannelStops(savedSky);
  return {
    ellipsoid: { ...DEFAULTS.ellipsoid, ...saved.ellipsoid },
    cloud: { ...DEFAULTS.cloud, ...saved.cloud },
    strand: { ...DEFAULTS.strand, ...saved.strand },
    ambient: { ...DEFAULTS.ambient, ...saved.ambient },
    directional: { ...DEFAULTS.directional, ...saved.directional },
    sky: {
      ...DEFAULTS.sky,
      ...savedSky,
      ...channels,
    },
    // Don't auto-resume streaming on page load: if the user reopens the app
    // they probably don't want it immediately blasting UDP to the strip.
    wled: { ...DEFAULTS.wled, ...saved.wled, enabled: false },
    breath: {
      ...DEFAULTS.breath,
      ...saved.breath,
      area: {
        ...DEFAULTS.breath.area,
        // Older snapshots stored these params under `wind`; fall back to
        // that so previously saved settings still apply.
        ...(saved.breath as { wind?: Partial<BreathAreaParams> } | undefined)
          ?.wind,
        ...saved.breath?.area,
      },
    },
    lightning: resolveLightning(saved.lightning),
    drone: resolveDroneParams(
      saved.drone as
        | (Partial<DroneParams> & Record<string, unknown>)
        | undefined,
    ),
    pad: resolvePadParams(
      saved.pad as
        | (Partial<PadParams> & Record<string, unknown>)
        | undefined,
    ),
    samples: resolveSamplesParams(
      saved.samples as
        | (Partial<SamplesParams> & Record<string, unknown>)
        | undefined,
    ),
    dayCycle: resolveDayCycle(saved.dayCycle),
    masterFx: resolveMasterFx(
      saved.masterFx as Partial<MasterFxParams> | undefined,
      saved.drone as Record<string, unknown> | undefined,
    ),
    breathMod: (() => {
      const src = (saved as unknown as Record<string, unknown>).breathMod;
      if (!src || typeof src !== "object") return {};
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
        if (typeof v === "number" && Number.isFinite(v)) {
          out[k] = Math.max(-1, Math.min(1, v));
        }
      }
      return out;
    })(),
    breathModEnabled: (() => {
      const v = (saved as unknown as Record<string, unknown>).breathModEnabled;
      return typeof v === "boolean" ? v : DEFAULTS.breathModEnabled;
    })(),
    ledViewMode: normalizeLedViewMode(saved.ledViewMode),
    ledDisplayMode:
      saved.ledDisplayMode === "leds" || saved.ledDisplayMode === "sensors"
        ? saved.ledDisplayMode
        : DEFAULTS.ledDisplayMode,
    breathTimeCombineMode:
      saved.breathTimeCombineMode === "linearMix" ||
      saved.breathTimeCombineMode === "revealOnInhale"
        ? saved.breathTimeCombineMode
        : DEFAULTS.breathTimeCombineMode,
    ledStreamPipeline: {
      ...DEFAULTS.ledStreamPipeline,
      ...saved.ledStreamPipeline,
    },
    ledLocator: { ...DEFAULTS.ledLocator, ...saved.ledLocator },
    mapping: { ...DEFAULTS.mapping, ...saved.mapping },
    mesh: { ...DEFAULTS.mesh, ...(saved.mesh ?? {}) },
    ui: { ...DEFAULTS.ui, ...(saved.ui ?? {}) },
  };
}

export const useSimStore = create<SimState>((set) => ({
  ...initialState(),
  setEllipsoid: (e) => set((s) => ({ ellipsoid: { ...s.ellipsoid, ...e } })),
  setCloud: (c) => set((s) => ({ cloud: { ...s.cloud, ...c } })),
  setStrand: (st) => set((s) => ({ strand: { ...s.strand, ...st } })),
  setAmbient: (a) => set((s) => ({ ambient: { ...s.ambient, ...a } })),
  setDirectional: (d) =>
    set((s) => ({ directional: { ...s.directional, ...d } })),
  setSky: (sk) => set((s) => ({ sky: { ...s.sky, ...sk } })),
  setWled: (w) => set((s) => ({ wled: { ...s.wled, ...w } })),
  setBreath: (b) =>
    set((s) => ({
      breath: {
        ...s.breath,
        ...b,
        area: { ...s.breath.area, ...b.area },
      },
    })),
  setLightning: (l) => set((s) => ({ lightning: { ...s.lightning, ...l } })),
  setDrone: (d) => set((s) => ({ drone: { ...s.drone, ...d } })),
  addDroneNote: (note) =>
    set((s) => ({ drone: { ...s.drone, notes: [...s.drone.notes, note] } })),
  updateDroneNote: (id, patch) =>
    set((s) => ({
      drone: {
        ...s.drone,
        notes: s.drone.notes.map((n) =>
          n.id === id ? { ...n, ...patch } : n,
        ),
      },
    })),
  removeDroneNote: (id) =>
    set((s) => ({
      drone: { ...s.drone, notes: s.drone.notes.filter((n) => n.id !== id) },
    })),
  clearDroneNotes: () =>
    set((s) => ({ drone: { ...s.drone, notes: [] } })),
  setPad: (p) => set((s) => ({ pad: { ...s.pad, ...p } })),
  addPadNote: (note) =>
    set((s) => ({ pad: { ...s.pad, notes: [...s.pad.notes, note] } })),
  updatePadNote: (id, patch) =>
    set((s) => ({
      pad: {
        ...s.pad,
        notes: s.pad.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
      },
    })),
  removePadNote: (id) =>
    set((s) => ({
      pad: { ...s.pad, notes: s.pad.notes.filter((n) => n.id !== id) },
    })),
  clearPadNotes: () => set((s) => ({ pad: { ...s.pad, notes: [] } })),
  setSamples: (p) => set((s) => ({ samples: { ...s.samples, ...p } })),
  addSample: (sample) =>
    set((s) => ({
      samples: { ...s.samples, library: [...s.samples.library, sample] },
    })),
  removeSample: (id) =>
    set((s) => ({
      samples: {
        ...s.samples,
        library: s.samples.library.filter((x) => x.id !== id),
        // Any clips referencing this sample become orphaned; drop them.
        clips: s.samples.clips.filter((c) => c.sampleId !== id),
      },
    })),
  addSampleClip: (clip) =>
    set((s) => ({
      samples: { ...s.samples, clips: [...s.samples.clips, clip] },
    })),
  updateSampleClip: (id, patch) =>
    set((s) => ({
      samples: {
        ...s.samples,
        clips: s.samples.clips.map((c) =>
          c.id === id ? { ...c, ...patch } : c,
        ),
      },
    })),
  removeSampleClip: (id) =>
    set((s) => ({
      samples: {
        ...s.samples,
        clips: s.samples.clips.filter((c) => c.id !== id),
      },
    })),
  clearSampleClips: () =>
    set((s) => ({ samples: { ...s.samples, clips: [] } })),
  setDayCycle: (patch) =>
    set((s) => ({ dayCycle: { ...s.dayCycle, ...patch } })),
  setMasterFx: (patch) =>
    set((s) => ({ masterFx: { ...s.masterFx, ...patch } })),
  setBreathMod: (key, value) =>
    set((s) => {
      const next = { ...s.breathMod };
      const clamped = Math.max(-1, Math.min(1, value));
      if (Math.abs(clamped) < 1e-4) delete next[key];
      else next[key] = clamped;
      return { breathMod: next };
    }),
  setBreathModEnabled: (v) => set({ breathModEnabled: v }),
  updateDayPeriod: (id, patch) =>
    set((s) => ({
      dayCycle: {
        ...s.dayCycle,
        periods: s.dayCycle.periods.map((p) =>
          p.id === id ? { ...p, ...patch } : p,
        ),
      },
    })),
  setActivePeriod: (id) =>
    set((s) => {
      const target = s.dayCycle.periods.find((p) => p.id === id);
      if (!target) return {};
      // Snap the clock to the period's start so the loop begins there.
      return {
        dayCycle: { ...s.dayCycle, activePeriodId: id },
        sky: { ...s.sky, timeHours: target.startHour },
      };
    }),
  advancePeriod: () =>
    set((s) => {
      const idx = s.dayCycle.periods.findIndex(
        (p) => p.id === s.dayCycle.activePeriodId,
      );
      const next = s.dayCycle.periods[(idx + 1) % s.dayCycle.periods.length];
      if (!next) return {};
      return {
        dayCycle: { ...s.dayCycle, activePeriodId: next.id },
        sky: { ...s.sky, timeHours: next.startHour },
      };
    }),
  previousPeriod: () =>
    set((s) => {
      const n = s.dayCycle.periods.length;
      const idx = s.dayCycle.periods.findIndex(
        (p) => p.id === s.dayCycle.activePeriodId,
      );
      const prev = s.dayCycle.periods[(idx - 1 + n) % n];
      if (!prev) return {};
      return {
        dayCycle: { ...s.dayCycle, activePeriodId: prev.id },
        sky: { ...s.sky, timeHours: prev.startHour },
      };
    }),
  setLedViewMode: (mode) => set({ ledViewMode: mode }),
  setLedDisplayMode: (mode) => set({ ledDisplayMode: mode }),
  setBreathTimeCombineMode: (mode) => set({ breathTimeCombineMode: mode }),
  setLedStreamPipeline: (patch) =>
    set((s) => ({
      ledStreamPipeline: { ...s.ledStreamPipeline, ...patch },
    })),
  setLedLocator: (patch) =>
    set((s) => ({ ledLocator: { ...s.ledLocator, ...patch } })),
  toggleLocatedLed: (index) =>
    set((s) => {
      const i = Math.max(0, Math.floor(index));
      const exists = s.ledLocator.highlighted.includes(i);
      return {
        ledLocator: {
          ...s.ledLocator,
          highlighted: exists
            ? s.ledLocator.highlighted.filter((x) => x !== i)
            : [...s.ledLocator.highlighted, i],
        },
      };
    }),
  clearLocatedLeds: () =>
    set((s) => ({ ledLocator: { ...s.ledLocator, highlighted: [] } })),
  setMapping: (m) => set((s) => ({ mapping: { ...s.mapping, ...m } })),
  setMesh: (m) => set((s) => ({ mesh: { ...s.mesh, ...m } })),
  setUi: (u) => set((s) => ({ ui: { ...s.ui, ...u } })),
  addMappedLed: (dir, pos, normal) =>
    set((s) => ({
      mapping: {
        ...s.mapping,
        leds: [...s.mapping.leds, { dir, pos, normal }],
      },
    })),
  moveMappedLed: (index, dir, pos, normal) =>
    set((s) => ({
      mapping: {
        ...s.mapping,
        leds: s.mapping.leds.map((l, i) =>
          i === index ? { dir, pos, normal } : l,
        ),
      },
    })),
  removeLastMappedLed: () =>
    set((s) => ({
      mapping: { ...s.mapping, leds: s.mapping.leds.slice(0, -1) },
    })),
  clearMappedLeds: () =>
    set((s) => ({ mapping: { ...s.mapping, leds: [] } })),
}));

/**
 * Apply a previously-saved snapshot to the live store. Returns the values
 * we wrote so the leva controls (which keep their own state) can be
 * imperatively synced.
 */
export function applySnapshot(snap: Snapshot): Snapshot {
  const s = useSimStore.getState();
  s.setEllipsoid(snap.ellipsoid);
  s.setCloud(snap.cloud);
  s.setStrand(snap.strand);
  s.setAmbient(snap.ambient);
  s.setDirectional(snap.directional);
  const snapSky = (snap.sky ?? {}) as Partial<SkyParams> & {
    stops?: LegacyTriStop[];
    palette?: Record<string, unknown>;
  };
  const channels = resolveChannelStops(snapSky);
  s.setSky({
    ...DEFAULTS.sky,
    ...snapSky,
    ...channels,
  });
  // Same caveat as initialState — never re-enable streaming via a load.
  s.setWled({ ...snap.wled, enabled: false });
  s.setBreath({
    ...DEFAULTS.breath,
    ...snap.breath,
    area: {
      ...DEFAULTS.breath.area,
      ...(snap.breath as { wind?: Partial<BreathAreaParams> } | undefined)
        ?.wind,
      ...snap.breath?.area,
    },
  });
  s.setLightning(resolveLightning(snap.lightning));
  s.setDrone(
    resolveDroneParams(
      snap.drone as
        | (Partial<DroneParams> & Record<string, unknown>)
        | undefined,
    ),
  );
  s.setPad(
    resolvePadParams(
      snap.pad as
        | (Partial<PadParams> & Record<string, unknown>)
        | undefined,
    ),
  );
  s.setSamples(
    resolveSamplesParams(
      snap.samples as
        | (Partial<SamplesParams> & Record<string, unknown>)
        | undefined,
    ),
  );
  s.setDayCycle(resolveDayCycle(snap.dayCycle));
  s.setMasterFx(
    resolveMasterFx(
      snap.masterFx as Partial<MasterFxParams> | undefined,
      snap.drone as Record<string, unknown> | undefined,
    ),
  );
  s.setLedViewMode(normalizeLedViewMode(snap.ledViewMode));
  if (snap.ledDisplayMode === "leds" || snap.ledDisplayMode === "sensors") {
    s.setLedDisplayMode(snap.ledDisplayMode);
  } else {
    s.setLedDisplayMode(DEFAULTS.ledDisplayMode);
  }
  if (
    snap.breathTimeCombineMode === "linearMix" ||
    snap.breathTimeCombineMode === "revealOnInhale"
  ) {
    s.setBreathTimeCombineMode(snap.breathTimeCombineMode);
  } else {
    s.setBreathTimeCombineMode(DEFAULTS.breathTimeCombineMode);
  }
  s.setLedStreamPipeline({
    ...DEFAULTS.ledStreamPipeline,
    ...snap.ledStreamPipeline,
  });
  s.setLedLocator({ ...DEFAULTS.ledLocator, ...snap.ledLocator });
  s.setMapping({ ...DEFAULTS.mapping, ...snap.mapping });
  s.setMesh({ ...DEFAULTS.mesh, ...(snap.mesh ?? {}) });
  s.setUi({ ...DEFAULTS.ui, ...(snap.ui ?? {}) });
  return snap;
}

/** Snapshot of the persisted slice of the store. */
export function currentSnapshot(): Omit<Snapshot, "version"> {
  const s = useSimStore.getState();
  return {
    ellipsoid: s.ellipsoid,
    cloud: s.cloud,
    strand: s.strand,
    ambient: s.ambient,
    directional: s.directional,
    sky: s.sky,
    wled: s.wled,
    breath: s.breath,
    lightning: s.lightning,
    drone: s.drone,
    pad: s.pad,
    samples: s.samples,
    dayCycle: s.dayCycle,
    masterFx: s.masterFx,
    breathMod: s.breathMod,
    breathModEnabled: s.breathModEnabled,
    ledViewMode: s.ledViewMode,
    ledDisplayMode: s.ledDisplayMode,
    breathTimeCombineMode: s.breathTimeCombineMode,
    ledStreamPipeline: s.ledStreamPipeline,
    ledLocator: s.ledLocator,
    mapping: s.mapping,
    mesh: s.mesh,
    ui: s.ui,
  };
}

/**
 * Distance-based intensity multiplier for the directional light.
 *
 * A true three.js directional light is parallel rays from infinity, so
 * its `position` only controls the direction — moving it closer or
 * farther has no effect on brightness. We instead apply a softened
 * inverse-square falloff based on the light's distance to the origin so
 * the panel's `distance` slider does something visible.
 *
 *   atten(d) = REF² / (REF² + d²)        with REF = 5
 *
 * At the default light position (≈ 5.4 from origin) this is ≈ 0.46, so
 * sliding the distance lower brightens up to ≈ 1.0, and sliding higher
 * dims toward 0. Both the custom LED shading and the three.js light
 * that shades the (translucent) ellipsoid mesh use this same multiplier
 * so the two views stay consistent.
 */
const DIR_FALLOFF_REF_SQ = 25;
export function directionalDistanceFalloff(distance: number): number {
  return DIR_FALLOFF_REF_SQ / (DIR_FALLOFF_REF_SQ + distance * distance);
}
