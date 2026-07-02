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
import { breathLevelAt } from "../lighting/breath";
import { sampleBreathAt } from "../lighting/breath";
import {
  breathWindInfluenceAt,
  computeBreathWindOrigin,
} from "../lighting/breathWind";
import {
  hexToVec3,
  shadeLeds,
  type ShadeLight,
} from "../lighting/shade";
import { directionalDistanceFalloff, useSimStore } from "../state";
import { computeSkyLighting } from "../lighting/skyCycle";
import { WledStreamClient } from "../wled/client";
import { publishFrame } from "../stream/frameBuffer";

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

/**
 * Exposure-like lift. Unlike plain multiplication, this can brighten even
 * darker LEDs so the exhale effect stays visible in low-light regions.
 */
function applyExposureLift(c: number, amount: number): number {
  if (amount <= 1e-6) return c;
  return 1 - (1 - clamp01(c)) * Math.exp(-amount);
}

function inhaleDimStrength(param: number): number {
  // Very strong pull-to-dark curve. At higher inhale values LEDs should
  // approach off, not just "a bit dimmer".
  const p = Math.max(0, param);
  return clamp01(1 - Math.exp(-6.0 * p));
}

function applyNeutralDecay(value: number, dtSec: number, decaySec: number): number {
  const tau = Math.max(0.01, decaySec);
  const strength = 3.1;
  return value * Math.exp((-dtSec * strength) / tau);
}

function applyNeutralVelocityDecay(
  velocity: number,
  dtSec: number,
  decaySec: number,
): number {
  const tau = Math.max(0.01, decaySec);
  const strength = 4.4;
  return velocity * Math.exp((-dtSec * strength) / tau);
}

/**
 * Second-order smoothing for per-LED breath channels.
 * Gives each LED an inertia-like response (value + velocity) so inhale/exhale
 * transitions accelerate/decelerate instead of hard-switching.
 */
function stepDynamicParam(
  value: number,
  velocity: number,
  target: number,
  durationSec: number,
  dtSec: number,
): [number, number] {
  const duration = Math.max(0.08, durationSec);
  const omega = 2.8 / duration;
  const accel = (target - value) * omega * omega;
  let v = velocity + accel * dtSec;
  v *= Math.exp(-2.1 * omega * dtSec);
  let x = value + v * dtSec;

  if (x < 0) {
    x = 0;
    if (v < 0) v = 0;
  }
  if (x > 6) {
    x = 6;
    if (v > 0) v = 0;
  }
  return [x, v];
}

