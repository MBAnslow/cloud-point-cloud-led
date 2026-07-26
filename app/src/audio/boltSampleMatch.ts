import type {
  BoltIntensityTag,
  BoltLengthTag,
  LightningSample,
} from "../state";

/** Flash duration (ms) → short / medium / long band. */
export function flashLengthTag(durationMs: number): BoltLengthTag {
  const d = Math.max(0, durationMs);
  if (d < 400) return "short";
  if (d < 1200) return "medium";
  return "long";
}

/** Per-strike intensity01 [0,1] → low / medium / high band. */
export function flashIntensityTag(intensity01: number): BoltIntensityTag {
  const u = intensity01 < 0 ? 0 : intensity01 > 1 ? 1 : intensity01;
  if (u < 1 / 3) return "low";
  if (u < 2 / 3) return "medium";
  return "high";
}

function hasIntensity(
  sample: LightningSample,
  tag: BoltIntensityTag,
): boolean {
  const tags = sample.intensityTags ?? [];
  // Untagged clips are usable as a last-resort fallback only.
  return tags.length > 0 && tags.includes(tag);
}

function hasLength(sample: LightningSample, tag: BoltLengthTag): boolean {
  const tags = sample.lengthTags ?? [];
  return tags.length > 0 && tags.includes(tag);
}

function isUntagged(sample: LightningSample): boolean {
  const i = sample.intensityTags ?? [];
  const l = sample.lengthTags ?? [];
  return i.length === 0 && l.length === 0;
}

/**
 * Pick a bolt sample that best matches the flash's intensity and length
 * bands. Preference order:
 * 1. both tags match
 * 2. intensity only
 * 3. length only
 * 4. untagged clips (legacy / not yet classified)
 * 5. any remaining sample
 */
export function pickBoltSample(
  samples: LightningSample[],
  intensity01: number,
  durationMs: number,
): LightningSample | null {
  if (!samples || samples.length === 0) return null;
  const needI = flashIntensityTag(intensity01);
  const needL = flashLengthTag(durationMs);

  const both = samples.filter(
    (s) => hasIntensity(s, needI) && hasLength(s, needL),
  );
  if (both.length > 0) {
    return both[Math.floor(Math.random() * both.length)];
  }

  const byIntensity = samples.filter((s) => hasIntensity(s, needI));
  if (byIntensity.length > 0) {
    return byIntensity[Math.floor(Math.random() * byIntensity.length)];
  }

  const byLength = samples.filter((s) => hasLength(s, needL));
  if (byLength.length > 0) {
    return byLength[Math.floor(Math.random() * byLength.length)];
  }

  const untagged = samples.filter(isUntagged);
  if (untagged.length > 0) {
    return untagged[Math.floor(Math.random() * untagged.length)];
  }

  return samples[Math.floor(Math.random() * samples.length)] ?? null;
}
