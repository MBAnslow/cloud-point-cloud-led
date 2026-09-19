import { useEffect, useMemo, useRef, useState } from "react";
import {
  PAD_KEYFRAME_PARAMS,
  type PadKeyframe,
  type PadKeyframeParam,
  type PadParams,
} from "../state";
import {
  PAD_AUTOMATION_META,
  clampPadKeyframeValue,
  samplePadParamAutomation,
  sortedPadKeyframes,
} from "../audio/padAutomation";
import { confirmDestructiveClear } from "../components/confirmDestructiveClear";

const HOURS = 24;
const PLOT_HEIGHT = 88;
const VALUE_TOP_FRAC = 0.08;
const VALUE_SPAN_FRAC = 0.7;
const PIANO_GUTTER_WIDTH = 56;

interface MarqueeSelection {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface Props {
  pad: PadParams;
  playheadHour: number;
  selectedId: string | null;
  selectedParam: PadKeyframeParam;
  followPlayhead: boolean;
  timelineWidth: number;
  scrollLeft: number;
  snapHours: number;
  onSelectedIdChange: (id: string | null) => void;
  onSelectedParamChange: (param: PadKeyframeParam) => void;
  onFollowPlayheadChange: (follow: boolean) => void;
  onKeyframesChange: (keyframes: PadKeyframe[]) => void;
  onScrollLeftChange: (scrollLeft: number) => void;
}

function newKeyframeId(): string {
  return `pad-kf-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
}

function fmtTime(hour: number): string {
  const h = ((hour % HOURS) + HOURS) % HOURS;
  const totalMinutes = Math.round(h * 60) % (HOURS * 60);
  const whole = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${whole.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}`;
}

function valueFraction(param: PadKeyframeParam, value: number): number {
  const meta = PAD_AUTOMATION_META[param];
  const v = clampPadKeyframeValue(param, value);
  if (meta.log) {
    const lo = Math.log(meta.min);
    const hi = Math.log(meta.max);
    return (Math.log(v) - lo) / Math.max(1e-9, hi - lo);
  }
  return (v - meta.min) / Math.max(1e-9, meta.max - meta.min);
}

function valueFromFraction(param: PadKeyframeParam, fraction: number): number {
  const meta = PAD_AUTOMATION_META[param];
  const t = Math.max(0, Math.min(1, fraction));
  const raw = meta.log
    ? Math.exp(Math.log(meta.min) + (Math.log(meta.max) - Math.log(meta.min)) * t)
    : meta.min + (meta.max - meta.min) * t;
  const steps = Math.round((raw - meta.min) / meta.step);
  return clampPadKeyframeValue(param, meta.min + steps * meta.step);
}

export function PadKeyframeEditor({
  pad,
  playheadHour,
  selectedId,
  selectedParam,
  followPlayhead,
  timelineWidth,
  scrollLeft,
  snapHours,
  onSelectedIdChange,
  onSelectedParamChange,
  onFollowPlayheadChange,
  onKeyframesChange,
  onScrollLeftChange,
}: Props) {
  const plotRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [marquee, setMarquee] = useState<MarqueeSelection | null>(null);
  const marqueeIdsRef = useRef<Set<string>>(new Set());
  const frames = useMemo(
    () => sortedPadKeyframes(pad.keyframes, selectedParam),
    [pad.keyframes, selectedParam],
  );
  const selected =
    pad.keyframes.find((frame) => frame.id === selectedId) ?? null;
  const meta = PAD_AUTOMATION_META[selectedParam];
  const selectionCount =
    selectedIds.size > 0 ? selectedIds.size : selected ? 1 : 0;

  useEffect(() => {
    if (
      selectedId &&
      !pad.keyframes.some(
        (frame) =>
          frame.id === selectedId && frame.param === selectedParam,
      )
    ) {
      onSelectedIdChange(null);
    }
  }, [onSelectedIdChange, pad.keyframes, selectedId, selectedParam]);

  useEffect(() => {
    setSelectedIds(new Set());
    setMarquee(null);
  }, [selectedParam]);

  useEffect(() => {
    const validIds = new Set(frames.map((frame) => frame.id));
    setSelectedIds((previous) => {
      const next = new Set(
        [...previous].filter((id) => validIds.has(id)),
      );
      return next.size === previous.size ? previous : next;
    });
  }, [frames]);

  useEffect(() => {
    if (selectedId && !selectedIds.has(selectedId)) {
      const frame = pad.keyframes.find(
        (item) => item.id === selectedId && item.param === selectedParam,
      );
      if (frame) setSelectedIds(new Set([selectedId]));
    }
  }, [pad.keyframes, selectedId, selectedIds, selectedParam]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element && Math.abs(element.scrollLeft - scrollLeft) > 1) {
      element.scrollLeft = scrollLeft;
    }
  }, [scrollLeft, timelineWidth]);

  const curvePoints = useMemo(() => {
    const point = (hour: number, value: number) => {
      const y =
        (VALUE_TOP_FRAC +
          (1 - valueFraction(selectedParam, value)) * VALUE_SPAN_FRAC) *
        100;
      return `${(hour / HOURS) * 100},${y}`;
    };
    const base = clampPadKeyframeValue(selectedParam, pad[selectedParam]);
    if (frames.length === 0) {
      return `${point(0, base)} ${point(HOURS, base)}`;
    }
    const points: string[] = [point(0, base)];
    const first = frames[0];
    if (first.hour > 0) points.push(point(first.hour, base));
    // Duplicate X at the first point intentionally shows the base→lane
    // change as a vertical edge instead of altering the earlier track.
    points.push(point(first.hour, first.value));
    for (let i = 1; i < frames.length; i++) {
      points.push(point(frames[i].hour, frames[i].value));
    }
    points.push(point(HOURS, frames[frames.length - 1].value));
    return points.join(" ");
  }, [frames, pad, selectedParam]);

  const snapHour = (hour: number): number => {
    const normalized = ((hour % HOURS) + HOURS) % HOURS;
    if (snapHours <= 0) return normalized;
    return (Math.round(normalized / snapHours) * snapHours) % HOURS;
  };

  const plotFractionAt = (clientX: number, clientY: number) => {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  };

  const beginMarquee = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;
    const point = plotFractionAt(event.clientX, event.clientY);
    const next = {
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
    };
    marqueeIdsRef.current = new Set();
    setSelectedIds(new Set());
    setMarquee(next);
    onSelectedIdChange(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const updateMarquee = (clientX: number, clientY: number) => {
    if (!marquee) return;
    const point = plotFractionAt(clientX, clientY);
    const next = {
      ...marquee,
      currentX: point.x,
      currentY: point.y,
    };
    const minX = Math.min(next.startX, next.currentX);
    const maxX = Math.max(next.startX, next.currentX);
    const minY = Math.min(next.startY, next.currentY);
    const maxY = Math.max(next.startY, next.currentY);
    const ids = new Set(
      frames
        .filter((frame) => {
          const x = frame.hour / HOURS;
          const y =
            VALUE_TOP_FRAC +
            (1 - valueFraction(selectedParam, frame.value)) *
              VALUE_SPAN_FRAC;
          return x >= minX && x <= maxX && y >= minY && y <= maxY;
        })
        .map((frame) => frame.id),
    );
    marqueeIdsRef.current = ids;
    setSelectedIds(ids);
    setMarquee(next);
  };

  const finishPointerInteraction = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (dragId) {
      setDragId(null);
      return;
    }
    if (!marquee) return;
    const ids = [...marqueeIdsRef.current];
    onSelectedIdChange(ids[0] ?? null);
    setMarquee(null);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
  };

  const addAtPlayhead = () => {
    const hour = snapHour(playheadHour);
    const value = samplePadParamAutomation(pad, selectedParam, hour);
    const existing = frames.find(
      (frame) => Math.abs(frame.hour - hour) < 1e-6,
    );
    if (existing) {
      updateFrame(existing.id, { value });
      setSelectedIds(new Set([existing.id]));
      onSelectedIdChange(existing.id);
      return;
    }
    const frame: PadKeyframe = {
      id: newKeyframeId(),
      hour,
      param: selectedParam,
      value,
    };
    onKeyframesChange(sortedPadKeyframes([...pad.keyframes, frame]));
    setSelectedIds(new Set([frame.id]));
    onSelectedIdChange(frame.id);
  };

  const updateFrame = (id: string, patch: Partial<PadKeyframe>) => {
    onKeyframesChange(
      sortedPadKeyframes(
        pad.keyframes.map((frame) =>
          frame.id === id ? { ...frame, ...patch } : frame,
        ),
      ),
    );
  };

  const updateDrag = (clientX: number, clientY: number) => {
    if (!dragId || !plotRef.current) return;
    const frame = pad.keyframes.find((item) => item.id === dragId);
    if (!frame) return;
    const rect = plotRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const plotY = Math.max(
      0,
      Math.min(1, (clientY - rect.top) / rect.height),
    );
    const hour = snapHour(x * HOURS);
    const valueY = Math.max(
      0,
      Math.min(1, (plotY - VALUE_TOP_FRAC) / VALUE_SPAN_FRAC),
    );
    const value = valueFromFraction(selectedParam, 1 - valueY);
    updateFrame(frame.id, {
      hour,
      value,
    });
  };

  const deleteSelected = () => {
    const ids =
      selectedIds.size > 0
        ? selectedIds
        : selected
          ? new Set([selected.id])
          : new Set<string>();
    if (ids.size === 0) return;
    const remaining = pad.keyframes.filter(
      (frame) => !ids.has(frame.id),
    );
    onKeyframesChange(remaining);
    setSelectedIds(new Set());
    onSelectedIdChange(null);
    onFollowPlayheadChange(remaining.length > 0);
  };

  const clearAll = () => {
    if (
      pad.keyframes.length > 0 &&
      confirmDestructiveClear(`all ${pad.keyframes.length} pad keyframes`)
    ) {
      onKeyframesChange([]);
      setSelectedIds(new Set());
      onSelectedIdChange(null);
      onFollowPlayheadChange(false);
    }
  };

  const clearCurve = () => {
    if (
      frames.length > 0 &&
      confirmDestructiveClear(`all ${meta.label} pad keyframes`)
    ) {
      onKeyframesChange(
        pad.keyframes.filter((frame) => frame.param !== selectedParam),
      );
      setSelectedIds(new Set());
      onSelectedIdChange(null);
      onFollowPlayheadChange(
        pad.keyframes.some((frame) => frame.param !== selectedParam),
      );
    }
  };

  return (
    <section style={sectionStyle}>
      <div style={toolbarStyle}>
        <strong style={{ fontSize: 12 }}>Pad keyframes</strong>
        <span style={{ fontSize: 10, opacity: 0.55 }}>
          Independent 24-hour parameter automation
        </span>
        <label style={toolbarLabelStyle}>
          Curve
          <select
            value={selectedParam}
            onChange={(event) => {
              onSelectedParamChange(
                event.target.value as PadKeyframeParam,
              );
              if (selectedId) {
                onSelectedIdChange(null);
                onFollowPlayheadChange(pad.keyframes.length > 0);
              }
            }}
            style={selectStyle}
          >
            {PAD_KEYFRAME_PARAMS.map((param) => (
              <option key={param} value={param}>
                {PAD_AUTOMATION_META[param].label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" style={buttonStyle} onClick={addAtPlayhead}>
          + {meta.label} keyframe at {fmtTime(playheadHour)}
        </button>
        <button
          type="button"
          style={{
            ...buttonStyle,
            borderColor:
              followPlayhead && !selected
                ? "rgba(255,225,77,0.8)"
                : undefined,
            background:
              followPlayhead && !selected
                ? "rgba(255,225,77,0.18)"
                : undefined,
          }}
          onClick={() => {
            onSelectedIdChange(null);
            onFollowPlayheadChange(true);
          }}
          disabled={pad.keyframes.length === 0}
          title={
            pad.keyframes.length > 0
              ? "Show the interpolated pad values at the current playhead"
              : "Add a keyframe to enable interpolated live values"
          }
        >
          Live values
        </button>
        <button
          type="button"
          style={{
            ...buttonStyle,
            borderColor:
              !followPlayhead && !selected
                ? "rgba(192,132,252,0.75)"
                : undefined,
            background:
              !followPlayhead && !selected
                ? "rgba(192,132,252,0.25)"
                : undefined,
          }}
          onClick={() => {
            onSelectedIdChange(null);
            onFollowPlayheadChange(false);
          }}
          title="Edit the static base patch instead of a keyframe"
        >
          Base patch
        </button>
        <button
          type="button"
          style={buttonStyle}
          disabled={selectionCount === 0}
          onClick={deleteSelected}
        >
          Delete selected{selectionCount > 1 ? ` (${selectionCount})` : ""}
        </button>
        <button
          type="button"
          style={buttonStyle}
          disabled={frames.length === 0}
          onClick={clearCurve}
        >
          Clear curve
        </button>
        <button
          type="button"
          style={{ ...buttonStyle, marginLeft: "auto" }}
          disabled={pad.keyframes.length === 0}
          onClick={clearAll}
        >
          Clear all
        </button>
      </div>

      <div
        ref={scrollRef}
        onScroll={(event) =>
          onScrollLeftChange(event.currentTarget.scrollLeft)
        }
        style={timelineScrollStyle}
      >
        <div style={timelineGutterStyle}>
          <span>{meta.label}</span>
        </div>
        <div
          ref={plotRef}
          onPointerDown={beginMarquee}
          onPointerMove={(event) => {
            if (dragId) updateDrag(event.clientX, event.clientY);
            else updateMarquee(event.clientX, event.clientY);
          }}
          onPointerUp={finishPointerInteraction}
          onPointerCancel={(event) => {
            setDragId(null);
            setMarquee(null);
            try {
              event.currentTarget.releasePointerCapture(event.pointerId);
            } catch {
              /* already released */
            }
          }}
          style={{ ...plotStyle, width: timelineWidth }}
          title="Drag empty space to box-select points; drag a point to edit its time and value"
        >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          width="100%"
          height="100%"
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          {[0, 6, 12, 18, 24].map((hour) => (
            <line
              key={hour}
              x1={(hour / HOURS) * 100}
              x2={(hour / HOURS) * 100}
              y1={0}
              y2={100}
              stroke="rgba(255,255,255,0.09)"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <polyline
            points={curvePoints}
            fill="none"
            stroke="#c084fc"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        <div
          style={{
            position: "absolute",
            left: `${((((playheadHour % HOURS) + HOURS) % HOURS) / HOURS) * 100}%`,
            top: 0,
            bottom: 0,
            width: 2,
            background: "#ffe14d",
            pointerEvents: "none",
          }}
        />

        {marquee && (
          <div
            style={{
              position: "absolute",
              left: `${Math.min(marquee.startX, marquee.currentX) * 100}%`,
              top: `${Math.min(marquee.startY, marquee.currentY) * 100}%`,
              width: `${Math.abs(marquee.currentX - marquee.startX) * 100}%`,
              height: `${Math.abs(marquee.currentY - marquee.startY) * 100}%`,
              border: "1px solid rgba(255,225,77,0.9)",
              background: "rgba(255,225,77,0.12)",
              boxSizing: "border-box",
              pointerEvents: "none",
              zIndex: 4,
            }}
          />
        )}

        {frames.map((frame) => {
          const y =
            VALUE_TOP_FRAC +
            (1 - valueFraction(selectedParam, frame.value)) *
              VALUE_SPAN_FRAC;
          const active =
            selectedIds.has(frame.id) || frame.id === selectedId;
          return (
            <button
              key={frame.id}
              type="button"
              onPointerDown={(event) => {
                event.stopPropagation();
                let next = selectedIds;
                if (event.shiftKey || event.metaKey || event.ctrlKey) {
                  next = new Set(selectedIds);
                  if (next.has(frame.id)) next.delete(frame.id);
                  else next.add(frame.id);
                  setSelectedIds(next);
                } else if (!selectedIds.has(frame.id)) {
                  next = new Set([frame.id]);
                  setSelectedIds(next);
                }
                if (!next.has(frame.id)) {
                  onSelectedIdChange([...next][0] ?? null);
                  event.preventDefault();
                  return;
                }
                setDragId(frame.id);
                onSelectedIdChange(frame.id);
                event.currentTarget.setPointerCapture(event.pointerId);
                event.preventDefault();
              }}
              style={{
                position: "absolute",
                left: `calc(${(frame.hour / HOURS) * 100}% - 7px)`,
                top: `calc(${y * 100}% - 7px)`,
                width: 14,
                height: 14,
                padding: 0,
                borderRadius: 7,
                border: active
                  ? "2px solid #fff"
                  : "1px solid rgba(255,255,255,0.65)",
                background: "#c084fc",
                boxShadow: active
                  ? "0 0 0 2px rgba(192,132,252,0.45)"
                  : "0 0 0 1px rgba(0,0,0,0.4)",
                cursor: "move",
                touchAction: "none",
              }}
              title={`${fmtTime(frame.hour)} · ${meta.label} ${frame.value.toFixed(2)}`}
              aria-label={`Pad keyframe at ${fmtTime(frame.hour)}`}
            />
          );
        })}

          <div style={axisLabelStyle}>
            <span>00h</span>
            <span>06h</span>
            <span>12h</span>
            <span>18h</span>
            <span>24h</span>
          </div>
        </div>
      </div>

      <div style={statusStyle}>
        {selectionCount > 1 ? (
          <>
            Selected <strong>{selectionCount}</strong> {meta.label} keyframes
            <span style={{ opacity: 0.6 }}>
              Delete them together or drag again to replace the selection.
            </span>
          </>
        ) : selected ? (
          <>
            Editing <strong>{PAD_AUTOMATION_META[selected.param].label}</strong>
            keyframe at <strong>{fmtTime(selected.hour)}</strong>
            <span style={{ opacity: 0.6 }}>
              Drag its point or use the pad controls below.
            </span>
          </>
        ) : followPlayhead ? (
          <>
            Following playhead at <strong>{fmtTime(playheadHour)}</strong>
            <span style={{ opacity: 0.6 }}>
              Controls show interpolated values. Moving one creates a point
              in only that parameter lane.
            </span>
          </>
        ) : (
          <>
            Editing <strong>base patch</strong>
            <span style={{ opacity: 0.6 }}>
              Select or add an independent parameter keyframe.
            </span>
          </>
        )}
      </div>
    </section>
  );
}

const sectionStyle: React.CSSProperties = {
  padding: "8px 0",
  borderTop: "1px solid rgba(255,255,255,0.08)",
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  flexWrap: "wrap",
};

const toolbarLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  fontSize: 10,
};

const buttonStyle: React.CSSProperties = {
  background: "rgba(192,132,252,0.16)",
  color: "rgba(230,225,240,0.95)",
  border: "1px solid rgba(192,132,252,0.45)",
  borderRadius: 4,
  padding: "3px 7px",
  fontSize: 10,
  cursor: "pointer",
};

const selectStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  color: "inherit",
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 3,
  padding: "2px 4px",
  fontSize: 10,
};

const plotStyle: React.CSSProperties = {
  position: "relative",
  height: PLOT_HEIGHT,
  flex: "0 0 auto",
  overflow: "hidden",
  background: "rgba(192,132,252,0.055)",
  border: "1px solid rgba(192,132,252,0.3)",
  borderRadius: 5,
  touchAction: "none",
};

const timelineScrollStyle: React.CSSProperties = {
  display: "flex",
  width: "100%",
  overflowX: "auto",
  overflowY: "hidden",
  borderRadius: 5,
};

const timelineGutterStyle: React.CSSProperties = {
  position: "sticky",
  left: 0,
  zIndex: 4,
  width: PIANO_GUTTER_WIDTH,
  minWidth: PIANO_GUTTER_WIDTH,
  height: PLOT_HEIGHT,
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 4,
  background: "rgba(12,8,22,0.96)",
  border: "1px solid rgba(192,132,252,0.3)",
  borderRight: "none",
  borderRadius: "5px 0 0 5px",
  fontSize: 9,
  opacity: 0.75,
  textAlign: "center",
};

const axisLabelStyle: React.CSSProperties = {
  position: "absolute",
  left: 3,
  right: 3,
  bottom: 1,
  display: "flex",
  justifyContent: "space-between",
  fontSize: 8,
  opacity: 0.45,
  pointerEvents: "none",
};

const statusStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  fontSize: 10,
  minHeight: 14,
};
