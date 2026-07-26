import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending } from "three";
import { Line } from "@react-three/drei";
import {
  boltTravelHead,
  peakIntensityRange,
  sharedLightningController,
  type BoltStrike,
} from "../lighting/lightning";
import { activeWindowProgress, useSimStore } from "../state";

interface VisibleBolt {
  id: string;
  points: Array<[number, number, number]>;
  opacity: number;
  head: number;
  color: string;
  lineWidth: number;
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

let nextId = 1;
const idByStrike = new WeakMap<BoltStrike, number>();

/**
 * Renders the currently active lightning strikes as additive lines. The
 * bolt geometry and envelope come from the shared controller, so the LED
 * contribution and this visualisation stay in lockstep. When the effect
 * is disabled, nothing is drawn.
 */
export function LightningBolts() {
  const lightning = useSimStore((s) => s.lightning);
  const [bolts, setBolts] = useState<VisibleBolt[]>([]);
  const lastTickRef = useRef(0);

  useFrame(() => {
    if (!lightning.enabled) {
      if (bolts.length !== 0) setBolts([]);
      return;
    }
    const now = performance.now();
    // Gate visualization refresh to the lightning sim FPS so bolts
    // strobe in lockstep with LED contribution at low frame rates.
    const fps = Math.max(1, Math.min(60, Math.round(lightning.simFps || 60)));
    if (now - lastTickRef.current < 1000 / fps) return;
    lastTickRef.current = now;
    const strikes = sharedLightningController.getStrikes();
    const keyframeU = activeWindowProgress(
      useSimStore.getState().sky.timeHours,
      lightning.activeStartHour,
      lightning.activeEndHour,
    );
    const peak = peakIntensityRange(lightning.keyframes, keyframeU);
    const intensityMax = Math.max(1, peak[1], 0.001);
    const next: VisibleBolt[] = [];
    for (const s of strikes) {
      const env = sharedLightningController.strikeEnvelope(s, now);
      if (env <= 0.001) continue;
      let sid = idByStrike.get(s);
      if (sid === undefined) {
        sid = nextId++;
        idByStrike.set(s, sid);
      }
      const age = now - s.bornMs;
      const mainHead = boltTravelHead(age, s.durationMs);
      const mainPoints = partialPath(s.path, mainHead);
      const c = sharedLightningController.strikeColor(s, now);
      const iNorm = Math.max(0, Math.min(1, env / intensityMax));
      const color = rgbToHex(c[0], c[1], c[2]);
      const isGround = s.kind === "strike";
      if (mainPoints.length >= 2) {
        next.push({
          id: `${sid}-main`,
          points: mainPoints,
          opacity: Math.max(
            0,
            Math.min(1, env * (isGround ? 0.55 + 0.45 * iNorm : 0.35 + 0.65 * iNorm)),
          ),
          head: mainHead,
          color,
          lineWidth: isGround ? 2.8 + iNorm * 2.4 : 1.5 + iNorm * 1.5,
        });
      }

      const totalSegs = s.path.length / 3 - 1;
      const travelMs = Math.max(30, s.durationMs * 0.25);
      const segTravel = totalSegs > 0 ? travelMs / totalSegs : travelMs;
      for (let bi = 0; bi < s.branches.length; bi++) {
        const branch = s.branches[bi];
        const forkDelay = branch.forkVertex * segTravel;
        const branchAge = age - forkDelay;
        if (branchAge < 0) continue;
        // Match main tip pace: branch deploys over the same travel window
        // scaled to its own segment count.
        const branchSegs = branch.path.length / 3 - 1;
        if (branchSegs < 1) continue;
        const branchTravelMs = branchSegs * segTravel;
        const branchHead = Math.min(
          1,
          branchAge / Math.max(1e-3, branchTravelMs),
        );
        const points = partialPath(branch.path, branchHead);
        if (points.length < 2) continue;
        const strength = Math.max(0.15, Math.min(1, branch.strength));
        next.push({
          id: `${sid}-b${bi}`,
          points,
          opacity: Math.max(
            0,
            Math.min(1, env * strength * (0.3 + 0.55 * iNorm)),
          ),
          head: branchHead,
          color,
          lineWidth: 0.8 + iNorm * strength,
        });
      }
    }
    // Cheap change check: compare counts + ids + rounded opacities.
    let changed = next.length !== bolts.length;
    if (!changed) {
      for (let i = 0; i < next.length; i++) {
        if (
          next[i].id !== bolts[i].id ||
          Math.abs(next[i].opacity - bolts[i].opacity) > 0.02 ||
          Math.abs(next[i].head - bolts[i].head) > 0.02
        ) {
          changed = true;
          break;
        }
      }
    }
    if (changed) setBolts(next);
  });

  if (!lightning.enabled || bolts.length === 0) return null;

  return (
    <group>
      {bolts.map((b) => (
        <Line
          key={b.id}
          points={b.points}
          color={b.color}
          lineWidth={b.lineWidth}
          transparent
          opacity={b.opacity}
          depthWrite={false}
          toneMapped={false}
          blending={AdditiveBlending}
          renderOrder={30}
        />
      ))}
    </group>
  );
}

/**
 * Return the first `head` fraction of the polyline as an array of
 * points, interpolating along the "current" segment so the tip lands
 * exactly at the deployed position rather than snapping to vertices.
 */
function partialPath(
  buf: Float32Array,
  head: number,
): Array<[number, number, number]> {
  const totalSegs = buf.length / 3 - 1;
  if (totalSegs < 1) return [];
  const activeF = Math.max(0, Math.min(1, head)) * totalSegs;
  const fullSegs = Math.floor(activeF);
  const tipT = activeF - fullSegs;
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i <= fullSegs && i <= totalSegs; i++) {
    const idx = i * 3;
    out.push([buf[idx], buf[idx + 1], buf[idx + 2]]);
  }
  if (fullSegs < totalSegs && tipT > 0) {
    const a3 = fullSegs * 3;
    const b3 = a3 + 3;
    out.push([
      buf[a3] + (buf[b3] - buf[a3]) * tipT,
      buf[a3 + 1] + (buf[b3 + 1] - buf[a3 + 1]) * tipT,
      buf[a3 + 2] + (buf[b3 + 2] - buf[a3 + 2]) * tipT,
    ]);
  }
  return out;
}
