import { useState } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending } from "three";
import { Line } from "@react-three/drei";
import { sharedLightningController, type BoltStrike } from "../lighting/lightning";
import { useSimStore } from "../state";

interface VisibleBolt {
  id: number;
  points: Array<[number, number, number]>;
  opacity: number;
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

  useFrame(() => {
    if (!lightning.enabled) {
      if (bolts.length !== 0) setBolts([]);
      return;
    }
    const now = performance.now();
    const strikes = sharedLightningController.getStrikes();
    const next: VisibleBolt[] = [];
    for (const s of strikes) {
      const env = sharedLightningController.strikeEnvelope(s, now);
      if (env <= 0.001) continue;
      let id = idByStrike.get(s);
      if (id === undefined) {
        id = nextId++;
        idByStrike.set(s, id);
      }
      next.push({ id, points: bufferToTriplets(s.path), opacity: Math.min(1, env) });
    }
    // Cheap change check: compare counts + ids + rounded opacities.
    let changed = next.length !== bolts.length;
    if (!changed) {
      for (let i = 0; i < next.length; i++) {
        if (
          next[i].id !== bolts[i].id ||
          Math.abs(next[i].opacity - bolts[i].opacity) > 0.02
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
          color={lightning.color}
          lineWidth={2}
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

function bufferToTriplets(buf: Float32Array): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < buf.length; i += 3) {
    out.push([buf[i], buf[i + 1], buf[i + 2]]);
  }
  return out;
}
