import { useSimStore } from "../state";

const HOURS = 24;

/**
 * Semi-transparent band drawn over an existing 24h scrubber ruler
 * showing where the active day period sits. For wrap-around periods
 * (endHour < startHour) it renders two segments. Place inside the
 * scrubber's positioned container.
 */
export function ActivePeriodBand({ opacity = 0.35 }: { opacity?: number }) {
  const dayCycle = useSimStore((s) => s.dayCycle);
  const active = dayCycle.periods.find((p) => p.id === dayCycle.activePeriodId);
  if (!active) return null;
  const spans: Array<[number, number]> =
    active.endHour >= active.startHour
      ? [[active.startHour, active.endHour]]
      : [
          [active.startHour, 24],
          [0, active.endHour],
        ];
  return (
    <>
      {spans.map(([a, b], i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${(a / HOURS) * 100}%`,
            width: `${((b - a) / HOURS) * 100}%`,
            background: `${active.color}`,
            opacity,
            pointerEvents: "none",
          }}
        />
      ))}
    </>
  );
}

/**
 * Prev / period-name / next transport buttons for embedding in an
 * instrument panel header. Advancing snaps `sky.timeHours` to the new
 * period's startHour (state does the snapping).
 */
export function PeriodTransportButtons() {
  const dayCycle = useSimStore((s) => s.dayCycle);
  const advancePeriod = useSimStore((s) => s.advancePeriod);
  const previousPeriod = useSimStore((s) => s.previousPeriod);
  const active = dayCycle.periods.find((p) => p.id === dayCycle.activePeriodId);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 6px",
        borderRadius: 4,
        border: `1px solid ${active?.color ?? "rgba(255,255,255,0.2)"}55`,
        background: `${active?.color ?? "#888"}22`,
      }}
      title="Loops inside the active period. Click Next to advance."
    >
      <button onClick={previousPeriod} style={btn} title="Previous period">
        ◀
      </button>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: active?.color ?? "inherit",
          minWidth: 46,
          textAlign: "center",
        }}
      >
        {active?.name ?? "—"}
      </span>
      <button onClick={advancePeriod} style={btn} title="Next period">
        ▶
      </button>
    </div>
  );
}

const btn: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  color: "rgba(207,214,230,0.95)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 3,
  padding: "1px 6px",
  fontSize: 10,
  cursor: "pointer",
  lineHeight: 1.2,
};
