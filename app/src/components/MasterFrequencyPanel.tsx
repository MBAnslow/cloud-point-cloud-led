import { useEffect, useMemo, useRef, useState } from "react";
import {
  useSimStore,
  type FilterChain,
  type FilterParams,
  type MasterFxParams,
} from "../state";
import { sampleBreathAt } from "../lighting/breath";
import { useDraggable } from "./useDraggable";

const PLOT_W = 360;
const PLOT_H = 70;
const F_MIN = 20;
const F_MAX = 20000;
const DB_MIN = -30;
const DB_MAX = 12;

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
      <BreathModHeader />
      <DroneSubmenu />
      <PadSubmenu />
      <SamplesSubmenu />
    </div>
  );
}

/**
 * Live breath waveform + enable toggle. When the checkbox is on, the
 * `breathMod` percentages next to each slider start driving the running
 * engines (see `modulatedEngineParams`). The scope always animates so
 * the user can see the current breath phase whether modulation is
 * engaged or not.
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
        title="Route the mod columns into the running engines"
      >
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Breath modulation
      </label>
      <div style={{ flex: 1 }}>
        <BreathScope active={enabled} />
      </div>
    </div>
  );
}

const SCOPE_W = 220;
const SCOPE_H = 32;

/**
 * Renders one full breath cycle as a static waveform with a playhead
 * that tracks the current lung fullness. `active` just brightens the
 * curve; the scope keeps ticking either way so the user can preview
 * the breath cycle before enabling modulation.
 */
function BreathScope({ active }: { active: boolean }) {
  const breath = useSimStore((s) => s.breath);
  const [level, setLevel] = useState(() => sampleBreathAt(breath, performance.now()).level);
  const [nowMs, setNowMs] = useState(() => performance.now());
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = performance.now();
      const s = sampleBreathAt(breath, t);
      setLevel(s.level);
      setNowMs(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [breath]);

  const cycleMs =
    Math.max(0, breath.inhaleSeconds + breath.holdPeakSeconds +
      breath.exhaleSeconds + breath.holdTroughSeconds) * 1000;
  const path = useMemo(() => {
    const N = 96;
    let d = "";
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * Math.max(1, cycleMs);
      const s = sampleBreathAt(breath, t);
      const y = SCOPE_H - 2 - s.level * (SCOPE_H - 4);
      const x = (i / N) * SCOPE_W;
      d += (i === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(2) + " ";
    }
    return d;
  }, [breath, cycleMs]);

  const headX = cycleMs > 0
    ? (((nowMs % cycleMs) + cycleMs) % cycleMs) / cycleMs * SCOPE_W
    : 0;
  const headY = SCOPE_H - 2 - level * (SCOPE_H - 4);
  return (
    <svg
      width="100%"
      height={SCOPE_H}
      viewBox={`0 0 ${SCOPE_W} ${SCOPE_H}`}
      preserveAspectRatio="none"
      style={{
        display: "block",
        background: "rgba(0,0,0,0.35)",
        borderRadius: 3,
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <path
        d={path}
        fill="none"
        stroke={active ? "#82c9ff" : "rgba(130,201,255,0.4)"}
        strokeWidth={1.4}
      />
      <line
        x1={headX}
        x2={headX}
        y1={0}
        y2={SCOPE_H}
        stroke="rgba(255,225,77,0.75)"
      />
      <circle cx={headX} cy={headY} r={2.5} fill="#ffe14d" />
    </svg>
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
      <SliderRow
        label="Volume"
        min={0}
        max={1}
        step={0.01}
        value={masterGain}
        onChange={(v) => setDrone({ masterGain: v })}
        modKey="drone.masterGain"
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
      <SliderRow
        label="Volume"
        min={0}
        max={1}
        step={0.01}
        value={master}
        onChange={(v) => setPad({ master: v })}
        modKey="pad.master"
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
      <SliderRow
        label="Volume"
        min={0}
        max={3}
        step={0.01}
        value={master}
        onChange={(v) => setSamples({ master: v })}
        modKey="samples.master"
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
}) {
  const modAmount = useSimStore((s) => (modKey ? s.breathMod[modKey] ?? 0 : 0));
  const extreme = modKey ? computeExtreme(value, min, max, modAmount, false) : null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
      <span style={{ width: 72, opacity: 0.85 }}>{label}</span>
      <RangeWithBaseTick
        min={min}
        max={max}
        step={step}
        value={value}
        base={value}
        extreme={extreme}
        onChange={onChange}
      />
      <span style={{ width: 48, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {formatValue ? formatValue(value) : value.toFixed(2)}
      </span>
      {modKey && <BreathModColumn modKey={modKey} />}
    </div>
  );
}

/**
 * Range input with a small tick beneath the thumb at the "base" value.
 * `base` is the reference the audio engine will treat as neutral once
 * breath modulation is wired in — for now `base === value`.
 */
function RangeWithBaseTick({
  min,
  max,
  step,
  value,
  base,
  extreme,
  onChange,
  logScale,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  base: number;
  /** Where the parameter lands at full exhale under the current mod amount. */
  extreme?: number | null;
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
          title="Value at full exhale (current mod amount)"
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
        title="Default value"
      />
    </div>
  );
}

/**
 * Compute where a parameter lands at full exhale for the current mod
 * amount, matching `modulatedEngineParams`. `amount` is signed in
 * [-1, 1]; log-scale sliders interpolate in log space so the extreme
 * marker matches the visual midpoint the slider draws.
 */
function computeExtreme(
  base: number,
  min: number,
  max: number,
  amount: number,
  logScale: boolean,
): number {
  if (amount === 0) return base;
  if (logScale) {
    const lo = Math.log(Math.max(1e-6, min));
    const hi = Math.log(Math.max(1e-6, max));
    const bLog = Math.log(Math.max(1e-6, base));
    const next = bLog + amount * (hi - lo);
    return Math.exp(Math.max(lo, Math.min(hi, next)));
  }
  return Math.max(min, Math.min(max, base + amount * (max - min)));
}

/**
 * Bipolar breath-modulation cell. Value is a signed fraction in
 * [-1, +1]; positive drives the parameter up on exhale, negative
 * drives it down. Magnitude is the fraction of the slider range
 * applied at full exhale. Alt-click resets to 0.
 */
function BreathModColumn({ modKey }: { modKey: string }) {
  const value = useSimStore((s) => s.breathMod[modKey] ?? 0);
  const setBreathMod = useSimStore((s) => s.setBreathMod);
  const pct = Math.round(value * 100);
  const dir = pct > 0 ? "R" : pct < 0 ? "L" : "·";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        minWidth: 118,
      }}
      title="Breath modulation (not yet audible)"
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
  const filterExtreme = modKey
    ? computeExtreme(hz, F_MIN, F_MAX, modAmount, true)
    : null;
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
          extreme={filterExtreme}
          onChange={onHz}
          logScale
        />
      </div>
      <span style={{ width: 60, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {formatHz(hz)}
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
