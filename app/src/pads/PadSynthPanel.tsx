import { useSimStore, type PadWaveform } from "../state";

const WAVEFORMS: PadWaveform[] = ["sine", "sawtooth", "square", "triangle"];

/**
 * Warm-pad synth controls: voicing, envelope, filter, chorus, reverb,
 * master. Intentionally simpler than the drone synth panel — the pad
 * uses one global patch and no per-note effects.
 */
export function PadSynthPanel() {
  const pad = useSimStore((s) => s.pad);
  const setPad = useSimStore((s) => s.setPad);

  return (
    <section style={sectionStyle}>
      <div style={grid}>
        <Card title="Voicing">
          <label style={inlineLabel}>
            <span style={{ width: 70 }}>Waveform</span>
            <select
              value={pad.waveform}
              onChange={(e) => setPad({ waveform: e.target.value as PadWaveform })}
              style={selectStyle}
            >
              {WAVEFORMS.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
          <Slider
            label="Unison"
            value={pad.unisonCount}
            min={1}
            max={8}
            step={1}
            onChange={(v) => setPad({ unisonCount: Math.round(v) })}
          />
          <Slider
            label="Spread"
            value={pad.unisonDetuneCents}
            min={0}
            max={50}
            step={0.5}
            unit="c"
            onChange={(v) => setPad({ unisonDetuneCents: v })}
          />
        </Card>

        <Card title="Envelope">
          <Slider
            label="Attack"
            value={pad.attack}
            min={0.01}
            max={8}
            step={0.01}
            unit="s"
            logScale
            onChange={(v) => setPad({ attack: v })}
          />
          <Slider
            label="Decay"
            value={pad.decay}
            min={0.01}
            max={5}
            step={0.01}
            unit="s"
            logScale
            onChange={(v) => setPad({ decay: v })}
          />
          <Slider
            label="Sustain"
            value={pad.sustain}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => setPad({ sustain: v })}
          />
          <Slider
            label="Release"
            value={pad.release}
            min={0.01}
            max={12}
            step={0.01}
            unit="s"
            logScale
            onChange={(v) => setPad({ release: v })}
          />
          <EnvelopeGraph
            a={pad.attack}
            d={pad.decay}
            s={pad.sustain}
            r={pad.release}
          />
        </Card>

        <Card title="Filter">
          <Slider
            label="Cutoff"
            value={pad.filterHz}
            min={80}
            max={18000}
            step={1}
            unit="Hz"
            logScale
            onChange={(v) => setPad({ filterHz: v })}
          />
          <Slider
            label="Q"
            value={pad.filterQ}
            min={0.1}
            max={12}
            step={0.05}
            onChange={(v) => setPad({ filterQ: v })}
          />
          <Slider
            label="Env"
            value={pad.filterEnvAmount}
            min={0}
            max={5000}
            step={10}
            unit="c"
            onChange={(v) => setPad({ filterEnvAmount: v })}
          />
          <div style={hint}>
            Env pushes cutoff up while any note is sounding — larger
            values give a more pronounced pad "swell".
          </div>
        </Card>

        <Card title="Chorus">
          <Slider
            label="Rate"
            value={pad.chorusRateHz}
            min={0.05}
            max={4}
            step={0.01}
            unit="Hz"
            logScale
            onChange={(v) => setPad({ chorusRateHz: v })}
          />
          <Slider
            label="Depth"
            value={pad.chorusDepth}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => setPad({ chorusDepth: v })}
          />
        </Card>

        <Card title="Reverb">
          <Slider
            label="Mix"
            value={pad.reverbMix}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => setPad({ reverbMix: v })}
          />
          <Slider
            label="Decay"
            value={pad.reverbDecay}
            min={0.2}
            max={10}
            step={0.05}
            unit="s"
            onChange={(v) => setPad({ reverbDecay: v })}
          />
        </Card>

        <Card title="Master">
          <label style={inlineLabel}>
            <input
              type="checkbox"
              checked={pad.enabled}
              onChange={(e) => setPad({ enabled: e.target.checked })}
            />
            <span>Enable audio</span>
          </label>
          <Slider
            label="Master"
            value={pad.master}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => setPad({ master: v })}
          />
        </Card>
      </div>
    </section>
  );
}

interface SliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  logScale?: boolean;
  unit?: string;
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  logScale,
  unit,
}: SliderProps) {
  const toSlider = (v: number) => (logScale ? Math.log(Math.max(1e-6, v)) : v);
  const fromSlider = (v: number) => (logScale ? Math.exp(v) : v);
  return (
    <label style={rowLabel}>
      <span style={{ fontSize: 11, width: 60 }}>{label}</span>
      <input
        type="range"
        min={toSlider(min)}
        max={toSlider(max)}
        step={logScale ? (toSlider(max) - toSlider(min)) / 500 : step}
        value={toSlider(value)}
        onChange={(e) => onChange(fromSlider(parseFloat(e.target.value)))}
        style={{ flex: 1 }}
      />
      <span
        style={{
          fontSize: 10,
          width: 60,
          textAlign: "right",
          opacity: 0.8,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value >= 100
          ? value.toFixed(0)
          : value >= 10
            ? value.toFixed(1)
            : value.toFixed(2)}
        {unit ? ` ${unit}` : ""}
      </span>
    </label>
  );
}

function EnvelopeGraph({
  a,
  d,
  s,
  r,
}: {
  a: number;
  d: number;
  s: number;
  r: number;
}) {
  // Layout ADSR into a 100-wide box, scaled so the whole envelope
  // (including a nominal 0.4s sustain plateau) fits.
  const total = Math.max(0.1, a + d + 0.4 + r);
  const px = (t: number) => (t / total) * 100;
  const sy = 24 - Math.max(0, Math.min(1, s)) * 20;
  const points = [
    `0,24`,
    `${px(a).toFixed(2)},4`,
    `${px(a + d).toFixed(2)},${sy.toFixed(2)}`,
    `${px(a + d + 0.4).toFixed(2)},${sy.toFixed(2)}`,
    `${px(a + d + 0.4 + r).toFixed(2)},24`,
  ].join(" ");
  return (
    <svg
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      width="100%"
      height="42"
      style={{
        background: "rgba(0,0,0,0.35)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 4,
        marginTop: 4,
      }}
    >
      <polyline
        points={points}
        fill="none"
        stroke="#c084fc"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      <polyline
        points={`0,24 ${points} 100,24`}
        fill="rgba(192,132,252,0.15)"
        stroke="none"
      />
    </svg>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={cardStyle}>
      <div style={cardTitle}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {children}
      </div>
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  padding: "10px 0",
  borderTop: "1px solid rgba(255,255,255,0.08)",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};
const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 10,
};
const cardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  padding: "8px 10px",
  display: "flex",
  flexDirection: "column",
  gap: 6,
};
const cardTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  opacity: 0.75,
};
const rowLabel: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};
const inlineLabel: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12,
};
const selectStyle: React.CSSProperties = {
  flex: 1,
  background: "rgba(255,255,255,0.06)",
  color: "rgba(207,214,230,0.95)",
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 4,
  padding: "3px 6px",
  fontSize: 11,
};
const hint: React.CSSProperties = {
  fontSize: 10,
  opacity: 0.6,
  lineHeight: 1.3,
};
