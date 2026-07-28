import { useState } from "react";
import {
  samplePlayDurationSec,
  sampleTrimRange,
  type Sample,
  type SampleAutoParam,
  type SampleClip,
} from "../state";
import { sampleTrackAutomation } from "../audio/sampleAutomation";
import { RangeSlider } from "../components/RangeSlider";
import { SampleWaveform } from "./SampleWaveform";
import { bakeSampleTrim } from "./bakeSampleTrim";
import { getSampleEngine } from "../audio/SampleEngine";
import { useSimStore } from "../state";

interface Props {
  clip: SampleClip;
  sample: Sample | undefined;
  onChangeTrack: (patch: Partial<Sample>) => void;
  onChangeClip: (patch: Partial<SampleClip>) => void;
  onDelete: () => void;
}

/**
 * Selected-clip editor. Sound/FX knobs edit the parent library *track*
 * (shared by every placement of that sample). Only Start is per-clip.
 */
export function SampleClipEditor({
  clip,
  sample,
  onChangeTrack,
  onChangeClip,
  onDelete,
}: Props) {
  const [baking, setBaking] = useState(false);

  if (!sample) {
    return (
      <div
        style={{
          marginTop: 8,
          padding: 10,
          borderRadius: 6,
          background: "rgba(251,146,60,0.08)",
          border: "1px solid rgba(251,146,60,0.35)",
          fontSize: 11,
        }}
      >
        (missing sample)
        <button onClick={onDelete} style={{ ...btn, marginLeft: 8 }}>
          Delete
        </button>
      </div>
    );
  }

  const trim = sampleTrimRange(sample);
  const playSec = samplePlayDurationSec(sample);
  const isTrimmed =
    trim.start > 0.001 || trim.end < sample.durationSec - 0.001;
  const skyHour = useSimStore((s) => s.sky.timeHours);

  const live = (param: SampleAutoParam) =>
    sampleTrackAutomation(sample, skyHour, param);

  const setTrim = (start: number, end: number) => {
    onChangeTrack({ trimStartSec: start, trimEndSec: end });
  };

  const onBake = async () => {
    if (!isTrimmed || baking) return;
    if (
      !confirm(
        `Permanently shorten “${sample.name}” to ${playSec.toFixed(2)}s? This rewrites the stored audio.`,
      )
    ) {
      return;
    }
    setBaking(true);
    try {
      const newDur = await bakeSampleTrim(sample.id, trim.start, trim.end);
      getSampleEngine().invalidateBuffer(sample.id);
      onChangeTrack({
        durationSec: newDur,
        trimStartSec: 0,
        trimEndSec: newDur,
      });
    } catch (err) {
      console.warn("[samples] bake trim failed", err);
      alert("Could not bake trim — see console for details.");
    } finally {
      setBaking(false);
    }
  };

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
        <strong>{sample.name}</strong>
        <span style={{ opacity: 0.65 }}>
          {playSec.toFixed(2)}s play
          {isTrimmed ? ` / ${sample.durationSec.toFixed(2)}s file` : ""}
          {` · ${(playSec / sample.playbackRate).toFixed(2)}s @ rate ${sample.playbackRate.toFixed(2)}`}
          {" · track settings apply to all placements"}
        </span>
        <label
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}
          title="Odds each placement on this track sounds when the playhead enters its span"
        >
          <span style={{ opacity: 0.75 }}>Chance</span>
          <select
            value={sample.triggerProbability}
            onChange={(e) =>
              onChangeTrack({ triggerProbability: parseFloat(e.target.value) })
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

      <div style={trimCard}>
        <div style={fxTitle}>Trim</div>
        <div
          style={{
            position: "relative",
            height: 44,
            borderRadius: 4,
            background: "rgba(0,0,0,0.35)",
            overflow: "hidden",
            marginBottom: 8,
          }}
        >
          <SampleWaveform
            sampleId={sample.id}
            color="rgba(251,146,60,0.9)"
            trimStartFrac={
              sample.durationSec > 0 ? trim.start / sample.durationSec : 0
            }
            trimEndFrac={
              sample.durationSec > 0 ? trim.end / sample.durationSec : 1
            }
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 36, opacity: 0.75 }}>Region</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <RangeSlider
              min={0}
              max={Math.max(0.01, sample.durationSec)}
              step={0.01}
              value={[trim.start, trim.end]}
              onChange={([lo, hi]) => setTrim(lo, hi)}
              color="#fb923c"
            />
          </div>
          <span
            style={{
              width: 110,
              textAlign: "right",
              fontVariantNumeric: "tabular-nums",
              opacity: 0.85,
            }}
          >
            {trim.start.toFixed(2)}–{trim.end.toFixed(2)}s
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 6,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            style={btn}
            disabled={!isTrimmed}
            onClick={() => setTrim(0, sample.durationSec)}
          >
            Reset
          </button>
          <button
            type="button"
            style={btn}
            disabled={!isTrimmed || baking}
            onClick={() => void onBake()}
            title="Rewrite the stored file to the trimmed region"
          >
            {baking ? "Baking…" : "Bake to file"}
          </button>
          <span style={hint}>
            Trim shortens arrangement clips and playback. Bake makes it
            permanent in IndexedDB.
          </span>
        </div>
      </div>

      <Slider
        label="Gain"
        value={sample.gain}
        live={live("gain")}
        min={0}
        max={1}
        step={0.01}
        auto={!!sample.automation?.gain?.length}
        onChange={(v) => onChangeTrack({ gain: v })}
      />
      <Slider
        label="Pan"
        value={sample.pan}
        live={live("pan")}
        min={-1}
        max={1}
        step={0.01}
        auto={!!sample.automation?.pan?.length}
        onChange={(v) => onChangeTrack({ pan: v })}
      />
      <Slider
        label="Filter"
        value={sample.filterHz}
        live={live("filterHz")}
        min={20}
        max={20000}
        step={1}
        logScale
        unit="Hz"
        auto={!!sample.automation?.filterHz?.length}
        onChange={(v) => onChangeTrack({ filterHz: v })}
      />
      <Slider
        label="Rate"
        value={sample.playbackRate}
        min={0.25}
        max={4}
        step={0.01}
        logScale
        unit="×"
        onChange={(v) => onChangeTrack({ playbackRate: v })}
      />
      <Slider
        label="Fade in"
        value={sample.fadeInSec}
        min={0}
        max={2}
        step={0.01}
        unit="s"
        onChange={(v) => onChangeTrack({ fadeInSec: v })}
      />
      <Slider
        label="Fade out"
        value={sample.fadeOutSec}
        min={0}
        max={2}
        step={0.01}
        unit="s"
        onChange={(v) => onChangeTrack({ fadeOutSec: v })}
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
            onChangeClip({
              startHour: Math.max(0, Math.min(24, parseFloat(e.target.value) || 0)),
            })
          }
          style={numInput}
        />
        <span style={{ opacity: 0.6 }}>h</span>
      </label>

      <div style={fxCard}>
        <div style={fxTitle}>Random pitch</div>
        <Slider
          label="Range"
          value={sample.randomPitchCents}
          min={0}
          max={1200}
          step={1}
          unit="c"
          onChange={(v) => onChangeTrack({ randomPitchCents: v })}
        />
        <div style={hint}>
          On each span enter, pitch is offset by a random amount in
          ±range cents. 1200c = ±1 octave. Shared by every placement on
          this track.
        </div>
      </div>
      <div style={fxCard}>
        <div style={fxTitle}>Reverb</div>
        <Slider
          label="Mix"
          value={sample.reverbMix}
          live={live("reverbMix")}
          min={0}
          max={1}
          step={0.01}
          auto={!!sample.automation?.reverbMix?.length}
          onChange={(v) => onChangeTrack({ reverbMix: v })}
        />
        <Slider
          label="Size"
          value={sample.reverbDecay}
          min={0}
          max={0.99}
          step={0.01}
          onChange={(v) => onChangeTrack({ reverbDecay: v })}
        />
      </div>
      <div style={fxCard}>
        <div style={fxTitle}>Delay</div>
        <Slider
          label="Time"
          value={sample.delayTimeSec}
          min={0.01}
          max={2}
          step={0.01}
          unit="s"
          logScale
          onChange={(v) => onChangeTrack({ delayTimeSec: v })}
        />
        <Slider
          label="Feedback"
          value={sample.delayFeedback}
          min={0}
          max={0.95}
          step={0.01}
          onChange={(v) => onChangeTrack({ delayFeedback: v })}
        />
        <Slider
          label="Mix"
          value={sample.delayMix}
          live={live("delayMix")}
          min={0}
          max={1}
          step={0.01}
          auto={!!sample.automation?.delayMix?.length}
          onChange={(v) => onChangeTrack({ delayMix: v })}
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

