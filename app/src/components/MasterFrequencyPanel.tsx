import { useEffect, useMemo, useRef, useState } from "react";
import {
  useSimStore,
  type FilterChain,
  type FilterParams,
} from "../state";
import { getBreathEffectDrive } from "../lighting/breathEffectDrive";
import { currentBreathDrive, isBreathModActive } from "../audio/breathModulation";
import { getDroneEngine } from "../audio/DroneEngine";
import { getPadEngine } from "../audio/PadEngine";
import { getSampleEngine } from "../audio/SampleEngine";
import { getMasterFxBus } from "../audio/MasterFxBus";
import { useDraggable } from "./useDraggable";

const PLOT_W = 360;
const PLOT_H = 70;
const F_MIN = 20;
const F_MAX = 20000;
const DB_MIN = -30;
const DB_MAX = 12;
/** Peak ≥ this (linear) lights the meter red (−1 dBFS ≈ 0.89). */
const PEAK_CLIP = 0.89;
const PEAK_HOLD_MS = 400;

/**
 * Compact, always-visible master frequency panel. Owns the shared
 * `MasterFxParams` slice: two filter rows (LPF + HPF) plus per-engine
 * Apply / Bypass toggles that decide whether each engine's output
 * flows through the EQ chain or a direct passthrough. A tiny magnitude
 * response plot summarizes the combined LPF+HPF curve so the user can
 * see the shape at a glance.
 */
export function MasterFrequencyPanel({ visible = true }: { visible?: boolean }) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { pos, handleProps } = useDraggable(panelRef);
  const dynStyle: React.CSSProperties = pos
    ? { top: pos.top, left: pos.left, bottom: "auto" }
    : {};
  if (!visible) return null;
  return (
    <div ref={panelRef} style={{ ...panelStyle, ...dynStyle }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, ...handleProps.style }}
        onPointerDown={handleProps.onPointerDown}
      >
        <div style={titleStyle}>Master volume controls</div>
      </div>
      <OutputSection />
      <BreathModHeader />
      <DroneSubmenu />
      <PadSubmenu />
      <SamplesSubmenu />
    </div>
  );
}

function OutputSection() {
  const outputGain = useSimStore((s) => s.masterFx.outputGain ?? 1);
  const setMasterFx = useSimStore((s) => s.setMasterFx);
  return (
    <div
      style={{
        marginTop: 6,
        padding: "6px 6px 4px",
        borderRadius: 4,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.1)",
      }}
    >
      <VolumeWithMeter
        label="Output"
        min={0}
        max={1.5}
        step={0.01}
        value={outputGain}
        onChange={(v) => setMasterFx({ outputGain: v })}
        source="output"
      />
      <div style={{ fontSize: 9, opacity: 0.5, marginTop: 2, paddingLeft: 2 }}>
        Shared fader + compressor/−1 dB limiter (all engines, lightning, breath)
      </div>
    </div>
  );
}

function peakToDb(peak: number): string {
  if (peak < 1e-4) return "−∞";
  const db = 20 * Math.log10(peak);
  return `${db >= 0 ? "+" : ""}${db.toFixed(1)}`;
}

/**
 * Live peak bar with ~400 ms hold so short spikes stay readable.
 * `source` picks which engine/bus meter to poll.
 */
