import { useEffect, useState } from "react";
import { BufferGeometry, DoubleSide } from "three";
import { useSimStore } from "../state";
import { loadMeshGeometry } from "../mapping/meshAsset";

/**
 * Renders the cloud shell in the simulator. The shell is now always the
 * user-uploaded mesh — if no mesh is loaded, nothing is drawn.
 */
export function Ellipsoid() {
  const cloud = useSimStore((s) => s.cloud);
  const meshTarget = useSimStore((s) => s.mesh);

  const [meshGeom, setMeshGeom] = useState<BufferGeometry | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!meshTarget.id) {
      setMeshGeom(null);
      return;
    }
    loadMeshGeometry(meshTarget.id).then((g) => {
      if (!cancelled) setMeshGeom(g);
    });
    return () => {
      cancelled = true;
    };
  }, [meshTarget.id]);

  if (!cloud.showOpacity || !meshGeom) return null;

  const visOpacity = 0.04 + cloud.opacity * 0.96;
  const isOpaque = visOpacity >= 0.999;
  const tiltRad = (cloud.rotationXDeg * Math.PI) / 180;
  const yawRad = (cloud.rotationYDeg * Math.PI) / 180;

  return (
    <mesh
      geometry={meshGeom}
      position={[
        cloud.offsetX,
        meshTarget.offsetY + cloud.offsetY,
        cloud.offsetZ,
      ]}
      scale={meshTarget.scale}
      rotation={[
        tiltRad + (meshTarget.tiltDeg * Math.PI) / 180,
        yawRad + (meshTarget.yawDeg * Math.PI) / 180,
        0,
      ]}
      castShadow={false}
      receiveShadow={false}
    >
      <meshStandardMaterial
        color="#ffffff"
        transparent={!isOpaque}
        opacity={visOpacity}
        roughness={1.0}
        metalness={0.0}
        depthWrite={isOpaque}
        side={DoubleSide}
      />
    </mesh>
  );
}
