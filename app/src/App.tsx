import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { Link } from "react-router-dom";
import { Leva } from "leva";
import { ControlPanel } from "./controls/Panel";
import { Histogram } from "./components/Histogram";
import { StreamMatrix } from "./components/StreamMatrix";
import { BreathOscillator } from "./components/BreathOscillator";
import { BreathFilterPanel } from "./components/BreathFilterPanel";
import { DayCyclePanel } from "./components/DayCyclePanel";
import { LedViewModePanel } from "./components/LedViewModePanel";
import { LightningPanel } from "./components/LightningPanel";
import { MasterFrequencyPanel } from "./components/MasterFrequencyPanel";
import { SkyTimeline } from "./components/SkyTimeline";
import { Ellipsoid } from "./scene/Ellipsoid";
import { BreathArea } from "./scene/BreathArea";
import { HorizonGuide } from "./scene/HorizonGuide";
import { Leds } from "./scene/Leds";
import { LightningBolts } from "./scene/LightningBolts";
import { Lights } from "./scene/Lights";
import { useSimStore } from "./state";

export default function App() {
  const ui = useSimStore((s) => s.ui);
  const setUi = useSimStore((s) => s.setUi);
  return (
    <>
      <Leva collapsed={false} oneLineLabels />
      <TopBar />
      <Footer
        showMaster={ui.showMaster}
        showBreath={ui.showBreath}
        showLightning={ui.showLightning}
        showBreathFilter={ui.showBreathFilter}
        showStream={ui.showStream}
        onToggleMaster={() => setUi({ showMaster: !ui.showMaster })}
        onToggleBreath={() => setUi({ showBreath: !ui.showBreath })}
        onToggleLightning={() => setUi({ showLightning: !ui.showLightning })}
        onToggleBreathFilter={() =>
          setUi({ showBreathFilter: !ui.showBreathFilter })
        }
        onToggleStream={() => setUi({ showStream: !ui.showStream })}
      />
      <ControlPanel />
      <DayCyclePanel />
      <SkyTimeline />
      <LedViewModePanel />
      <MasterFrequencyPanel visible={ui.showMaster} />
      <BreathOscillator visible={ui.showBreath} />
      <LightningPanel visible={ui.showLightning} />
      <BreathFilterPanel visible={ui.showBreathFilter} />
      <Histogram />
      <StreamMatrix visible={ui.showStream} />
      <Canvas
        camera={{ position: [4, 3, 5], fov: 50 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={["#0a0a0c"]} />
        <Grid
          args={[20, 20]}
          cellSize={0.5}
          sectionSize={2}
          cellColor="#222"
          sectionColor="#333"
          fadeDistance={30}
          fadeStrength={1.5}
          infiniteGrid
          position={[0, -1.5, 0]}
        />
        <axesHelper args={[1]} />

        <Lights />
        <HorizonGuide />
        <Ellipsoid />
        <Leds />
        <BreathArea />
        <LightningBolts />

        <OrbitControls makeDefault />
      </Canvas>
    </>
  );
}

/**
 * Fixed transport bar at the top of the simulator page. Exposes the
 * global sky-clock play/pause and an "auto-next" toggle that makes the
 * clock roll into the next day period at the boundary instead of
 * looping inside the current one.
 */
function TopBar() {
  const sky = useSimStore((s) => s.sky);
  const setSky = useSimStore((s) => s.setSky);
  const dayCycle = useSimStore((s) => s.dayCycle);
  const setDayCycle = useSimStore((s) => s.setDayCycle);
  const advancePeriod = useSimStore((s) => s.advancePeriod);
  const previousPeriod = useSimStore((s) => s.previousPeriod);
  const active = dayCycle.periods.find((p) => p.id === dayCycle.activePeriodId);
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        background: "rgba(10, 12, 20, 0.85)",
        backdropFilter: "blur(8px)",
        borderBottom: "1px solid rgba(255,255,255,0.12)",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        color: "rgba(207,214,230,0.95)",
        fontSize: 12,
      }}
    >
      <button
        onClick={() => setSky({ autoPlay: !sky.autoPlay })}
        style={topPlayStyle(sky.autoPlay)}
        title={sky.autoPlay ? "Pause the day clock" : "Play the day clock"}
      >
        {sky.autoPlay ? "❚❚ Pause" : "▶ Play"}
      </button>
      <button
        onClick={() => setDayCycle({ autoNext: !dayCycle.autoNext })}
        style={topToggleStyle(dayCycle.autoNext)}
        title="When on, the clock advances into the next day period automatically at the boundary."
      >
        {dayCycle.autoNext ? "⏭ Auto-next: on" : "⏭ Auto-next: off"}
      </button>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          marginLeft: 4,
          padding: "2px 6px",
          borderRadius: 4,
          border: `1px solid ${active?.color ?? "rgba(255,255,255,0.2)"}55`,
          background: `${active?.color ?? "#888"}22`,
        }}
      >
        <button onClick={previousPeriod} style={topStepStyle} title="Previous period">
          ◀
        </button>
        <span
          style={{
            minWidth: 46,
            textAlign: "center",
            fontWeight: 600,
            color: active?.color ?? "inherit",
          }}
        >
          {active?.name ?? "—"}
        </span>
        <button onClick={advancePeriod} style={topStepStyle} title="Next period">
          ▶
        </button>
      </div>
    </div>
  );
}

