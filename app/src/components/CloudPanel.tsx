import { useRef } from "react";
import {
  useSimStore,
  type CloudParams,
  type StrandParams,
} from "../state";
import { useDraggable } from "./useDraggable";

/**
 * Hideable cloud body + strand controls (opacity, transform, LED size).
 * Formerly the Leva "Cloud" and "Strand" folders.
 */
export function CloudPanel({ visible = true }: { visible?: boolean }) {
  const cloud = useSimStore((s) => s.cloud);
  const setCloud = useSimStore((s) => s.setCloud);
  const strand = useSimStore((s) => s.strand);
  const setStrand = useSimStore((s) => s.setStrand);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { pos, handleProps } = useDraggable(panelRef);
  const dynStyle: React.CSSProperties = pos
    ? { top: pos.top, left: pos.left, bottom: "auto", right: "auto" }
    : {};
  if (!visible) return null;
  const upd = (patch: Partial<CloudParams>) => setCloud(patch);
  const updStrand = (patch: Partial<StrandParams>) => setStrand(patch);
  return (
    <div ref={panelRef} style={{ ...panelStyle, ...dynStyle }}>
      <div
        onPointerDown={handleProps.onPointerDown}
        style={{ display: "flex", alignItems: "center", gap: 10, cursor: "move" }}
      >
        <div style={titleStyle}>Cloud</div>
        <label style={inlineLabel}>
          <input
            type="checkbox"
            checked={cloud.showOpacity}
            onChange={(e) => upd({ showOpacity: e.target.checked })}
          />
          show cloud
        </label>
        <label style={inlineLabel}>
          <input
            type="checkbox"
            checked={cloud.applyLedOffset ?? true}
            onChange={(e) => upd({ applyLedOffset: e.target.checked })}
          />
          LED bumps
        </label>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
        <SliderRow
          label="Opacity"
          value={cloud.opacity}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => upd({ opacity: v })}
          formatValue={(v) => v.toFixed(2)}
        />
        <SliderRow
          label="Yaw"
          value={cloud.rotationYDeg ?? 0}
          min={-180}
          max={180}
          step={1}
          onChange={(v) => upd({ rotationYDeg: v })}
          formatValue={(v) => `${v.toFixed(0)}°`}
        />
        <SliderRow
          label="Tilt"
          value={cloud.rotationXDeg ?? 0}
          min={-90}
          max={90}
          step={1}
          onChange={(v) => upd({ rotationXDeg: v })}
          formatValue={(v) => `${v.toFixed(0)}°`}
        />
        <SliderRow
          label="Offset X"
          value={cloud.offsetX ?? 0}
          min={-5}
          max={5}
          step={0.01}
          onChange={(v) => upd({ offsetX: v })}
          formatValue={(v) => `${v.toFixed(2)} m`}
        />
        <SliderRow
          label="Offset Y"
          value={cloud.offsetY ?? 0}
          min={-5}
          max={5}
          step={0.01}
          onChange={(v) => upd({ offsetY: v })}
          formatValue={(v) => `${v.toFixed(2)} m`}
        />
        <SliderRow
          label="Offset Z"
          value={cloud.offsetZ ?? 0}
          min={-5}
          max={5}
          step={0.01}
          onChange={(v) => upd({ offsetZ: v })}
          formatValue={(v) => `${v.toFixed(2)} m`}
        />
        <div style={sectionLabel}>Strand</div>
        <SliderRow
          label="LED size"
          value={strand.ledSize}
          min={0.005}
          max={0.2}
          step={0.005}
          onChange={(v) => updStrand({ ledSize: v })}
          formatValue={(v) => `${(v * 1000).toFixed(0)} mm`}
        />
        <SliderRow
          label="Sensor focus"
          value={strand.sensorHemisphereFocus ?? 0}
          min={0}
          max={12}
          step={0.1}
          onChange={(v) => updStrand({ sensorHemisphereFocus: v })}
          formatValue={(v) => v.toFixed(1)}
        />
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
      <span style={{ width: 80, opacity: 0.85 }}>{label}</span>
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
          width: 52,
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
  left: 12,
  zIndex: 15,
  width: 300,
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
