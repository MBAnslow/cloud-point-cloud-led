import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useSimStore,
  periodContainsHour,
  periodLengthHours,
  type DayPeriod,
} from "../state";

const HOURS = 24;
const BAR_HEIGHT = 28;
const HANDLE_WIDTH = 8;

/**
 * Day-cycle control. Shows a horizontal 24h bar with the four (or
 * more) named periods drawn as coloured segments. The clock loops
 * inside whichever period is active; the user manually advances with
 * the Prev / Next buttons or by clicking on a segment. Drag the shared
 * edges between periods to move boundaries. Wrap-around periods (like
 * Night 20 → 5) render as two coupled segments.
 */
export function DayCyclePanel() {
  const dayCycle = useSimStore((s) => s.dayCycle);
  const timeHours = useSimStore((s) => s.sky.timeHours);
  const setActivePeriod = useSimStore((s) => s.setActivePeriod);
  const advancePeriod = useSimStore((s) => s.advancePeriod);
  const previousPeriod = useSimStore((s) => s.previousPeriod);
  const updateDayPeriod = useSimStore((s) => s.updateDayPeriod);

  const barRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{
    // The period whose endHour is being dragged, coupled to the next
    // period's startHour so segments stay contiguous.
    leftPeriodId: string;
    rightPeriodId: string;
  } | null>(null);

  const activePeriod = useMemo(
    () => dayCycle.periods.find((p) => p.id === dayCycle.activePeriodId),
    [dayCycle],
  );

  // For display, each period may contribute one or two rectangles
  // depending on whether it wraps midnight.
  const segments = useMemo(() => segmentsForPeriods(dayCycle.periods), [dayCycle.periods]);

  const clientToHour = useCallback((clientX: number): number => {
    const el = barRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    return (x / rect.width) * HOURS;
  }, []);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const raw = clientToHour(e.clientX);
      // Clamp so neither adjacent segment collapses to zero.
      const left = dayCycle.periods.find((p) => p.id === drag.leftPeriodId);
      const right = dayCycle.periods.find((p) => p.id === drag.rightPeriodId);
      if (!left || !right) return;
      const MIN = 0.1;
      const clamped = clampBoundary(raw, left, right, MIN);
      updateDayPeriod(left.id, { endHour: clamped });
      updateDayPeriod(right.id, { startHour: clamped });
    };
    const onUp = () => setDrag(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, clientToHour, dayCycle.periods, updateDayPeriod]);

  const progress = activePeriod ? periodProgress(activePeriod, timeHours) : 0;

  return (
    <div style={panelStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={previousPeriod} style={btnStyle} title="Previous period">
          ◀
        </button>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: activePeriod?.color ?? "inherit",
            minWidth: 60,
            letterSpacing: 0.3,
          }}
        >
          {activePeriod?.name ?? "—"}
        </div>
        <button onClick={advancePeriod} style={btnStyle} title="Next period">
          Next ▶
        </button>
        <span
          style={{
            marginLeft: 4,
            fontSize: 11,
            opacity: 0.7,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {activePeriod
            ? `${(progress * periodLengthHours(activePeriod)).toFixed(2)}h / ${periodLengthHours(activePeriod).toFixed(2)}h`
            : ""}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 10, opacity: 0.55 }}>
          Drag segment edges to reshape · click a segment to activate
        </span>
      </div>

      {/* 24h coloured bar. */}
      <div
        ref={barRef}
        style={{
          position: "relative",
          height: BAR_HEIGHT,
          marginTop: 6,
          background: "rgba(0,0,0,0.35)",
          borderRadius: 4,
          border: "1px solid rgba(255,255,255,0.15)",
          userSelect: "none",
        }}
      >
        {segments.map((seg) => {
          const p = dayCycle.periods.find((x) => x.id === seg.periodId)!;
          const isActive = p.id === dayCycle.activePeriodId;
          return (
            <div
              key={seg.key}
              onClick={() => setActivePeriod(p.id)}
              style={{
                position: "absolute",
                left: `${(seg.startHour / HOURS) * 100}%`,
                width: `${((seg.endHour - seg.startHour) / HOURS) * 100}%`,
                top: 0,
                bottom: 0,
                background: `${p.color}${isActive ? "cc" : "55"}`,
                borderTop: isActive
                  ? "2px solid rgba(255,255,255,0.9)"
                  : "1px solid rgba(255,255,255,0.15)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                fontWeight: 600,
                color: "rgba(20,15,10,0.95)",
                overflow: "hidden",
                whiteSpace: "nowrap",
              }}
              title={`${p.name}  ${p.startHour.toFixed(2)}h → ${p.endHour.toFixed(2)}h`}
            >
              {seg.endHour - seg.startHour > 1.4 ? p.name : ""}
            </div>
          );
        })}
        {/* Boundary drag handles — one per shared edge between periods (in
            declared cyclic order). Each handle sits at endHour of `left`
            (== startHour of `right`). */}
        {dayCycle.periods.map((p, i) => {
          const next = dayCycle.periods[(i + 1) % dayCycle.periods.length];
          if (!next) return null;
          const edge = p.endHour;
          return (
            <div
              key={`edge-${p.id}`}
              onPointerDown={(e) => {
                setDrag({ leftPeriodId: p.id, rightPeriodId: next.id });
                (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
                e.stopPropagation();
                e.preventDefault();
              }}
              style={{
                position: "absolute",
                left: `calc(${(edge / HOURS) * 100}% - ${HANDLE_WIDTH / 2}px)`,
                top: 0,
                bottom: 0,
                width: HANDLE_WIDTH,
                cursor: "ew-resize",
                background: "transparent",
              }}
              title="Drag to move boundary"
            >
              <div
                style={{
                  position: "absolute",
                  left: HANDLE_WIDTH / 2 - 1,
                  top: 0,
                  bottom: 0,
                  width: 2,
                  background: "rgba(255,255,255,0.55)",
                }}
              />
            </div>
          );
        })}
        {/* Hour ticks at 0/6/12/18. */}
        {[0, 6, 12, 18].map((h) => (
          <div
            key={h}
            style={{
              position: "absolute",
              left: `${(h / HOURS) * 100}%`,
              top: 0,
              bottom: 0,
              width: 1,
              background: "rgba(255,255,255,0.15)",
              pointerEvents: "none",
            }}
          />
        ))}
        {/* Playhead. */}
        <div
          style={{
            position: "absolute",
            left: `${(timeHours / HOURS) * 100}%`,
            top: -2,
            bottom: -2,
            width: 2,
            background: "#ffe14d",
            boxShadow: "0 0 4px #ffe14d",
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
}

interface Segment {
  key: string;
  periodId: string;
  startHour: number;
  endHour: number;
}

/**
 * Expand each period into 1 or 2 draw-segments so wrap-around periods
 * (endHour < startHour) show as two rectangles hugging both edges of
 * the 24h axis.
 */
function segmentsForPeriods(periods: DayPeriod[]): Segment[] {
  const out: Segment[] = [];
  for (const p of periods) {
    if (p.endHour >= p.startHour) {
      out.push({
        key: `${p.id}-a`,
        periodId: p.id,
        startHour: p.startHour,
        endHour: p.endHour,
      });
    } else {
      out.push({
        key: `${p.id}-a`,
        periodId: p.id,
        startHour: p.startHour,
        endHour: 24,
      });
      out.push({
        key: `${p.id}-b`,
        periodId: p.id,
        startHour: 0,
        endHour: p.endHour,
      });
    }
  }
  return out;
}

/**
 * Progress through the active period as a [0, 1] fraction. Handles
 * wrap-around periods by measuring along the cyclic axis.
 */
function periodProgress(p: DayPeriod, hour: number): number {
  if (!periodContainsHour(p, hour)) return 0;
  const len = periodLengthHours(p);
  if (len <= 0) return 0;
  const h = ((hour % 24) + 24) % 24;
  const elapsed =
    p.endHour >= p.startHour
      ? h - p.startHour
      : h >= p.startHour
        ? h - p.startHour
        : 24 - p.startHour + h;
  return Math.max(0, Math.min(1, elapsed / len));
}

/**
 * Constrain a proposed shared-boundary hour so it can't invert or
 * collapse either adjacent period. `left.endHour` and `right.startHour`
 * are being coupled to the returned value.
 */
function clampBoundary(
  proposed: number,
  left: DayPeriod,
  right: DayPeriod,
  minLen: number,
): number {
  // Simple, non-wrap-safe clamp: the boundary must sit strictly between
  // the two periods' *other* edges. Since periods are ordered cyclically
  // in `periods[]`, we use `right.endHour` as the far end.
  const near = left.startHour;
  const far = right.endHour;
  const bounded = clampCyclic(proposed, near + minLen, far - minLen);
  // If the far edge itself wraps past midnight, allow the boundary to
  // wrap too; clampCyclic returns the raw modulo already.
  return bounded;
}

function clampCyclic(v: number, lo: number, hi: number): number {
  const n = ((v % 24) + 24) % 24;
  // When lo < hi in raw 24h terms this is just standard clamp.
  if (hi > lo) return Math.max(lo, Math.min(hi, n));
  // Otherwise the valid arc wraps midnight; keep the proposed value
  // as-is when it's inside that arc, else snap to the nearest edge.
  if (n >= lo || n <= hi) return n;
  return Math.abs(n - lo) < Math.abs(n - hi) ? lo : hi;
}

const panelStyle: React.CSSProperties = {
  position: "fixed",
  top: 56,
  left: 12,
  right: 300,
  zIndex: 15,
  background: "rgba(10, 12, 20, 0.82)",
  backdropFilter: "blur(8px)",
  color: "rgba(207,214,230,0.95)",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.12)",
  fontFamily:
    "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
};

const btnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  color: "rgba(207,214,230,0.95)",
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 4,
  padding: "3px 8px",
  fontSize: 11,
  cursor: "pointer",
};