const trimCard: React.CSSProperties = {
  ...fxCard,
  gridColumn: "1 / -1",
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
  /** Live automated value at the playhead (shown when `auto`). */
  live?: number;
  min: number;
  max: number;
  step: number;
  logScale?: boolean;
  unit?: string;
  /** True when day-timeline automation overrides this knob. */
  auto?: boolean;
  onChange: (v: number) => void;
}

function Slider({
  label,
  value,
  live,
  min,
  max,
  step,
  logScale,
  unit,
  auto,
  onChange,
}: SliderProps) {
  const to = (v: number) => (logScale ? Math.log(Math.max(1e-4, v)) : v);
  const from = (v: number) => (logScale ? Math.exp(v) : v);
  const shown = auto && live != null ? live : value;
  const fmt = (v: number) => {
    if (unit === "Hz") {
      return v >= 1000 ? `${(v / 1000).toFixed(1)}k Hz` : `${Math.round(v)} Hz`;
    }
    return `${v.toFixed(2)}${unit ? ` ${unit}` : ""}`;
  };
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 56, fontSize: 11 }}>
        {label}
        {auto ? (
          <span
            title="Automated on the day timeline — Clear the lane to use this knob. Number shows live playhead value."
            style={{
              marginLeft: 4,
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: 0.3,
              color: "rgba(251,146,60,0.95)",
              verticalAlign: "super",
            }}
          >
            AUTO
          </span>
        ) : null}
      </span>
      <input
        type="range"
        min={to(min)}
        max={to(max)}
        step={logScale ? (to(max) - to(min)) / 400 : step}
        value={to(value)}
        onChange={(e) => onChange(from(parseFloat(e.target.value)))}
        style={{ flex: 1, opacity: auto ? 0.55 : 1 }}
      />
      <span
        style={{
          width: 52,
          textAlign: "right",
          fontSize: 10,
          opacity: 0.8,
          fontVariantNumeric: "tabular-nums",
          color: auto ? "rgba(251,146,60,0.95)" : "inherit",
        }}
      >
        {fmt(shown)}
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
