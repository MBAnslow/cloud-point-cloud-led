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
  /** Enables locator hard override in streamed output. */
  locatorOverrideStage: boolean;
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

interface SimState {
  ellipsoid: EllipsoidParams;
  cloud: CloudParams;
  strand: StrandParams;
  ambient: AmbientLightParams;
  directional: DirectionalLightParams;
  sky: SkyParams;
  wled: WledParams;
  breath: BreathParams;
  ledViewMode: LedViewMode;
  ledDisplayMode: LedDisplayMode;
  breathTimeCombineMode: BreathTimeCombineMode;
  ledStreamPipeline: LedStreamPipeline;
  ledLocator: LedLocatorState;
  mapping: MappingParams;
  setEllipsoid: (e: Partial<EllipsoidParams>) => void;
  setCloud: (c: Partial<CloudParams>) => void;
  setStrand: (s: Partial<StrandParams>) => void;
  setAmbient: (a: Partial<AmbientLightParams>) => void;
  setDirectional: (d: Partial<DirectionalLightParams>) => void;
  setSky: (sk: Partial<SkyParams>) => void;
  setWled: (w: Partial<WledParams>) => void;
  setBreath: (b: BreathPatch) => void;
  setLedViewMode: (mode: LedViewMode) => void;
  setLedDisplayMode: (mode: LedDisplayMode) => void;
  setBreathTimeCombineMode: (mode: BreathTimeCombineMode) => void;
  setLedStreamPipeline: (patch: Partial<LedStreamPipeline>) => void;
  setLedLocator: (patch: Partial<LedLocatorState>) => void;
  toggleLocatedLed: (index: number) => void;
  clearLocatedLeds: () => void;
  setMapping: (m: Partial<MappingParams>) => void;
  addMappedLed: (dir: Vec3) => void;
  moveMappedLed: (index: number, dir: Vec3) => void;
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
  dir: Vec3;
}

export interface MappingParams {
  /** LEDs in the order they were placed on the strand. */
  leds: MappedLed[];
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
  ledViewMode: "breathPlusTimeOfDay" as LedViewMode,
  ledDisplayMode: "sensors" as LedDisplayMode,
  breathTimeCombineMode: "revealOnInhale" as BreathTimeCombineMode,
  ledStreamPipeline: {
    timeOfDayStage: true,
    breathStage: true,
    locatorOverrideStage: true,
  } as LedStreamPipeline,
  ledLocator: {
    enabled: false,
    highlighted: [],
    color: "#ffe14d",
  } as LedLocatorState,
  mapping: {
    leds: [],
    flipUpDown: false,
    flipLeftRight: false,
    reversed: false,
    ledSize: 0.05,
  } as MappingParams,
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
  addMappedLed: (dir) =>
    set((s) => ({
      mapping: { ...s.mapping, leds: [...s.mapping.leds, { dir }] },
    })),
  moveMappedLed: (index, dir) =>
    set((s) => ({
      mapping: {
        ...s.mapping,
        leds: s.mapping.leds.map((l, i) => (i === index ? { dir } : l)),
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
    ledViewMode: s.ledViewMode,
    ledDisplayMode: s.ledDisplayMode,
    breathTimeCombineMode: s.breathTimeCombineMode,
    ledStreamPipeline: s.ledStreamPipeline,
    ledLocator: s.ledLocator,
    mapping: s.mapping,
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
