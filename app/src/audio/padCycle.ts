import type { PadNote } from "../state";

export interface ActivePadVoice {
  /** Stable id — one voice per PadNote so overlapping same pitch works. */
  id: string;
  note: string;
  /** Per-note gain, [0, 1]. Resolves to 1 when unset. */
  gain: number;
  /** Per-note pitch offset in cents. Resolves to 0 when unset. */
  detuneCents: number;
}

function normalizeHour(hour: number): number {
  const h = hour % 24;
  return h < 0 ? h + 24 : h;
}

/**
 * Notes currently "on" at the given hour, using the same
 * `startHour <= h < endHour` rule as the drone track. Wrap-around
 * across midnight is not supported — draw two notes for that.
 */
export function activePadVoicesAt(
  notes: PadNote[],
  hour: number,
): ActivePadVoice[] {
  const h = normalizeHour(hour);
  const out: ActivePadVoice[] = [];
  for (const n of notes) {
    if (h >= n.startHour && h < n.endHour) {
      out.push({
        id: n.id,
        note: n.note,
        gain: Math.max(0, Math.min(1, n.gain ?? 1)),
        detuneCents: n.detuneCents ?? 0,
      });
    }
  }
  return out;
}
