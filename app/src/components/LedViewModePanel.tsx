import { useSimStore, type LedDisplayMode, type LedViewMode } from "../state";

const MODES: Array<{ id: LedViewMode; label: string; help: string }> = [
  {
    id: "breathIntensity",
    label: "Breath",
    help: "Shows only the breath rendering pipeline.",
  },
  {
    id: "timeOfDay",
    label: "Time of day",
    help: "Shows only the time-of-day rendering pipeline.",
  },
  {
    id: "breathPlusTimeOfDay",
    label: "Breath + time of day",
    help: "Blends breath and time-of-day pipelines parametrically.",
  },
];

const DISPLAY_MODES: Array<{ id: LedDisplayMode; label: string; help: string }> = [
  {
    id: "sensors",
    label: "Ball sensors",
    help:
      "Matte spheres that sample lighting at their surface position. Represents the rendering pipeline's sampling side.",
  },
  {
    id: "leds",
    label: "LEDs (streamed)",
    help:
      "Narrow oriented hemispheres that emit their per-LED stream color. Shows what actually gets sent to WLED.",
  },
];

export function LedViewModePanel() {
  const mode = useSimStore((s) => s.ledViewMode);
  const setMode = useSimStore((s) => s.setLedViewMode);
  const displayMode = useSimStore((s) => s.ledDisplayMode);
  const setDisplayMode = useSimStore((s) => s.setLedDisplayMode);
  const streamPipeline = useSimStore((s) => s.ledStreamPipeline);
  const setStreamPipeline = useSimStore((s) => s.setLedStreamPipeline);
  const locator = useSimStore((s) => s.ledLocator);
  const setLocator = useSimStore((s) => s.setLedLocator);
  const clearLocated = useSimStore((s) => s.clearLocatedLeds);

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
      <div
        style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: "1px solid rgba(255,255,255,0.1)",
          display: "grid",
          gap: 6,
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: 0.45,
            textTransform: "uppercase",
            opacity: 0.72,
          }}
        >
          Display
        </div>
        {DISPLAY_MODES.map((m) => (
          <label
            key={m.id}
            title={m.help}
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: 8,
              alignItems: "start",
              background:
                displayMode === m.id
                  ? "rgba(70,225,110,0.12)"
                  : "rgba(255,255,255,0.04)",
              border: `1px solid ${
                displayMode === m.id
                  ? "rgba(70,225,110,0.35)"
                  : "rgba(255,255,255,0.1)"
              }`,
              borderRadius: 7,
              padding: "6px 8px",
              cursor: "pointer",
            }}
          >
            <input
              type="radio"
              name="led-display-mode"
              checked={displayMode === m.id}
              onChange={() => setDisplayMode(m.id)}
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
      {displayMode === "leds" && (
        <div
          style={{
            marginTop: 8,
            paddingTop: 8,
            borderTop: "1px solid rgba(255,255,255,0.1)",
            display: "grid",
            gap: 6,
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: 0.45,
              textTransform: "uppercase",
              opacity: 0.72,
            }}
          >
            LED Stream Pipeline
          </div>
          <div style={{ fontSize: 11, opacity: 0.78 }}>
            time of day → breath → locator override → stream
          </div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={streamPipeline.timeOfDayStage}
              onChange={(e) => setStreamPipeline({ timeOfDayStage: e.target.checked })}
            />
            enable time-of-day stage
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={streamPipeline.breathStage}
              onChange={(e) => setStreamPipeline({ breathStage: e.target.checked })}
            />
            enable breath stage
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={streamPipeline.locatorOverrideStage}
              onChange={(e) =>
                setStreamPipeline({ locatorOverrideStage: e.target.checked })}
            />
            enable locator override stage
          </label>
        </div>
      )}
      <div
        style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: "1px solid rgba(255,255,255,0.1)",
          display: "grid",
          gap: 6,
        }}
      >
        <label
          title="When enabled, click LEDs in the 3D view to toggle bright yellow highlight."
          style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12 }}
        >
          <input
            type="checkbox"
            checked={locator.enabled}
            onChange={(e) => setLocator({ enabled: e.target.checked })}
          />
          locate LEDs (click to highlight)
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, opacity: 0.75 }}>
            selected {locator.highlighted.length}
          </span>
          <button
            onClick={clearLocated}
            style={{
              background: "rgba(255,255,255,0.08)",
              color: "inherit",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 6,
              padding: "2px 8px",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            clear
          </button>
        </div>
      </div>
    </div>
  );
}

