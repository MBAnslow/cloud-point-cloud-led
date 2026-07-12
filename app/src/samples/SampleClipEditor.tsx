import type { Sample, SampleClip } from "../state";

interface Props {
  clip: SampleClip;
  sample: Sample | undefined;
  onChange: (patch: Partial<SampleClip>) => void;
  onDelete: () => void;
}

/**
 * Selected-clip editor: gain, pan, rate, fade in / out. Rendered under
 * the timeline when a clip is selected.
 */
export function SampleClipEditor({ clip, sample, onChange, onDelete }: Props) {
  return (
    <div
      style={{
        marginTop: 8,
        padding: 10,
        borderRadius: 6,
        background: "rgba(251,146,60,0.08)",
        border: "1px solid rgba(251,146,60,0.35)",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 10,
        fontSize: 11,
      }}
    >
      <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 8 }}>
        <strong>{sample?.name ?? "(missing sample)"}</strong>
        <span style={{ opacity: 0.65 }}>
          {sample ? `${sample.durationSec.toFixed(2)}s` : ""}
          {sample ? ` · plays ${(sample.durationSec / clip.playbackRate).toFixed(2)}s @ rate ${clip.playbackRate.toFixed(2)}` : ""}
        </span>
        <label
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}
          title="Odds this clip fires each time the playhead crosses its trigger point"
        >
          <span style={{ opacity: 0.75 }}>Trigger</span>
          <select
            value={clip.triggerProbability ?? 1}
            onChange={(e) =>
              onChange({ triggerProbability: parseFloat(e.target.value) })
            }
            style={{
              background: "rgba(255,255,255,0.06)",
              color: "inherit",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 3,
              padding: "2px 4px",
              fontSize: 11,
            }}
          >
            <option value={1}>1</option>
            <option value={0.5}>1/2</option>
            <option value={0.25}>1/4</option>
            <option value={0.125}>1/8</option>
          </select>
        </label>
        <button onClick={onDelete} style={btn}>
          Delete
        </button>
      </div>
      <Slider
        label="Gain"
        value={clip.gain}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => onChange({ gain: v })}
      />
      <Slider
        label="Pan"
        value={clip.pan}
        min={-1}
        max={1}
        step={0.01}
        onChange={(v) => onChange({ pan: v })}
      />
      <Slider
        label="Rate"
        value={clip.playbackRate}
        min={0.25}
        max={4}
        step={0.01}
        logScale
        unit="×"
        onChange={(v) => onChange({ playbackRate: v })}
      />
      <Slider
        label="Fade in"
        value={clip.fadeInSec}
        min={0}
        max={2}
        step={0.01}
        unit="s"
        onChange={(v) => onChange({ fadeInSec: v })}
      />
      <Slider
        label="Fade out"
        value={clip.fadeOutSec}
        min={0}
        max={2}
        step={0.01}
        unit="s"
        onChange={(v) => onChange({ fadeOutSec: v })}
      />
      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
        Start
        <input
          type="number"
          min={0}
          max={24}
          step={0.05}
          value={+clip.startHour.toFixed(2)}
          onChange={(e) =>
            onChange({
              startHour: Math.max(0, Math.min(24, parseFloat(e.target.value) || 0)),
            })
          }
          style={numInput}
        />
        <span style={{ opacity: 0.6 }}>h</span>
      </label>

      {/*
        FX row: random pitch, reverb, delay. Each is a small card so
        params stay grouped visually. Applied per-clip (each active
        voice gets its own Freeverb + FeedbackDelay).
      */}
      <div style={fxCard}>
        <div style={fxTitle}>Random pitch</div>
        <Slider
          label="Range"
          value={clip.randomPitchCents ?? 0}
          min={0}
          max={1200}
          step={1}
          unit="c"
          onChange={(v) => onChange({ randomPitchCents: v })}
        />
        <div style={hint}>
          On each trigger, pitch is offset by a random amount in
          ±range cents. 1200c = ±1 octave. Held for the whole clip.
        </div>
      </div>
      <div style={fxCard}>
        <div style={fxTitle}>Reverb</div>
        <Slider
          label="Mix"
          value={clip.reverbMix ?? 0}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onChange({ reverbMix: v })}
        />
        <Slider
          label="Size"
          value={clip.reverbDecay ?? 0.7}
          min={0}
          max={0.99}
          step={0.01}
          onChange={(v) => onChange({ reverbDecay: v })}
        />
      </div>
      <div style={fxCard}>
        <div style={fxTitle}>Delay</div>
        <Slider
          label="Time"
          value={clip.delayTimeSec ?? 0.25}
          min={0.01}
          max={2}
          step={0.01}
          unit="s"
          logScale
          onChange={(v) => onChange({ delayTimeSec: v })}
        />
        <Slider
          label="Feedback"
          value={clip.delayFeedback ?? 0.3}
          min={0}
          max={0.95}
          step={0.01}
          onChange={(v) => onChange({ delayFeedback: v })}
        />
        <Slider
          label="Mix"
          value={clip.delayMix ?? 0}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onChange({ delayMix: v })}
        />
      </div>
    </div>
  );
}

const fxCard: React.CSSProperties = {
  gridColumn: "span 1",
  background: "rgba(0,0,0,0.25)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 4,
  padding: "6px 8px",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const fxTitle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  opacity: 0.7,
};

const hint: React.CSSProperties = {
  fontSize: 10,
  opacity: 0.55,
  lineHeight: 1.3,
};

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  logScale?: boolean;
  unit?: string;
  onChange: (v: number) => void;
}

function Slider({ label, value, min, max, step, logScale, unit, onChange }: SliderProps) {
  const to = (v: number) => (logScale ? Math.log(Math.max(1e-4, v)) : v);
  const from = (v: number) => (logScale ? Math.exp(v) : v);
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 56, fontSize: 11 }}>{label}</span>
      <input
        type="range"
        min={to(min)}
        max={to(max)}
        step={logScale ? (to(max) - to(min)) / 400 : step}
        value={to(value)}
        onChange={(e) => onChange(from(parseFloat(e.target.value)))}
        style={{ flex: 1 }}
      />
      <span
        style={{
          width: 46,
          textAlign: "right",
          fontSize: 10,
          opacity: 0.8,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value.toFixed(2)}
        {unit ? ` ${unit}` : ""}
      </span>
    </label>
  );
}

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
