import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { Leva } from "leva";
import { ControlPanel } from "./controls/Panel";
import { Histogram } from "./components/Histogram";
import { SkyTimeline } from "./components/SkyTimeline";
import { Ellipsoid } from "./scene/Ellipsoid";
import { Leds } from "./scene/Leds";
import { Lights } from "./scene/Lights";

export default function App() {
  return (
    <>
      <Leva collapsed={false} oneLineLabels />
      <ControlPanel />
      <SkyTimeline />
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
        <Leds />

        <OrbitControls makeDefault />
      </Canvas>
    </>
  );
}
