import { useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import {
  AdditiveBlending,
  Color,
  FrontSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Object3D,
  Vector3,
} from "three";
import {
  applyMappingOrientation,
  surfaceNormal,
  surfacePoint,
} from "../mapping/geometry";
import { sampleBreathAt } from "../lighting/breath";
import {
  computeBreathAreaOrigin,
} from "../lighting/breathArea";
import {
  hexToVec3,
  shadeLeds,
  type ShadeLight,
} from "../lighting/shade";
import { hourInRange, useSimStore } from "../state";
import { computeSkyLighting } from "../lighting/skyCycle";
import { sharedLightningController } from "../lighting/lightning";
import { WledStreamClient } from "../wled/client";
import { publishFrame } from "../stream/frameBuffer";

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}
const STREAM_BYTE_DEADBAND = 1;

function ensureOutwardNormal(position: [number, number, number], normal: [number, number, number]): [number, number, number] {
  // If a normal ever comes in flipped (inward), invert it so lighting stays
  // physically intuitive: lights above brighten the upper hemisphere.
  const d = position[0] * normal[0] + position[1] * normal[1] + position[2] * normal[2];
  return d >= 0 ? normal : [-normal[0], -normal[1], -normal[2]];
}

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
  return rotateY(rotateX(v, tiltRad), yawRad);
}

function offsetXZ(v: [number, number, number], x: number, z: number): [number, number, number] {
  return [v[0] + x, v[1], v[2] + z];
}