function PeakMeter({
  source,
}: {
  source: "drone" | "pad" | "samples" | "output";
}) {
  const [display, setDisplay] = useState(0);
  const holdRef = useRef({ peak: 0, until: 0 });

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      let raw = 0;
      try {
        if (source === "drone") raw = getDroneEngine().getPeakLevel();
        else if (source === "pad") raw = getPadEngine().getPeakLevel();
        else if (source === "samples") raw = getSampleEngine().getPeakLevel();
        else raw = getMasterFxBus().getPeakLevel();
      } catch {
        raw = 0;
      }
      const now = performance.now();
      const hold = holdRef.current;
      if (raw >= hold.peak) {
        hold.peak = raw;
        hold.until = now + PEAK_HOLD_MS;
      } else if (now > hold.until) {
        // Slow release toward live level.
        hold.peak = hold.peak * 0.85 + raw * 0.15;
        if (hold.peak < 0.001) hold.peak = raw;
      }
      setDisplay(hold.peak);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [source]);

  const fill = Math.max(0, Math.min(1.2, display));
  const hot = fill >= PEAK_CLIP;
  return (
    <div
      title={`Peak ${peakToDb(display)} dBFS`}
      style={{
        position: "relative",
        width: 52,
        height: 14,
        flexShrink: 0,
        background: "rgba(0,0,0,0.4)",
        borderRadius: 2,
        border: "1px solid rgba(255,255,255,0.12)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: `${Math.min(100, (fill / 1) * 100)}%`,
          background: hot
            ? "rgba(248,113,113,0.85)"
            : "rgba(74,222,128,0.7)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 8,
          fontVariantNumeric: "tabular-nums",
          opacity: 0.9,
          pointerEvents: "none",
          textShadow: "0 0 2px #000",
        }}
      >
        {peakToDb(display)}
      </div>
    </div>
  );
}

function VolumeWithMeter({
  label,
  min,
  max,
  step,
  value,
  onChange,
  formatValue,
  modKey,
  source,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  formatValue?: (v: number) => string;
  modKey?: string;
  source: "drone" | "pad" | "samples" | "output";
}) {
  return (
    <SliderRow
      label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={onChange}
      formatValue={formatValue}
      modKey={modKey}
      meterSource={source}
    />
  );
}

/**
 * Live cloud-effect drive meter + enable toggle. When on, engine params
 * lerp from the % rest offset toward the yellow slider during the breath
 * period (reveal 0 → 1). Outside the period, stored slider values play.
 */
function BreathModHeader() {
  const enabled = useSimStore((s) => s.breathModEnabled);
  const setEnabled = useSimStore((s) => s.setBreathModEnabled);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginTop: 6,
        padding: "4px 6px",
        borderRadius: 4,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          fontSize: 11,
          cursor: "pointer",
          userSelect: "none",
        }}
        title="Off: engines play the yellow slider levels exactly. On: during the breath period, params rest at the % offset (reveal 0) and return to the slider as reveal rises."
      >
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Cloud breath mod
      </label>
      <div style={{ flex: 1 }}>
        <BreathFilterDriveMeter active={enabled} />
      </div>
    </div>
  );
}

const SCOPE_H = 32;

/**
 * Meter of mean LED time-of-day reveal (threshold floor + breath
 * path/linger) — pulses as waves cross and tracks the threshold.
 */
function BreathFilterDriveMeter({ active }: { active: boolean }) {
  const [drive, setDrive] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setDrive(getBreathEffectDrive());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const fill = Math.max(0, Math.min(1, drive));
  return (
    <div
      title="Mean LED time-of-day reveal (threshold + breath). 1 = all LEDs fully revealed, 0 = none"
      style={{
        position: "relative",
        height: SCOPE_H,
        background: "rgba(0,0,0,0.35)",
        borderRadius: 3,
        border: "1px solid rgba(255,255,255,0.08)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: `${fill * 100}%`,
          background: active
            ? "rgba(130,201,255,0.55)"
            : "rgba(130,201,255,0.22)",
          transition: "width 60ms linear",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 10,
          fontVariantNumeric: "tabular-nums",
          opacity: active ? 0.9 : 0.55,
          pointerEvents: "none",
        }}
      >
        reveal {fill.toFixed(2)}
      </div>
    </div>
  );
}

/**
 * Two FilterRow entries (LPF + HPF) bound to a `FilterChain` slice on
 * one engine, plus a live magnitude-response plot. Used inside each
 * per-engine Submenu below.
 */
