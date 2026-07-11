import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSimStore, type Sample, type SampleClip } from "../state";
import { putSampleBlob, deleteSampleBlob } from "./sampleStorage";
import { getSampleEngine } from "../audio/SampleEngine";
import { clipWidthHours } from "../audio/sampleCycle";
import { SampleClipEditor } from "./SampleClipEditor";
import { ActivePeriodBand, PeriodTransportButtons } from "../components/PeriodOverlay";

const HOURS = 24;
const LANE_HEIGHT = 40;
const LIBRARY_WIDTH = 220;
const RESIZE_EDGE_PX = 6;

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
}

function fmtTime(hour: number): string {
  const h = ((hour % HOURS) + HOURS) % HOURS;
  const H = Math.floor(h);
  const M = Math.floor((h - H) * 60);
  return `${H.toString().padStart(2, "0")}:${M.toString().padStart(2, "0")}`;
}

/**
 * Decode an uploaded file to measure duration. Uses the same
 * AudioContext Tone.js will play through, so channel/sample-rate
 * mismatches are handled once here.
 */
async function decodeDuration(arrayBuffer: ArrayBuffer): Promise<number> {
  const AC = (window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext) as typeof AudioContext;
  const ctx = new AC();
  try {
    const buf = await ctx.decodeAudioData(arrayBuffer.slice(0));
    return buf.duration;
  } finally {
    if (ctx.state !== "closed") ctx.close().catch(() => undefined);
  }
}

interface DragState {
  kind: "move" | "resize-right" | "library";
  // For move / resize-right: the clip id being modified.
  clipId?: string;
  // For library drops: the sample being dropped.
  librarySampleId?: string;
  originHour: number;
  originStart: number;
  originEnd: number;
  originLane: number;
}

/**
 * Samples arrangement editor. Layout:
 *
 *   [ header ]
 *   [ library sidebar | timeline (one lane per sample) ]
 *   [ clip editor (when selected) ]
 */