export function Leds() {
  const ellipsoid = useSimStore((s) => s.ellipsoid);
  const cloud = useSimStore((s) => s.cloud);
  const strand = useSimStore((s) => s.strand);
  const ambient = useSimStore((s) => s.ambient);
  const directional = useSimStore((s) => s.directional);
  const sky = useSimStore((s) => s.sky);
  const breath = useSimStore((s) => s.breath);
  const ledViewMode = useSimStore((s) => s.ledViewMode);
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
      inhaleParam: new Float32Array(n),
      exhaleParam: new Float32Array(n),
      inhaleVelocity: new Float32Array(n),
      exhaleVelocity: new Float32Array(n),
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
  useFrame((_, delta) => {
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
    if (
      ledViewMode === "breathPlusLight" &&
      breath.enabled &&
      breath.breathers.length > 0
    ) {
      const nowMs = performance.now();
      const cycleSeconds =
        breath.inhaleSeconds +
        breath.holdPeakSeconds +
        breath.exhaleSeconds +
        breath.holdTroughSeconds;
      const cycleMs = Math.max(1, cycleSeconds * 1000);
      const perBreatherGain = breath.intensity / Math.max(1, breath.breathers.length);
      for (const breather of breath.breathers) {
        const phaseMs = (breather.phaseOffset % 1) * cycleMs;
        const level = breathLevelAt(breath, nowMs + phaseMs);
        if (level <= 1e-5) continue;
        lights.push({
          type: "ambient",
          color: hexToVec3(breather.color),
          intensity: perBreatherGain * level,
        });
      }
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

    // Update per-LED dynamic breath channels (stateful over time), then
    // render according to selected LED view mode.
    if (breath.enabled && breath.wind.enabled) {
      const nowMs = performance.now();
      const sample = sampleBreathAt(breath, nowMs);
      const windOrigin = computeBreathWindOrigin(ellipsoid, {
        sourceAzimuthDeg: breath.wind.sourceAzimuthDeg,
        sourceElevationDeg: breath.wind.sourceElevationDeg,
        distanceFromCloud: breath.wind.distanceFromCloud,
      });
      const field = {
        origin: windOrigin as [number, number, number],
        radius: breath.wind.radius,
        falloffExponent: breath.wind.falloffExponent,
      };
      const dt = Math.min(0.1, Math.max(1 / 240, delta || 1 / 60));
      const inhaleResponseSec = Math.max(
        0.08,
        breath.inhaleSeconds + breath.holdPeakSeconds * 0.35,
      );
      const exhaleResponseSec = Math.max(
        0.08,
        breath.exhaleSeconds + breath.holdTroughSeconds * 0.35,
      );
      const neutralDecaySec = Math.max(0.01, breath.wind.neutralDecaySeconds);

      for (let i = 0; i < buffers.n; i++) {
        const i3 = i * 3;
        const px = buffers.positions[i3];
        const py = buffers.positions[i3 + 1];
        const pz = buffers.positions[i3 + 2];

        const inhalePull = breathWindInfluenceAt(
          [px, py, pz],
          { ...field, maxIntensity: breath.wind.inhaleMaxIntensity },
          sample.inhaleIntensity,
        );
        const exhalePush = breathWindInfluenceAt(
          [px, py, pz],
          { ...field, maxIntensity: breath.wind.maxIntensity },
          sample.exhaleIntensity,
        );

        // Per-LED dynamic channels (stateful over time).
        const inhaleTarget = inhalePull * breath.wind.inhaleDimAmount;
        const exhaleTarget = exhalePush * breath.wind.exhaleExposureAmount;

        const [inhaleParam, inhaleVel] = stepDynamicParam(
          buffers.inhaleParam[i],
          buffers.inhaleVelocity[i],
          inhaleTarget,
          inhaleResponseSec,
          dt,
        );
        const [exhaleParam, exhaleVel] = stepDynamicParam(
          buffers.exhaleParam[i],
          buffers.exhaleVelocity[i],
          exhaleTarget,
          exhaleResponseSec,
          dt,
        );
        buffers.inhaleParam[i] = inhaleParam;
        buffers.inhaleVelocity[i] = inhaleVel;
        buffers.exhaleParam[i] = exhaleParam;
        buffers.exhaleVelocity[i] = exhaleVel;

        // Explicit relaxation channel toward neutral over time.
        buffers.inhaleParam[i] = applyNeutralDecay(
          buffers.inhaleParam[i],
          dt,
          neutralDecaySec,
        );
        buffers.exhaleParam[i] = applyNeutralDecay(
          buffers.exhaleParam[i],
          dt,
          neutralDecaySec,
        );
        buffers.inhaleVelocity[i] = applyNeutralVelocityDecay(
          buffers.inhaleVelocity[i],
          dt,
          neutralDecaySec,
        );
        buffers.exhaleVelocity[i] = applyNeutralVelocityDecay(
          buffers.exhaleVelocity[i],
          dt,
          neutralDecaySec,
        );

      }
    } else {
      // Wind disabled: smoothly relax channels back to zero.
      const dt = Math.min(0.1, Math.max(1 / 240, delta || 1 / 60));
      const neutralDecaySec = Math.max(0.01, breath.wind.neutralDecaySeconds);
      for (let i = 0; i < buffers.n; i++) {
        const [inhaleParam, inhaleVel] = stepDynamicParam(
          buffers.inhaleParam[i],
          buffers.inhaleVelocity[i],
          0,
          neutralDecaySec,
          dt,
        );
        const [exhaleParam, exhaleVel] = stepDynamicParam(
          buffers.exhaleParam[i],
          buffers.exhaleVelocity[i],
          0,
          neutralDecaySec,
          dt,
        );
        buffers.inhaleParam[i] = applyNeutralDecay(inhaleParam, dt, neutralDecaySec);
        buffers.inhaleVelocity[i] = applyNeutralVelocityDecay(
          inhaleVel,
          dt,
          neutralDecaySec,
        );
        buffers.exhaleParam[i] = applyNeutralDecay(exhaleParam, dt, neutralDecaySec);
        buffers.exhaleVelocity[i] = applyNeutralVelocityDecay(
          exhaleVel,
          dt,
          neutralDecaySec,
        );
      }
    }

    if (ledViewMode === "breathPlusLight") {
      const breathTint = hexToVec3(breath.wind.tintColor);
      for (let i = 0; i < buffers.n; i++) {
        const i3 = i * 3;
        const dim = inhaleDimStrength(buffers.inhaleParam[i]);
        const exposureBoost = Math.max(0, buffers.exhaleParam[i]);
        const breathPresence = clamp01(buffers.inhaleParam[i] + buffers.exhaleParam[i]);
        const dimScale = 1 - dim;
        const dr = clamp01(buffers.colorFloats[i3] * dimScale);
        const dg = clamp01(buffers.colorFloats[i3 + 1] * dimScale);
        const db = clamp01(buffers.colorFloats[i3 + 2] * dimScale);
        const er = clamp01(applyExposureLift(dr, exposureBoost));
        const eg = clamp01(applyExposureLift(dg, exposureBoost));
        const eb = clamp01(applyExposureLift(db, exposureBoost));
        const tintMix = clamp01(breathPresence * breath.wind.tintAmount);
        const keep = 1 - tintMix;
        const tr = clamp01(er * keep + breathTint[0] * tintMix);
        const tg = clamp01(eg * keep + breathTint[1] * tintMix);
        const tb = clamp01(eb * keep + breathTint[2] * tintMix);

        // Final stage: pull the current LED color toward black.
        // This guarantees inhale dimming is obvious and can nearly switch
        // LEDs off at full local inhale influence.
        const darkPull = 1 - dim;
        const r = clamp01(tr * darkPull);
        const g = clamp01(tg * darkPull);
        const b = clamp01(tb * darkPull);
        buffers.colorFloats[i3] = r;
        buffers.colorFloats[i3 + 1] = g;
        buffers.colorFloats[i3 + 2] = b;
        buffers.colorBytes[i3] = (r * 255 + 0.5) | 0;
        buffers.colorBytes[i3 + 1] = (g * 255 + 0.5) | 0;
        buffers.colorBytes[i3 + 2] = (b * 255 + 0.5) | 0;
      }
    } else if (ledViewMode === "breathIntensity") {
      for (let i = 0; i < buffers.n; i++) {
        const i3 = i * 3;
        const exhale = clamp01(buffers.exhaleParam[i]);
        const inhale = clamp01(buffers.inhaleParam[i]);
        const r = exhale;
        const g = 0;
        const b = inhale;
        buffers.colorFloats[i3] = r;
        buffers.colorFloats[i3 + 1] = g;
        buffers.colorFloats[i3 + 2] = b;
        buffers.colorBytes[i3] = (r * 255 + 0.5) | 0;
        buffers.colorBytes[i3 + 1] = 0;
        buffers.colorBytes[i3 + 2] = (b * 255 + 0.5) | 0;
      }
    }

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
