import { useEffect } from "react";
import { activeWindowProgress, hourInRange, useSimStore } from "../state";
import {
  sampleLightningKeyframe,
  sharedLightningController,
} from "../lighting/lightning";
import { getLightningAudioEngine } from "./LightningAudioEngine";

/**
 * Drives the LightningAudioEngine. Each frame it:
 *   1. lazily starts the engine once any user interaction has unlocked
 *      the AudioContext elsewhere,
 *   2. updates the background loop based on `enabled + active window`,
 *   3. detects newly-born strikes in `sharedLightningController` by
 *      tracking born-timestamps and fires a bolt sound per new strike.
 *      Ground strikes (`kind === "strike"`) use `strikeSample`; cloud
 *      flashes use the tagged `boltSamples` library. Newly spawned
 *      storm sprites fire `spriteSample` when set.
 *
 * We identify new strikes by the max `bornMs` seen so far — cheap and
 * doesn't require patching the LightningController API. Sprites use
 * the same watermark pattern on `getSprites()`.
 */
export function LightningAudioRuntime(): null {
  useEffect(() => {
    const engine = getLightningAudioEngine();
    let raf = 0;
    let lastMaxBorn = -Infinity;
    let lastMaxSpriteBorn = -Infinity;
    let unlockedOnce = false;
    let firstFrame = true;
    // Pending thunder timers so we can clear queued sounds on unmount /
    // when the effect is disabled mid-flight.
    const pendingThunder = new Set<ReturnType<typeof setTimeout>>();

    const unlock = () => {
      engine
        .start()
        .then(() => {
          unlockedOnce = true;
          engine.preload(useSimStore.getState().lightning);
        })
        .catch((err) => console.warn("[lightning-audio] start failed", err));
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!unlockedOnce) return;
      const state = useSimStore.getState();
      const p = state.lightning;
      const active = hourInRange(
        state.sky.timeHours,
        p.activeStartHour,
        p.activeEndHour,
      );
      const keyframeU = activeWindowProgress(
        state.sky.timeHours,
        p.activeStartHour,
        p.activeEndHour,
      );
      const live = sampleLightningKeyframe(p.keyframes, keyframeU);
      engine.update(
        {
          ...p,
          backgroundGain: live.backgroundGain,
          pan: live.pan,
        },
        active,
      );

      const strikes = sharedLightningController.getStrikes();
      const sprites = sharedLightningController.getSprites();
      // Skip on the very first tick after start — otherwise pre-existing
      // strikes would all replay simultaneously.
      if (firstFrame) {
        for (const s of strikes) {
          if (s.bornMs > lastMaxBorn) lastMaxBorn = s.bornMs;
        }
        for (const s of sprites) {
          if (s.bornMs > lastMaxSpriteBorn) lastMaxSpriteBorn = s.bornMs;
        }
        firstFrame = false;
        return;
      }
      let newMax = lastMaxBorn;
      for (const s of strikes) {
        if (s.bornMs > lastMaxBorn) {
          const delay = Math.max(0, s.thunderDelayMs ?? p.thunderDelayMs ?? 0);
          const intensity = s.intensity;
          const boltGain = s.boltGain ?? p.boltGain;
          const pan = s.pan ?? p.pan ?? 0;
          const isGroundStrike = s.kind === "strike";
          const match = {
            intensity01: s.intensity01,
            durationMs: s.durationMs,
          };
          const fire = (cur: typeof p) => {
            if (isGroundStrike) {
              engine.triggerStrike(cur, intensity, boltGain, pan);
            } else {
              engine.triggerBolt(cur, intensity, boltGain, pan, match);
            }
          };
          if (delay <= 0) {
            fire(p);
          } else {
            const timer = setTimeout(() => {
              pendingThunder.delete(timer);
              const cur = useSimStore.getState().lightning;
              if (!cur.enabled) return;
              fire(cur);
            }, delay);
            pendingThunder.add(timer);
          }
          if (s.bornMs > newMax) newMax = s.bornMs;
        }
      }
      lastMaxBorn = newMax;

      let newSpriteMax = lastMaxSpriteBorn;
      for (const sp of sprites) {
        if (sp.bornMs > lastMaxSpriteBorn) {
          const pan = live.pan ?? p.pan ?? 0;
          engine.triggerSprite(p, 1, sp.gain, pan);
          if (sp.bornMs > newSpriteMax) newSpriteMax = sp.bornMs;
        }
      }
      lastMaxSpriteBorn = newSpriteMax;
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      for (const t of pendingThunder) clearTimeout(t);
      pendingThunder.clear();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);
  return null;
}
