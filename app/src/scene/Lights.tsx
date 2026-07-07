import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { PointLight } from "three";
import { useSimStore } from "../state";
import { computeSkyLighting } from "../lighting/skyCycle";
import { sampleBreathAt } from "../lighting/breath";
import { computeBreathAreaOrigin } from "../lighting/breathArea";

function rotateY(v: [number, number, number], radians: number): [number, number, number] {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

function offsetXZ(v: [number, number, number], x: number, z: number): [number, number, number] {
  return [v[0] + x, v[1], v[2] + z];
}

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function spreadToSpotAngle(spread: number): number {
  // 0 => tight focal hit, 1 => very broad.
  const s = clamp01(spread);
  return 0.08 + s * (Math.PI / 2 - 0.08);
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
  const ledViewMode = useSimStore((s) => s.ledViewMode);
  const MANUAL_BLEND_WHEN_SKY = 0.2;

  // Pure Breath mode: only the omni breath light illuminates the scene,
  // matching the stream pipeline which uses a single point light.
  if (ledViewMode === "breathIntensity") {
    return <BreathLight />;
  }

  const skyLighting = computeSkyLighting(sky);
  const skyAmount = clamp01(sky.visualizationAmount ?? 1);
  const manualBlend = sky.enabled
    ? 1 - (1 - MANUAL_BLEND_WHEN_SKY) * skyAmount
    : 1;

  const skyRadius = 8;
  const sunPos: [number, number, number] = [
    skyLighting.sunDirection[0] * skyRadius,
    skyLighting.sunDirection[1] * skyRadius,
    skyLighting.sunDirection[2] * skyRadius,
  ];
  const moonPos: [number, number, number] = [
    skyLighting.moonDirection[0] * skyRadius,
    skyLighting.moonDirection[1] * skyRadius,
    skyLighting.moonDirection[2] * skyRadius,
  ];
  const sunAngle = spreadToSpotAngle(sky.sunSpread ?? 0.9);
  const moonAngle = spreadToSpotAngle(sky.moonSpread ?? 0.9);

  return (
    <>
      <ambientLight
        color={ambient.color}
        intensity={ambient.intensity * manualBlend}
      />
      {sky.enabled && (
        <>
          <ambientLight
            color={skyLighting.ambientColor}
            intensity={skyLighting.ambientIntensity}
          />
          <spotLight
            color={skyLighting.sunColor}
            intensity={skyLighting.sunIntensity}
            position={sunPos}
            angle={sunAngle}
            penumbra={0.35}
            distance={0}
            decay={2}
          />
          <spotLight
            color={skyLighting.moonColor}
            intensity={skyLighting.moonIntensity}
            position={moonPos}
            angle={moonAngle}
            penumbra={0.35}
            distance={0}
            decay={2}
          />
          <mesh position={sunPos}>
            <sphereGeometry args={[0.09, 16, 12]} />
            <meshBasicMaterial color={skyLighting.sunColor} />
          </mesh>
          <mesh position={moonPos}>
            <sphereGeometry args={[0.07, 16, 12]} />
            <meshBasicMaterial color={skyLighting.moonColor} />
          </mesh>
        </>
      )}
      {ledViewMode === "breathPlusTimeOfDay" && <BreathLight />}
    </>
  );
}

/**
 * Real three.js omni point light for the breath stage. Position/decay
 * mirror the `point` light fed to `shadeLeds` in `Leds.tsx`, and the
 * intensity is updated every frame from the breath cycle so the 3D
 * ball-sensor view matches the streamed LED values.
 */
function BreathLight() {
  const ellipsoid = useSimStore((s) => s.ellipsoid);
  const breath = useSimStore((s) => s.breath);
  const cloud = useSimStore((s) => s.cloud);
  const lightRef = useRef<PointLight>(null);
  const yawRad = (cloud.rotationYDeg * Math.PI) / 180;

  const origin = offsetXZ(
    rotateY(
      computeBreathAreaOrigin(ellipsoid, {
        sourceAzimuthDeg: breath.area.sourceAzimuthDeg,
        sourceElevationDeg: breath.area.sourceElevationDeg,
        distanceFromCloud: breath.area.distanceFromCloud,
      }),
      yawRad,
    ),
    cloud.offsetX,
    cloud.offsetZ,
  );
  const radius = Math.max(0.05, breath.area.radius);
  const decay = Math.max(0.0001, breath.area.falloffExponent);
  const tintGain = Math.max(0, breath.area.tintAmount);

  useFrame(() => {
    const light = lightRef.current;
    if (!light) return;
    const strength = breath.enabled
      ? sampleBreathAt(breath, performance.now()).inhaleIntensity
      : 0;
    light.intensity = tintGain * strength;
  });

  return (
    <pointLight
      ref={lightRef}
      color={breath.area.tintColor}
      position={origin}
      distance={radius}
      decay={decay}
      intensity={0}
    />
  );
}
