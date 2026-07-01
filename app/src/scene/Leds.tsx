import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Object3D,
} from "three";
import { buildSpiral } from "../geometry/spiral";
import {
  hexToVec3,
  shadeLeds,
  type ShadeLight,
} from "../lighting/shade";
import { directionalDistanceFalloff, useSimStore } from "../state";
import { computeSkyLighting } from "../lighting/skyCycle";
import { WledStreamClient } from "../wled/client";
import { publishFrame } from "../stream/frameBuffer";

export function Leds() {
  const ellipsoid = useSimStore((s) => s.ellipsoid);
  const cloud = useSimStore((s) => s.cloud);
  const strand = useSimStore((s) => s.strand);
  const ambient = useSimStore((s) => s.ambient);
  const directional = useSimStore((s) => s.directional);
  const sky = useSimStore((s) => s.sky);
  const wled = useSimStore((s) => s.wled);
  const MANUAL_BLEND_WHEN_SKY = 0.2;

  const meshRef = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const tmpColor = useMemo(() => new Color(), []);

  // Per-LED buffers. Reallocated when the LED count changes.
  const buffers = useMemo(() => {
    const n = Math.max(2, Math.floor(strand.count));
    return {
      n,
      positions: new Float32Array(n * 3),
      normals: new Float32Array(n * 3),
      colorFloats: new Float32Array(n * 3),
      colorBytes: new Uint8Array(n * 3),
    };
  }, [strand.count]);

  // Recompute LED positions whenever the geometric parameters change.
  // Written in-place to avoid per-frame allocations.
  useEffect(() => {
    const samples = buildSpiral({
      rx: ellipsoid.rx,
      ry: ellipsoid.ry,
      rz: ellipsoid.rz,
      count: buffers.n,
      turns: strand.turns,
      start: strand.start,
    });
    for (let i = 0; i < buffers.n; i++) {
      const s = samples[i];
      const i3 = i * 3;
      buffers.positions[i3] = s.position[0];
      buffers.positions[i3 + 1] = s.position[1];
      buffers.positions[i3 + 2] = s.position[2];
      buffers.normals[i3] = s.normal[0];
      buffers.normals[i3 + 1] = s.normal[1];
      buffers.normals[i3 + 2] = s.normal[2];
    }

    const mesh = meshRef.current;
    if (mesh) {
      // Push each LED slightly outward along its surface normal so the bead
      // sits on top of the (slightly translucent) ellipsoid rather than
      // bisected by it. The offset is one bead radius — enough to keep the
      // whole sphere visible without floating away from the surface.
      const offset = strand.ledSize;
      for (let i = 0; i < buffers.n; i++) {
        const i3 = i * 3;
        dummy.position.set(
          buffers.positions[i3] + buffers.normals[i3] * offset,
          buffers.positions[i3 + 1] + buffers.normals[i3 + 1] * offset,
          buffers.positions[i3 + 2] + buffers.normals[i3 + 2] * offset,
        );
        dummy.scale.setScalar(strand.ledSize);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.count = buffers.n;
    }
  }, [
    ellipsoid.rx,
    ellipsoid.ry,
    ellipsoid.rz,
    strand.turns,
    strand.start,
    strand.ledSize,
    buffers,
    dummy,
  ]);

  // Long-lived WLED streaming client.
  const wledClient = useMemo(() => new WledStreamClient(), []);
  useEffect(() => {
    if (wled.enabled) wledClient.start();
    else wledClient.stop();
    return () => wledClient.stop();
  }, [wled.enabled, wledClient]);
  useEffect(() => {
    wledClient.setTarget(wled.host, 4048);
  }, [wled.host, wledClient]);

  // Ensure the instance color attribute exists before the first frame.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (!mesh.instanceColor || mesh.instanceColor.count !== buffers.n) {
      const init = new Float32Array(buffers.n * 3);
      const attr = new InstancedBufferAttribute(init, 3);
      attr.setUsage(DynamicDrawUsage);
      mesh.instanceColor = attr;
    }
  }, [buffers.n]);

  // Per-frame: shade and push colors to GPU + WLED.
  const lastSendRef = useRef(0);
  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    // Direction *from origin (ellipsoid center) to the light*. A real
    // directional light has no distance falloff (its rays are parallel
    // from infinity), but the panel exposes a `distance` slider so we
    // apply our own softened inverse-square attenuation — see
    // `directionalDistanceFalloff` for the formula and rationale.
    const [lx, ly, lz] = directional.position;
    const dlen = Math.hypot(lx, ly, lz) || 1;
    const distFalloff = directionalDistanceFalloff(dlen);
    const skyLighting = computeSkyLighting(sky);
    const manualBlend = sky.enabled ? MANUAL_BLEND_WHEN_SKY : 1;

    const lights: ShadeLight[] = [
      {
        type: "ambient",
        color: hexToVec3(ambient.color),
        intensity: ambient.intensity * manualBlend,
      },
      {
        type: "directional",
        direction: [lx / dlen, ly / dlen, lz / dlen],
        color: hexToVec3(directional.color),
        intensity: directional.intensity * distFalloff * manualBlend,
        spread: directional.spread,
      },
    ];
    if (sky.enabled) {
      lights.push(
        {
          type: "ambient",
          color: hexToVec3(skyLighting.ambientColor),
          intensity: skyLighting.ambientIntensity,
        },
        {
          type: "directional",
          direction: skyLighting.sunDirection,
          color: hexToVec3(skyLighting.sunColor),
          intensity: skyLighting.sunIntensity,
          spread: 0.88,
        },
        {
          type: "directional",
          direction: skyLighting.moonDirection,
          color: hexToVec3(skyLighting.moonColor),
          intensity: skyLighting.moonIntensity,
          spread: 0.94,
        },
      );
    }

    shadeLeds(
      buffers.positions,
      buffers.normals,
      buffers.n,
      lights,
      cloud.opacity,
      buffers.colorBytes,
      buffers.colorFloats,
    );

    for (let i = 0; i < buffers.n; i++) {
      const i3 = i * 3;
      tmpColor.setRGB(
        buffers.colorFloats[i3],
        buffers.colorFloats[i3 + 1],
        buffers.colorFloats[i3 + 2],
      );
      mesh.setColorAt(i, tmpColor);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    publishFrame(buffers.colorBytes, buffers.n);

    if (wled.enabled) {
      const now = performance.now();
      const minDelta = 1000 / Math.max(1, wled.fps);
      if (now - lastSendRef.current >= minDelta) {
        if (wledClient.send(buffers.colorBytes)) {
          lastSendRef.current = now;
        }
      }
    }
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, buffers.n]}
      frustumCulled={false}
    >
      <sphereGeometry args={[1, 12, 8]} />
      <meshBasicMaterial color="#ffffff" toneMapped={false} />
    </instancedMesh>
  );
}