function EngineFilterSection({
  filters,
  onChange,
  keyPrefix,
}: {
  filters: FilterChain;
  onChange: (next: FilterChain) => void;
  /** Prefix for breath-modulation slider IDs (e.g. "drone" → "drone.filters.lp.hz"). */
  keyPrefix: string;
}) {
  const setSlot = (key: keyof FilterChain, patch: Partial<FilterParams>) => {
    onChange({ ...filters, [key]: { ...filters[key], ...patch } });
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
      <FilterRow
        label="LPF"
        enabled={filters.lp.enabled}
        hz={filters.lp.hz}
        onToggle={(v) => setSlot("lp", { enabled: v })}
        onHz={(v) => setSlot("lp", { hz: v })}
        modKey={`${keyPrefix}.filters.lp.hz`}
      />
      <FilterRow
        label="HPF"
        enabled={filters.hp.enabled}
        hz={filters.hp.hz}
        onToggle={(v) => setSlot("hp", { enabled: v })}
        onHz={(v) => setSlot("hp", { hz: v })}
        modKey={`${keyPrefix}.filters.hp.hz`}
      />
      <FilterChainPlot filters={filters} />
    </div>
  );
}

/**
 * Collapsible per-engine sections for controls that don't belong in
 * the shared EQ chain — currently just master volume for each engine,
 * plus saturation for the drone. Handy for balancing levels without
 * hopping between the /drones, /pads and /samples pages.
 */
function DroneSubmenu() {
  const masterGain = useSimStore((s) => s.drone.masterGain);
  const saturation = useSimStore((s) => s.drone.saturation);
  const tremoloRateHz = useSimStore((s) => s.drone.tremoloRateHz);
  const tremoloDepth = useSimStore((s) => s.drone.tremoloDepth);
  const filters = useSimStore((s) => s.drone.filters);
  const setDrone = useSimStore((s) => s.setDrone);
  return (
    <Submenu label="Drone">
      <VolumeWithMeter
        label="Volume"
        min={0}
        max={1}
        step={0.01}
        value={masterGain}
        onChange={(v) => setDrone({ masterGain: v })}
        modKey="drone.masterGain"
        source="drone"
      />
      <SliderRow
        label="Saturation"
        min={0}
        max={1}
        step={0.01}
        value={saturation}
        onChange={(v) => setDrone({ saturation: v })}
        modKey="drone.saturation"
      />
      <SliderRow
        label="Tremolo rate"
        min={0.05}
        max={20}
        step={0.01}
        value={tremoloRateHz}
        onChange={(v) => setDrone({ tremoloRateHz: v })}
        formatValue={(v) => `${v.toFixed(2)} Hz`}
        modKey="drone.tremoloRateHz"
      />
      <SliderRow
        label="Tremolo depth"
        min={0}
        max={1}
        step={0.01}
        value={tremoloDepth}
        onChange={(v) => setDrone({ tremoloDepth: v })}
        modKey="drone.tremoloDepth"
      />
      <EngineFilterSection
        keyPrefix="drone"
        filters={filters}
        onChange={(next) => setDrone({ filters: next })}
      />
    </Submenu>
  );
}

function PadSubmenu() {
  const master = useSimStore((s) => s.pad.master);
  const saturation = useSimStore((s) => s.pad.saturation);
  const filters = useSimStore((s) => s.pad.filters);
  const setPad = useSimStore((s) => s.setPad);
  return (
    <Submenu label="Pad">
      <VolumeWithMeter
        label="Volume"
        min={0}
        max={1}
        step={0.01}
        value={master}
        onChange={(v) => setPad({ master: v })}
        modKey="pad.master"
        source="pad"
      />
      <SliderRow
        label="Saturation"
        min={0}
        max={1}
        step={0.01}
        value={saturation}
        onChange={(v) => setPad({ saturation: v })}
        modKey="pad.saturation"
      />
      <EngineFilterSection
        keyPrefix="pad"
        filters={filters}
        onChange={(next) => setPad({ filters: next })}
      />
    </Submenu>
  );
}

