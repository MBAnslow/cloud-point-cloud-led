import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { breathLevelAt, sampleBreathAt } from "../lighting/breath";
import { computeBreathAreaOrigin } from "../lighting/breathArea";
import { useSimStore, type Breather } from "../state";
import { useDraggable } from "./useDraggable";

const PRESET_COLORS = [
  "#77d5ff",
  "#9bff9b",
  "#ffc878",
  "#f3a6ff",
  "#ff8f8f",
  "#90b1ff",
];

const ORIGIN_PRESETS: Array<{
  id: "front" | "back" | "left" | "right" | "top" | "bottom";
  label: string;
  azimuth: number;
  elevation: number;
}> = [
  { id: "front", label: "front", azimuth: 90, elevation: 0 },
  { id: "back", label: "back", azimuth: -90, elevation: 0 },
  { id: "left", label: "left", azimuth: 180, elevation: 0 },
  { id: "right", label: "right", azimuth: 0, elevation: 0 },
  { id: "top", label: "top", azimuth: 0, elevation: 90 },
  { id: "bottom", label: "bottom", azimuth: 0, elevation: -90 },
];

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function makeBreatherId(): string {
  return `breather-${Math.random().toString(36).slice(2, 7)}-${Date.now().toString(36)}`;
}

function fmtS(v: number): string {
  return `${v.toFixed(1)}s`;
}

const PARAM_HELP = {
  inhaleSeconds:
    "Duration of the inhale ramp. Longer values make the pull-in phase slower and smoother.",
  holdPeakSeconds:
    "How long breath stays at full inhale before exhaling begins.",
  exhaleSeconds:
    "Duration of the exhale ramp. Longer values create a slower outward breath release.",
  holdTroughSeconds:
    "How long breath rests at the trough before the next inhale starts.",
  areaRadius:
    "Radius of the breath area of effect on the cloud. LEDs outside are unaffected.",
  areaFalloff:
    "How quickly influence drops from the center of the area. Higher means sharper, lower means broader.",
  breathTintColor:
    "Marker/guide color used to visualize the breath area in Breath view.",
  breathTintAmount:
    "Marker/guide intensity for breath-area visualization only (does not change streamed LED lighting).",
  breathTimeMix:
    "Blend in Breath + Time of Day mode. 0 = time-of-day only, 1 = breath-only.",
  sourceAzimuth:
    "Horizontal direction around the cloud center for the breath source.",
  sourceElevation:
    "Vertical direction of the breath source. -90 is below cloud, +90 is above.",
  distanceCloud:
    "Offset of the area center from the cloud surface along the selected direction.",
};

