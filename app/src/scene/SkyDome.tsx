import { useMemo } from "react";
import { BackSide, Color, Vector3 } from "three";
import { useSimStore } from "../state";
import { computeSkyLighting } from "../lighting/skyCycle";

const vertexShader = `
  varying vec3 vSkyDirection;

  void main() {
    vSkyDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform vec3 skyColor;
  uniform vec3 groundColor;
  uniform vec3 sunColor;
  uniform vec3 moonColor;
  uniform vec3 sunDirection;
  uniform vec3 moonDirection;
  uniform float sunIntensity;
  uniform float moonIntensity;

  varying vec3 vSkyDirection;

  void main() {
    vec3 direction = normalize(vSkyDirection);
    float vertical = smoothstep(-0.35, 0.75, direction.y);
    vec3 color = mix(groundColor, skyColor, vertical);

    float sunDot = max(0.0, dot(direction, normalize(sunDirection)));
    float moonDot = max(0.0, dot(direction, normalize(moonDirection)));
    float sunHalo = pow(sunDot, 18.0) * 0.65 + pow(sunDot, 320.0) * 2.2;
    float moonHalo = pow(moonDot, 28.0) * 0.45 + pow(moonDot, 420.0) * 1.5;

    color += sunColor * sunHalo * sunIntensity;
    color += moonColor * moonHalo * moonIntensity;
    gl_FragColor = vec4(color, 1.0);
  }
`;

/** Inward-facing dome that makes the live sky gradient spatially visible. */
export function SkyDome() {
  const sky = useSimStore((s) => s.sky);
  const lighting = computeSkyLighting(sky);
  const uniforms = useMemo(
    () => ({
      skyColor: { value: new Color() },
      groundColor: { value: new Color() },
      sunColor: { value: new Color() },
      moonColor: { value: new Color() },
      sunDirection: { value: new Vector3() },
      moonDirection: { value: new Vector3() },
      sunIntensity: { value: 0 },
      moonIntensity: { value: 0 },
    }),
    [],
  );

  // Shader uniforms are bound by object identity at material creation.
  // Mutate their values in place so the dome follows the live sky clock.
  uniforms.skyColor.value.set(lighting.skyColor);
  uniforms.groundColor.value.set(lighting.groundColor);
  uniforms.sunColor.value.set(lighting.sunColor);
  uniforms.moonColor.value.set(lighting.moonColor);
  uniforms.sunDirection.value.set(
    lighting.sunDirection[0],
    lighting.sunDirection[1],
    lighting.sunDirection[2],
  );
  uniforms.moonDirection.value.set(
    lighting.moonDirection[0],
    lighting.moonDirection[1],
    lighting.moonDirection[2],
  );
  uniforms.sunIntensity.value = lighting.sunIntensity;
  uniforms.moonIntensity.value = lighting.moonIntensity;

  if (!sky.enabled) return null;

  return (
    <mesh renderOrder={-1000}>
      <sphereGeometry args={[30, 64, 32]} />
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        side={BackSide}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}
