import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { Leva } from "leva";
import { ControlPanel } from "./controls/Panel";
import { Histogram } from "./components/Histogram";
import { BreathOscillator } from "./components/BreathOscillator";
import { LedViewModePanel } from "./components/LedViewModePanel";
import { SkyTimeline } from "./components/SkyTimeline";
import { Ellipsoid } from "./scene/Ellipsoid";
import { BreathWind } from "./scene/BreathWind";
import { Leds } from "./scene/Leds";
import { Lights } from "./scene/Lights";

export default function App() {
  return (
    <>
      <Leva collapsed={false} oneLineLabels />
      <ControlPanel />
      <SkyTimeline />
      <LedViewModePanel />
      <BreathOscillator />
      <Histogram />
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
        <Ellipsoid />
        <BreathWind />
        <Leds />

        <OrbitControls makeDefault />
      </Canvas>
    </>
  );
}
