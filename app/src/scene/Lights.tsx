import { useLayoutEffect, useMemo } from "react";
import { Object3D, Quaternion, Vector3 } from "three";
import { useSimStore } from "../state";
import { computeSkyLighting } from "../lighting/skyCycle";
import { spreadToSpotAngle } from "../lighting/shade";

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

/**
 * Ambient + directional light. Position and colour are driven by the leva
 * panel via the store. A small unlit sphere is rendered at the directional
 * light's position so you can see where it is.
 *
 * three.js's `<directionalLight>` ignores distance (parallel rays from
 * infinity), so we apply the same custom distance falloff that the LED
 * shading uses to keep the visual ellipsoid in sync with the LEDs as the
 * `distance` slider is dragged.
 */
export function Lights() {
  const ambient = useSimStore((s) => s.ambient);
  const sky = useSimStore((s) => s.sky);
  const cloud = useSimStore((s) => s.cloud);
  const mesh = useSimStore((s) => s.mesh);
  const ledViewMode = useSimStore((s) => s.ledViewMode);
  const MANUAL_BLEND_WHEN_SKY = 0.2;

  const skyLighting = computeSkyLighting(sky);
  const skyAmount = clamp01(sky.visualizationAmount ?? 1);
  const manualBlend = sky.enabled
    ? 1 - (1 - MANUAL_BLEND_WHEN_SKY) * skyAmount
    : 1;

  const orbitRadiusX = Math.max(0, sky.orbitRadiusX ?? sky.orbitRadius ?? 12);
  const orbitRadiusY = Math.max(0, sky.orbitRadiusY ?? sky.orbitRadius ?? 12);
  const orbitRadiusZ = Math.max(0, sky.orbitRadiusZ ?? sky.orbitRadius ?? 12);
  const cloudCenter = useMemo<[number, number, number]>(
    () => [cloud.offsetX, cloud.offsetY + mesh.offsetY, cloud.offsetZ],
    [cloud.offsetX, cloud.offsetY, cloud.offsetZ, mesh.offsetY],
  );
  const cloudTarget = useMemo(() => new Object3D(), []);
  useLayoutEffect(() => {
    cloudTarget.position.set(...cloudCenter);
    cloudTarget.updateMatrixWorld();
  }, [cloudCenter, cloudTarget]);
  const sunPos: [number, number, number] = [
    cloudCenter[0] + skyLighting.sunDirection[0] * orbitRadiusX,
    cloudCenter[1] + skyLighting.sunDirection[1] * orbitRadiusY,
    cloudCenter[2] + skyLighting.sunDirection[2] * orbitRadiusZ,
  ];
  const moonPos: [number, number, number] = [
    cloudCenter[0] + skyLighting.moonDirection[0] * orbitRadiusX,
    cloudCenter[1] + skyLighting.moonDirection[1] * orbitRadiusY,
    cloudCenter[2] + skyLighting.moonDirection[2] * orbitRadiusZ,
  ];
  const sunAngle = spreadToSpotAngle(sky.sunSpread ?? 0.9);
  const moonAngle = spreadToSpotAngle(sky.moonSpread ?? 0.9);
  const sunCone = useMemo(() => {
    const source = new Vector3(sunPos[0], sunPos[1], sunPos[2]);
    const target = new Vector3(cloudCenter[0], cloudCenter[1], cloudCenter[2]);
    const dir = target.clone().sub(source);
    const baseLen = Math.max(0.5, dir.length());
    const extendFactor = 2.2; // continue well past cloud centre
    const len = baseLen * extendFactor;
    dir.normalize();
    const visualAngle = Math.min(sunAngle, 1.2);
    const radius = Math.tan(visualAngle) * len;
    const center = source.clone().addScaledVector(dir, len * 0.5);
    const quat = new Quaternion().setFromUnitVectors(
      new Vector3(0, 1, 0),
      dir.clone().multiplyScalar(-1),
    );
    return {
      center: [center.x, center.y, center.z] as [number, number, number],
      quat: [quat.x, quat.y, quat.z, quat.w] as [number, number, number, number],
      len,
      radius,
    };
  }, [sunPos, sunAngle, cloudCenter]);
  const moonCone = useMemo(() => {
    const source = new Vector3(moonPos[0], moonPos[1], moonPos[2]);
    const target = new Vector3(cloudCenter[0], cloudCenter[1], cloudCenter[2]);
    const dir = target.clone().sub(source);
    const baseLen = Math.max(0.5, dir.length());
    const extendFactor = 2.2; // continue well past cloud centre
    const len = baseLen * extendFactor;
    dir.normalize();
    const visualAngle = Math.min(moonAngle, 1.2);
    const radius = Math.tan(visualAngle) * len;
    const center = source.clone().addScaledVector(dir, len * 0.5);
    const quat = new Quaternion().setFromUnitVectors(
      new Vector3(0, 1, 0),
      dir.clone().multiplyScalar(-1),
    );
    return {
      center: [center.x, center.y, center.z] as [number, number, number],
      quat: [quat.x, quat.y, quat.z, quat.w] as [number, number, number, number],
      len,
      radius,
    };
  }, [moonPos, moonAngle, cloudCenter]);

  // Pure Breath mode is a non-lighting visualization pass.
  if (ledViewMode === "breathIntensity") return null;

  return (
    <>
      <ambientLight
        color={ambient.color}
        intensity={ambient.intensity * manualBlend}
      />
      {sky.enabled && (
        <>
          <primitive object={cloudTarget} />
          <hemisphereLight
            color={skyLighting.skyColor}
            groundColor={skyLighting.groundColor}
            intensity={skyLighting.hemiIntensity}
          />
          <spotLight
            color={skyLighting.sunColor}
            intensity={skyLighting.sunIntensity}
            position={sunPos}
            angle={sunAngle}
            penumbra={clamp01(sky.sunBeamFocus ?? 0.65)}
            distance={0}
            decay={Math.max(0, sky.lightDecay ?? 1)}
            target={cloudTarget}
          />
          <spotLight
            color={skyLighting.moonColor}
            intensity={skyLighting.moonIntensity}
            position={moonPos}
            angle={moonAngle}
            penumbra={clamp01(sky.moonBeamFocus ?? 0.65)}
            distance={0}
            decay={Math.max(0, sky.lightDecay ?? 1)}
            target={cloudTarget}
          />
          <mesh position={sunPos}>
            <sphereGeometry args={[0.09, 16, 12]} />
            <meshBasicMaterial color={skyLighting.sunColor} />
          </mesh>
          <mesh position={moonPos}>
            <sphereGeometry args={[0.07, 16, 12]} />
            <meshBasicMaterial color={skyLighting.moonColor} />
          </mesh>
          {sky.showSpreadCones && (
            <>
              <mesh position={sunCone.center} quaternion={sunCone.quat}>
                <coneGeometry args={[sunCone.radius, sunCone.len, 36, 1, true]} />
                <meshBasicMaterial
                  color={skyLighting.sunColor}
                  transparent
                  opacity={0.09}
                  depthWrite={false}
                />
              </mesh>
              <mesh position={moonCone.center} quaternion={moonCone.quat}>
                <coneGeometry args={[moonCone.radius, moonCone.len, 36, 1, true]} />
                <meshBasicMaterial
                  color={skyLighting.moonColor}
                  transparent
                  opacity={0.09}
                  depthWrite={false}
                />
              </mesh>
            </>
          )}
        </>
      )}
    </>
  );
}