export function SamplesPanel() {
  const samples = useSimStore((s) => s.samples);
  const setSamples = useSimStore((s) => s.setSamples);
  const addSample = useSimStore((s) => s.addSample);
  const removeSample = useSimStore((s) => s.removeSample);
  const addSampleClip = useSimStore((s) => s.addSampleClip);
  const updateSampleClip = useSimStore((s) => s.updateSampleClip);
  const removeSampleClip = useSimStore((s) => s.removeSampleClip);
  const clearSampleClips = useSimStore((s) => s.clearSampleClips);
  const timeHours = useSimStore((s) => s.sky.timeHours);
  const cycleSeconds = useSimStore((s) => s.sky.cycleSeconds);
  const sky = useSimStore((s) => s.sky);
  const setSky = useSimStore((s) => s.setSky);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const rollRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const scrubbingRef = useRef(false);
  const [dragSampleId, setDragSampleId] = useState<string | null>(null);

  const laneIndexBySampleId = useMemo(() => {
    const m = new Map<string, number>();
    samples.library.forEach((s, i) => m.set(s.id, i));
    return m;
  }, [samples.library]);
  const sampleById = useMemo(() => {
    const m = new Map<string, Sample>();
    for (const s of samples.library) m.set(s.id, s);
    return m;
  }, [samples.library]);

  const laneCount = Math.max(1, samples.library.length);
  const rollHeight = laneCount * LANE_HEIGHT;

  const clientToHourLane = useCallback((clientX: number, clientY: number) => {
    const grid = rollRef.current?.querySelector<HTMLDivElement>("[data-grid]");
    if (!grid) return { hour: 0, lane: 0 };
    const rect = grid.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height - 1, clientY - rect.top));
    return {
      hour: (x / rect.width) * HOURS,
      lane: Math.floor(y / LANE_HEIGHT),
    };
  }, []);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      setUploading(true);
      try {
        for (const file of Array.from(files)) {
          const buffer = await file.arrayBuffer();
          let durationSec = 0;
          try {
            durationSec = await decodeDuration(buffer);
          } catch (err) {
            console.warn("[samples] decode failed", file.name, err);
            continue;
          }
          const id = newId("sample");
          const blob = new Blob([buffer], { type: file.type || "audio/wav" });
          await putSampleBlob(id, blob);
          const meta: Sample = {
            id,
            name: file.name.replace(/\.[^.]+$/, ""),
            durationSec,
          };
          addSample(meta);
          // Preload into the engine so first placement plays instantly.
          getSampleEngine()
            .ensureSampleLoaded(meta)
            .catch(() => undefined);
        }
      } finally {
        setUploading(false);
      }
    },
    [addSample],
  );

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    void handleFiles(e.target.files);
    e.target.value = "";
  };

  const deleteSample = useCallback(
    async (id: string) => {
      if (!confirm("Delete this sample and all its clips?")) return;
      removeSample(id);
      await deleteSampleBlob(id).catch(() => undefined);
    },
    [removeSample],
  );

  const beginClipDrag = (
    e: React.PointerEvent,
    kind: "move" | "resize-right",
    clipId: string,
  ) => {
    const clip = samples.clips.find((c) => c.id === clipId);
    if (!clip) return;
    const sample = sampleById.get(clip.sampleId);
    if (!sample) return;
    const { hour } = clientToHourLane(e.clientX, e.clientY);
    const width = clipWidthHours(sample, clip, cycleSeconds);
    dragRef.current = {
      kind,
      clipId,
      originHour: hour,
      originStart: clip.startHour,
      originEnd: clip.startHour + width,
      originLane: laneIndexBySampleId.get(clip.sampleId) ?? 0,
    };
    setSelectedId(clipId);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    e.stopPropagation();
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (scrubbingRef.current) {
        const { hour } = clientToHourLane(e.clientX, e.clientY);
        setSky({ timeHours: Math.max(0, Math.min(24, hour)) });
        return;
      }
      const drag = dragRef.current;
      if (!drag) return;
      const { hour } = clientToHourLane(e.clientX, e.clientY);
      const dHour = hour - drag.originHour;
      if (drag.kind === "move" && drag.clipId) {
        const clip = samples.clips.find((c) => c.id === drag.clipId);
        if (!clip) return;
        const sample = sampleById.get(clip.sampleId);
        if (!sample) return;
        const width = clipWidthHours(sample, clip, cycleSeconds);
        const start = Math.max(0, Math.min(HOURS - width, drag.originStart + dHour));
        updateSampleClip(drag.clipId, { startHour: start });
      } else if (drag.kind === "resize-right" && drag.clipId) {
        // Resize-right modifies playbackRate as a time-stretch: new
        // widthHours = originalWidthHours * originalRate / newRate.
        const clip = samples.clips.find((c) => c.id === drag.clipId);
        if (!clip) return;
        const sample = sampleById.get(clip.sampleId);
        if (!sample) return;
        const newEnd = Math.max(
          drag.originStart + 0.02,
          Math.min(HOURS, drag.originEnd + dHour),
        );
        const newWidth = newEnd - drag.originStart;
        // widthHours = durationSec/rate * (24/cycleSeconds) ⇒
        // rate = durationSec * (24/cycleSeconds) / widthHours.
        const hoursPerSec = 24 / Math.max(1, cycleSeconds);
        const rate = Math.max(
          0.1,
          Math.min(4, (sample.durationSec * hoursPerSec) / newWidth),
        );
        updateSampleClip(drag.clipId, { playbackRate: rate });
      }
    };
    const onUp = () => {
      dragRef.current = null;
      scrubbingRef.current = false;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [clientToHourLane, cycleSeconds, sampleById, samples.clips, setSky, updateSampleClip]);

  // Delete key removes selected clip.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedId &&
        !isTypingTarget(e.target)
      ) {
        removeSampleClip(selectedId);
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, removeSampleClip]);

  const onGridPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).dataset.clipId) return;
    // Empty click: deselect (and, if a library-drag was in flight, drop it).
    setSelectedId(null);
  };

  // Drop from the library sidebar onto a lane.
  const onLaneDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!dragSampleId) return;
    e.preventDefault();
  };
  const onLaneDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!dragSampleId) return;
    e.preventDefault();
    const { hour } = clientToHourLane(e.clientX, e.clientY);
    const sample = sampleById.get(dragSampleId);
    if (!sample) return;
    const clip: SampleClip = {
      id: newId("clip"),
      sampleId: dragSampleId,
      startHour: Math.max(0, Math.min(HOURS - 0.05, hour)),
      gain: 1,
      pan: 0,
      playbackRate: 1,
      fadeInSec: 0.01,
      fadeOutSec: 0.05,
      randomPitchCents: 0,
      reverbMix: 0,
      reverbDecay: 0.7,
      delayTimeSec: 0.25,
      delayFeedback: 0.3,
      delayMix: 0,
    };
    addSampleClip(clip);
    setSelectedId(clip.id);
    setDragSampleId(null);
  };

  const selectedClip = useMemo(
    () => samples.clips.find((c) => c.id === selectedId) ?? null,
    [samples.clips, selectedId],
  );

  return (
    <div style={panelStyle}>
      <header style={headerStyle}>
        <Link to="/" style={linkStyle}>
          ← simulator
        </Link>
        <Link to="/drones" style={linkStyle}>
          Drones
        </Link>
        <Link to="/pads" style={linkStyle}>
          Pads
        </Link>
        <span style={{ marginLeft: 8, fontSize: 16, fontWeight: 600 }}>
          Samples
        </span>
        <button
          onClick={() => setSky({ autoPlay: !sky.autoPlay })}
          style={{
            ...btn,
            marginLeft: 8,
            background: sky.autoPlay
              ? "rgba(255,225,77,0.25)"
              : "rgba(251,146,60,0.2)",
            borderColor: sky.autoPlay
              ? "rgba(255,225,77,0.6)"
              : "rgba(251,146,60,0.5)",
            minWidth: 78,
          }}
        >
          {sky.autoPlay ? "❚❚ Pause" : "▶ Play"}
        </button>
        <button
          onClick={() => setSky({ timeHours: 0 })}
          style={btn}
          title="Rewind to 00:00"
        >
          ⏮ 00:00
        </button>
        <PeriodTransportButtons />
        <label style={{ ...row, fontSize: 11 }}>
          Cycle
          <input
            type="number"
            min={5}
            max={3600}
            step={5}
            value={Math.round(sky.cycleSeconds)}
            onChange={(e) =>
              setSky({
                cycleSeconds: Math.max(5, parseFloat(e.target.value) || 60),
              })
            }
            style={{ ...numInput, width: 60 }}
          />
          <span style={{ opacity: 0.6 }}>s / 24h</span>
        </label>
        <label style={row}>
          <input
            type="checkbox"
            checked={samples.enabled}
            onChange={(e) => setSamples({ enabled: e.target.checked })}
          />
          <span>Enable</span>
        </label>
        <label style={{ ...row, minWidth: 180 }}>
          <span style={{ fontSize: 11, width: 40 }}>Master</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={samples.master}
            onChange={(e) => setSamples({ master: parseFloat(e.target.value) })}
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: 10, width: 32, textAlign: "right", opacity: 0.8 }}>
            {samples.master.toFixed(2)}
          </span>
        </label>
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{ ...btn, marginLeft: 4 }}
          disabled={uploading}
        >
          {uploading ? "Uploading…" : "+ Upload"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          onChange={onPickFiles}
          style={{ display: "none" }}
        />
        <div style={{ marginLeft: "auto", fontSize: 12, opacity: 0.85, fontVariantNumeric: "tabular-nums" }}>
          {fmtTime(timeHours)}
        </div>
      </header>

      <div style={bodyScrollStyle}>
        <section style={rollSectionStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <strong style={{ fontSize: 12 }}>Arrangement</strong>
            <span style={{ fontSize: 11, opacity: 0.6 }}>
              drag a sample from the library onto a lane · drag body to move ·
              drag right edge to stretch · Del to remove · drag ruler to scrub
            </span>
            <button
              style={{ ...btn, marginLeft: "auto" }}
              onClick={() => {
                if (confirm("Clear all clips?")) {
                  clearSampleClips();
                  setSelectedId(null);
                }
              }}
            >
              Clear clips
            </button>
          </div>

          <div ref={rollRef} style={arrangementWrap}>
            {/* Library sidebar */}
            <div style={librarySideStyle}>
              <div style={sideTitle}>Library</div>
              {samples.library.length === 0 && (
                <div style={emptyHint}>
                  Upload audio files to start arranging.
                </div>
              )}
              {samples.library.map((s) => (
                <div
                  key={s.id}
                  draggable
                  onDragStart={(e) => {
                    setDragSampleId(s.id);
                    e.dataTransfer.effectAllowed = "copy";
                    e.dataTransfer.setData("text/plain", s.id);
                  }}
                  onDragEnd={() => setDragSampleId(null)}
                  style={{
                    height: LANE_HEIGHT,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "0 6px",
                    borderTop: "1px solid rgba(255,255,255,0.06)",
                    cursor: "grab",
                    background:
                      dragSampleId === s.id
                        ? "rgba(251,146,60,0.18)"
                        : "transparent",
                  }}
                  title={`Drag onto a lane · ${s.durationSec.toFixed(2)}s`}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {s.name}
                    </div>
                    <div style={{ fontSize: 9, opacity: 0.6 }}>
                      {s.durationSec.toFixed(2)}s
                    </div>
                  </div>
                  <button
                    onClick={() => void deleteSample(s.id)}
                    style={{ ...btn, padding: "1px 5px", fontSize: 10 }}
                    title="Delete sample"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            {/* Timeline */}
            <div style={{ flex: 1, minWidth: 400, position: "relative" }}>
              {/* Scrubber ruler */}
              <div
                onPointerDown={(e) => {
                  scrubbingRef.current = true;
                  const { hour } = clientToHourLane(e.clientX, e.clientY);
                  setSky({ timeHours: Math.max(0, Math.min(24, hour)) });
                  (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
                  e.preventDefault();
                }}
                style={rulerStyle}
                title="Drag to scrub"
              >
                <ActivePeriodBand opacity={0.3} />
                {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
                  <span
                    key={h}
                    style={{
                      position: "absolute",
                      left: `${(h / HOURS) * 100}%`,
                      top: 3,
                      fontSize: 9,
                      opacity: 0.7,
                      paddingLeft: 3,
                      pointerEvents: "none",
                    }}
                  >
                    {h.toString().padStart(2, "0")}h
                  </span>
                ))}
                <div style={playheadTop(timeHours)} />
                <div style={playheadKnob(timeHours)} />
              </div>

              <div
                data-grid
                onPointerDown={onGridPointerDown}
                onDragOver={onLaneDragOver}
                onDrop={onLaneDrop}
                style={{
                  position: "relative",
                  width: "100%",
                  height: rollHeight,
                  cursor: dragSampleId ? "copy" : "default",
                }}
              >
                {/* Lane rows */}
                {Array.from({ length: laneCount }, (_, lane) => (
                  <div
                    key={lane}
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: lane * LANE_HEIGHT,
                      height: LANE_HEIGHT,
                      borderTop: "1px solid rgba(255,255,255,0.08)",
                      background:
                        lane % 2 === 0
                          ? "rgba(255,255,255,0.015)"
                          : "rgba(255,255,255,0.035)",
                      pointerEvents: "none",
                    }}
                  />
                ))}
                {/* Hour gridlines */}
                {Array.from({ length: HOURS + 1 }, (_, h) => (
                  <div
                    key={h}
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      left: `${(h / HOURS) * 100}%`,
                      width: 1,
                      background:
                        h % 6 === 0
                          ? "rgba(255,255,255,0.25)"
                          : h % 3 === 0
                            ? "rgba(255,255,255,0.12)"
                            : "rgba(255,255,255,0.05)",
                      pointerEvents: "none",
                    }}
                  />
                ))}
                {/* Playhead */}
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: `${(timeHours / HOURS) * 100}%`,
                    width: 2,
                    background: "#ffe14d",
                    pointerEvents: "none",
                  }}
                />
                {/* Clips */}
                {samples.clips.map((c) => {
                  const sample = sampleById.get(c.sampleId);
                  if (!sample) return null;
                  const lane = laneIndexBySampleId.get(c.sampleId);
                  if (lane === undefined) return null;
                  const width = clipWidthHours(sample, c, cycleSeconds);
                  const leftPct = (c.startHour / HOURS) * 100;
                  const widthPct = (width / HOURS) * 100;
                  const isSel = c.id === selectedId;
                  return (
                    <div
                      key={c.id}
                      data-clip-id={c.id}
                      onPointerDown={(e) => {
                        const rect = (
                          e.currentTarget as HTMLDivElement
                        ).getBoundingClientRect();
                        const nearRight = e.clientX > rect.right - RESIZE_EDGE_PX;
                        beginClipDrag(e, nearRight ? "resize-right" : "move", c.id);
                      }}
                      style={{
                        position: "absolute",
                        top: lane * LANE_HEIGHT + 2,
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        height: LANE_HEIGHT - 4,
                        background: isSel
                          ? "linear-gradient(180deg,#fb923c,#ea580c)"
                          : "linear-gradient(180deg,#fb923caa,#ea580caa)",
                        border: `1px solid ${isSel ? "#fff" : "#7c2d12"}`,
                        borderRadius: 3,
                        cursor: "grab",
                        boxSizing: "border-box",
                        display: "flex",
                        alignItems: "center",
                        paddingLeft: 4,
                        fontSize: 10,
                        color: "#1a0a05",
                        fontWeight: 600,
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                      }}
                      title={`${sample.name}  @ ${fmtTime(c.startHour)}  rate ${c.playbackRate.toFixed(2)}× gain ${c.gain.toFixed(2)}`}
                    >
                      {sample.name}
                    </div>
                  );
                })}
              </div>
              <div style={bottomLabelsStyle}>
                {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
                  <span key={h}>{h.toString().padStart(2, "0")}h</span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {selectedClip && (
          <SampleClipEditor
            clip={selectedClip}
            sample={sampleById.get(selectedClip.sampleId)}
            onChange={(patch) => updateSampleClip(selectedClip.id, patch)}
            onDelete={() => {
              removeSampleClip(selectedClip.id);
              setSelectedId(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

const panelStyle: React.CSSProperties = {
  position: "fixed",
  inset: 12,
  zIndex: 10,
  background: "rgba(15, 8, 6, 0.9)",
  backdropFilter: "blur(8px)",
  color: "rgba(207,214,230,0.95)",
  padding: 14,
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.12)",
  fontFamily:
    "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  display: "flex",
  flexDirection: "column",
  gap: 6,
  minHeight: 0,
  overflow: "hidden",
};
const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};
const bodyScrollStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 6,
  paddingRight: 4,
};
const rollSectionStyle: React.CSSProperties = {
  padding: "8px 0",
  borderTop: "1px solid rgba(255,255,255,0.08)",
  display: "flex",
  flexDirection: "column",
  gap: 6,
  flex: "1 0 300px",
  minHeight: 300,
};
const arrangementWrap: React.CSSProperties = {
  display: "flex",
  flex: 1,
  minHeight: 0,
  overflow: "auto",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 6,
  background: "rgba(255,255,255,0.02)",
};
const librarySideStyle: React.CSSProperties = {
  width: LIBRARY_WIDTH,
  flexShrink: 0,
  background: "rgba(0,0,0,0.35)",
  borderRight: "1px solid rgba(255,255,255,0.15)",
  display: "flex",
  flexDirection: "column",
};
const sideTitle: React.CSSProperties = {
  padding: "4px 8px",
  fontSize: 10,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  opacity: 0.7,
  fontWeight: 600,
  background: "rgba(0,0,0,0.6)",
  borderBottom: "1px solid rgba(255,255,255,0.12)",
  height: 22,
  display: "flex",
  alignItems: "center",
};
const emptyHint: React.CSSProperties = {
  padding: 10,
  fontSize: 10,
  opacity: 0.6,
  lineHeight: 1.4,
};
const rulerStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 3,
  height: 22,
  background: "rgba(0,0,0,0.7)",
  borderBottom: "1px solid rgba(255,255,255,0.25)",
  cursor: "ew-resize",
  userSelect: "none",
};
const bottomLabelsStyle: React.CSSProperties = {
  position: "sticky",
  bottom: 0,
  display: "flex",
  justifyContent: "space-between",
  fontSize: 9,
  opacity: 0.6,
  padding: "2px 2px",
  background: "rgba(0,0,0,0.5)",
  pointerEvents: "none",
};
const linkStyle: React.CSSProperties = {
  color: "rgba(207,214,230,0.95)",
  textDecoration: "none",
  fontSize: 12,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 6,
  padding: "3px 8px",
};
const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12,
};
const btn: React.CSSProperties = {
  background: "rgba(251,146,60,0.2)",
  color: "rgba(207,214,230,0.95)",
  border: "1px solid rgba(251,146,60,0.5)",
  borderRadius: 4,
  padding: "3px 8px",
  fontSize: 11,
  cursor: "pointer",
};
const numInput: React.CSSProperties = {
  width: 60,
  marginLeft: 4,
  background: "rgba(255,255,255,0.06)",
  color: "inherit",
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 3,
  padding: "2px 4px",
  fontSize: 11,
};

function playheadTop(hour: number): React.CSSProperties {
  return {
    position: "absolute",
    left: `${(hour / HOURS) * 100}%`,
    top: 0,
    bottom: 0,
    width: 2,
    background: "#ffe14d",
    pointerEvents: "none",
  };
}
function playheadKnob(hour: number): React.CSSProperties {
  return {
    position: "absolute",
    left: `calc(${(hour / HOURS) * 100}% - 6px)`,
    top: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    background: "#ffe14d",
    border: "1px solid #7a6100",
    pointerEvents: "none",
  };
}
