import { useRef } from "react";
import {
  useSimStore,
  type AmbientLightParams,
  type SkyParams,
} from "../state";
import { useDraggable } from "./useDraggable";

/**
 * Hideable time-of-day visualization + ambient light controls.
 * Color stops stay on the SkyTimeline.
 */
export function TimeOfDayPanel({ visible = true }: { visible?: boolean }) {
  const sky = useSimStore((s) => s.sky);
  const setSky = useSimStore((s) => s.setSky);
  const ambient = useSimStore((s) => s.ambient);
  const setAmbient = useSimStore((s) => s.setAmbient);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { pos, handleProps } = useDraggable(panelRef);
  const dynStyle: React.CSSProperties = pos
    ? { top: pos.top, left: pos.left, bottom: "auto", right: "auto" }
    : {};
  if (!visible) return null;
  const upd = (patch: Partial<SkyParams>) => setSky(patch);
  const updAmbient = (patch: Partial<AmbientLightParams>) => setAmbient(patch);
  return (
    <div ref={panelRef} style={{ ...panelStyle, ...dynStyle }}>
      <div
        onPointerDown={handleProps.onPointerDown}
        style={{ display: "flex", alignItems: "center", gap: 10, cursor: "move" }}
      >
        <div style={titleStyle}>Time of day</div>
        <label style={inlineLabel}>
          <input
            type="checkbox"
            checked={sky.enabled}
            onChange={(e) => upd({ enabled: e.target.checked })}
          />
          enabled
        </label>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
        <SliderRow
          label="Amount"
          value={sky.visualizationAmount ?? 1}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => upd({ visualizationAmount: v })}
          formatValue={(v) => v.toFixed(2)}
        />
        <SliderRow
          label="24h cycle"
          value={sky.cycleSeconds}
          min={20}
          max={600}
          step={1}
          onChange={(v) => upd({ cycleSeconds: v })}
          formatValue={(v) => `${v.toFixed(0)}s`}
        />
        <SliderRow
          label="Ambient scale"
          value={sky.ambientScale}
          min={0}
          max={3}
          step={0.01}
          onChange={(v) => upd({ ambientScale: v })}
          formatValue={(v) => v.toFixed(2)}
        />
        <SliderRow
          label="Sun scale"
          value={sky.sunScale}
          min={0}
          max={3}
          step={0.01}
          onChange={(v) => upd({ sunScale: v })}
          formatValue={(v) => v.toFixed(2)}
        />
        <SliderRow
          label="Sun spread"
          value={sky.sunSpread ?? 0.9}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => upd({ sunSpread: v })}
          formatValue={(v) => v.toFixed(2)}
        />
        <SliderRow
          label="Moon scale"
          value={sky.moonScale}
          min={0}
          max={3}
          step={0.01}
          onChange={(v) => upd({ moonScale: v })}
          formatValue={(v) => v.toFixed(2)}
        />
        <SliderRow
          label="Moon spread"
          value={sky.moonSpread ?? 0.9}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => upd({ moonSpread: v })}
          formatValue={(v) => v.toFixed(2)}
        />
        <SliderRow
          label="Horizon cut"
          value={sky.horizonCutoffDeg ?? -7}
          min={-30}
          max={30}
          step={0.5}
          onChange={(v) => upd({ horizonCutoffDeg: v })}
          formatValue={(v) => `${v.toFixed(1)}°`}
        />
        <SliderRow
          label="Horizon soft"
          value={sky.horizonSoftnessDeg ?? 0}
          min={0}
          max={60}
          step={0.5}
          onChange={(v) => upd({ horizonSoftnessDeg: v })}
          formatValue={(v) => `${v.toFixed(1)}°`}
        />
        <div style={sectionLabel}>Lights</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
          <span style={{ width: 88, opacity: 0.85 }}>Ambient</span>
          <input
            type="color"
            value={ambient.color}
            onChange={(e) => updAmbient({ color: e.target.value })}
            style={{
              width: 28,
              height: 20,
              padding: 0,
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 3,
              background: "transparent",
              cursor: "pointer",
            }}
          />
          <span style={{ flex: 1 }} />
        </div>
        <SliderRow
          label="Amb. intensity"
          value={ambient.intensity}
          min={0}
          max={2}
          step={0.01}
          onChange={(v) => updAmbient({ intensity: v })}
          formatValue={(v) => v.toFixed(2)}
        />
      </div>
      <div style={{ marginTop: 6, fontSize: 10, opacity: 0.65, lineHeight: 1.35 }}>
        Color stops for sun, moon, and ambient live on the sky timeline.
        This panel sets how strongly that lighting paints the cloud.
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
      <span
        style={{
          width: 46,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatValue ? formatValue(value) : value.toFixed(2)}
      </span>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 60,
  left: 340,
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
  maxHeight: "calc(100vh - 80px)",
  overflowY: "auto",
};

const titleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: 0.3,
  marginRight: "auto",
};

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  opacity: 0.7,
  marginTop: 6,
  paddingTop: 4,
  borderTop: "1px solid rgba(255,255,255,0.1)",
};

const inlineLabel: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontSize: 11,
};
