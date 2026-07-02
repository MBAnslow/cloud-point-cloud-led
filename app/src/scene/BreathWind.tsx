import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from "three";
import { sampleBreathAt } from "../lighting/breath";
import { computeBreathWindOrigin } from "../lighting/breathWind";
import { useSimStore } from "../state";

const PUFF_COUNT = 4;
const FLOAT_SPEED = 0.42;
const UP = new Vector3(0, 1, 0);
const ORIGIN = new Vector3(0, 0, 0);

export function BreathWind() {
  const ellipsoid = useSimStore((s) => s.ellipsoid);
  const breath = useSimStore((s) => s.breath);
  const groupRef = useRef<Group>(null);
  const puffRefs = useRef<Array<Mesh | null>>([]);
  const sourceRef = useRef<Mesh>(null);
  const tmpSource = useMemo(() => new Vector3(), []);
  const tmpDir = useMemo(() => new Vector3(), []);
  const tmpQuat = useMemo(() => new Quaternion(), []);
  const baseColor = breath.breathers[0]?.color ?? "#9fd9ff";

  const sourcePos = useMemo(
    () =>
      computeBreathWindOrigin(ellipsoid, {
        sourceAzimuthDeg: breath.wind.sourceAzimuthDeg,
        sourceElevationDeg: breath.wind.sourceElevationDeg,
        distanceFromCloud: breath.wind.distanceFromCloud,
      }),
    [
      ellipsoid,
      breath.wind.sourceAzimuthDeg,
      breath.wind.sourceElevationDeg,
      breath.wind.distanceFromCloud,
    ],
  );

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    groupRef.current.visible = breath.enabled && breath.wind.enabled;
    if (!breath.enabled || !breath.wind.enabled) return;

    const nowMs = clock.elapsedTime * 1000;
    const cycleMs =
      Math.max(
        0.01,
        breath.inhaleSeconds +
          breath.holdPeakSeconds +
          breath.exhaleSeconds +
          breath.holdTroughSeconds,
      ) * 1000;
    const sample = sampleBreathAt(breath, nowMs);
    const exhale = sample.exhaleIntensity * breath.wind.maxIntensity;
    const inhale = sample.inhaleIntensity * breath.wind.inhaleMaxIntensity;
    const activity = Math.max(exhale, inhale);

    // Always orient the plume from source toward the cloud origin.
    tmpSource.set(sourcePos[0], sourcePos[1], sourcePos[2]);
    tmpDir.copy(ORIGIN).sub(tmpSource);
    if (tmpDir.lengthSq() < 1e-9) tmpDir.set(0, 1, 0);
    else tmpDir.normalize();
    tmpQuat.setFromUnitVectors(UP, tmpDir);

    groupRef.current.position.copy(tmpSource);
    groupRef.current.quaternion.copy(tmpQuat);

    for (let i = 0; i < PUFF_COUNT; i++) {
      const mesh = puffRefs.current[i];
      if (!mesh) continue;
      const mat = mesh.material as MeshBasicMaterial;

      const phase = (((nowMs / 1000) * FLOAT_SPEED + i / PUFF_COUNT) % 1 + 1) % 1;
      const exhaleRise = phase * breath.wind.plumeHeight;
      const inhaleRise = (1 - phase) * breath.wind.plumeHeight;
      const rise = exhale > 1e-4 ? exhaleRise : inhaleRise;
      const outRadius = breath.wind.radius * (0.2 + 0.95 * phase);
      const inRadius = breath.wind.radius * (0.25 + 0.85 * (1 - phase));
      const radius = exhale > 1e-4 ? outRadius : inRadius;
      const outAlpha = exhale * (1 - phase) * 0.42;
      const inAlpha = inhale * phase * 0.36;
      const puffAlpha = exhale > 1e-4 ? outAlpha : inAlpha;

      mesh.position.set(0, rise, 0);
      mesh.scale.set(radius, radius, 1);
      mat.opacity = puffAlpha;
      mat.color.set(exhale > 1e-4 ? baseColor : "#b7ecff");
    }

    if (sourceRef.current) {
      const mat = sourceRef.current.material as MeshBasicMaterial;
      const r = 0.045 + activity * 0.06;
      sourceRef.current.position.set(0, 0, 0);
      sourceRef.current.scale.set(r, r, r);
      mat.opacity = 0.28 + activity * 0.5;
      mat.color.set(exhale > 1e-4 ? baseColor : "#d0f5ff");
    }

    // Visualize influence reach as a soft ring at the source plane.
    const influenceRing = puffRefs.current[PUFF_COUNT - 1];
    if (influenceRing) {
      const mat = influenceRing.material as MeshBasicMaterial;
      influenceRing.position.set(0, 0, 0);
      influenceRing.scale.set(breath.wind.radius, breath.wind.radius, 1);
      mat.opacity = 0.06 + activity * 0.08;
    }
  });

  return (
    <group ref={groupRef}>
      {Array.from({ length: PUFF_COUNT }).map((_, i) => (
        <mesh
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          ref={(el) => {
            puffRefs.current[i] = el;
          }}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={30 + i}
        >
          <circleGeometry args={[1, 48]} />
          <meshBasicMaterial
            color={baseColor}
            transparent
            opacity={0}
            depthWrite={false}
            blending={AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      ))}
      <mesh ref={sourceRef} renderOrder={42}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshBasicMaterial
          color={baseColor}
          transparent
          opacity={0.3}
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

