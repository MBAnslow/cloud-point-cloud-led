/** Absolute peak from Tone.Meter.getValue() (scalar or stereo array). */
export function meterAbs(v: number | number[]): number {
  if (typeof v === "number") return Math.max(0, Math.abs(v));
  let m = 0;
  for (const x of v) m = Math.max(m, Math.abs(x));
  return m;
}
