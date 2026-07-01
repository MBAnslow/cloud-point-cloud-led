import { useSimStore } from "../state";

export function Ellipsoid() {
  const { rx, ry, rz } = useSimStore((s) => s.ellipsoid);
  const cloud = useSimStore((s) => s.cloud);

  if (!cloud.showOpacity) return null;

  // Map the physical opacity [0, 1] to a visual opacity that's never quite
  // fully transparent and never quite fully opaque — so a high-α cloud still
  // shows hints of the LEDs inside, and a low-α cloud still hints at its
  // shape. The mapping is a simple linear remap into [0.04, 0.85].
  const visOpacity = 0.04 + cloud.opacity * 0.81;

  return (
    <mesh scale={[rx, ry, rz]} castShadow={false} receiveShadow={false}>
      <sphereGeometry args={[1, 64, 48]} />
      <meshStandardMaterial
        color="#cfd6e6"
        transparent
        opacity={visOpacity}
        roughness={0.9}
        metalness={0.0}
        depthWrite={false}
      />
    </mesh>
  );
}
