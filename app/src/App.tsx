import { useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { Link } from "react-router-dom";
import { Leva } from "leva";
import { ControlPanel } from "./controls/Panel";
import { Histogram } from "./components/Histogram";
import { StreamMatrix } from "./components/StreamMatrix";
import { BreathOscillator } from "./components/BreathOscillator";
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

export default function App() {
  const [showMaster, setShowMaster] = useState(true);
  const [showBreath, setShowBreath] = useState(true);
  const [showLightning, setShowLightning] = useState(false);
  const [showStream, setShowStream] = useState(false);
  return (
    <>
      <Leva collapsed={false} oneLineLabels />
      <Footer
        showMaster={showMaster}
        showBreath={showBreath}
        showLightning={showLightning}
        showStream={showStream}
        onToggleMaster={() => setShowMaster((v) => !v)}
        onToggleBreath={() => setShowBreath((v) => !v)}
        onToggleLightning={() => setShowLightning((v) => !v)}
        onToggleStream={() => setShowStream((v) => !v)}
      />
      <ControlPanel />
      <DayCyclePanel />
      <SkyTimeline />
      <LedViewModePanel />
      <MasterFrequencyPanel visible={showMaster} />
      <BreathOscillator visible={showBreath} />
      <LightningPanel visible={showLightning} />
      <Histogram />
      <StreamMatrix visible={showStream} />
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
  showStream,
  onToggleMaster,
  onToggleBreath,
  onToggleLightning,
  onToggleStream,
}: {
  showMaster: boolean;
  showBreath: boolean;
  showLightning: boolean;
  showStream: boolean;
  onToggleMaster: () => void;
  onToggleBreath: () => void;
  onToggleLightning: () => void;
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
      <div style={{ display: "flex", gap: 8 }}>
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
