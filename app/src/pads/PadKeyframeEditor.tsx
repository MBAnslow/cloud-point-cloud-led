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
  padKeyframeValues,
  samplePadAutomation,
  sortedPadKeyframes,
} from "../audio/padAutomation";
import { confirmDestructiveClear } from "../components/confirmDestructiveClear";

const HOURS = 24;
const PLOT_HEIGHT = 88;
const VALUE_TOP_FRAC = 0.08;
const VALUE_SPAN_FRAC = 0.7;
const PIANO_GUTTER_WIDTH = 56;

interface Props {
  pad: PadParams;
  playheadHour: number;
  selectedId: string | null;
  selectedParam: PadKeyframeParam;
  timelineWidth: number;
  scrollLeft: number;
  snapHours: number;
  onSelectedIdChange: (id: string | null) => void;
  onSelectedParamChange: (param: PadKeyframeParam) => void;
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
  timelineWidth,
  scrollLeft,
  snapHours,
  onSelectedIdChange,
  onSelectedParamChange,
  onKeyframesChange,
  onScrollLeftChange,
}: Props) {
  const plotRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const frames = useMemo(
    () => sortedPadKeyframes(pad.keyframes),
    [pad.keyframes],
  );
  const selected = frames.find((frame) => frame.id === selectedId) ?? null;
  const meta = PAD_AUTOMATION_META[selectedParam];

  useEffect(() => {
    if (selectedId && !pad.keyframes.some((frame) => frame.id === selectedId)) {
      onSelectedIdChange(null);
    }
  }, [onSelectedIdChange, pad.keyframes, selectedId]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element && Math.abs(element.scrollLeft - scrollLeft) > 1) {
      element.scrollLeft = scrollLeft;
    }
  }, [scrollLeft, timelineWidth]);

  const curvePoints = useMemo(() => {
    // Every keyframe hour must be an actual polyline vertex. Sampling only
    // at fixed intervals cuts across sharp peaks when a keyframe falls
    // between samples, making the curve appear detached from its handle.
    const hours = [...new Set([0, HOURS, ...frames.map((frame) => frame.hour)])]
      .sort((a, b) => a - b);
    const points: string[] = [];
    for (const hour of hours) {
      const value = samplePadAutomation(pad, hour)[selectedParam];
      const y =
        (VALUE_TOP_FRAC +
          (1 - valueFraction(selectedParam, value)) * VALUE_SPAN_FRAC) *
        100;
      points.push(`${(hour / HOURS) * 100},${y}`);
    }
    return points.join(" ");
  }, [frames, pad, selectedParam]);

  const snapHour = (hour: number): number => {
    const normalized = ((hour % HOURS) + HOURS) % HOURS;
    if (snapHours <= 0) return normalized;
    return (Math.round(normalized / snapHours) * snapHours) % HOURS;
  };

  const addAtPlayhead = () => {
    const hour = snapHour(playheadHour);
    const sampled = samplePadAutomation(pad, hour);
    const frame: PadKeyframe = {
      id: newKeyframeId(),
      hour,
      values: padKeyframeValues(sampled),
    };
    onKeyframesChange(sortedPadKeyframes([...pad.keyframes, frame]));
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
      values: { ...frame.values, [selectedParam]: value },
    });
  };

  const deleteSelected = () => {
    if (!selected) return;
    onKeyframesChange(pad.keyframes.filter((frame) => frame.id !== selected.id));
    onSelectedIdChange(null);
  };

  const clearAll = () => {
    if (
      pad.keyframes.length > 0 &&
      confirmDestructiveClear(`all ${pad.keyframes.length} pad keyframes`)
    ) {
      onKeyframesChange([]);
      onSelectedIdChange(null);
    }
  };

  return (
    <section style={sectionStyle}>
      <div style={toolbarStyle}>
        <strong style={{ fontSize: 12 }}>Pad keyframes</strong>
        <span style={{ fontSize: 10, opacity: 0.55 }}>
          24-hour continuous patch automation
        </span>
        <label style={toolbarLabelStyle}>
          Curve
          <select
            value={selectedParam}
            onChange={(event) =>
              onSelectedParamChange(event.target.value as PadKeyframeParam)
            }
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
          + keyframe at {fmtTime(playheadHour)}
        </button>
        <button
          type="button"
          style={{
            ...buttonStyle,
            borderColor: !selected ? "rgba(192,132,252,0.75)" : undefined,
            background: !selected ? "rgba(192,132,252,0.25)" : undefined,
          }}
          onClick={() => onSelectedIdChange(null)}
          title="Edit the static base patch instead of a keyframe"
        >
          Base patch
        </button>
        <button
          type="button"
          style={buttonStyle}
          disabled={!selected}
          onClick={deleteSelected}
        >
          Delete selected
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
          onPointerMove={(event) => updateDrag(event.clientX, event.clientY)}
          onPointerUp={() => setDragId(null)}
          onPointerCancel={() => setDragId(null)}
          style={{ ...plotStyle, width: timelineWidth }}
          title="Select a point; drag horizontally for time and vertically for value"
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

        {frames.map((frame) => {
          const y =
            VALUE_TOP_FRAC +
            (1 - valueFraction(selectedParam, frame.values[selectedParam])) *
              VALUE_SPAN_FRAC;
          const active = frame.id === selectedId;
          return (
            <button
              key={frame.id}
              type="button"
              onPointerDown={(event) => {
                setDragId(frame.id);
                onSelectedIdChange(frame.id);
                event.currentTarget.setPointerCapture(event.pointerId);
                event.preventDefault();
              }}
              onClick={() => onSelectedIdChange(frame.id)}
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
              title={`${fmtTime(frame.hour)} · ${meta.label} ${frame.values[
                selectedParam
              ].toFixed(2)}`}
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
        {selected ? (
          <>
            Editing keyframe at <strong>{fmtTime(selected.hour)}</strong>
            <span style={{ opacity: 0.6 }}>
              Drag its point or use the pad controls below.
            </span>
          </>
        ) : (
          <>
            Editing <strong>base patch</strong>
            <span style={{ opacity: 0.6 }}>
              Select or add a keyframe to edit its snapshot.
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
