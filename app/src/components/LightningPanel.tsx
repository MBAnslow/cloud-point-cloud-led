import { useRef } from "react";
import {
  useSimStore,
  type LightningParams,
  type LightningSample,
} from "../state";
import { useDraggable } from "./useDraggable";
import { RangeSlider } from "./RangeSlider";
import { putSampleBlob, deleteSampleBlob } from "../samples/sampleStorage";

/**
 * Draggable / hideable lightning controls, mirroring the Master
 * volume panel. Owns all fields of `LightningParams` including a new
 * active-hour window so lightning only fires during a specific slice
 * of the 24h timeline (visualized on `SkyTimeline`).
 */
export function LightningPanel({ visible = true }: { visible?: boolean }) {
  const lightning = useSimStore((s) => s.lightning);
  const setLightning = useSimStore((s) => s.setLightning);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { pos, handleProps } = useDraggable(panelRef);
  const dynStyle: React.CSSProperties = pos
    ? { top: pos.top, left: pos.left, bottom: "auto", right: "auto" }
    : {};
  if (!visible) return null;
  const upd = (patch: Partial<LightningParams>) => setLightning(patch);
  return (
    <div ref={panelRef} style={{ ...panelStyle, ...dynStyle }}>
      <div
        onPointerDown={handleProps.onPointerDown}
        style={{ display: "flex", alignItems: "center", gap: 10, cursor: "move" }}
      >
        <div style={titleStyle}>Lightning</div>
        <label style={inlineLabel}>
          <input
            type="checkbox"
            checked={lightning.enabled}
            onChange={(e) => upd({ enabled: e.target.checked })}
          />
          enabled
        </label>
        <label style={inlineLabel}>
          colors
          {[0, 1, 2].map((i) => (
            <input
              key={i}
              type="color"
              value={lightning.colors[i]}
              onChange={(e) => {
                const next = [...lightning.colors] as [string, string, string];
                next[i] = e.target.value;
                upd({ colors: next });
              }}
              style={{
                width: 26,
                height: 20,
                padding: 0,
                marginLeft: i === 0 ? 0 : 2,
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 3,
                background: "transparent",
              }}
            />
          ))}
        </label>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
        <RangeRow
          label="Intensity"
          min={0}
          max={3}
          step={0.01}
          low={lightning.intensityRange[0]}
          high={lightning.intensityRange[1]}
          onChange={(lo, hi) => upd({ intensityRange: [lo, hi] })}
          format={(lo, hi) => `${lo.toFixed(2)} – ${hi.toFixed(2)}`}
        />
        <SliderRow
          label="Strikes / min"
          value={lightning.strikesPerMinute}
          min={0}
          max={120}
          step={1}
          onChange={(v) => upd({ strikesPerMinute: v })}
          formatValue={(v) => v.toFixed(0)}
        />
        <SliderRow
          label="Light falloff"
          min={0}
          max={1}
          step={0.01}
          value={lightning.falloffDistance}
          onChange={(v) => upd({ falloffDistance: v })}
          formatValue={(v) => `${v.toFixed(2)} m`}
        />
        <SliderRow
          label="Segments"
          value={lightning.boltSegments}
          min={4}
          max={24}
          step={1}
          onChange={(v) => upd({ boltSegments: Math.round(v) })}
          formatValue={(v) => v.toFixed(0)}
        />
        <RangeRow
          label="Jitter"
          min={0}
          max={1}
          step={0.01}
          low={lightning.boltJitterRange[0]}
          high={lightning.boltJitterRange[1]}
          onChange={(lo, hi) => upd({ boltJitterRange: [lo, hi] })}
          format={(lo, hi) => `${lo.toFixed(2)} – ${hi.toFixed(2)}`}
        />
        <RangeRow
          label="Travel (m/s)"
          min={0.1}
          max={5}
          step={0.05}
          low={lightning.travelSpeedRange[0]}
          high={lightning.travelSpeedRange[1]}
          onChange={(lo, hi) => upd({ travelSpeedRange: [lo, hi] })}
          format={(lo, hi) => `${lo.toFixed(1)} – ${hi.toFixed(1)}`}
        />
        <SliderRow
          label="Sub-flashes"
          value={lightning.subFlashes}
          min={0}
          max={4}
          step={1}
          onChange={(v) => upd({ subFlashes: Math.round(v) })}
          formatValue={(v) => v.toFixed(0)}
        />
        <RangeRow
          label="Span"
          min={0}
          max={1}
          step={0.01}
          low={Math.min(1, lightning.minSpanScale)}
          high={lightning.spanScale}
          onChange={(lo, hi) => upd({ minSpanScale: lo, spanScale: hi })}
          format={(lo, hi) => `${lo.toFixed(2)} – ${hi.toFixed(2)}`}
        />
        <SliderRow
          label="Sim FPS"
          value={lightning.simFps}
          min={1}
          max={60}
          step={1}
          onChange={(v) => upd({ simFps: Math.round(v) })}
          formatValue={(v) => `${v.toFixed(0)} fps`}
        />
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", marginTop: 4, paddingTop: 4 }}>
          <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 4 }}>
            Active window (24h)
          </div>
          <SliderRow
            label="Start hour"
            value={lightning.activeStartHour}
            min={0}
            max={24}
            step={0.25}
            onChange={(v) => upd({ activeStartHour: v % 24 })}
            formatValue={(v) => `${v.toFixed(2)}h`}
          />
          <SliderRow
            label="End hour"
            value={lightning.activeEndHour}
            min={0}
            max={24}
            step={0.25}
            onChange={(v) => upd({ activeEndHour: v % 24 })}
            formatValue={(v) => `${v.toFixed(2)}h`}
          />
        </div>
        <AudioSection lightning={lightning} upd={upd} />
      </div>
    </div>
  );
}

