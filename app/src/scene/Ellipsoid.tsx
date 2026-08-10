import { useEffect, useMemo, useState } from "react";
import { BufferGeometry, DoubleSide } from "three";
import { useSimStore } from "../state";
import { loadMeshGeometry } from "../mapping/meshAsset";
import { applyMappingOrientationPoint } from "../mapping/geometry";
import {
  buildBakedDomeSurface,
  orientGaussians,
} from "../mapping/gaussians";
import {
  getBakedSurfaceGeometry,
  setBakedSurfaceGeometry,
} from "../mapping/bakedSurface";
import { mappingBakeSignature } from "../mapping/bakeSignature";

/**
 * Renders the cloud shell in the simulator. The shell is now always the
 * user-uploaded mesh — if no mesh is loaded, nothing is drawn.
 */
export function Ellipsoid() {
  const cloud = useSimStore((s) => s.cloud);
  const meshTarget = useSimStore((s) => s.mesh);
  const mapping = useSimStore((s) => s.mapping);
  const setMapping = useSimStore((s) => s.setMapping);

  const [meshGeom, setMeshGeom] = useState<BufferGeometry | null>(null);
  const [bakedGeom, setBakedGeom] = useState<BufferGeometry | null>(() =>
    getBakedSurfaceGeometry(),
  );
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

  const orientedGaussians = useMemo(
    () =>
      orientGaussians(
        mapping.gaussians,
        mapping.flipUpDown,
        mapping.flipLeftRight,
        applyMappingOrientationPoint,
      ),
    [mapping.gaussians, mapping.flipUpDown, mapping.flipLeftRight],
  );
  const bakeSignature = useMemo(
    () => mappingBakeSignature(mapping),
    [mapping],
  );
  useEffect(() => {
    if (!mapping.showBakedSurface || orientedGaussians.length === 0) {
      setBakedGeom(null);
      return;
    }
    const cached = getBakedSurfaceGeometry();
    if (cached && mapping.bakedSurfaceSignature === bakeSignature) {
      setBakedGeom(cached);
      return;
    }
    const render = buildBakedDomeSurface(
      orientedGaussians,
      mapping.bumpAdditivity,
      { radialSteps: 16, angularSteps: 48 },
    );
    const occluder = buildBakedDomeSurface(
      orientedGaussians,
      mapping.bumpAdditivity,
      { radialSteps: 8, angularSteps: 20 },
    );
    setBakedSurfaceGeometry(render, occluder);
    setBakedGeom(render);
    setMapping({ bakedSurfaceSignature: render ? bakeSignature : null });
  }, [
    mapping.showBakedSurface,
    mapping.bakedSurfaceSignature,
    mapping.bumpAdditivity,
    orientedGaussians,
    bakeSignature,
    setMapping,
  ]);

  const showPyramid = cloud.showOpacity && meshGeom;
  const showBakedDome = mapping.showBakedSurface && bakedGeom;
  if (!showPyramid && !showBakedDome) return null;

  const visOpacity = 0.04 + cloud.opacity * 0.96;
  const isOpaque = visOpacity >= 0.999;
  const tiltRad = (cloud.rotationXDeg * Math.PI) / 180;
  const yawRad = (cloud.rotationYDeg * Math.PI) / 180;

  return (
    <group
      position={[cloud.offsetX, cloud.offsetY, cloud.offsetZ]}
      rotation={[
        tiltRad,
        yawRad,
        0,
      ]}
    >
      <group
        position={[0, meshTarget.offsetY, 0]}
        scale={meshTarget.scale}
        rotation={[
          (meshTarget.tiltDeg * Math.PI) / 180,
          (meshTarget.yawDeg * Math.PI) / 180,
          0,
        ]}
      >
        {showPyramid && (
          <mesh
            geometry={meshGeom}
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
        )}
        {showBakedDome && (
          <mesh geometry={bakedGeom} raycast={() => null}>
            <meshStandardMaterial
              color="#7ec8ff"
              transparent
              opacity={Math.max(0.05, mapping.bumpSurfaceOpacity)}
              roughness={0.72}
              metalness={0}
              side={DoubleSide}
              depthWrite
            />
          </mesh>
        )}
      </group>
    </group>
  );
}