function SamplesSubmenu() {
  const master = useSimStore((s) => s.samples.master);
  const filters = useSimStore((s) => s.samples.filters);
  const setSamples = useSimStore((s) => s.setSamples);
  return (
    <Submenu label="Samples">
      <VolumeWithMeter
        label="Volume"
        min={0}
        max={3}
        step={0.01}
        value={master}
        onChange={(v) => setSamples({ master: v })}
        modKey="samples.master"
        source="samples"
      />
      <EngineFilterSection
        keyPrefix="samples"
        filters={filters}
        onChange={(next) => setSamples({ filters: next })}
      />
    </Submenu>
  );
}

function Submenu({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div
      style={{
        marginTop: 6,
        borderTop: "1px solid rgba(255,255,255,0.1)",
        paddingTop: 6,
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          ...pillStyle,
          background: "transparent",
          borderColor: "transparent",
          fontSize: 11,
          padding: 0,
          opacity: 0.9,
          fontWeight: 600,
          letterSpacing: 0.3,
        }}
        title={label}
      >
        {open ? "▾" : "▸"} {label}
      </button>
      {open && (
        <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
          {children}
        </div>
      )}
    </div>
  );
}

function SliderRow({
  label,
  min,
  max,
  step,
  value,
  onChange,
  formatValue,
  modKey,
  meterSource,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  formatValue?: (v: number) => string;
  /** Enables the breath-modulation column and picks a stable storage key. */
  modKey?: string;
  /** When set, show a live peak meter before the slider. */
  meterSource?: "drone" | "pad" | "samples" | "output";
}) {
  const modAmount = useSimStore((s) => (modKey ? s.breathMod[modKey] ?? 0 : 0));
  const modEnabled = useSimStore((s) => s.breathModEnabled);
  const live = useLiveModValue(value, min, max, modAmount, false, modKey);
  // Blue offset marker only while mod can actually move the engine.
  const offset =
    modKey && modEnabled && modAmount !== 0
      ? computeOffset(value, min, max, modAmount, false)
      : null;
  const shown = live != null ? live : value;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
      <span style={{ width: 72, opacity: 0.85 }}>{label}</span>
      {meterSource && <PeakMeter source={meterSource} />}
      <RangeWithBaseTick
        min={min}
        max={max}
        step={step}
        value={value}
        base={value}
        extreme={offset}
        live={live}
        onChange={onChange}
      />
      <span style={{ width: 48, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {formatValue ? formatValue(shown) : shown.toFixed(2)}
      </span>
      {modKey && <BreathModColumn modKey={modKey} />}
    </div>
  );
}

/**
 * Range input with ticks under the track:
 *   yellow — slider target (reveal = 1)
 *   blue   — rest offset at reveal = 0 (mod % shift)
 *   green  — live playing value during the breath period
 */
function RangeWithBaseTick({
  min,
  max,
  step,
  value,
  base,
  extreme,
  live,
  onChange,
  logScale,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  base: number;
  /** Rest offset at reveal 0 (mod amount). */
  extreme?: number | null;
  /** Live engine value while breath mod is active. */
  live?: number | null;
  onChange: (v: number) => void;
  logScale?: boolean;
}) {
  const lMin = Math.log(Math.max(1e-6, min));
  const lMax = Math.log(Math.max(1e-6, max));
  const toPct = (v: number): number => {
    if (logScale) {
      return ((Math.log(Math.max(min, v)) - lMin) / (lMax - lMin)) * 100;
    }
    return ((v - min) / (max - min)) * 100;
  };
  const basePct = Math.max(0, Math.min(100, toPct(base)));
  const pos = logScale
    ? Math.max(0, Math.min(1, (Math.log(Math.max(min, value)) - lMin) / (lMax - lMin)))
    : value;
  const extremePct =
    extreme != null && Number.isFinite(extreme) && Math.abs(extreme - base) > 1e-6
      ? Math.max(0, Math.min(100, toPct(extreme)))
      : null;
  const livePct =
    live != null && Number.isFinite(live) && Math.abs(live - base) > 1e-6
      ? Math.max(0, Math.min(100, toPct(live)))
      : null;
  return (
    <div style={{ flex: 1, position: "relative" }}>
      <input
        type="range"
        min={logScale ? 0 : min}
        max={logScale ? 1 : max}
        step={logScale ? 0.001 : step}
        value={pos}
        onChange={(e) => {
          const t = parseFloat(e.target.value);
          if (logScale) onChange(Math.exp(lMin + t * (lMax - lMin)));
          else onChange(t);
        }}
        style={{ width: "100%", display: "block" }}
      />
      {extremePct != null && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: `calc(${extremePct}% - 1px)`,
            bottom: -2,
            width: 2,
            height: 6,
            background: "rgba(130,201,255,0.95)",
            pointerEvents: "none",
            borderRadius: 1,
          }}
          title="Rest offset at reveal 0 (mod %)"
        />
      )}
      {livePct != null && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: `calc(${livePct}% - 1px)`,
            bottom: -2,
            width: 2,
            height: 8,
            background: "rgba(74,222,128,0.95)",
            pointerEvents: "none",
            borderRadius: 1,
            zIndex: 1,
          }}
          title="Live playing value (lerp offset → slider by reveal)"
        />
      )}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: `calc(${basePct}% - 1px)`,
          bottom: -2,
          width: 2,
          height: 6,
          background: "rgba(255,225,77,0.9)",
          pointerEvents: "none",
          borderRadius: 1,
        }}
        title="Slider target at reveal 1"
      />
    </div>
  );
}

