import { useMemo } from "react";
import { DoubleSide } from "three";
import { useSimStore } from "../state";

/**
 * Visual guide for the soft-horizon gate used by sky lighting.
 *
 * - One plane: horizon cutoff altitude.
 *
 * Softness remains purely a lighting fade parameter (not a second geometric
 * blocker plane), so this guide only shows the primary horizon level.
 */
export function HorizonGuide() {
  const sky = useSimStore((s) => s.sky);
  const ellipsoid = useSimStore((s) => s.ellipsoid);

  if (!sky.enabled) return null;

  const { cutoffY, discRadius } = useMemo(() => {
    // Match the sky dome radius used in Lights.tsx.
    const skyRadius = 8;
    const cutoffDeg = sky.horizonCutoffDeg ?? -7;
    const cutoffY = Math.sin((cutoffDeg * Math.PI) / 180) * skyRadius;
    // Keep the guide comfortably beyond the cloud silhouette so the
    // horizon reference is easy to read from any angle.
    const cloudRadius = Math.max(ellipsoid.rx, ellipsoid.ry, ellipsoid.rz);
    const discRadius = Math.max(22, cloudRadius * 18);
    return { cutoffY, discRadius };
  }, [sky.horizonCutoffDeg, ellipsoid]);

  return (
    <group renderOrder={4}>
      <mesh position={[0, cutoffY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[discRadius, 96]} />
        <meshBasicMaterial
          color="#000000"
          transparent={false}
          opacity={1}
          side={DoubleSide}
          depthTest
          depthWrite
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

