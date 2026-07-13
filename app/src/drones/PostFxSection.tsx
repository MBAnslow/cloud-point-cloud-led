import { useSimStore } from "../state";

/**
 * Post-processing effect stack. A single soft-clip distortion,
 * mixable and togglable. Chain:
 *   voices → master EQ → tremolo → distortion → master.
 */
export function PostFxSection() {
  const drone = useSimStore((s) => s.drone);
  const setDrone = useSimStore((s) => s.setDrone);

  return (
    <section
      style={{
        padding: "10px 0",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        display: "flex",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      <FxCard
        title="Distortion"
        titleIcon="⚡"
        enabled={drone.distortionEnabled}
        onToggle={(v) => setDrone({ distortionEnabled: v })}
        accent="#22c55e"
      >
        <FxSlider
          label="Drive"
          icon="🚗"
          value={drone.distortionDrive}
          onChange={(v) => setDrone({ distortionDrive: v })}
          accent="#22c55e"
        />
        <FxSlider
          label="Mix"
          icon="☕"
          value={drone.distortionMix}
          onChange={(v) => setDrone({ distortionMix: v })}
          accent="#22c55e"
        />
      </FxCard>
    </section>
  );
}

function FxCard({
  title,
  titleIcon,
  enabled,
  onToggle,
  accent,
  children,
}: {
  title: string;
  titleIcon: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        flex: "1 1 320px",
        minWidth: 280,
        padding: 12,
        borderRadius: 10,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.1)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        opacity: enabled ? 1 : 0.7,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16, opacity: 0.8 }}>{titleIcon}</span>
        <strong style={{ fontSize: 14 }}>{title}</strong>
        <button
          onClick={() => onToggle(!enabled)}
          title={enabled ? "Bypass" : "Enable"}
          style={{
            marginLeft: "auto",
            background: enabled ? accent : "rgba(255,255,255,0.08)",
            color: enabled ? "#0a1420" : "rgba(207,214,230,0.7)",
            border: `1px solid ${enabled ? accent : "rgba(255,255,255,0.2)"}`,
            borderRadius: 999,
            width: 30,
            height: 24,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          ⏻
        </button>
      </div>
      {children}
    </div>
  );
}

function FxSlider({
  label,
  icon,
  value,
  min,
  max,
  step,
  onChange,
  accent,
}: {
  label: string;
  icon: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  accent: string;
}) {
  const lo = min ?? 0;
  const hi = max ?? 1;
  const st = step ?? 0.01;
  const pct = ((Math.max(lo, Math.min(hi, value)) - lo) / (hi - lo || 1)) * 100;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
        <span style={{ opacity: 0.75 }}>{icon}</span>
        <span>{label}</span>
        <span style={{ marginLeft: "auto", opacity: 0.6 }}>
          {max !== undefined
            ? value.toFixed(step && step < 0.01 ? 3 : step && step < 0.1 ? 2 : 1)
            : `${Math.round(pct)}%`}
        </span>
      </div>
      <input
        type="range"
        min={lo}
        max={hi}
        step={st}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={
          {
            width: "100%",
            accentColor: accent,
          } as React.CSSProperties
        }
      />
    </div>
  );
}
