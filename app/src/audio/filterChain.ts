import * as Tone from "tone";
import type { FilterChain } from "../state";

/**
 * Ramp a paired HPF+LPF Tone.Filter chain from a FilterChain slice.
 * When a slot is disabled, the frequency is snapped to the audible
 * extreme (10 Hz for HPF, 22 kHz for LPF) which is effectively a
 * bypass without disconnecting the graph — cheaper than repatching
 * every frame and glitch-free.
 */
export function applyFilterChain(
  hp: Tone.Filter | null,
  lp: Tone.Filter | null,
  fx: FilterChain,
): void {
  const finite = (value: number, fallback: number) =>
    Number.isFinite(value) ? value : fallback;
  if (hp) {
    const target = fx.hp.enabled
      ? Math.max(10, Math.min(22000, finite(fx.hp.hz, 10)))
      : 10;
    hp.frequency.rampTo(target, 0.05);
    hp.Q.rampTo(Math.max(0.1, Math.min(20, finite(fx.hp.q, 0.7))), 0.05);
  }
  if (lp) {
    const target = fx.lp.enabled
      ? Math.max(10, Math.min(22000, finite(fx.lp.hz, 22000)))
      : 22000;
    lp.frequency.rampTo(target, 0.05);
    lp.Q.rampTo(Math.max(0.1, Math.min(20, finite(fx.lp.q, 0.7))), 0.05);
  }
}
