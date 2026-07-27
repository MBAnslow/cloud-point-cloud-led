/**
 * Live scalar written each frame from Leds for cloud breath-mod audio.
 *
 * Mean over all LEDs of the same inhale/reveal gate used for time-of-day
 * compositing:
 *   inhaleMask = filterOn ? max(threshold, memory) : liveFoggedMask
 *   drive      = mean(inhaleMask)
 *
 * So 1 = every LED at full TOD reveal, 0 = none. Threshold raises the
 * floor constantly; breath waves temporarily raise memory as they path
 * and linger.
 */

let meanEffect = 0;

export function setBreathEffectDrive(mean01: number): void {
  meanEffect =
    !(mean01 >= 0) || !Number.isFinite(mean01)
      ? 0
      : mean01 <= 0
        ? 0
        : mean01 >= 1
          ? 1
          : mean01;
}

/** [0,1] mean LED time-of-day reveal from the latest frame. */
export function getBreathEffectDrive(): number {
  return meanEffect;
}
