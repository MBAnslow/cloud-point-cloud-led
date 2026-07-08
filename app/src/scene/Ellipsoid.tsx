import { useSimStore } from "../state";

export function Ellipsoid() {
  const { rx, ry, rz } = useSimStore((s) => s.ellipsoid);
  const cloud = useSimStore((s) => s.cloud);

  if (!cloud.showOpacity) return null;

  // Map the physical opacity [0, 1] to visual opacity. cloud.opacity = 1
  // is now fully opaque so the mesh reads at the same brightness as an
  // adjacent LED. Low values still hint at the shape via the 0.04 floor.
  const visOpacity = 0.04 + cloud.opacity * 0.96;
  const isOpaque = visOpacity >= 0.999;
  const tiltRad = (cloud.rotationXDeg * Math.PI) / 180;
  const yawRad = (cloud.rotationYDeg * Math.PI) / 180;

  return (
    <mesh
      position={[cloud.offsetX, 0, cloud.offsetZ]}
      scale={[rx, ry, rz]}
      rotation={[tiltRad, yawRad, 0]}
      castShadow={false}
      receiveShadow={false}
    >
      <sphereGeometry args={[1, 64, 48]} />
      <meshStandardMaterial
        color="#ffffff"
        transparent={!isOpaque}
        opacity={visOpacity}
        roughness={1.0}
        metalness={0.0}
        depthWrite={isOpaque}
      />
    </mesh>
  );
}
