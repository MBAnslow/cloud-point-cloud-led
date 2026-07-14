import { useEffect } from "react";
import { useSimStore } from "../state";
import { getSampleEngine } from "./SampleEngine";
import { modulatedEngineParams } from "./breathModulation";

/**
 * Headless RAF loop that drives the samples engine. Mount once at the
 * app root alongside DroneRuntime / PadRuntime. Doesn't advance the
 * sky clock (DroneRuntime owns that) — this runtime only feeds its
 * engine each frame.
 */
export function SampleRuntime(): null {
  useEffect(() => {
    const engine = getSampleEngine();
    let raf = 0;

    const unlock = () => {
      engine
        .start()
        .catch((err) => console.warn("[samples] start failed", err));
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const state = useSimStore.getState();
      const { samples } = modulatedEngineParams(state, performance.now());
      engine.update(state.sky.timeHours, state.sky.cycleSeconds, samples);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);
  return null;
}