/**
 * Rest offset at reveal = 0 for the current mod amount (blue tick).
 * Matches breathModulation.apply with reveal = 0.
 */
function computeOffset(
  base: number,
  min: number,
  max: number,
  amount: number,
  logScale: boolean,
): number {
  return computeModulated(base, min, max, amount, 0, logScale);
}

/**
 * Same mapping as breathModulation.apply: slider is reveal=1 target;
 * live = base + amount * range * (1 - reveal).
 */
function computeModulated(
  base: number,
  min: number,
  max: number,
  amount: number,
  reveal: number,
  logScale: boolean,
): number {
  if (amount === 0) return base;
  const t = reveal < 0 ? 0 : reveal > 1 ? 1 : reveal;
  if (logScale) {
    const lo = Math.log(Math.max(1e-6, min));
    const hi = Math.log(Math.max(1e-6, max));
    const bLog = Math.log(Math.max(1e-6, base));
    const next = bLog + amount * (1 - t) * (hi - lo);
    return Math.exp(Math.max(lo, Math.min(hi, next)));
  }
  return Math.max(
    min,
    Math.min(max, base + amount * (1 - t) * (max - min)),
  );
}

/**
 * RAF-polled live value while breath mod is active in the breath window.
 * Null outside the period / when amount is 0 so the green tick hides.
 */
