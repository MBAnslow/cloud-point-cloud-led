import { useMemo } from "react";
import { Vector3 } from "three";
import { Line } from "@react-three/drei";
import { computeBreathAreaOrigin } from "../lighting/breathArea";
import { useSimStore } from "../state";

function rotateY(v: [number, number, number], radians: number): [number, number, number] {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

function offsetXZ(v: [number, number, number], x: number, z: number): [number, number, number] {
  return [v[0] + x, v[1], v[2] + z];
}

/**
 * Minimal visualization of the breath omni light: a small marker sphere at
 * the light's center and a thin line back to the cloud surface. The actual
 * shading is provided by a real three.js `<pointLight>` in `Lights.tsx`,
 * so we don't try to render any special-radius volume here.
 */
export function BreathArea() {
  const ellipsoid = useSimStore((s) => s.ellipsoid);
  const breath = useSimStore((s) => s.breath);
  const cloud = useSimStore((s) => s.cloud);
  const yawRad = (cloud.rotationYDeg * Math.PI) / 180;

  const { center, surfacePoint } = useMemo(() => {
    const centerLocal = computeBreathAreaOrigin(ellipsoid, {
      sourceAzimuthDeg: breath.area.sourceAzimuthDeg,
      sourceElevationDeg: breath.area.sourceElevationDeg,
      distanceFromCloud: breath.area.distanceFromCloud,
    });
    const centerLen = Math.hypot(centerLocal[0], centerLocal[1], centerLocal[2]) || 1;
    const dx = centerLocal[0] / centerLen;
    const dy = centerLocal[1] / centerLen;
    const dz = centerLocal[2] / centerLen;
    const denom =
      (dx * dx) / Math.max(1e-6, ellipsoid.rx * ellipsoid.rx) +
      (dy * dy) / Math.max(1e-6, ellipsoid.ry * ellipsoid.ry) +
      (dz * dz) / Math.max(1e-6, ellipsoid.rz * ellipsoid.rz);
    const surfaceScale = denom > 1e-12 ? 1 / Math.sqrt(denom) : 0;
    const centerPos = offsetXZ(rotateY(centerLocal, yawRad), cloud.offsetX, cloud.offsetZ);
    const surfacePos = rotateY(
      [dx * surfaceScale, dy * surfaceScale, dz * surfaceScale],
      yawRad,
    );
    const worldSurfacePos = offsetXZ(surfacePos, cloud.offsetX, cloud.offsetZ);
    return {
      center: new Vector3(centerPos[0], centerPos[1], centerPos[2]),
      surfacePoint: new Vector3(
        worldSurfacePos[0],
        worldSurfacePos[1],
        worldSurfacePos[2],
      ),
    };
  }, [
    ellipsoid,
    yawRad,
    cloud.offsetX,
    cloud.offsetZ,
    breath.area.sourceAzimuthDeg,
    breath.area.sourceElevationDeg,
    breath.area.distanceFromCloud,
  ]);

  const linePoints = useMemo(
    () =>
      [
        [surfacePoint.x, surfacePoint.y, surfacePoint.z],
        [center.x, center.y, center.z],
      ] as [number, number, number][],
    [surfacePoint, center],
  );

  if (!breath.enabled) return null;

  return (
    <group>
      <mesh position={center} renderOrder={22}>
        <sphereGeometry args={[0.05, 16, 12]} />
        <meshBasicMaterial
          color={breath.area.tintColor}
          transparent
          opacity={0.75}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <Line
        points={linePoints}
        color={breath.area.tintColor}
        lineWidth={1}
        transparent
        opacity={0.35}
        depthWrite={false}
        toneMapped={false}
        renderOrder={22}
      />
    </group>
  );
}