export function Leds() {
  const ellipsoid = useSimStore((s) => s.ellipsoid);
  const cloud = useSimStore((s) => s.cloud);
  const strand = useSimStore((s) => s.strand);
  const mapping = useSimStore((s) => s.mapping);
  const ambient = useSimStore((s) => s.ambient);
  const sky = useSimStore((s) => s.sky);
  const breath = useSimStore((s) => s.breath);
  const lightning = useSimStore((s) => s.lightning);
  const ledViewMode = useSimStore((s) => s.ledViewMode);
  const ledDisplayMode = useSimStore((s) => s.ledDisplayMode);
  const breathTimeCombineMode = useSimStore((s) => s.breathTimeCombineMode);
  const ledStreamPipeline = useSimStore((s) => s.ledStreamPipeline);
  const ledLocator = useSimStore((s) => s.ledLocator);
  const toggleLocatedLed = useSimStore((s) => s.toggleLocatedLed);
  const wled = useSimStore((s) => s.wled);
  const cloudTiltRad = (cloud.rotationXDeg * Math.PI) / 180;
  const cloudYawRad = (cloud.rotationYDeg * Math.PI) / 180;
  const MANUAL_BLEND_WHEN_SKY = 0.2;

  const meshRef = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const tmpColor = useMemo(() => new Color(), []);
  const stableBytesRef = useRef<Uint8Array | null>(null);
  const locatedSet = useMemo(
    () => new Set(ledLocator.highlighted),
    [ledLocator.highlighted],
  );

  // LED positions come exclusively from the mapping app.
  const ledCount = mapping.leds.length;

  // Per-LED buffers. Reallocated when the LED count changes.
  const buffers = useMemo(() => {
    const n = ledCount;
    return {
      n,
      positions: new Float32Array(n * 3),
      normals: new Float32Array(n * 3),
      colorFloats: new Float32Array(n * 3),
      timeColorFloats: new Float32Array(n * 3),
      breathColorFloats: new Float32Array(n * 3),
      lightningColorFloats: new Float32Array(n * 3),
      colorBytes: new Uint8Array(n * 3),
    };
  }, [ledCount]);

  // Recompute LED positions whenever the geometric parameters change.
  // Written in-place to avoid per-frame allocations.
  useEffect(() => {
    for (let i = 0; i < buffers.n; i++) {
      // `i` is the logical strand index; map it to the placement index so
      // the reverse toggle flips which physical end is LED #0.
      const physical = mapping.reversed ? buffers.n - 1 - i : i;
      const dir = applyMappingOrientation(
        mapping.leds[physical].dir,
        mapping.flipUpDown,
        mapping.flipLeftRight,
      );
      const pos = surfacePoint(dir, ellipsoid);
      const nrm = ensureOutwardNormal(pos, surfaceNormal(dir, ellipsoid));
      const rPos = offsetXZ(
        rotateCloud(pos, cloudTiltRad, cloudYawRad),
        cloud.offsetX,
        cloud.offsetZ,
      );
      const rNrm = rotateCloud(nrm, cloudTiltRad, cloudYawRad);
      const i3 = i * 3;
      buffers.positions[i3] = rPos[0];
      buffers.positions[i3 + 1] = rPos[1];
      buffers.positions[i3 + 2] = rPos[2];
      buffers.normals[i3] = rNrm[0];
      buffers.normals[i3 + 1] = rNrm[1];
      buffers.normals[i3 + 2] = rNrm[2];
    }

    const mesh = meshRef.current;
    if (mesh) {
      // In "sensors" mode the bead is a full sphere pushed one bead
      // radius above the surface so it sits on top. In "leds" mode the
      // primitive is a hemisphere whose flat side is at the surface, so
      // we set no additional normal offset and just rotate the primitive
      // to align its pole with the LED's outward normal.
      const isLeds = ledDisplayMode === "leds";
      // Keep both cap types off the exact cloud surface to avoid depth
      // fighting shimmer. Streamed LED emitters sit a bit further out so
      // additive blending reads as emission rather than shell acne.
      const sensorOffset = Math.max(0.0015, strand.ledSize * 0.06);
      const ledOffset = Math.max(0.003, strand.ledSize * 0.18);
      const offset = isLeds ? ledOffset : sensorOffset;
      const yAxis = new Vector3(0, 1, 0);
      const normalVec = new Vector3();
      for (let i = 0; i < buffers.n; i++) {
        const i3 = i * 3;
        const nx = buffers.normals[i3];
        const ny = buffers.normals[i3 + 1];
        const nz = buffers.normals[i3 + 2];
        dummy.position.set(
          buffers.positions[i3] + nx * offset,
          buffers.positions[i3 + 1] + ny * offset,
          buffers.positions[i3 + 2] + nz * offset,
        );
        {
          normalVec.set(nx, ny, nz);
          dummy.quaternion.setFromUnitVectors(yAxis, normalVec);
        }
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
    strand.ledSize,
    mapping.leds,
    mapping.flipUpDown,
    mapping.flipLeftRight,
    mapping.reversed,
    cloudTiltRad,
    cloudYawRad,
    cloud.offsetX,
    cloud.offsetZ,
    ledDisplayMode,
    buffers,
    dummy,
  ]);

  // Long-lived WLED streaming client. Lightning uses a shared controller
  // so the 3D bolt visualisation sees the same active strikes.
  const lightningCtrl = sharedLightningController;
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
  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const skyLighting = computeSkyLighting(sky);
    const skyAmount = clamp01(sky.visualizationAmount ?? 1);
    const manualBlend = sky.enabled
      ? 1 - (1 - MANUAL_BLEND_WHEN_SKY) * skyAmount
      : 1;

    const useBreathPipeline =
      ledStreamPipeline.breathStage && ledViewMode === "breathPlusTimeOfDay";
    const useTimePipeline =
      ledStreamPipeline.timeOfDayStage && ledViewMode !== "breathIntensity";

    if (useTimePipeline) {
      // Pipeline A: time-of-day lighting.
      const timeLights: ShadeLight[] = [
        {
          type: "ambient",
          color: hexToVec3(ambient.color),
          intensity: ambient.intensity * manualBlend,
        },
      ];
      if (sky.enabled) {
        timeLights.push(
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
            spread: clamp01(sky.sunSpread ?? 0.9),
          },
          {
            type: "directional",
            direction: skyLighting.moonDirection,
            color: hexToVec3(skyLighting.moonColor),
            intensity: skyLighting.moonIntensity,
            spread: clamp01(sky.moonSpread ?? 0.9),
          },
        );
      }
      shadeLeds(
        buffers.positions,
        buffers.normals,
        buffers.n,
        timeLights,
        cloud.opacity,
        buffers.colorBytes,
        buffers.timeColorFloats,
        {
          hemisphereAverage: true,
          hemisphereFocusExponent: Math.max(0, strand.sensorHemisphereFocus),
        },
      );
    } else {
      buffers.timeColorFloats.fill(0);
    }

    if (useBreathPipeline) {
      // Breath is a filter mask (not a light): inhale gates an area-of-effect.
      const sample = breath.enabled ? sampleBreathAt(breath, performance.now()) : null;
      const strength = sample ? sample.inhaleIntensity : 0;
      const radius = Math.max(0.05, breath.area.radius);
      const invRadius = 1 / radius;
      const falloffExp = Math.max(0.0001, breath.area.falloffExponent);
      const origin = offsetXZ(
        rotateY(
          rotateX(
            computeBreathAreaOrigin(ellipsoid, {
              sourceAzimuthDeg: breath.area.sourceAzimuthDeg,
              sourceElevationDeg: breath.area.sourceElevationDeg,
              distanceFromCloud: breath.area.distanceFromCloud,
            }),
            cloudTiltRad,
          ),
          cloudYawRad,
        ),
        cloud.offsetX,
        cloud.offsetZ,
      );
      const ox = origin[0];
      const oy = origin[1];
      const oz = origin[2];
      for (let i = 0; i < buffers.n; i++) {
        const i3 = i * 3;
        const dx = buffers.positions[i3] - ox;
        const dy = buffers.positions[i3 + 1] - oy;
        const dz = buffers.positions[i3 + 2] - oz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const prox = clamp01(1 - d * invRadius);
        const mask = clamp01(strength * Math.pow(prox, falloffExp));
        buffers.breathColorFloats[i3] = mask;
        buffers.breathColorFloats[i3 + 1] = mask;
        buffers.breathColorFloats[i3 + 2] = mask;
      }
    } else {
      buffers.breathColorFloats.fill(0);
    }

    // Lightning: additive contribution independent of view mode. Runs only
    // when both the effect and the stream pipeline stage are enabled, and
    // only in views where time-of-day is visible (so Breath view stays a
    // pure visualization pass).
    const useLightning =
      lightning.enabled &&
      ledStreamPipeline.lightningStage &&
      ledViewMode !== "breathIntensity" &&
      hourInRange(sky.timeHours, lightning.activeStartHour, lightning.activeEndHour);
    if (useLightning) {
      const now = performance.now();
      const substeps = Math.max(
        1,
        Math.min(20, Math.round(lightning.updatesPerFrame || 1)),
      );
      // Feed the controller N intermediate timestamps so the Poisson
      // process runs `substeps` times per frame instead of once. Same
      // total rate, but strikes are less clumped and the bolt
      // population refreshes more often within a single render.
      const lastMs = lightningCtrl.getLastUpdateMs();
      const prev = lastMs > 0 ? lastMs : now;
      const stepDt = (now - prev) / substeps;
      const cloudXform = {
        tiltRad: cloudTiltRad,
        yawRad: cloudYawRad,
        offsetX: cloud.offsetX,
        offsetZ: cloud.offsetZ,
      };
      for (let s = 1; s <= substeps; s++) {
        lightningCtrl.update(prev + stepDt * s, lightning, ellipsoid, cloudXform);
      }
      lightningCtrl.contribute(
        buffers.positions,
        buffers.n,
        buffers.lightningColorFloats,
        now,
        lightning,
      );
    } else {
      buffers.lightningColorFloats.fill(0);
    }

    // Select or blend pipelines per mode.
    if (ledViewMode === "breathIntensity") {
      const sample = breath.enabled ? sampleBreathAt(breath, performance.now()) : null;
      const strength = sample ? sample.inhaleIntensity : 0;
      const radius = Math.max(0.05, breath.area.radius);
      const invRadius = 1 / radius;
      const falloffExp = Math.max(0.0001, breath.area.falloffExponent);
      const origin = offsetXZ(
        rotateY(
          rotateX(
            computeBreathAreaOrigin(ellipsoid, {
              sourceAzimuthDeg: breath.area.sourceAzimuthDeg,
              sourceElevationDeg: breath.area.sourceElevationDeg,
              distanceFromCloud: breath.area.distanceFromCloud,
            }),
            cloudTiltRad,
          ),
          cloudYawRad,
        ),
        cloud.offsetX,
        cloud.offsetZ,
      );
      const ox = origin[0];
      const oy = origin[1];
      const oz = origin[2];
      for (let i = 0; i < buffers.n; i++) {
        const i3 = i * 3;
        const dx = buffers.positions[i3] - ox;
        const dy = buffers.positions[i3 + 1] - oy;
        const dz = buffers.positions[i3 + 2] - oz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const prox = clamp01(1 - d * invRadius);
        const influence = strength * Math.pow(prox, falloffExp);
        const v = clamp01(influence);
        const r = v;
        const g = v;
        const b = v;
        buffers.colorFloats[i3] = r;
        buffers.colorFloats[i3 + 1] = g;
        buffers.colorFloats[i3 + 2] = b;
        buffers.colorBytes[i3] = (r * 255 + 0.5) | 0;
        buffers.colorBytes[i3 + 1] = (g * 255 + 0.5) | 0;
        buffers.colorBytes[i3 + 2] = (b * 255 + 0.5) | 0;
      }
    } else if (ledViewMode === "timeOfDay") {
      for (let i = 0; i < buffers.n; i++) {
        const i3 = i * 3;
        const r = clamp01(buffers.timeColorFloats[i3] + buffers.lightningColorFloats[i3]);
        const g = clamp01(buffers.timeColorFloats[i3 + 1] + buffers.lightningColorFloats[i3 + 1]);
        const b = clamp01(buffers.timeColorFloats[i3 + 2] + buffers.lightningColorFloats[i3 + 2]);
        buffers.colorFloats[i3] = r;
        buffers.colorFloats[i3 + 1] = g;
        buffers.colorFloats[i3 + 2] = b;
        buffers.colorBytes[i3] = (r * 255 + 0.5) | 0;
        buffers.colorBytes[i3 + 1] = (g * 255 + 0.5) | 0;
        buffers.colorBytes[i3 + 2] = (b * 255 + 0.5) | 0;
      }
    } else {
      const mix = ledStreamPipeline.breathStage ? clamp01(breath.area.breathVsTimeMix) : 0;
      for (let i = 0; i < buffers.n; i++) {
        const i3 = i * 3;
        const tr = buffers.timeColorFloats[i3];
        const tg = buffers.timeColorFloats[i3 + 1];
        const tb = buffers.timeColorFloats[i3 + 2];
        const br = buffers.breathColorFloats[i3];
        const bg = buffers.breathColorFloats[i3 + 1];
        const bb = buffers.breathColorFloats[i3 + 2];
        let r = tr;
        let g = tg;
        let b = tb;
        const inhaleMask = clamp01((br + bg + bb) / 3);
        if (breathTimeCombineMode === "revealOnInhale") {
          // Hide time-of-day by default and reveal it where inhale activates.
          r = tr * inhaleMask;
          g = tg * inhaleMask;
          b = tb * inhaleMask;
        } else {
          // Linear filter depth: 0 = unfiltered time-of-day, 1 = fully masked.
          const filter = 1 - mix + mix * inhaleMask;
          r = tr * filter;
          g = tg * filter;
          b = tb * filter;
        }
        r = clamp01(r + buffers.lightningColorFloats[i3]);
        g = clamp01(g + buffers.lightningColorFloats[i3 + 1]);
        b = clamp01(b + buffers.lightningColorFloats[i3 + 2]);
        buffers.colorFloats[i3] = r;
        buffers.colorFloats[i3 + 1] = g;
        buffers.colorFloats[i3 + 2] = b;
        buffers.colorBytes[i3] = (r * 255 + 0.5) | 0;
        buffers.colorBytes[i3 + 1] = (g * 255 + 0.5) | 0;
        buffers.colorBytes[i3 + 2] = (b * 255 + 0.5) | 0;
      }
    }

    const locatorColor = hexToVec3(ledLocator.color);
    if (ledDisplayMode === "leds") {
      for (let i = 0; i < buffers.n; i++) {
        const i3 = i * 3;
        if (
          ledStreamPipeline.locatorOverrideStage &&
          ledLocator.enabled &&
          locatedSet.has(i)
        ) {
          // Hard output override: bypass all prior processing and force this LED
          // to locator yellow both in the 3D view and in streamed byte output.
          buffers.colorFloats[i3] = locatorColor[0];
          buffers.colorFloats[i3 + 1] = locatorColor[1];
          buffers.colorFloats[i3 + 2] = locatorColor[2];
          buffers.colorBytes[i3] = (locatorColor[0] * 255 + 0.5) | 0;
          buffers.colorBytes[i3 + 1] = (locatorColor[1] * 255 + 0.5) | 0;
          buffers.colorBytes[i3 + 2] = (locatorColor[2] * 255 + 0.5) | 0;
          tmpColor.setRGB(locatorColor[0], locatorColor[1], locatorColor[2]);
        } else {
          tmpColor.setRGB(
            buffers.colorFloats[i3],
            buffers.colorFloats[i3 + 1],
            buffers.colorFloats[i3 + 2],
          );
        }
        mesh.setColorAt(i, tmpColor);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    } else {
      // Sensor display is physically-lit white geometry. InstancedMesh still
      // multiplies by instanceColor when present, so explicitly write white
      // every frame (with optional locator highlights) to avoid stale/zero
      // instance colors making sensors appear black.
      for (let i = 0; i < buffers.n; i++) {
        if (ledLocator.enabled && locatedSet.has(i)) {
          tmpColor.setRGB(locatorColor[0], locatorColor[1], locatorColor[2]);
        }
        else tmpColor.setRGB(1, 1, 1);
        mesh.setColorAt(i, tmpColor);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // Suppress 1-LSB chatter in streamed bytes. This removes tiny histogram
    // flicker from floating-point noise while preserving meaningful motion.
    const byteCount = buffers.n * 3;
    if (!stableBytesRef.current || stableBytesRef.current.length !== byteCount) {
      stableBytesRef.current = new Uint8Array(buffers.colorBytes);
    } else {
      const stable = stableBytesRef.current;
      for (let i = 0; i < byteCount; i++) {
        const next = buffers.colorBytes[i];
        const prev = stable[i];
        if (Math.abs(next - prev) <= STREAM_BYTE_DEADBAND) {
          buffers.colorBytes[i] = prev;
        } else {
          stable[i] = next;
        }
      }
    }

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

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!ledLocator.enabled) return;
    if (e.instanceId === undefined || e.instanceId === null) return;
    e.stopPropagation();
    toggleLocatedLed(e.instanceId);
  };

  if (ledDisplayMode === "leds") {
    return (
      <instancedMesh
        key="leds-emitters"
        ref={meshRef}
        args={[undefined, undefined, buffers.n]}
        frustumCulled={false}
        onPointerDown={onPointerDown}
        renderOrder={5}
      >
        {/*
          Narrow half-hemisphere: only the top ~π/3 of the sphere along
          the pole. Renders as a small forward-facing cap oriented along
          each LED's outward normal, with additive blending so the color
          reads as light emission rather than a matte surface.
        */}
        <sphereGeometry args={[1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 3]} />
        <meshBasicMaterial
          color="#ffffff"
          toneMapped={false}
          transparent
          opacity={1}
          side={FrontSide}
          blending={AdditiveBlending}
          depthTest={false}
          depthWrite={false}
        />
      </instancedMesh>
    );
  }

  return (
    <instancedMesh
      key="leds-sensors"
      ref={meshRef}
      args={[undefined, undefined, buffers.n]}
      frustumCulled={false}
      onPointerDown={onPointerDown}
    >
      {/* Sensor cap: outward hemisphere embedded in the cloud surface. */}
      <sphereGeometry args={[1, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
      <meshStandardMaterial color="#ffffff" roughness={1} metalness={0} />
    </instancedMesh>
  );
}
