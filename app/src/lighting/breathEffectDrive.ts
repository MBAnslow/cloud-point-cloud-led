/**
 * Live scalar written each frame from Leds for cloud breath-mod audio.
 *
 * Uses geometric spheroid fill (strength × radial falloff), **not** the
 * fogged visual mask. Fog speckles make the painted mask average ~0.1
 * even when the sphere fully covers the cloud; geometric fill goes to
 * ~1 at the center of a full pass.
 *
 * Among LEDs inside the spheroid:
 *   fill    = mean geometric weight
 *   breadth = soft count scale (full by ~40 LEDs)
 *   drive   = fill × breadth
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

/** [0,1] geometric breath-sphere engagement from the latest LED frame. */
export function getBreathEffectDrive(): number {
  return meanEffect;
}
