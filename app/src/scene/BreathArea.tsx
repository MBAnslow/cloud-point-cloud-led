import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Matrix4, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { Line } from "@react-three/drei";
import {
  cloudCenterWorld,
  liveWaveExtents,
  participantWorldPos,
  sharedBreathWaveController,
  waveLocalFrame,
} from "../lighting/breathWaves";
import { tickBreathClock } from "../lighting/breath";
import { useSimStore } from "../state";

/**
 * Horizon participants + travelling exhale waves. Visible in Breath view.
 * Wave state is owned by `sharedBreathWaveController` (advanced from Leds).
 */
export function BreathArea() {
  const breath = useSimStore((s) => s.breath);
  const cloud = useSimStore((s) => s.cloud);
  const ledViewMode = useSimStore((s) => s.ledViewMode);
  const waveMeshesRef = useRef<(Mesh | null)[]>([]);
  const basisMat = useMemo(() => new Matrix4(), []);
  const rightV = useMemo(() => new Vector3(), []);
  const upV = useMemo(() => new Vector3(), []);
  const forwardV = useMemo(() => new Vector3(), []);

  const tiltRad = (cloud.rotationXDeg * Math.PI) / 180;
  const yawRad = (cloud.rotationYDeg * Math.PI) / 180;
  const transform = useMemo(
    () => ({
      tiltRad,
      yawRad,
      offsetX: cloud.offsetX,
      offsetY: cloud.offsetY,
      offsetZ: cloud.offsetZ,
    }),
    [tiltRad, yawRad, cloud.offsetX, cloud.offsetY, cloud.offsetZ],
  );

  const center = useMemo(
    () => {
      const c = cloudCenterWorld(transform);
      return new Vector3(c[0], c[1], c[2]);
    },
    [transform],
  );

  const participants = useMemo(() => {
    return breath.participants
      .filter((p) => p.enabled)
      .map((p) => {
        const pos = participantWorldPos(
          p,
          breath.cloudDistance,
          breath.horizonDistance,
          transform,
        );
        return {
          id: p.id,
          color: p.color,
          position: new Vector3(pos[0], pos[1], pos[2]),
        };
      });
  }, [breath.participants, breath.cloudDistance, breath.horizonDistance, transform]);

  useFrame(() => {
    const now = tickBreathClock(performance.now(), breath.paused);
    const waves = sharedBreathWaveController.getWaves();
    const { width, height, depth } = liveWaveExtents(breath);
    const sx = Math.max(0.001, width);
    const sy = Math.max(0.001, height);
    const sz = Math.max(0.001, depth);
    for (let i = 0; i < waveMeshesRef.current.length; i++) {
      const mesh = waveMeshesRef.current[i];
      if (!mesh) continue;
      const w = waves[i];
      if (!w) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      const c = sharedBreathWaveController.waveCenterAt(w, now);
      mesh.position.set(c[0], c[1], c[2]);
      const frame = waveLocalFrame(w.direction);
      rightV.set(frame.right[0], frame.right[1], frame.right[2]);
      upV.set(frame.up[0], frame.up[1], frame.up[2]);
      forwardV.set(frame.forward[0], frame.forward[1], frame.forward[2]);
      basisMat.makeBasis(rightV, upV, forwardV);
      mesh.quaternion.setFromRotationMatrix(basisMat);
      mesh.scale.set(sx, sy, sz);
      const strength = sharedBreathWaveController.waveStrength(w, now);
      const mat = mesh.material as MeshBasicMaterial;
      mat.color.set(w.color);
      mat.opacity = 0.06 + 0.28 * strength;
    }
  });

  if (!breath.enabled || ledViewMode !== "breathIntensity") return null;

  const waves = sharedBreathWaveController.getWaves();
  // Keep a stable pool of wave meshes so we don't thrash the scene graph.
  const waveSlots = Math.max(4, waves.length);

  return (
    <group>
      {participants.map((p) => (
        <group key={p.id}>
          <mesh position={p.position} renderOrder={22}>
            <sphereGeometry args={[0.07, 16, 12]} />
            <meshBasicMaterial
              color={p.color}
              transparent
              opacity={0.9}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          <Line
            points={[
              [p.position.x, p.position.y, p.position.z],
              [center.x, center.y, center.z],
            ]}
            color={p.color}
            lineWidth={1}
            transparent
            opacity={0.35}
            depthWrite={false}
            toneMapped={false}
            renderOrder={22}
          />
        </group>
      ))}
      {Array.from({ length: waveSlots }, (_, i) => (
        <mesh
          key={`wave-${i}`}
          ref={(el) => {
            waveMeshesRef.current[i] = el;
          }}
          renderOrder={21}
          visible={false}
        >
          <sphereGeometry args={[1, 24, 16]} />
          <meshBasicMaterial
            color="#8fd8ff"
            transparent
            opacity={0.14}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}
