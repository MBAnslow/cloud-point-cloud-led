import { useSimStore } from "../state";
import { computeSkyLighting } from "../lighting/skyCycle";

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

  // Pure Breath mode is now a non-lighting visualization pass.
  if (ledViewMode === "breathIntensity") {
    return null;
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
    </>
  );
}
