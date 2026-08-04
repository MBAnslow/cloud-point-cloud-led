import { useMemo, useRef, useState } from "react";
import {
  useSimStore,
  hourInRange,
  activeWindowProgress,
  periodsCrossingActiveWindow,
  type BreathFilterKeyframe,
  type BreathFilterParams,
  type DayPeriod,
} from "../state";
import { sampleBreathFilterThreshold } from "../lighting/breathFilter";
import { useDraggable } from "./useDraggable";

/**
 * Hideable controls for the persistent breath → time-of-day filter
 * memory. Threshold is keyframed over the breath active window
 * (same plot style as lightning storm keys).
 */
export function BreathFilterPanel({ visible = true }: { visible?: boolean }) {
  const breathFilter = useSimStore((s) => s.breathFilter);
  const setBreathFilter = useSimStore((s) => s.setBreathFilter);
  const breath = useSimStore((s) => s.breath);
  const dayPeriods = useSimStore((s) => s.dayCycle.periods);
  const skyTimeHours = useSimStore((s) => s.sky.timeHours);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { pos, handleProps } = useDraggable(panelRef);
  const dynStyle: React.CSSProperties = pos
    ? { top: pos.top, left: pos.left, bottom: "auto", right: "auto" }
    : {};

  const sorted = useMemo(
    () => [...breathFilter.keyframes].sort((a, b) => a.t - b.t),
    [breathFilter.keyframes],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    sorted.find((k) => k.id === selectedId) ?? sorted[0] ?? null;
  const inActiveWindow = hourInRange(
    skyTimeHours,
    breath.activeStartHour,
    breath.activeEndHour,
  );
  const playheadU = activeWindowProgress(
    skyTimeHours,
    breath.activeStartHour,
    breath.activeEndHour,
  );
  const liveThreshold = sampleBreathFilterThreshold(
    sorted,
    playheadU,
    breathFilter.threshold,
  );

  if (!visible) return null;

  const upd = (patch: Partial<BreathFilterParams>) => setBreathFilter(patch);

  const setKeyframes = (keyframes: BreathFilterKeyframe[]) => {
    const next = [...keyframes].sort((a, b) => a.t - b.t);
    const sel =
      next.find((k) => k.id === (selected?.id ?? selectedId)) ?? next[0];
    upd({
      keyframes: next,
      threshold: sel?.threshold ?? breathFilter.threshold,
    });
  };

  const patchSelectedThreshold = (threshold: number) => {
    if (!selected) {
      upd({ threshold });
      return;
    }
    setSelectedId(selected.id);
    const th = Math.max(0, Math.min(1, threshold));
    const keyframes = breathFilter.keyframes.map((k) =>
      k.id === selected.id ? { ...k, threshold: th } : k,
    );
    upd({ keyframes, threshold: th });
  };

  return (
    <div ref={panelRef} style={{ ...panelStyle, ...dynStyle }}>
      <div
        onPointerDown={handleProps.onPointerDown}
        style={{ display: "flex", alignItems: "center", gap: 10, cursor: "move" }}
      >
        <div style={titleStyle}>Breath filter</div>
        <label style={inlineLabel}>
          <input
            type="checkbox"
            checked={breathFilter.enabled}
            onChange={(e) => upd({ enabled: e.target.checked })}
          />
          enabled
        </label>
        <label style={inlineLabel}>
          <input
            type="checkbox"
            checked={breathFilter.showNoise}
            onChange={(e) => upd({ showNoise: e.target.checked })}
          />
          show noise
        </label>
        <button
          type="button"
          style={miniBtn}
          title="Resample the spatial cooldown-rate field"
          onClick={() =>
            upd({ seed: (Math.random() * 0x7fffffff) | 0 })
          }
        >
          Regenerate
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
        <ThresholdKeyframeEditor
          keyframes={breathFilter.keyframes}
          selectedId={selected?.id ?? null}
          playheadU={inActiveWindow ? playheadU : null}
          activeStartHour={breath.activeStartHour}
          activeEndHour={breath.activeEndHour}
          periods={dayPeriods}
          onSelect={setSelectedId}
          onChange={setKeyframes}
        />
        <div style={{ fontSize: 9, opacity: 0.55, marginBottom: 2 }}>
          Threshold* follows the breath active window (sky timeline). Yellow
          line = now
          {inActiveWindow
            ? ` · live ${liveThreshold.toFixed(2)}`
            : " · outside window"}.
        </div>
        <SliderRow
          label="Threshold*"
          value={selected?.threshold ?? breathFilter.threshold}
          min={0}
          max={1}
          step={0.01}
          onChange={patchSelectedThreshold}
          formatValue={(v) => v.toFixed(2)}
        />
        {selected && (
          <SliderRow
            label="Key pos"
            value={selected.t}
            min={0}
            max={1}
            step={0.001}
            onChange={(t) => {
              const keyframes = breathFilter.keyframes.map((k) =>
                k.id === selected.id
                  ? { ...k, t: Math.max(0, Math.min(1, t)) }
                  : k,
              );
              setKeyframes(keyframes);
            }}
            formatValue={(v) => `${(v * 100).toFixed(0)}%`}
          />
        )}
        <SliderRow
          label="Decay max"
          value={breathFilter.decayMaxSeconds}
          min={0.1}
          max={30}
          step={0.1}
          onChange={(v) => upd({ decayMaxSeconds: v })}
          formatValue={(v) => `${v.toFixed(1)}s`}
        />
        <SliderRow
          label="Noise scale"
          value={breathFilter.cooldownScale}
          min={0.2}
          max={10}
          step={0.05}
          onChange={(v) => upd({ cooldownScale: v })}
          formatValue={(v) => v.toFixed(2)}
        />
        <SliderRow
          label="Noise contrast"
          value={breathFilter.cooldownContrast}
          min={0.1}
          max={4}
          step={0.05}
          onChange={(v) => upd({ cooldownContrast: v })}
          formatValue={(v) => v.toFixed(2)}
        />
      </div>
      <div style={{ marginTop: 6, fontSize: 10, opacity: 0.65, lineHeight: 1.35 }}>
        Show noise overrides the current view (including locate) with
        cooldown rates (black = long fade, white = snap). Decay max is the
        full fade length for black LEDs. Turn show-noise off to restore
        normal shading. Regenerate reshuffles the field.
      </div>
    </div>
  );
}

function makeKfId(): string {
  return `bf-kf-${Math.random().toString(36).slice(2, 8)}`;
}

function ThresholdKeyframeEditor({
  keyframes,
  selectedId,
  playheadU,
  activeStartHour,
  activeEndHour,
  periods,
  onSelect,
  onChange,
}: {
  keyframes: BreathFilterKeyframe[];
  selectedId: string | null;
  playheadU: number | null;
  activeStartHour: number;
  activeEndHour: number;
  periods: DayPeriod[];
  onSelect: (id: string) => void;
  onChange: (next: BreathFilterKeyframe[]) => void;
}) {
  const sorted = useMemo(
    () => [...keyframes].sort((a, b) => a.t - b.t),
    [keyframes],
  );
  const selected =
    sorted.find((k) => k.id === selectedId) ?? sorted[0] ?? null;

  const periodSpans = useMemo(
    () =>
      periodsCrossingActiveWindow(periods, activeStartHour, activeEndHour),
    [periods, activeStartHour, activeEndHour],
  );

  const W = 520;
  const H = 64;
  const PAD = 4;
  const plotInnerW = W - PAD * 2;
  const path = useMemo(() => {
    const samples = 48;
    const pts: string[] = [];
    for (let i = 0; i <= samples; i++) {
      const u = i / samples;
      const x = PAD + u * plotInnerW;
      const v = sampleBreathFilterThreshold(sorted, u, 0);
      const y = PAD + (1 - Math.min(1, v)) * (H - PAD * 2);
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return pts.length ? `M${pts.join(" L")}` : "";
  }, [sorted, plotInnerW]);

  const addKey = () => {
    const base = selected?.threshold ?? sampleBreathFilterThreshold(sorted, 0.5);
    const t = selected ? Math.min(1, selected.t + 0.1) : 0.5;
    const id = makeKfId();
    onChange([...keyframes, { id, t, threshold: base }]);
    onSelect(id);
  };

  const removeKey = () => {
    if (keyframes.length <= 2 || !selected) return;
    const next = keyframes.filter((k) => k.id !== selected.id);
    onChange(next);
    onSelect(next[0]?.id ?? null);
  };

  const onPreviewClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const t = Math.max(0, Math.min(1, x));
    const threshold = sampleBreathFilterThreshold(sorted, t);
    const id = makeKfId();
    onChange([...keyframes, { id, t, threshold }]);
    onSelect(id);
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <div style={{ fontSize: 10, opacity: 0.7 }}>
          Threshold keyframes · breath window
          {playheadU != null
            ? ` · now ${(playheadU * 100).toFixed(0)}%`
            : " · outside window"}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button type="button" style={miniBtn} onClick={addKey}>
            + key
          </button>
          <button
            type="button"
            style={miniBtn}
            onClick={removeKey}
            disabled={keyframes.length <= 2}
          >
            − key
          </button>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        style={{
          display: "block",
          cursor: "crosshair",
          background: "rgba(0,0,0,0.2)",
          borderRadius: 4,
        }}
        onClick={onPreviewClick}
      >
        {periodSpans.map((span, i) => {
          const x = PAD + span.u0 * plotInnerW;
          const w = Math.max(0.5, (span.u1 - span.u0) * plotInnerW);
          const label =
            w >= 28 ? span.name : w >= 14 ? span.name.slice(0, 1) : "";
          return (
            <g key={`${span.periodId}-${i}-${span.u0.toFixed(3)}`}>
              <rect
                x={x}
                y={0}
                width={w}
                height={H}
                fill={span.color}
                opacity={0.22}
              />
              <line
                x1={x}
                x2={x}
                y1={0}
                y2={H}
                stroke={span.color}
                strokeOpacity={0.55}
                strokeWidth={1}
              />
              {label && (
                <text
                  x={x + 3}
                  y={10}
                  fill="rgba(255,255,255,0.88)"
                  fontSize={7}
                  fontFamily="ui-sans-serif, system-ui, sans-serif"
                  style={{ pointerEvents: "none" }}
                >
                  {label}
                </text>
              )}
            </g>
          );
        })}
        {path && (
          <path
            d={path}
            fill="none"
            stroke="rgba(119,213,255,0.95)"
            strokeWidth={1.5}
            style={{ pointerEvents: "none" }}
          />
        )}
        {playheadU != null && (
          <line
            x1={PAD + playheadU * plotInnerW}
            x2={PAD + playheadU * plotInnerW}
            y1={0}
            y2={H}
            stroke="rgba(255,220,90,0.95)"
            strokeWidth={1.5}
            strokeDasharray="3 2"
            style={{ pointerEvents: "none" }}
          />
        )}
        {sorted.map((k) => {
          const x = PAD + k.t * plotInnerW;
          const y = PAD + (1 - Math.min(1, k.threshold)) * (H - PAD * 2);
          const isSel = selected?.id === k.id;
          return (
            <g
              key={k.id}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(k.id);
              }}
              style={{ cursor: "pointer" }}
            >
              <circle
                cx={x}
                cy={y}
                r={isSel ? 5 : 4}
                fill={isSel ? "#fff" : "rgba(119,213,255,0.95)"}
                stroke={isSel ? "rgba(255,220,90,0.9)" : "rgba(0,0,0,0.5)"}
                strokeWidth={isSel ? 2 : 1}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  formatValue,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  formatValue?: (v: number) => string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
      <span style={{ width: 88, opacity: 0.85 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1 }}
      />
      <span style={{ width: 46, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {formatValue ? formatValue(value) : value.toFixed(2)}
      </span>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 60,
  left: 12,
  zIndex: 15,
  width: 360,
  background: "rgba(10, 12, 20, 0.82)",
  backdropFilter: "blur(8px)",
  color: "rgba(207,214,230,0.95)",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.12)",
  fontFamily:
    "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
};

const titleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: 0.3,
  marginRight: "auto",
};

const inlineLabel: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontSize: 11,
};

const miniBtn: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  color: "inherit",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 4,
  padding: "2px 6px",
  fontSize: 10,
  cursor: "pointer",
};
