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
    let unlocking = false;

    const unlock = () => {
      if (unlocking) return;
      unlocking = true;
      engine
        .start()
        .then(() => {
          window.removeEventListener("pointerdown", unlock);
          window.removeEventListener("keydown", unlock);
        })
        .catch((err) => console.warn("[samples] start failed", err))
        .finally(() => {
          unlocking = false;
        });
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") unlock();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    document.addEventListener("visibilitychange", onVisibility);

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const state = useSimStore.getState();
      const { samples } = modulatedEngineParams(state, performance.now());
      const hour = Number.isFinite(state.sky.timeHours)
        ? state.sky.timeHours
        : 0;
      const cycleSeconds = Number.isFinite(state.sky.cycleSeconds)
        ? Math.max(1, state.sky.cycleSeconds)
        : 300;
      engine.update(
        hour,
        cycleSeconds,
        state.audioMuted.samples ||
          (state.audioSolo && state.audioSolo !== "samples")
          ? { ...samples, master: 0 }
          : samples,
        state.sky.autoPlay,
      );
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return null;
}
