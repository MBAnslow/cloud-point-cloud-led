import { useEffect } from "react";
import { activeWindowProgress, hourInRange, useSimStore } from "../state";
import {
  sampleLightningKeyframe,
  sharedLightningController,
  spriteFlashEnvelope,
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
 *      storm sprites choose randomly from `spriteAudioSamples`.
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
    let unlockedOnce = engine.isStarted();
    let unlocking = false;
    let firstFrame = true;
    let nextSpriteEventId = 1;
    const spriteEventIds = new WeakMap<object, number>();
    const spriteEventId = (sprite: object): number => {
      const existing = spriteEventIds.get(sprite);
      if (existing !== undefined) return existing;
      const id = nextSpriteEventId++;
      spriteEventIds.set(sprite, id);
      return id;
    };
    // Pending thunder timers so we can clear queued sounds on unmount /
    // when the effect is disabled mid-flight.
    const pendingThunder = new Set<ReturnType<typeof setTimeout>>();

    const unlock = () => {
      if (unlocking) return;
      unlocking = true;
      engine
        .start()
        .then(() => {
          unlockedOnce = true;
          engine.preload(useSimStore.getState().lightning);
          window.removeEventListener("pointerdown", unlock);
          window.removeEventListener("keydown", unlock);
        })
        .catch((err) => console.warn("[lightning-audio] start failed", err))
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
    if (unlockedOnce) engine.preload(useSimStore.getState().lightning);

    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!unlockedOnce) return;
      const state = useSimStore.getState();
      const p = state.lightning;
      // Keep newly uploaded/replaced sounds warm as well as those that were
      // present when the AudioContext was first unlocked.
      engine.preload(p);
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
      const nowMs = performance.now();
      for (const sp of sprites) {
        const eventId = spriteEventId(sp);
        engine.setSpriteEnvelope(
          eventId,
          p.spriteAudioReactiveBrightness ? 1 : spriteFlashEnvelope(sp, nowMs),
        );
        sp.audioDynamics = engine.getSpriteDynamics(eventId);
      }
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
          const rawDelay = s.thunderDelayMs ?? p.thunderDelayMs ?? 0;
          const delay = Math.max(
            0,
            Number.isFinite(rawDelay) ? rawDelay : 0,
          );
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
            const dueAt = performance.now() + delay;
            const timer = setTimeout(() => {
              pendingThunder.delete(timer);
              const curState = useSimStore.getState();
              const cur = curState.lightning;
              // Hidden-tab timer throttling can release many stale thunder
              // callbacks together. Drop very late events instead of
              // producing an overload burst when audio resumes.
              if (performance.now() - dueAt > 1000 || !cur.enabled) return;
              if (
                !hourInRange(
                  curState.sky.timeHours,
                  cur.activeStartHour,
                  cur.activeEndHour,
                )
              ) {
                return;
              }
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
          const eventId = spriteEventId(sp);
          const pan = live.pan ?? p.pan ?? 0;
          engine.triggerSprite(p, 1, p.spriteAudioGain, pan, eventId);
          engine.setSpriteEnvelope(
            eventId,
            p.spriteAudioReactiveBrightness
              ? 1
              : spriteFlashEnvelope(sp, performance.now()),
          );
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
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return null;
}
