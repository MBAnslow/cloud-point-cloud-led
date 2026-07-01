import { directionalDistanceFalloff, useSimStore } from "../state";
import { computeSkyLighting } from "../lighting/skyCycle";

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
  const directional = useSimStore((s) => s.directional);
  const sky = useSimStore((s) => s.sky);
  const MANUAL_BLEND_WHEN_SKY = 0.2;

  const [lx, ly, lz] = directional.position;
  const distFalloff = directionalDistanceFalloff(Math.hypot(lx, ly, lz));
  const skyLighting = computeSkyLighting(sky);
  const manualBlend = sky.enabled ? MANUAL_BLEND_WHEN_SKY : 1;
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

  return (
    <>
      <ambientLight color={ambient.color} intensity={ambient.intensity * manualBlend} />
      {sky.enabled && (
        <>
          <ambientLight
            color={skyLighting.ambientColor}
            intensity={skyLighting.ambientIntensity}
          />
          <directionalLight
            color={skyLighting.sunColor}
            intensity={skyLighting.sunIntensity}
            position={sunPos}
          />
          <directionalLight
            color={skyLighting.moonColor}
            intensity={skyLighting.moonIntensity}
            position={moonPos}
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
      <directionalLight
        color={directional.color}
        intensity={directional.intensity * distFalloff * manualBlend}
        position={directional.position}
      />
      <mesh position={directional.position}>
        <sphereGeometry args={[0.06, 16, 12]} />
        <meshBasicMaterial color={directional.color} />
      </mesh>
    </>
  );
}
