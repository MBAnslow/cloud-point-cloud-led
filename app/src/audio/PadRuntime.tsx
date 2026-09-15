import { useEffect } from "react";
import { useSimStore } from "../state";
import { getPadEngine } from "./PadEngine";
import { modulatedEngineParams } from "./breathModulation";

/**
 * Headless component that drives the warm-pad engine every animation
 * frame. Mount once at the app root, alongside `DroneRuntime`. Reads
 * `sky.timeHours` + `pad` from the store on each tick without
 * subscribing (avoids re-renders). The sky clock itself is advanced by
 * `DroneRuntime` — this runtime only feeds its engine.
 *
 * AudioContext unlock is idempotent: the same pointer/key gestures
 * that start the drone engine also start the pad engine.
 */
export function PadRuntime(): null {
  useEffect(() => {
    const engine = getPadEngine();
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
        .catch((err) => console.warn("[pad] start failed", err))
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
      const { pad } = modulatedEngineParams(state, performance.now());
      engine.update(
        state.sky.timeHours,
        state.audioMuted.pad ||
          (state.audioSolo && state.audioSolo !== "pad")
          ? { ...pad, master: 0 }
          : pad,
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