function AudioSection({
  lightning,
  upd,
}: {
  lightning: LightningParams;
  upd: (patch: Partial<LightningParams>) => void;
}) {
  const boltInputRef = useRef<HTMLInputElement | null>(null);
  const bgInputRef = useRef<HTMLInputElement | null>(null);

  const onBoltFiles = async (files: FileList | null) => {
    if (!files) return;
    const added: LightningSample[] = [];
    for (const f of Array.from(files)) {
      const sample = await ingestFile(f);
      if (sample) added.push(sample);
    }
    if (added.length > 0) {
      upd({ boltSamples: [...lightning.boltSamples, ...added] });
    }
    if (boltInputRef.current) boltInputRef.current.value = "";
  };

  const onBgFile = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const sample = await ingestFile(files[0]);
    if (sample) {
      // Free the previously-stored background blob so IndexedDB
      // doesn't accumulate orphaned recordings on each replacement.
      if (lightning.backgroundSample) {
        void deleteSampleBlob(lightning.backgroundSample.id);
      }
      upd({ backgroundSample: sample });
    }
    if (bgInputRef.current) bgInputRef.current.value = "";
  };

  const removeBolt = (id: string) => {
    void deleteSampleBlob(id);
    upd({ boltSamples: lightning.boltSamples.filter((s) => s.id !== id) });
  };

  const clearBackground = () => {
    if (lightning.backgroundSample) {
      void deleteSampleBlob(lightning.backgroundSample.id);
    }
    upd({ backgroundSample: null });
  };

  return (
    <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", marginTop: 4, paddingTop: 4 }}>
      <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 4 }}>Audio</div>
      <SliderRow
        label="Bolt gain"
        value={lightning.boltGain}
        min={0}
        max={3}
        step={0.01}
        onChange={(v) => upd({ boltGain: v })}
      />
      <SliderRow
        label="BG gain"
        value={lightning.backgroundGain}
        min={0}
        max={3}
        step={0.01}
        onChange={(v) => upd({ backgroundGain: v })}
      />
      <SliderRow
        label="Pitch ±¢"
        value={lightning.boltPitchJitterCents}
        min={0}
        max={1200}
        step={5}
        onChange={(v) => upd({ boltPitchJitterCents: v })}
        formatValue={(v) => `${v.toFixed(0)}¢`}
      />
      <SliderRow
        label="Thunder delay"
        value={lightning.thunderDelayMs}
        min={0}
        max={5000}
        step={10}
        onChange={(v) => upd({ thunderDelayMs: v })}
        formatValue={(v) =>
          v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v.toFixed(0)} ms`
        }
      />

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
        <span style={{ fontSize: 11, opacity: 0.85, flex: 1 }}>
          Bolt sounds ({lightning.boltSamples.length})
        </span>
        <button
          type="button"
          style={miniBtn}
          onClick={() => boltInputRef.current?.click()}
        >
          + upload
        </button>
        <input
          ref={boltInputRef}
          type="file"
          accept="audio/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => onBoltFiles(e.target.files)}
        />
      </div>
      {lightning.boltSamples.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: "4px 0 0",
            maxHeight: 90,
            overflowY: "auto",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 4,
          }}
        >
          {lightning.boltSamples.map((s) => (
            <li
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 6px",
                fontSize: 11,
                borderBottom: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {s.name}
              </span>
              {typeof s.durationSec === "number" && (
                <span style={{ opacity: 0.55, fontVariantNumeric: "tabular-nums" }}>
                  {s.durationSec.toFixed(1)}s
                </span>
              )}
              <button type="button" style={miniBtn} onClick={() => removeBolt(s.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
        <span style={{ fontSize: 11, opacity: 0.85, flex: 1 }}>
          Background:{" "}
          {lightning.backgroundSample ? (
            <span style={{ opacity: 0.95 }}>{lightning.backgroundSample.name}</span>
          ) : (
            <span style={{ opacity: 0.55 }}>(none)</span>
          )}
        </span>
        <button
          type="button"
          style={miniBtn}
          onClick={() => bgInputRef.current?.click()}
        >
          {lightning.backgroundSample ? "replace" : "+ upload"}
        </button>
        {lightning.backgroundSample && (
          <button type="button" style={miniBtn} onClick={clearBackground}>
            ×
          </button>
        )}
        <input
          ref={bgInputRef}
          type="file"
          accept="audio/*"
          style={{ display: "none" }}
          onChange={(e) => onBgFile(e.target.files)}
        />
      </div>
    </div>
  );
}

async function ingestFile(file: File): Promise<LightningSample | null> {
  try {
    const id = `lightning-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
    await putSampleBlob(id, file);
    let durationSec: number | undefined;
    try {
      const arr = await file.arrayBuffer();
      const AC =
        (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (AC) {
        const ctx = new AC();
        const buf = await ctx.decodeAudioData(arr.slice(0));
        durationSec = buf.duration;
        void ctx.close();
      }
    } catch {
      // Duration is optional; playback still works via IndexedDB blob.
    }
    return { id, name: file.name, durationSec };
  } catch (err) {
    console.warn("[lightning] file ingest failed", err);
    return null;
  }
}

