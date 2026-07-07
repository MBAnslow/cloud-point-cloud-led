import { useState } from "react";
import { Canvas } from "@react-three/fiber";
import { MappingPanel } from "./MappingPanel";
import { MappingScene } from "./MappingScene";

export function MappingApp() {
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#05070d" }}>
      <Canvas
        camera={{ position: [3.5, 2.2, 3.5], fov: 45 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
      >
        <color attach="background" args={["#05070d"]} />
        <MappingScene selected={selected} setSelected={setSelected} />
      </Canvas>
      <MappingPanel selected={selected} setSelected={setSelected} />
    </div>
  );
}
