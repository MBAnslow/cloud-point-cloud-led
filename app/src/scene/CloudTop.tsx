import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box3,
  BufferGeometry,
  Color,
  Data3DTexture,
  DoubleSide,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  RGBAFormat,
  UnsignedByteType,
  Vector3,
} from "three";
import { loadMeshGeometry } from "../mapping/meshAsset";
import { useSimStore } from "../state";
import { getFrame } from "../stream/frameBuffer";

const VOLUME_SIZE = 24;
const VOXEL_COUNT = VOLUME_SIZE ** 3;
const EMISSIVE_SCALE = 0.12;

type ShaderHandle = {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
};

/**
 * A visual-only transport medium. LED colors are splatted into a compact
 * local-space volume, then sampled as emissive light by the cloud-top mesh.
 */
export function CloudTop() {
  const cloudTop = useSimStore((s) => s.cloudTop);
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!cloudTop.id) {
      setGeometry(null);
      return;
    }
    loadMeshGeometry(cloudTop.id)
      .then((next) => {
        if (!cancelled) setGeometry(next);
      })
      .catch((err) => {
        console.warn("[cloud-top] mesh load failed", err);
        if (!cancelled) setGeometry(null);
      });
    return () => {
      cancelled = true;
    };
  }, [cloudTop.id]);

  if (!cloudTop.visible || !geometry) return null;
  return <CloudTopMesh geometry={geometry} />;
}