function RangeRow({
  label,
  min,
  max,
  step,
  low,
  high,
  onChange,
  format,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  low: number;
  high: number;
  onChange: (low: number, high: number) => void;
  format?: (low: number, high: number) => string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
      <span style={{ width: 82, opacity: 0.85 }}>{label}</span>
      <RangeSlider
        min={min}
        max={max}
        step={step}
        value={[low, high]}
        onChange={([lo, hi]) => onChange(lo, hi)}
      />
      <span
        style={{
          width: 90,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {format ? format(low, high) : `${low.toFixed(2)}–${high.toFixed(2)}`}
      </span>
    </div>
  );
}

const miniBtn: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  color: "inherit",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 4,
  padding: "2px 6px",
  fontSize: 10,
  cursor: "pointer",
};

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  formatValue,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  formatValue?: (v: number) => string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
      <span style={{ width: 82, opacity: 0.85 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1 }}
      />
      <span style={{ width: 46, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {formatValue ? formatValue(value) : value.toFixed(2)}
      </span>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 60,
  right: 12,
  zIndex: 15,
  width: 340,
  background: "rgba(10, 12, 20, 0.82)",
  backdropFilter: "blur(8px)",
  color: "rgba(207,214,230,0.95)",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.12)",
  fontFamily:
    "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
};

const titleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: 0.3,
  marginRight: "auto",
};

const inlineLabel: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontSize: 11,
};
