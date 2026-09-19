import { useEffect } from "react";
import { isBreathActive, useSimStore } from "../state";
import { sharedBreathWaveController } from "../lighting/breathWaves";
import { getBreathExhaleAudioEngine } from "./BreathExhaleAudioEngine";

/**
 * Fires the breath-out one-shot for exhale onsets in either spatial mode.
 * Local inhale mode emits the event without spawning a travelling wave.
 */
export function BreathExhaleAudioRuntime(): null {
  useEffect(() => {
    const engine = getBreathExhaleAudioEngine();
    let raf = 0;
    let lastEventId = 0;
    let unlockedOnce = engine.isStarted();
    let unlocking = false;
    let firstFrame = true;

    const unlock = () => {
      if (unlocking) return;
      unlocking = true;
      engine
        .start()
        .then(() => {
          unlockedOnce = true;
          engine.preload(useSimStore.getState().breath);
          window.removeEventListener("pointerdown", unlock);
          window.removeEventListener("keydown", unlock);
        })
        .catch((err) => console.warn("[breath-exhale] start failed", err))
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
    if (unlockedOnce) engine.preload(useSimStore.getState().breath);

    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!unlockedOnce) return;
      engine.update();
      const state = useSimStore.getState();
      const breath = state.breath;
      engine.preload(breath);

      const events = sharedBreathWaveController.getExhaleEvents();
      if (firstFrame) {
        for (const event of events) {
          if (event.id > lastEventId) lastEventId = event.id;
        }
        firstFrame = false;
        return;
      }

      const active = isBreathActive(breath, state.sky.timeHours);
      if (!breath.enabled || !active) {
        for (const event of events) {
          if (event.id > lastEventId) lastEventId = event.id;
        }
        return;
      }

      let newMax = lastEventId;
      for (const event of events) {
        if (event.id > lastEventId) {
          engine.triggerExhale(breath);
          if (event.id > newMax) newMax = event.id;
        }
      }
      lastEventId = newMax;
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