const topPlayStyle = (playing: boolean): React.CSSProperties => ({
  color: "rgba(207,214,230,0.95)",
  padding: "6px 12px",
  fontSize: 12,
  borderRadius: 6,
  border: `1px solid ${playing ? "rgba(70,225,110,0.45)" : "rgba(255,255,255,0.15)"}`,
  background: playing ? "rgba(70,225,110,0.22)" : "rgba(255,255,255,0.04)",
  cursor: "pointer",
});

const topToggleStyle = (active: boolean): React.CSSProperties => ({
  color: "rgba(207,214,230,0.95)",
  padding: "6px 12px",
  fontSize: 12,
  borderRadius: 6,
  border: `1px solid ${active ? "rgba(76, 110, 245, 0.5)" : "rgba(255,255,255,0.15)"}`,
  background: active ? "rgba(76, 110, 245, 0.28)" : "rgba(255,255,255,0.04)",
  cursor: "pointer",
});

const topStepStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  color: "rgba(207,214,230,0.95)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 3,
  padding: "1px 6px",
  fontSize: 10,
  cursor: "pointer",
  lineHeight: 1.2,
};

const footerLinkStyle: React.CSSProperties = {
  color: "rgba(207,214,230,0.95)",
  textDecoration: "none",
  padding: "6px 12px",
  fontSize: 12,
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.04)",
};

const footerToggleStyle = (active: boolean): React.CSSProperties => ({
  color: "rgba(207,214,230,0.95)",
  padding: "6px 12px",
  fontSize: 12,
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.15)",
  background: active ? "rgba(76, 110, 245, 0.35)" : "rgba(255,255,255,0.04)",
  cursor: "pointer",
});

function Footer({
  showMaster,
  showBreath,
  showLightning,
  showBreathFilter,
  showStream,
  onToggleMaster,
  onToggleBreath,
  onToggleLightning,
  onToggleBreathFilter,
  onToggleStream,
}: {
  showMaster: boolean;
  showBreath: boolean;
  showLightning: boolean;
  showBreathFilter: boolean;
  showStream: boolean;
  onToggleMaster: () => void;
  onToggleBreath: () => void;
  onToggleLightning: () => void;
  onToggleBreathFilter: () => void;
  onToggleStream: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "8px 12px",
        background: "rgba(10, 12, 20, 0.85)",
        backdropFilter: "blur(8px)",
        borderTop: "1px solid rgba(255,255,255,0.12)",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={onToggleMaster}
          style={footerToggleStyle(showMaster)}
          title="Toggle Master volume controls panel"
        >
          {showMaster ? "▾" : "▸"} Master volume
        </button>
        <button
          onClick={onToggleBreath}
          style={footerToggleStyle(showBreath)}
          title="Toggle Breath oscillator panel"
        >
          {showBreath ? "▾" : "▸"} Breath
        </button>
        <button
          onClick={onToggleBreathFilter}
          style={footerToggleStyle(showBreathFilter)}
          title="Toggle Breath filter panel"
        >
          {showBreathFilter ? "▾" : "▸"} Breath filter
        </button>
        <button
          onClick={onToggleLightning}
          style={footerToggleStyle(showLightning)}
          title="Toggle Lightning panel"
        >
          {showLightning ? "▾" : "▸"} Lightning
        </button>
        <button
          onClick={onToggleStream}
          style={footerToggleStyle(showStream)}
          title="Toggle Stream RGB matrix panel"
        >
          {showStream ? "▾" : "▸"} Stream RGB
        </button>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Link to="/drones" style={footerLinkStyle}>
          Drones →
        </Link>
        <Link to="/pads" style={footerLinkStyle}>
          Pads →
        </Link>
        <Link to="/samples" style={footerLinkStyle}>
          Samples →
        </Link>
        <Link to="/mapping" style={footerLinkStyle}>
          LED mapping →
        </Link>
      </div>
    </div>
  );
}