function CloudTopMesh({ geometry }: { geometry: BufferGeometry }) {
  const cloud = useSimStore((s) => s.cloud);
  const cloudTop = useSimStore((s) => s.cloudTop);
  const meshRef = useRef<Mesh>(null);
  const textureData = useMemo(() => new Uint8Array(VOXEL_COUNT * 4), []);
  const accumulation = useMemo(() => new Float32Array(VOXEL_COUNT * 3), []);
  const texture = useMemo(() => {
    const next = new Data3DTexture(
      textureData,
      VOLUME_SIZE,
      VOLUME_SIZE,
      VOLUME_SIZE,
    );
    next.format = RGBAFormat;
    next.type = UnsignedByteType;
    next.minFilter = LinearFilter;
    next.magFilter = LinearFilter;
    next.unpackAlignment = 1;
    next.needsUpdate = true;
    return next;
  }, [textureData]);

  const localBounds = useMemo(() => {
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    return (geometry.boundingBox ?? new Box3()).clone();
  }, [geometry]);
  const boundsMin = useMemo(() => new Vector3(), []);
  const boundsMax = useMemo(() => new Vector3(), []);
  const tintColor = useMemo(() => new Color(cloudTop.tint), []);
  const glowStrengthUniform = useMemo(
    () => ({ value: cloudTop.glowStrength * EMISSIVE_SCALE }),
    [],
  );
  const material = useMemo(() => {
    const next = new MeshStandardMaterial({
      // The covering receives no sun, moon, ambient, or scene lighting.
      // Its only visible contribution is the LED-driven emissive volume.
      color: "#000000",
      transparent: false,
      opacity: 1,
      roughness: 1,
      metalness: 0,
      depthWrite: true,
      side: DoubleSide,
    });
    // Match the LED emitter preview: preserve the authored output colors
    // instead of letting scene exposure crush a mostly-emissive surface.
    next.toneMapped = false;
    next.onBeforeCompile = (shader) => {
      const handle = shader as unknown as ShaderHandle;
      handle.uniforms.cloudTopVolume = { value: texture };
      handle.uniforms.cloudTopBoundsMin = { value: boundsMin };
      handle.uniforms.cloudTopBoundsMax = { value: boundsMax };
      handle.uniforms.cloudTopGlowStrength = glowStrengthUniform;
      handle.uniforms.cloudTopTint = { value: tintColor };
      handle.vertexShader = handle.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vCloudTopLocalPosition;",
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvCloudTopLocalPosition = position;",
        );
      handle.fragmentShader = handle.fragmentShader
        .replace(
          "#include <common>",
          [
            "#include <common>",
            "varying vec3 vCloudTopLocalPosition;",
            "uniform highp sampler3D cloudTopVolume;",
            "uniform vec3 cloudTopBoundsMin;",
            "uniform vec3 cloudTopBoundsMax;",
            "uniform float cloudTopGlowStrength;",
            "uniform vec3 cloudTopTint;",
          ].join("\n"),
        )
        .replace(
          "#include <emissivemap_fragment>",
          [
            "#include <emissivemap_fragment>",
            "vec3 cloudTopSize = max(cloudTopBoundsMax - cloudTopBoundsMin, vec3(0.0001));",
            "vec3 cloudTopUv = clamp((vCloudTopLocalPosition - cloudTopBoundsMin) / cloudTopSize, 0.0, 1.0);",
            "vec3 cloudTopLedLight = texture(cloudTopVolume, cloudTopUv).rgb;",
            "totalEmissiveRadiance += cloudTopLedLight * cloudTopTint * cloudTopGlowStrength;",
          ].join("\n"),
        );
    };
    next.customProgramCacheKey = () => "cloud-top-volume-v1";
    return next;
  }, [boundsMax, boundsMin, texture, tintColor, glowStrengthUniform]);

  useEffect(() => {
    tintColor.set(cloudTop.tint);
  }, [cloudTop.tint, tintColor]);
  useEffect(() => {
    glowStrengthUniform.value = cloudTop.glowStrength * EMISSIVE_SCALE;
  }, [cloudTop.glowStrength, glowStrengthUniform]);

  useEffect(
    () => () => {
      material.dispose();
      texture.dispose();
    },
    [material, texture],
  );

  const worldPosition = useMemo(() => new Vector3(), []);
  const localNormal = useMemo(() => new Vector3(), []);
  const inverseWorld = useMemo(() => new Matrix4(), []);
  const lastFrameVersion = useRef(-1);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const frame = getFrame();
    if (
      !frame.buffer ||
      !frame.positions ||
      !frame.normals ||
      frame.version === lastFrameVersion.current
    ) {
      return;
    }
    lastFrameVersion.current = frame.version;
    mesh.updateWorldMatrix(true, false);
    inverseWorld.copy(mesh.matrixWorld).invert();

    // The control describes the visible softness at the covering. Light must
    // first cross the air gap between the pyramid LEDs and that covering, so
    // use a wider transport radius than the final displayed falloff.
    const transportRadius = cloudTop.glowRadius * 2;
    const localRadius = transportRadius / Math.max(0.001, cloudTop.scale);
    boundsMin.copy(localBounds.min).addScalar(-localRadius);
    boundsMax.copy(localBounds.max).addScalar(localRadius);
    const sizeX = Math.max(0.0001, boundsMax.x - boundsMin.x);
    const sizeY = Math.max(0.0001, boundsMax.y - boundsMin.y);
    const sizeZ = Math.max(0.0001, boundsMax.z - boundsMin.z);
    const stepX = sizeX / (VOLUME_SIZE - 1);
    const stepY = sizeY / (VOLUME_SIZE - 1);
    const stepZ = sizeZ / (VOLUME_SIZE - 1);
    const radiusX = Math.max(1, Math.min(10, Math.ceil(localRadius / stepX)));
    const radiusY = Math.max(1, Math.min(10, Math.ceil(localRadius / stepY)));
    const radiusZ = Math.max(1, Math.min(10, Math.ceil(localRadius / stepZ)));
    accumulation.fill(0);

    const count = Math.min(frame.count, frame.positionCount);
    for (let led = 0; led < count; led++) {
      if (frame.positionValidity && !frame.positionValidity[led]) continue;
      const i3 = led * 3;
      worldPosition
        .set(
          frame.positions[i3],
          frame.positions[i3 + 1],
          frame.positions[i3 + 2],
        );
      mesh.worldToLocal(worldPosition);
      localNormal
        .set(
          frame.normals[i3],
          frame.normals[i3 + 1],
          frame.normals[i3 + 2],
        )
        .transformDirection(inverseWorld);
      const gx = ((worldPosition.x - boundsMin.x) / sizeX) * (VOLUME_SIZE - 1);
      const gy = ((worldPosition.y - boundsMin.y) / sizeY) * (VOLUME_SIZE - 1);
      const gz = ((worldPosition.z - boundsMin.z) / sizeZ) * (VOLUME_SIZE - 1);
      if (
        gx < -radiusX ||
        gy < -radiusY ||
        gz < -radiusZ ||
        gx > VOLUME_SIZE - 1 + radiusX ||
        gy > VOLUME_SIZE - 1 + radiusY ||
        gz > VOLUME_SIZE - 1 + radiusZ
      ) {
        continue;
      }

      const minX = Math.max(0, Math.floor(gx - radiusX));
      const maxX = Math.min(VOLUME_SIZE - 1, Math.ceil(gx + radiusX));
      const minY = Math.max(0, Math.floor(gy - radiusY));
      const maxY = Math.min(VOLUME_SIZE - 1, Math.ceil(gy + radiusY));
      const minZ = Math.max(0, Math.floor(gz - radiusZ));
      const maxZ = Math.min(VOLUME_SIZE - 1, Math.ceil(gz + radiusZ));
      for (let z = minZ; z <= maxZ; z++) {
        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            const dx = (x - gx) * stepX;
            const dy = (y - gy) * stepY;
            const dz = (z - gz) * stepZ;
            const distance = Math.hypot(dx, dy, dz);
            if (distance > localRadius) continue;
            const facing =
              distance < 1e-6
                ? 1
                : Math.max(
                    0,
                    (dx * localNormal.x +
                      dy * localNormal.y +
                      dz * localNormal.z) /
                      distance,
                  );
            if (facing <= 0) continue;
            const beam = Math.pow(facing, cloudTop.glowFocus);
            const weight =
              Math.exp((-2.5 * distance) / Math.max(0.0001, localRadius)) *
              beam;
            const voxel = x + y * VOLUME_SIZE + z * VOLUME_SIZE * VOLUME_SIZE;
            const v3 = voxel * 3;
            // A diffuser should spread each source, not add hundreds of
            // overlapping sources until the entire covering clips white.
            accumulation[v3] = Math.max(
              accumulation[v3],
              frame.buffer[i3] * weight,
            );
            accumulation[v3 + 1] = Math.max(
              accumulation[v3 + 1],
              frame.buffer[i3 + 1] * weight,
            );
            accumulation[v3 + 2] = Math.max(
              accumulation[v3 + 2],
              frame.buffer[i3 + 2] * weight,
            );
          }
        }
      }
    }

    for (let voxel = 0; voxel < VOXEL_COUNT; voxel++) {
      const v3 = voxel * 3;
      const v4 = voxel * 4;
      textureData[v4] = Math.min(255, accumulation[v3]);
      textureData[v4 + 1] = Math.min(255, accumulation[v3 + 1]);
      textureData[v4 + 2] = Math.min(255, accumulation[v3 + 2]);
      textureData[v4 + 3] = 255;
    }
    texture.needsUpdate = true;
  });

  const deg = Math.PI / 180;
  return (
    <group
      position={[cloud.offsetX, cloud.offsetY, cloud.offsetZ]}
      rotation={[cloud.rotationXDeg * deg, cloud.rotationYDeg * deg, 0]}
    >
      <mesh
        ref={meshRef}
        geometry={geometry}
        material={material}
        position={[cloudTop.offsetX, cloudTop.offsetY, cloudTop.offsetZ]}
        rotation={[cloudTop.tiltDeg * deg, cloudTop.yawDeg * deg, 0]}
        scale={cloudTop.scale}
        castShadow={false}
        receiveShadow={false}
      />
    </group>
  );
}
