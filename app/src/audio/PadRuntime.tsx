import { useEffect } from "react";
import { useSimStore } from "../state";
import { getPadEngine } from "./PadEngine";

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

    const unlock = () => {
      engine.start().catch((err) => console.warn("[pad] start failed", err));
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const state = useSimStore.getState();
      engine.update(state.sky.timeHours, state.pad);
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
