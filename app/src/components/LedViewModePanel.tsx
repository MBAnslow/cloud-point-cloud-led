import { useSimStore, type LedViewMode } from "../state";

const MODES: Array<{ id: LedViewMode; label: string; help: string }> = [
  {
    id: "breathIntensity",
    label: "Breath intensity",
    help: "Shows only breath channels on LEDs: exhale=red, inhale=blue.",
  },
  {
    id: "lightOnly",
    label: "Light visualization",
    help: "Shows scene lighting only, without breath modulation.",
  },
  {
    id: "breathPlusLight",
    label: "Breath + light",
    help: "Shows scene lighting with inhale dimming and exhale exposure boost.",
  },
];

export function LedViewModePanel() {
  const mode = useSimStore((s) => s.ledViewMode);
  const setMode = useSimStore((s) => s.setLedViewMode);

  return (
    <div
      style={{
        position: "fixed",
        left: 12,
        top: 220,
        width: "min(300px, 24vw)",
        zIndex: 10,
        pointerEvents: "auto",
        background: "rgba(10, 12, 20, 0.72)",
        backdropFilter: "blur(8px)",
        borderRadius: 10,
        boxShadow: "0 1px 0 rgba(255,255,255,0.05) inset",
        color: "rgba(207,214,230,0.95)",
        padding: "10px 10px 8px",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: 0.45,
          textTransform: "uppercase",
          opacity: 0.72,
          marginBottom: 8,
        }}
      >
        LED View
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {MODES.map((m) => (
          <label
            key={m.id}
            title={m.help}
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: 8,
              alignItems: "start",
              background:
                mode === m.id ? "rgba(70,225,110,0.12)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${
                mode === m.id ? "rgba(70,225,110,0.35)" : "rgba(255,255,255,0.1)"
              }`,
              borderRadius: 7,
              padding: "7px 8px",
              cursor: "pointer",
            }}
          >
            <input
              type="radio"
              name="led-view-mode"
              checked={mode === m.id}
              onChange={() => setMode(m.id)}
              style={{ marginTop: 1 }}
            />
            <span>
              <span style={{ display: "block", fontSize: 12 }}>{m.label}</span>
              <span style={{ display: "block", fontSize: 10, opacity: 0.72 }}>
                {m.help}
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