export function BreathOscillator({ visible: mounted = true }: { visible?: boolean } = {}) {
  const breath = useSimStore((s) => s.breath);
  const ellipsoid = useSimStore((s) => s.ellipsoid);
  const setBreath = useSimStore((s) => s.setBreath);
  const [nowMs, setNowMs] = useState(() => performance.now());
  const [visible, setVisible] = useState(true);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { pos, handleProps } = useDraggable(panelRef);

  useEffect(() => {
    let raf = 0;
    const tick = (t: number) => {
      setNowMs(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const cycleSeconds =
    breath.inhaleSeconds +
    breath.holdPeakSeconds +
    breath.exhaleSeconds +
    breath.holdTroughSeconds;
  const cycleMs = Math.max(1, cycleSeconds * 1000);
  const leadProgress = (nowMs % cycleMs) / cycleMs;
  const sample = sampleBreathAt(breath, nowMs);
  const currentLevel = sample.level;
  const inhaleLevel = sample.inhaleIntensity;
  const exhaleLevel = sample.exhaleIntensity;

  const sourcePos = computeBreathAreaOrigin(ellipsoid, {
    sourceAzimuthDeg: breath.area.sourceAzimuthDeg,
    sourceElevationDeg: breath.area.sourceElevationDeg,
    distanceFromCloud: breath.area.distanceFromCloud,
  });

  const segmentPercents = useMemo(() => {
    if (cycleSeconds <= 1e-6) {
      return { inhale: 0, holdPeak: 0, exhale: 0, holdTrough: 100 };
    }
    return {
      inhale: (breath.inhaleSeconds / cycleSeconds) * 100,
      holdPeak: (breath.holdPeakSeconds / cycleSeconds) * 100,
      exhale: (breath.exhaleSeconds / cycleSeconds) * 100,
      holdTrough: (breath.holdTroughSeconds / cycleSeconds) * 100,
    };
  }, [
    breath.exhaleSeconds,
    breath.holdPeakSeconds,
    breath.holdTroughSeconds,
    breath.inhaleSeconds,
    cycleSeconds,
  ]);

  const addBreather = () => {
    const nextIndex = breath.breathers.length;
    const newBreather: Breather = {
      id: makeBreatherId(),
      color: PRESET_COLORS[nextIndex % PRESET_COLORS.length],
      phaseOffset: (nextIndex * 0.17) % 1,
    };
    setBreath({ breathers: [...breath.breathers, newBreather] });
  };

  const updateBreather = (id: string, patch: Partial<Breather>) => {
    setBreath({
      breathers: breath.breathers.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    });
  };

  const removeBreather = (id: string) => {
    setBreath({
      breathers: breath.breathers.filter((b) => b.id !== id),
    });
  };

  const selectedOriginPreset = useMemo(() => {
    for (const p of ORIGIN_PRESETS) {
      if (
        Math.abs(breath.area.sourceAzimuthDeg - p.azimuth) < 0.5 &&
        Math.abs(breath.area.sourceElevationDeg - p.elevation) < 0.5
      ) {
        return p.id;
      }
    }
    return "custom";
  }, [breath.area.sourceAzimuthDeg, breath.area.sourceElevationDeg]);

  const setOriginPreset = (
    value: "front" | "back" | "left" | "right" | "top" | "bottom" | "custom",
  ) => {
    if (value === "custom") return;
    const preset = ORIGIN_PRESETS.find((p) => p.id === value);
    if (!preset) return;
    setBreath({
      area: {
        sourceAzimuthDeg: preset.azimuth,
        sourceElevationDeg: preset.elevation,
      },
    });
  };

  const baseStyle: React.CSSProperties = {
    position: "fixed",
    left: pos ? pos.left : "50%",
    top: pos ? pos.top : undefined,
    bottom: pos ? undefined : 200,
    transform: pos ? undefined : "translateX(-50%)",
    width: "min(820px, calc(100vw - 390px))",
    zIndex: 9,
    pointerEvents: "auto",
    background: "rgba(10, 12, 20, 0.72)",
    backdropFilter: "blur(8px)",
    borderRadius: 12,
    color: "rgba(207,214,230,0.95)",
    boxShadow: "0 1px 0 rgba(255,255,255,0.05) inset",
    padding: "10px 12px",
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  };
  if (!mounted) return null;
  return (
    <div ref={panelRef} style={baseStyle}>
      <div
        onPointerDown={handleProps.onPointerDown}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 8,
          fontSize: 11,
          cursor: "move",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => setVisible((v) => !v)}
            title={visible ? "Hide panel body" : "Show panel body"}
            style={{
              background: "rgba(255,255,255,0.06)",
              color: "inherit",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 4,
              padding: "1px 6px",
              cursor: "pointer",
              fontSize: 11,
              lineHeight: 1,
            }}
          >
            {visible ? "▾" : "▸"}
          </button>
          <span style={{ textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.7 }}>
            Breath Oscillator
          </span>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={breath.enabled}
              onChange={(e) => setBreath({ enabled: e.target.checked })}
            />
            enabled
          </label>
          {visible && (
            <span style={{ opacity: 0.75 }}>
              cycle {fmtS(cycleSeconds)} · level {currentLevel.toFixed(2)} · exhale{" "}
              {exhaleLevel.toFixed(2)} · inhale {inhaleLevel.toFixed(2)} · mode{" "}
              {sample.phase}
            </span>
          )}
        </div>
        <button
          onClick={addBreather}
          style={{
            background: "rgba(255,255,255,0.06)",
            color: "inherit",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 6,
            padding: "3px 10px",
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          + add breather
        </button>
      </div>

      {visible && (
      <>
      <BreathCurve
        breath={breath}
        cycleSeconds={cycleSeconds}
        leadProgress={leadProgress}
        nowMs={nowMs}
      />

      <div style={{ display: "flex", gap: 6, marginTop: 8, fontSize: 10 }}>
        <SegmentPill
          label={`inhale ${fmtS(breath.inhaleSeconds)}`}
          width={segmentPercents.inhale}
          color="rgba(116, 201, 255, 0.45)"
        />
        <SegmentPill
          label={`hold peak ${fmtS(breath.holdPeakSeconds)}`}
          width={segmentPercents.holdPeak}
          color="rgba(180, 212, 255, 0.35)"
        />
        <SegmentPill
          label={`exhale ${fmtS(breath.exhaleSeconds)}`}
          width={segmentPercents.exhale}
          color="rgba(255, 170, 144, 0.42)"
        />
        <SegmentPill
          label={`hold trough ${fmtS(breath.holdTroughSeconds)}`}
          width={segmentPercents.holdTrough}
          color="rgba(170, 180, 195, 0.32)"
        />
      </div>

      <div
        style={{
          marginTop: 8,
          display: "grid",
          gap: 10,
          fontSize: 11,
        }}
      >
        <Section title="Breath Timing">
          <SliderField
            label="inhale"
            tooltip={PARAM_HELP.inhaleSeconds}
            value={breath.inhaleSeconds}
            min={0}
            max={12}
            step={0.1}
            onChange={(v) => setBreath({ inhaleSeconds: v })}
          />
          <SliderField
            label="hold peak"
            tooltip={PARAM_HELP.holdPeakSeconds}
            value={breath.holdPeakSeconds}
            min={0}
            max={8}
            step={0.1}
            onChange={(v) => setBreath({ holdPeakSeconds: v })}
          />
          <SliderField
            label="exhale"
            tooltip={PARAM_HELP.exhaleSeconds}
            value={breath.exhaleSeconds}
            min={0}
            max={14}
            step={0.1}
            onChange={(v) => setBreath({ exhaleSeconds: v })}
          />
          <SliderField
            label="hold trough"
            tooltip={PARAM_HELP.holdTroughSeconds}
            value={breath.holdTroughSeconds}
            min={0}
            max={8}
            step={0.1}
            onChange={(v) => setBreath({ holdTroughSeconds: v })}
          />
        </Section>

        <Section title="Area of Effect">
          <SliderField
            label="source azimuth"
            tooltip={PARAM_HELP.sourceAzimuth}
            value={breath.area.sourceAzimuthDeg}
            min={-180}
            max={180}
            step={1}
            onChange={(v) => setBreath({ area: { sourceAzimuthDeg: v } })}
          />
          <SliderField
            label="source elevation"
            tooltip={PARAM_HELP.sourceElevation}
            value={breath.area.sourceElevationDeg}
            min={-90}
            max={90}
            step={1}
            onChange={(v) => setBreath({ area: { sourceElevationDeg: v } })}
          />
          <SliderField
            label="surface offset"
            tooltip={PARAM_HELP.distanceCloud}
            value={breath.area.distanceFromCloud}
            min={0}
            max={1.5}
            step={0.01}
            onChange={(v) => setBreath({ area: { distanceFromCloud: v } })}
          />
          <SliderField
            label="radius"
            tooltip={PARAM_HELP.areaRadius}
            value={breath.area.radius}
            min={0.1}
            max={20}
            step={0.05}
            onChange={(v) => setBreath({ area: { radius: v } })}
          />
          <SliderField
            label="falloff"
            tooltip={PARAM_HELP.areaFalloff}
            value={breath.area.falloffExponent}
            min={0.2}
            max={6}
            step={0.05}
            onChange={(v) => setBreath({ area: { falloffExponent: v } })}
          />
        </Section>

        <Section title="Breath View Visualization">
          <ColorField
            label="marker color"
            tooltip={PARAM_HELP.breathTintColor}
            value={breath.area.tintColor}
            onChange={(v) => setBreath({ area: { tintColor: v } })}
          />
          <SliderField
            label="marker intensity"
            tooltip={PARAM_HELP.breathTintAmount}
            value={breath.area.tintAmount}
            min={0}
            max={3}
            step={0.01}
            onChange={(v) => setBreath({ area: { tintAmount: v } })}
          />
          <SliderField
            label="breath/time mix"
            tooltip={PARAM_HELP.breathTimeMix}
            value={breath.area.breathVsTimeMix}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => setBreath({ area: { breathVsTimeMix: v } })}
          />
        </Section>
      </div>
      <div
        style={{
          marginTop: 6,
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 11,
        }}
      >
        <span style={{ opacity: 0.75, textTransform: "uppercase", fontSize: 10 }}>
          origin
        </span>
        <select
          value={selectedOriginPreset}
          title="Snap source direction to a cardinal cloud side."
          onChange={(e) =>
            setOriginPreset(
              e.target.value as
                | "front"
                | "back"
                | "left"
                | "right"
                | "top"
                | "bottom"
                | "custom",
            )
          }
          style={{
            background: "rgba(0,0,0,0.35)",
            color: "inherit",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 6,
            padding: "2px 6px",
            fontSize: 11,
          }}
        >
          <option value="custom">custom</option>
          {ORIGIN_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <span style={{ opacity: 0.7 }}>
          snap to front/left/right/back/top/bottom, then fine-tune with sliders
        </span>
      </div>
      <div
        style={{
          marginTop: 6,
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 10,
          opacity: 0.78,
        }}
      >
        <span>
          area center ({sourcePos[0].toFixed(2)}, {sourcePos[1].toFixed(2)},{" "}
          {sourcePos[2].toFixed(2)})
        </span>
      </div>

      <div
        style={{
          marginTop: 8,
          display: "grid",
          gap: 6,
          maxHeight: 152,
          overflowY: "auto",
          paddingRight: 4,
        }}
      >
        {breath.breathers.map((b, idx) => {
          const shiftedNow = nowMs + b.phaseOffset * cycleMs;
          const level = breathLevelAt(breath, shiftedNow);
          return (
            <div
              key={b.id}
              style={{
                display: "grid",
                gridTemplateColumns: "auto auto 1fr auto auto",
                gap: 8,
                alignItems: "center",
                fontSize: 11,
                background: "rgba(255,255,255,0.04)",
                borderRadius: 6,
                padding: "5px 7px",
              }}
            >
              <span style={{ opacity: 0.7, width: 20 }}>{idx + 1}</span>
              <input
                type="color"
                value={b.color}
                onChange={(e) => updateBreather(b.id, { color: e.target.value })}
                style={{
                  width: 30,
                  height: 20,
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: 4,
                  background: "transparent",
                  padding: 0,
                  cursor: "pointer",
                }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                phase
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={b.phaseOffset}
                  onChange={(e) =>
                    updateBreather(b.id, { phaseOffset: clamp01(parseFloat(e.target.value)) })
                  }
                  style={{ width: "100%" }}
                />
                <span
                  style={{
                    minWidth: 38,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    opacity: 0.75,
                  }}
                >
                  {b.phaseOffset.toFixed(2)}
                </span>
              </label>
              <span style={{ minWidth: 64, opacity: 0.8 }}>level {level.toFixed(2)}</span>
              <button
                onClick={() => removeBreather(b.id)}
                disabled={breath.breathers.length <= 1}
                style={{
                  background: "rgba(255,90,90,0.14)",
                  color: "inherit",
                  border: "1px solid rgba(255,90,90,0.35)",
                  borderRadius: 5,
                  padding: "2px 7px",
                  cursor: breath.breathers.length <= 1 ? "not-allowed" : "pointer",
                  fontSize: 11,
                  opacity: breath.breathers.length <= 1 ? 0.5 : 1,
                }}
                title={
                  breath.breathers.length <= 1
                    ? "Keep at least one breather"
                    : "Remove this breather"
                }
              >
                remove
              </button>
            </div>
          );
        })}
      </div>
      </>
      )}
    </div>
  );
}

function BreathCurve({
  breath,
  cycleSeconds,
  leadProgress,
  nowMs,
}: {
  breath: ReturnType<typeof useSimStore.getState>["breath"];
  cycleSeconds: number;
  leadProgress: number;
  nowMs: number;
}) {
  const WIDTH = 480;
  const HEIGHT = 80;
  const PAD_X = 8;
  const PAD_Y = 8;
  const usableW = WIDTH - PAD_X * 2;
  const usableH = HEIGHT - PAD_Y * 2;

  const mainPath = useMemo(() => {
    const samples = 120;
    const points: string[] = [];
    for (let i = 0; i <= samples; i++) {
      const p = i / samples;
      const tMs = p * Math.max(1, cycleSeconds * 1000);
      const y01 = breathLevelAt(breath, tMs);
      const x = PAD_X + p * usableW;
      const y = PAD_Y + (1 - y01) * usableH;
      points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
    return `M${points.join(" L")}`;
  }, [breath, cycleSeconds, usableH, usableW]);

  return (
    <div
      style={{
        borderRadius: 8,
        background: "rgba(0,0,0,0.25)",
        border: "1px solid rgba(255,255,255,0.08)",
        padding: 6,
      }}
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: 92, display: "block" }}
      >
        <line
          x1={PAD_X}
          x2={WIDTH - PAD_X}
          y1={PAD_Y + usableH}
          y2={PAD_Y + usableH}
          stroke="rgba(255,255,255,0.2)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={PAD_X}
          x2={WIDTH - PAD_X}
          y1={PAD_Y}
          y2={PAD_Y}
          stroke="rgba(255,255,255,0.2)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {[0.25, 0.5, 0.75].map((t) => (
          <line
            key={t}
            x1={PAD_X}
            x2={WIDTH - PAD_X}
            y1={PAD_Y + (1 - t) * usableH}
            y2={PAD_Y + (1 - t) * usableH}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {breath.breathers.map((b) => {
          const x = PAD_X + (((leadProgress + b.phaseOffset) % 1) * usableW);
          const y = PAD_Y + (1 - breathLevelAt(breath, nowMs + b.phaseOffset * cycleSeconds * 1000)) * usableH;
          return (
            <circle
              key={b.id}
              cx={x}
              cy={y}
              r={4}
              fill={b.color}
              stroke="rgba(255,255,255,0.7)"
              strokeWidth={1}
            />
          );
        })}
        <path
          d={mainPath}
          fill="none"
          stroke="rgba(120,215,255,0.95)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

function SliderField({
  label,
  tooltip,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  tooltip?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label
      title={tooltip}
      style={{
        display: "grid",
        gridTemplateRows: "auto auto",
        gap: 4,
        background: "rgba(255,255,255,0.04)",
        borderRadius: 6,
        padding: "6px 8px",
      }}
    >
      <span style={{ fontSize: 10, textTransform: "uppercase", opacity: 0.72 }}>
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{ width: "100%" }}
        />
        <span
          style={{
            minWidth: 40,
            textAlign: "right",
            opacity: 0.82,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value.toFixed(2)}
        </span>
      </div>
    </label>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 8,
        padding: 8,
      }}
    >
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.45,
          opacity: 0.7,
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, minmax(120px, 1fr))",
          gap: 8,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function ColorField({
  label,
  tooltip,
  value,
  onChange,
}: {
  label: string;
  tooltip?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label
      title={tooltip}
      style={{
        display: "grid",
        gridTemplateRows: "auto auto",
        gap: 4,
        background: "rgba(255,255,255,0.04)",
        borderRadius: 6,
        padding: "6px 8px",
      }}
    >
      <span style={{ fontSize: 10, textTransform: "uppercase", opacity: 0.72 }}>
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: 32,
            height: 22,
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 4,
            background: "transparent",
            padding: 0,
            cursor: "pointer",
          }}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => {
            const v = e.target.value.trim();
            if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v);
          }}
          style={{
            background: "rgba(0,0,0,0.35)",
            color: "inherit",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 4,
            padding: "1px 4px",
            fontSize: 11,
            width: 86,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        />
      </div>
    </label>
  );
}

function SegmentPill({
  label,
  width,
  color,
}: {
  label: string;
  width: number;
  color: string;
}) {
  return (
    <div
      style={{
        width: `${Math.max(0, width)}%`,
        background: color,
        borderRadius: 4,
        padding: "2px 6px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
      title={label}
    >
      {label}
    </div>
  );
}