function useLiveModValue(
  base: number,
  min: number,
  max: number,
  amount: number,
  logScale: boolean,
  modKey: string | undefined,
): number | null {
  const [live, setLive] = useState<number | null>(null);

  useEffect(() => {
    if (!modKey || amount === 0) {
      setLive(null);
      return;
    }
    let raf = 0;
    const tick = () => {
      const state = useSimStore.getState();
      if (!isBreathModActive(state)) {
        setLive(null);
      } else {
        const reveal = currentBreathDrive(state);
        setLive(computeModulated(base, min, max, amount, reveal, logScale));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [base, min, max, amount, logScale, modKey]);

  return live;
}

/**
 * Bipolar cloud-breath modulation cell. Value is a signed fraction in
 * [-1, +1]: the rest offset at reveal 0 as a fraction of the slider
 * range. Reveal lerps from that offset back to the yellow slider.
 * Alt-click / double-click resets to 0.
 */
function BreathModColumn({ modKey }: { modKey: string }) {
  const value = useSimStore((s) => s.breathMod[modKey] ?? 0);
  const setBreathMod = useSimStore((s) => s.setBreathMod);
  const modEnabled = useSimStore((s) => s.breathModEnabled);
  const pct = Math.round(value * 100);
  const dir = pct > 0 ? "R" : pct < 0 ? "L" : "·";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        minWidth: 118,
        opacity: modEnabled ? 1 : 0.35,
      }}
      title={
        modEnabled
          ? "% = rest offset at reveal 0; inhale (reveal) returns to the slider. Only during the breath period."
          : "Cloud breath mod is off — engines use the yellow slider levels as-is."
      }
    >
      <input
        type="range"
        min={-100}
        max={100}
        step={1}
        value={pct}
        onChange={(e) => setBreathMod(modKey, parseFloat(e.target.value) / 100)}
        onDoubleClick={() => setBreathMod(modKey, 0)}
        onClick={(e) => {
          if (e.altKey) setBreathMod(modKey, 0);
        }}
        style={{ width: 72 }}
      />
      <span
        style={{
          width: 42,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          opacity: pct === 0 ? 0.4 : 0.9,
        }}
      >
        {pct >= 0 ? `+${pct}` : `${pct}`}% {dir}
      </span>
    </div>
  );
}

function EngineToggle({
  label,
  apply,
  onChange,
}: {
  label: string;
  apply: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        opacity: 0.9,
      }}
    >
      <span style={{ opacity: 0.75 }}>{label}</span>
      <select
        value={apply ? "apply" : "bypass"}
        onChange={(e) => onChange(e.target.value === "apply")}
        style={selectStyle}
      >
        <option value="apply">Apply</option>
        <option value="bypass">Bypass</option>
      </select>
    </label>
  );
}

function FilterRow({
  label,
  enabled,
  hz,
  onToggle,
  onHz,
  modKey,
}: {
  label: string;
  enabled: boolean;
  hz: number;
  onToggle: (v: boolean) => void;
  onHz: (v: number) => void;
  modKey?: string;
}) {
  const modAmount = useSimStore((s) => (modKey ? s.breathMod[modKey] ?? 0 : 0));
  const modEnabled = useSimStore((s) => s.breathModEnabled);
  const live = useLiveModValue(hz, F_MIN, F_MAX, modAmount, true, modKey);
  const offset =
    modKey && modEnabled && modAmount !== 0
      ? computeOffset(hz, F_MIN, F_MAX, modAmount, true)
      : null;
  const shownHz = live != null ? live : hz;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        opacity: enabled ? 1 : 0.55,
      }}
    >
      <button
        onClick={() => onToggle(!enabled)}
        title={enabled ? "Disable" : "Enable"}
        style={{
          ...pillStyle,
          background: enabled ? "#4c6ef5" : "rgba(255,255,255,0.08)",
          borderColor: enabled ? "#4c6ef5" : "rgba(255,255,255,0.2)",
        }}
      >
        ⏻
      </button>
      <span style={{ width: 28, opacity: 0.85 }}>{label}</span>
      <div style={{ width: 140 }}>
        <RangeWithBaseTick
          min={F_MIN}
          max={F_MAX}
          step={1}
          value={hz}
          base={hz}
          extreme={offset}
          live={live}
          onChange={onHz}
          logScale
        />
      </div>
      <span style={{ width: 60, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {formatHz(shownHz)}
      </span>
      {modKey && <BreathModColumn modKey={modKey} />}
    </div>
  );
}

