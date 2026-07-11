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
import { SkyTimeline } from "./components/SkyTimeline";
import { Ellipsoid } from "./scene/Ellipsoid";
import { BreathArea } from "./scene/BreathArea";
import { HorizonGuide } from "./scene/HorizonGuide";
import { Leds } from "./scene/Leds";
import { LightningBolts } from "./scene/LightningBolts";
import { Lights } from "./scene/Lights";

const navLinkStyle: React.CSSProperties = {
  color: "rgba(207,214,230,0.95)",
  textDecoration: "none",
  background: "rgba(10, 12, 20, 0.82)",
  backdropFilter: "blur(8px)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 8,
  padding: "6px 12px",
  fontFamily:
    "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  fontSize: 12,
};

export default function App() {
  return (
    <>
      <Leva collapsed={false} oneLineLabels />
      <div
        style={{
          position: "fixed",
          bottom: 12,
          right: 12,
          zIndex: 20,
          display: "flex",
          gap: 8,
        }}
      >
        <Link to="/drones" style={navLinkStyle}>
          Drones →
        </Link>
        <Link to="/pads" style={navLinkStyle}>
          Pads →
        </Link>
        <Link to="/samples" style={navLinkStyle}>
          Samples →
        </Link>
        <Link to="/mapping" style={navLinkStyle}>
          LED mapping →
        </Link>
      </div>
      <ControlPanel />
      <DayCyclePanel />
      <SkyTimeline />
      <LedViewModePanel />
      <BreathOscillator />
      <Histogram />
      <StreamMatrix />
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
