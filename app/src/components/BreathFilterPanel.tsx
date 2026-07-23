import { useRef } from "react";
import { useSimStore, type BreathFilterParams } from "../state";
import { useDraggable } from "./useDraggable";

/**
 * Hideable controls for the persistent breath → time-of-day filter
 * memory: threshold floor and procedural per-LED cooldown rates.
 */
export function BreathFilterPanel({ visible = true }: { visible?: boolean }) {
  const breathFilter = useSimStore((s) => s.breathFilter);
  const setBreathFilter = useSimStore((s) => s.setBreathFilter);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { pos, handleProps } = useDraggable(panelRef);
  const dynStyle: React.CSSProperties = pos
    ? { top: pos.top, left: pos.left, bottom: "auto", right: "auto" }
    : {};
  if (!visible) return null;
  const upd = (patch: Partial<BreathFilterParams>) => setBreathFilter(patch);
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
        <SliderRow
          label="Threshold"
          value={breathFilter.threshold}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => upd({ threshold: v })}
          formatValue={(v) => v.toFixed(2)}
        />
        <SliderRow
          label="Decay max"
          value={breathFilter.decayMaxSeconds}
          min={0.1}
          max={5}
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
        cooldown rates (black = linger, white = snap). Turn it off to restore
        normal shading. Regenerate reshuffles the field.
      </div>
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
  width: 320,
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
