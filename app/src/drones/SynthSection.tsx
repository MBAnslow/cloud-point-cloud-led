import { useEffect, useRef, useState } from "react";
import {
  useSimStore,
  type DroneLfoShape,
  type DroneWaveform,
} from "../state";

const WAVEFORMS: DroneWaveform[] = ["sine", "triangle", "sawtooth", "square"];
const LFO_SHAPES: DroneLfoShape[] = ["sine", "triangle", "square", "sawtooth"];

/**
 * Synth panel: ADSR + tremolo (amplitude pulsation) + filter with its
 * own LFO. Each modulation section has a live visualization of the
 * LFO shape scrolling at its actual rate, so the visual and the sound
 * stay in lockstep.
 */
export function SynthSection() {
  const drone = useSimStore((s) => s.drone);
  const setDrone = useSimStore((s) => s.setDrone);

  return (
    <section
      style={{
        padding: "10px 0",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={row3}>
        <Card title="Oscillator + ADSR">
          <label style={inlineLabel}>
            <span style={{ width: 60 }}>Waveform</span>
            <select
              value={drone.waveform}
              onChange={(e) => setDrone({ waveform: e.target.value as DroneWaveform })}
              style={selectStyle}
            >
              {WAVEFORMS.map((w) => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
          </label>
          <Slider label="Attack" value={drone.attack} min={0.001} max={5} step={0.01} unit="s" onChange={(v) => setDrone({ attack: v })} />
          <Slider label="Decay" value={drone.decay} min={0.001} max={5} step={0.01} unit="s" onChange={(v) => setDrone({ decay: v })} />
          <Slider label="Sustain" value={drone.sustain} min={0} max={1} step={0.01} onChange={(v) => setDrone({ sustain: v })} />
          <Slider label="Release" value={drone.release} min={0.001} max={8} step={0.01} unit="s" onChange={(v) => setDrone({ release: v })} />
          <EnvelopeGraph a={drone.attack} d={drone.decay} s={drone.sustain} r={drone.release} />
        </Card>

        <Card title="Tremolo (amp pulsation)">
          <Slider label="Rate" value={drone.tremoloRateHz} min={0.05} max={20} step={0.01} unit="Hz" logScale onChange={(v) => setDrone({ tremoloRateHz: v })} />
          <Slider label="Depth" value={drone.tremoloDepth} min={0} max={1} step={0.01} onChange={(v) => setDrone({ tremoloDepth: v })} />
          <label style={inlineLabel}>
            <span style={{ width: 60 }}>Shape</span>
            <select
              value={drone.tremoloShape}
              onChange={(e) => setDrone({ tremoloShape: e.target.value as DroneLfoShape })}
              style={selectStyle}
            >
              {LFO_SHAPES.map((w) => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
          </label>
          <LfoScope
            rateHz={drone.tremoloRateHz}
            depth={drone.tremoloDepth}
            shape={drone.tremoloShape}
            colorStroke="#f472b6"
            colorFill="rgba(244,114,182,0.15)"
            label={`${drone.tremoloRateHz.toFixed(2)} Hz × ${(drone.tremoloDepth * 100).toFixed(0)}%`}
          />
        </Card>

      </div>
    </section>
  );
}

/** Compact envelope shape SVG. Rescales so all four phases are visible. */
function EnvelopeGraph({ a, d, s, r }: { a: number; d: number; s: number; r: number }) {
  const W = 260;
  const H = 90;
  const PAD_X = 8;
  const PAD_Y_TOP = 6;
  const PAD_Y_BOT = 18;
  const total = a + d + r;
  const drawable = W - PAD_X * 2;
  const sustainW = drawable * 0.28;
  const dynamicW = drawable - sustainW;
  const scale = dynamicW / Math.max(0.001, total);
  const x0 = PAD_X;
  const x1 = x0 + a * scale;
  const x2 = x1 + d * scale;
  const x3 = x2 + sustainW;
  const x4 = x3 + r * scale;
  const yTop = PAD_Y_TOP;
  const yBot = H - PAD_Y_BOT;
  const y = (v: number) => yBot - v * (yBot - yTop);
  const yPeak = y(1);
  const ySus = y(s);
  const y0 = y(0);
  const path = `M ${x0} ${y0} L ${x1} ${yPeak} L ${x2} ${ySus} L ${x3} ${ySus} L ${x4} ${y0}`;
  return (
    <div style={vizWrap}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        <line x1={PAD_X} y1={yBot} x2={W - PAD_X} y2={yBot} stroke="rgba(255,255,255,0.15)" />
        <line x1={PAD_X} y1={ySus} x2={W - PAD_X} y2={ySus} stroke="rgba(56,189,248,0.25)" strokeDasharray="2 4" />
        <path d={`${path} L ${x4} ${yBot} L ${x0} ${yBot} Z`} fill="rgba(56,189,248,0.15)" />
        <path d={path} fill="none" stroke="#38bdf8" strokeWidth={2} strokeLinejoin="round" />
        {["A", "D", "S", "R"].map((L, i) => {
          const cx = [(x0 + x1) / 2, (x1 + x2) / 2, (x2 + x3) / 2, (x3 + x4) / 2][i];
          return (
            <text key={L} x={cx} y={H - 4} fontSize={10} textAnchor="middle" fill="rgba(255,255,255,0.7)" fontWeight={600}>{L}</text>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * Live LFO scope. Draws two cycles of the current shape, scaled by
 * depth, and slides a playhead across at the actual rate so you can
 * hear-and-see the modulation move in lockstep.
 */
function LfoScope({
  rateHz,
  depth,
  shape,
  colorStroke,
  colorFill,
  label,
}: {
  rateHz: number;
  depth: number;
  shape: DroneLfoShape;
  colorStroke: string;
  colorFill: string;
  label: string;
}) {
  const W = 260;
  const H = 60;
  const PAD = 6;
  const midY = H / 2;
  const amp = ((H - PAD * 2) / 2) * Math.max(0, Math.min(1, depth));
  // Draw two full cycles across the width.
  const cycles = 2;
  const samples = 120;
  const points: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const phase = u * cycles;
    const y = midY - lfoValue(shape, phase) * amp;
    const x = PAD + (i / samples) * (W - PAD * 2);
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  const path = `M ${points.join(" L ")}`;
  const zeroPath = `M ${PAD} ${midY} L ${W - PAD} ${midY}`;

  const [phase, setPhase] = useState(0);
  const rafRef = useRef(0);
  const lastTsRef = useRef<number | null>(null);
  useEffect(() => {
    const tick = (ts: number) => {
      if (lastTsRef.current === null) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      if (rateHz > 0 && depth > 0) {
        setPhase((p) => (p + dt * rateHz) % cycles);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [rateHz, depth]);
  const playheadX = PAD + (phase / cycles) * (W - PAD * 2);
  const playheadY = midY - lfoValue(shape, phase) * amp;

  return (
    <div style={vizWrap}>
      <div style={{ fontSize: 10, opacity: 0.65, marginBottom: 2 }}>{label}</div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        <path d={zeroPath} stroke="rgba(255,255,255,0.12)" strokeDasharray="2 3" />
        <path
          d={`${path} L ${W - PAD} ${midY} L ${PAD} ${midY} Z`}
          fill={colorFill}
        />
        <path d={path} fill="none" stroke={colorStroke} strokeWidth={1.6} />
        {depth > 0 && rateHz > 0 && (
          <>
            <line x1={playheadX} y1={PAD} x2={playheadX} y2={H - PAD} stroke="rgba(255,225,77,0.8)" />
            <circle cx={playheadX} cy={playheadY} r={3} fill="#ffe14d" />
          </>
        )}
      </svg>
    </div>
  );
}

/** Unit LFO value in [-1, 1] at phase in cycles (0..1 = one full cycle). */
function lfoValue(shape: DroneLfoShape, phase: number): number {
  const t = phase - Math.floor(phase);
  switch (shape) {
    case "sine":
      return Math.sin(t * Math.PI * 2);
    case "triangle":
      return 4 * Math.abs(t - 0.5) - 1;
    case "square":
      return t < 0.5 ? 1 : -1;
    case "sawtooth":
      return 2 * t - 1;
  }
}

export { Card, Slider, LfoScope, LFO_SHAPES };

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        flex: "1 1 260px",
        minWidth: 240,
        padding: 10,
        borderRadius: 8,
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.1)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ fontSize: 11, opacity: 0.8, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  unit,
  logScale,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  unit?: string;
  logScale?: boolean;
}) {
  const toS = (v: number) => (logScale ? Math.log(Math.max(1e-6, v)) : v);
  const fromS = (v: number) => (logScale ? Math.exp(v) : v);
  const sMin = toS(min);
  const sMax = toS(max);
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
      <span style={{ width: 60 }}>{label}</span>
      <input
        type="range"
        min={sMin}
        max={sMax}
        step={logScale ? (sMax - sMin) / 500 : step}
        value={toS(value)}
        onChange={(e) => onChange(fromS(parseFloat(e.target.value)))}
        style={{ flex: 1 }}
      />
      <span style={{ width: 60, textAlign: "right", opacity: 0.8, fontVariantNumeric: "tabular-nums" }}>
        {value.toFixed(logScale ? (value < 10 ? 2 : 0) : step < 0.1 ? 2 : 1)}
        {unit ? ` ${unit}` : ""}
      </span>
    </label>
  );
}

const row3: React.CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  alignItems: "stretch",
};

const inlineLabel: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 11,
};

const selectStyle: React.CSSProperties = {
  flex: 1,
  background: "rgba(255,255,255,0.06)",
  color: "rgba(207,214,230,0.95)",
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 4,
  padding: "2px 6px",
  fontSize: 11,
};

const vizWrap: React.CSSProperties = {
  marginTop: 4,
  background: "rgba(0,0,0,0.35)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  padding: 6,
};
