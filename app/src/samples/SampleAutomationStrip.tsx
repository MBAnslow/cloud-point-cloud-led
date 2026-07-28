import { useCallback, useMemo, useRef, useState } from "react";
import {
  clampSampleAutoValue,
  SAMPLE_AUTO_PARAMS,
  type Sample,
  type SampleAutoParam,
  type SampleAutoPoint,
} from "../state";
import {
  autoValueFromYFrac,
  autoYFracFromValue,
  SAMPLE_AUTO_LABELS,
  sampleTrackAutomation,
  sortedAutoPoints,
} from "../audio/sampleAutomation";

const HOURS = 24;

interface Props {
  sample: Sample;
  param: SampleAutoParam;
  onParamChange: (p: SampleAutoParam) => void;
  onChangeTrack: (patch: Partial<Sample>) => void;
  playheadHour: number;
  height: number;
}

function newPointId(): string {
  return `ap-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
}

/**
 * Day-timeline automation editor for one sample track: param tabs,
 * polyline + draggable points, clear. Empty lane = static knob.
 */
export function SampleAutomationStrip({
  sample,
  param,
  onParamChange,
  onChangeTrack,
  playheadHour,
  height,
}: Props) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const points = useMemo(
    () => sortedAutoPoints(sample, param),
    [sample, param],
  );
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const hasPoints = points.length > 0;

  const setPoints = useCallback(
    (next: SampleAutoPoint[]) => {
      pointsRef.current = next;
      const automation = { ...sample.automation };
      if (next.length === 0) delete automation[param];
      else automation[param] = next;
      onChangeTrack({ automation });
    },
    [onChangeTrack, param, sample.automation],
  );

  const clientToHourValue = useCallback(
    (clientX: number, clientY: number): { hour: number; value: number } | null => {
      const el = stripRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      const x = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      const y = Math.max(0, Math.min(1, (clientY - r.top) / r.height));
      return {
        hour: x * HOURS,
        value: autoValueFromYFrac(param, y),
      };
    },
    [param],
  );

  const onStripPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).dataset.autoPoint) return;
    e.preventDefault();
    e.stopPropagation();
    const hv = clientToHourValue(e.clientX, e.clientY);
    if (!hv) return;
    const id = newPointId();
    // First point on an empty lane seeds at the knob value so a casual
    // click can't silently zero gain/filter. Drag afterward to shape.
    const value =
      pointsRef.current.length === 0
        ? sampleTrackAutomation(sample, hv.hour, param)
        : hv.value;
    const next = [
      ...pointsRef.current,
      { id, hour: hv.hour, value },
    ];
    setPoints(next);
    setDragId(id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onStripPointerMove = (e: React.PointerEvent) => {
    if (!dragId) return;
    const hv = clientToHourValue(e.clientX, e.clientY);
    if (!hv) return;
    setPoints(
      pointsRef.current.map((p) =>
        p.id === dragId
          ? {
              ...p,
              hour: hv.hour,
              value: clampSampleAutoValue(param, hv.value),
            }
          : p,
      ),
    );
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!dragId) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    setDragId(null);
  };

  const deletePoint = (id: string) => {
    setPoints(points.filter((p) => p.id !== id));
  };

  const clearLane = () => setPoints([]);

  // Polyline path in % coords.
  const poly = useMemo(() => {
      if (points.length === 0) {
      const y = autoYFracFromValue(param, sample[param]);
      return `0,${y * 100} 100,${y * 100}`;
    }
    // Draw wrapping: include last→first across midnight as dashed via full path
    // by plotting sorted points only within [0,24]; wrap segment drawn separately.
    const coords = points.map((p) => {
      const x = (p.hour / HOURS) * 100;
      const y = autoYFracFromValue(param, p.value) * 100;
      return `${x},${y}`;
    });
    return coords.join(" ");
  }, [param, points, sample]);

  const wrapSegment = useMemo(() => {
    if (points.length < 2) return null;
    const first = points[0];
    const last = points[points.length - 1];
    const span = first.hour + HOURS - last.hour;
    if (span <= 1e-9) return null;
    const tAt24 = (HOURS - last.hour) / span;
    // Value approaching midnight from last toward first.
    const yMid =
      autoYFracFromValue(
        param,
        last.value + (first.value - last.value) * Math.max(0, Math.min(1, tAt24)),
      ) * 100;
    // For log params this is approximate on the wrap edge only; fine for guide.
    const x0 = (last.hour / HOURS) * 100;
    const y0 = autoYFracFromValue(param, last.value) * 100;
    const x1 = (first.hour / HOURS) * 100;
    const y1 = autoYFracFromValue(param, first.value) * 100;
    return { x0, y0, x1, y1, yMid };
  }, [param, points]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "0 4px",
          height: 20,
          flexShrink: 0,
        }}
      >
        {SAMPLE_AUTO_PARAMS.map((p) => {
          const active = p === param;
          const n = sample.automation?.[p]?.length ?? 0;
          return (
            <button
              key={p}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onParamChange(p);
              }}
              style={{
                fontSize: 9,
                padding: "1px 5px",
                borderRadius: 3,
                border: active
                  ? "1px solid rgba(251,146,60,0.8)"
                  : "1px solid rgba(255,255,255,0.12)",
                background: active
                  ? "rgba(251,146,60,0.25)"
                  : "rgba(255,255,255,0.04)",
                color: "inherit",
                cursor: "pointer",
                opacity: n > 0 || active ? 1 : 0.55,
              }}
              title={`${SAMPLE_AUTO_LABELS[p]} automation${n ? ` (${n})` : ""}`}
            >
              {SAMPLE_AUTO_LABELS[p]}
              {n > 0 ? "·" : ""}
            </button>
          );
        })}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            clearLane();
          }}
          disabled={!hasPoints}
          style={{
            marginLeft: "auto",
            fontSize: 9,
            padding: "1px 5px",
            borderRadius: 3,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "transparent",
            color: "inherit",
            cursor: hasPoints ? "pointer" : "default",
            opacity: hasPoints ? 0.8 : 0.3,
          }}
          title="Clear this automation lane (revert to knob)"
        >
          Clear
        </button>
      </div>
      <div
        ref={stripRef}
        onPointerDown={onStripPointerDown}
        onPointerMove={onStripPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        title="Click to add · drag points · alt/double-click to delete"
        style={{
          position: "relative",
          flex: 1,
          minHeight: height - 20,
          background: hasPoints
            ? "rgba(251,146,60,0.08)"
            : "rgba(255,255,255,0.03)",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          cursor: "crosshair",
          touchAction: "none",
        }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          <polyline
            points={poly}
            fill="none"
            stroke={
              hasPoints
                ? "rgba(251,146,60,0.9)"
                : "rgba(255,255,255,0.25)"
            }
            strokeWidth={hasPoints ? 1.2 : 0.8}
            vectorEffect="non-scaling-stroke"
          />
          {wrapSegment && (
            <>
              <polyline
                points={`${wrapSegment.x0},${wrapSegment.y0} 100,${wrapSegment.yMid}`}
                fill="none"
                stroke="rgba(251,146,60,0.45)"
                strokeWidth={1}
                strokeDasharray="2 2"
                vectorEffect="non-scaling-stroke"
              />
              <polyline
                points={`0,${wrapSegment.yMid} ${wrapSegment.x1},${wrapSegment.y1}`}
                fill="none"
                stroke="rgba(251,146,60,0.45)"
                strokeWidth={1}
                strokeDasharray="2 2"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>
        {/* Playhead */}
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${(((playheadHour % HOURS) + HOURS) % HOURS / HOURS) * 100}%`,
            width: 1,
            background: "rgba(255,225,77,0.7)",
            pointerEvents: "none",
          }}
        />
        {points.map((p) => {
          const left = (p.hour / HOURS) * 100;
          const top = autoYFracFromValue(param, p.value) * 100;
          return (
            <div
              key={p.id}
              data-auto-point="1"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.altKey) {
                  deletePoint(p.id);
                  return;
                }
                setDragId(p.id);
                stripRef.current?.setPointerCapture(e.pointerId);
              }}
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                deletePoint(p.id);
              }}
              style={{
                position: "absolute",
                left: `${left}%`,
                top: `${top}%`,
                width: 10,
                height: 10,
                marginLeft: -5,
                marginTop: -5,
                borderRadius: "50%",
                background:
                  dragId === p.id
                    ? "#fff"
                    : "rgba(251,146,60,0.95)",
                border: "1px solid rgba(0,0,0,0.5)",
                cursor: "grab",
                zIndex: 2,
                boxSizing: "border-box",
              }}
              title={`${SAMPLE_AUTO_LABELS[param]} @ ${p.hour.toFixed(2)}h = ${
                param === "filterHz"
                  ? `${Math.round(p.value)} Hz`
                  : p.value.toFixed(2)
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}
