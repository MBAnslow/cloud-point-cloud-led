import { useEffect } from "react";
import { isBreathActive, useSimStore } from "../state";
import { sharedBreathWaveController } from "../lighting/breathWaves";
import { getBreathExhaleAudioEngine } from "./BreathExhaleAudioEngine";

/**
 * Fires the breath-out one-shot once per newly spawned travelling wave
 * (whichever exclusive trigger source is selected). Same bornMs watermark
 * pattern as LightningAudioRuntime.
 */
export function BreathExhaleAudioRuntime(): null {
  useEffect(() => {
    const engine = getBreathExhaleAudioEngine();
    let raf = 0;
    let lastMaxBorn = -Infinity;
    let unlockedOnce = false;
    let firstFrame = true;

    const unlock = () => {
      engine
        .start()
        .then(() => {
          unlockedOnce = true;
          engine.preload(useSimStore.getState().breath);
        })
        .catch((err) => console.warn("[breath-exhale] start failed", err));
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!unlockedOnce) return;
      const state = useSimStore.getState();
      const breath = state.breath;
      engine.preload(breath);

      const waves = sharedBreathWaveController.getWaves();
      if (firstFrame) {
        for (const w of waves) {
          if (w.bornMs > lastMaxBorn) lastMaxBorn = w.bornMs;
        }
        firstFrame = false;
        return;
      }

      const active = isBreathActive(breath, state.sky.timeHours);
      if (!breath.enabled || !active) {
        for (const w of waves) {
          if (w.bornMs > lastMaxBorn) lastMaxBorn = w.bornMs;
        }
        return;
      }

      let newMax = lastMaxBorn;
      for (const w of waves) {
        if (w.bornMs > lastMaxBorn) {
          engine.triggerExhale(breath);
          if (w.bornMs > newMax) newMax = w.bornMs;
        }
      }
      lastMaxBorn = newMax;
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
