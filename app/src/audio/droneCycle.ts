import { resolveNoteFx, type DroneNote, type NoteFx } from "../state";

export interface ActiveVoice {
  /** Stable id — one voice per DroneNote so overlapping same pitch works. */
  id: string;
  note: string;
  /** Fully-resolved per-note effect params (never undefined). */
  fx: NoteFx;
}

function normalizeHour(hour: number): number {
  const h = hour % 24;
  return h < 0 ? h + 24 : h;
}

/**
 * Return the list of notes currently "on" at the given hour. A note
 * is on when `startHour <= hour < endHour`. Wrap-around notes are
 * drawn as two segments by the user rather than wrapped implicitly.
 */
export function activeVoicesAt(
  notes: DroneNote[],
  hour: number,
): ActiveVoice[] {
  const h = normalizeHour(hour);
  const out: ActiveVoice[] = [];
  for (const n of notes) {
    if (h >= n.startHour && h < n.endHour) {
      out.push({ id: n.id, note: n.note, fx: resolveNoteFx(n) });
    }
  }
  return out;
}