function LogRange({
  min,
  max,
  value,
  onChange,
  width,
}: {
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  width: number;
}) {
  const lMin = Math.log(min);
  const lMax = Math.log(max);
  const pos = Math.max(0, Math.min(1, (Math.log(Math.max(min, value)) - lMin) / (lMax - lMin)));
  return (
    <input
      type="range"
      min={0}
      max={1}
      step={0.001}
      value={pos}
      onChange={(e) => {
        const t = parseFloat(e.target.value);
        onChange(Math.exp(lMin + t * (lMax - lMin)));
      }}
      style={{ width }}
    />
  );
}

function FilterChainPlot({ filters }: { filters: FilterChain }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const path = useMemo(() => {
    const N = PLOT_W;
    const lMin = Math.log(F_MIN);
    const lMax = Math.log(F_MAX);
    let d = "";
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const f = Math.exp(lMin + t * (lMax - lMin));
      let db = 0;
      if (filters.lp.enabled) db += biquadDb("lowpass", f, filters.lp.hz, filters.lp.q, 0);
      if (filters.hp.enabled) db += biquadDb("highpass", f, filters.hp.hz, filters.hp.q, 0);
      const y =
        PLOT_H -
        ((Math.max(DB_MIN, Math.min(DB_MAX, db)) - DB_MIN) / (DB_MAX - DB_MIN)) *
          PLOT_H;
      d += (i === 0 ? "M" : "L") + i.toFixed(1) + " " + y.toFixed(2) + " ";
    }
    return d;
  }, [filters]);
  return (
    <svg
      ref={svgRef}
      width={PLOT_W}
      height={PLOT_H}
      viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
      style={{
        display: "block",
        background: "rgba(0,0,0,0.35)",
        borderRadius: 4,
        border: "1px solid rgba(255,255,255,0.1)",
      }}
    >
      {/* 0 dB baseline */}
      <line
        x1={0}
        x2={PLOT_W}
        y1={((DB_MAX - 0) / (DB_MAX - DB_MIN)) * PLOT_H}
        y2={((DB_MAX - 0) / (DB_MAX - DB_MIN)) * PLOT_H}
        stroke="rgba(255,255,255,0.15)"
      />
      <path d={path} fill="none" stroke="#82c9ff" strokeWidth={1.5} />
    </svg>
  );
}

/**
 * Analytical magnitude response of a biquad filter in dB. Standard
 * RBJ cookbook formulas. `gainDb` is ignored for non-peaking/shelf.
 */
function biquadDb(
  type: "lowpass" | "highpass",
  f: number,
  f0: number,
  Q: number,
  _gainDb: number,
): number {
  void _gainDb;
  const w = 2 * Math.PI * f;
  const w0 = 2 * Math.PI * f0;
  const s = w / w0;
  // |H(jw)|² for RBJ LP/HP normalized to 0 dB at DC / Nyquist respectively.
  if (type === "lowpass") {
    const denom = Math.pow(1 - s * s, 2) + Math.pow(s / Q, 2);
    return 10 * Math.log10(1 / denom);
  }
  const denom = Math.pow(1 - s * s, 2) + Math.pow(s / Q, 2);
  const num = Math.pow(s, 4);
  return 10 * Math.log10(num / denom);
}

function formatHz(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)}k`;
  return `${v.toFixed(0)}`;
}

const panelStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 60,
  left: 12,
  zIndex: 15,
  background: "rgba(10, 12, 20, 0.82)",
  backdropFilter: "blur(8px)",
  color: "rgba(207,214,230,0.95)",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.12)",
  fontFamily:
    "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  width: PLOT_W + 24,
};

const titleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: 0.3,
  marginRight: "auto",
};

const selectStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  color: "inherit",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 4,
  padding: "1px 3px",
  fontSize: 11,
};

const pillStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 4,
  color: "inherit",
  fontSize: 10,
  lineHeight: 1,
  padding: "2px 5px",
  cursor: "pointer",
};
