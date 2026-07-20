import { useEffect } from "react";
import {
  useSimStore,
  periodContainsHour,
  periodLengthHours,
} from "../state";
import { getDroneEngine } from "./DroneEngine";
import { modulatedEngineParams } from "./breathModulation";

/**
 * Headless component that drives the drone engine every animation frame.
 * Mount once at the app root. Reads sky.timeHours + drone params from
 * the store on each tick without subscribing (avoids re-renders).
 * The AudioContext is unlocked on the first pointer/key event.
 */
export function DroneRuntime(): null {
  useEffect(() => {
    const engine = getDroneEngine();
    let raf = 0;

    const unlock = () => {
      engine.start().catch((err) => console.warn("[drone] start failed", err));
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    // Drives both the sky clock and the drone engine each frame. This
    // runs regardless of the current route so the Play button works on
    // the /drones view too (SkyTimeline isn't mounted there).
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dtMs = now - last;
      last = now;
      const state = useSimStore.getState();
      // The clock loops inside the currently-active day period.
      // Advancing to the next period is a manual action that also
      // snaps timeHours to that period's startHour.
      const period =
        state.dayCycle.periods.find(
          (p) => p.id === state.dayCycle.activePeriodId,
        ) ?? state.dayCycle.periods[0];
      const cur = state.sky.timeHours;
      if (!period) {
        // Degenerate config: fall back to legacy 24h wrap.
        if (state.sky.autoPlay) {
          const hoursPerMs =
            24 / (Math.max(1, state.sky.cycleSeconds) * 1000);
          let next = cur + dtMs * hoursPerMs;
          next = ((next % 24) + 24) % 24;
          state.setSky({ timeHours: next });
        }
      } else if (!periodContainsHour(period, cur)) {
        // Scrubbed or switched period; snap to start.
        state.setSky({ timeHours: period.startHour });
      } else if (state.sky.autoPlay) {
        const hoursPerMs =
          24 / (Math.max(1, state.sky.cycleSeconds) * 1000);
        const dh = dtMs * hoursPerMs;
        const len = periodLengthHours(period);
        // Distance from `cur` to the period's end walking forward on
        // the cyclic 24h axis. When the advance crosses that distance
        // we loop back to `startHour + overshoot`.
        const distToEnd =
          period.endHour >= period.startHour
            ? period.endHour - cur
            : cur >= period.startHour
              ? 24 - cur + period.endHour
              : period.endHour - cur;
        let next: number;
        if (dh < distToEnd) {
          next = cur + dh;
          if (next >= 24) next -= 24;
          state.setSky({ timeHours: next });
        } else if (state.dayCycle.autoNext) {
          // Auto-advance to the next period at the boundary. The
          // overshoot beyond `distToEnd` is discarded — advancing snaps
          // to the next period's startHour, matching the manual Next
          // button's behaviour and keeping instrument scheduling
          // predictable.
          state.advancePeriod();
        } else {
          // Classic loop: land at startHour + (dh - distToEnd) mod length.
          const overshoot = (dh - distToEnd) % len;
          next = period.startHour + overshoot;
          if (next >= 24) next -= 24;
          state.setSky({ timeHours: next });
        }
      }
      const { drone } = modulatedEngineParams(state, now);
      engine.update(state.sky.timeHours, drone);
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
