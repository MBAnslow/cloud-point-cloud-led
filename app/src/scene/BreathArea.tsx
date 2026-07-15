import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Mesh, MeshBasicMaterial, Vector3 } from "three";
import { Line } from "@react-three/drei";
import { computeBreathAreaOrigin } from "../lighting/breathArea";
import { sampleBreathAt } from "../lighting/breath";
import { useSimStore } from "../state";

function rotateY(v: [number, number, number], radians: number): [number, number, number] {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

function rotateX(v: [number, number, number], radians: number): [number, number, number] {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}

function rotateCloud(
  v: [number, number, number],
  tiltRad: number,
  yawRad: number,
): [number, number, number] {
  // Match three.js default Euler order "XYZ" used by the Ellipsoid mesh
  // (composed matrix Rx * Ry * Rz → yaw applied first, then tilt).
  return rotateX(rotateY(v, yawRad), tiltRad);
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
  const ledViewMode = useSimStore((s) => s.ledViewMode);
  const markerRef = useRef<Mesh>(null);
  const areaRef = useRef<Mesh>(null);
  const tiltRad = (cloud.rotationXDeg * Math.PI) / 180;
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
    const centerPos = offsetXZ(
      rotateCloud(centerLocal, tiltRad, yawRad),
      cloud.offsetX,
      cloud.offsetZ,
    );
    const surfacePos = rotateCloud(
      [dx * surfaceScale, dy * surfaceScale, dz * surfaceScale],
      tiltRad,
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
    tiltRad,
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

  useFrame(() => {
    const marker = markerRef.current;
    const area = areaRef.current;
    if (!marker || !area) return;
    const inhale = breath.enabled
      ? sampleBreathAt(breath, performance.now()).inhaleIntensity
      : 0;
    const visualGain = Math.max(0, breath.area.tintAmount);
    const strength = Math.min(1, inhale * visualGain);
    const markerScale = 0.8 + 0.5 * strength;
    marker.scale.setScalar(markerScale);
    const markerMat = marker.material as MeshBasicMaterial;
    markerMat.opacity = 0.25 + 0.7 * strength;
    area.scale.setScalar(Math.max(0.001, breath.area.radius));
    const areaMat = area.material as MeshBasicMaterial;
    areaMat.opacity = 0.06 + 0.24 * strength;
  });

  if (!breath.enabled || ledViewMode !== "breathIntensity") return null;

  return (
    <group>
      <mesh ref={areaRef} position={center} renderOrder={21}>
        <sphereGeometry args={[1, 24, 16]} />
        <meshBasicMaterial
          color={breath.area.tintColor}
          transparent
          opacity={0.14}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={markerRef} position={center} renderOrder={22}>
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
