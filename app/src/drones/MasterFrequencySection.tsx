import { useSimStore, type DroneParams } from "../state";

/**
 * Master frequency shaping section: high-pass, low-pass, and a peak
 * (bell) filter arranged serially on the drone bus. Each filter can be
 * bypassed with its power button. The bottom of the panel draws the
 * combined magnitude response so users see what the chain is doing.
 *
 * Signal chain (see DroneEngine): bus → highPass → peak → lowPass →
 *   tremolo → distortion → reverb → master.
 */
export function MasterFrequencySection() {
  const drone = useSimStore((s) => s.drone);
  const setDrone = useSimStore((s) => s.setDrone);

  return (
    <section
      style={{
        padding: 14,
        borderRadius: 10,
        background: "rgba(0,0,0,0.35)",
        border: "1px solid rgba(255,255,255,0.1)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <strong style={{ fontSize: 13, letterSpacing: 0.3 }}>
          Master frequency
        </strong>
        <span style={{ fontSize: 11, opacity: 0.6 }}>
          shape the composite drone before FX
        </span>
      </div>

      <FilterRow
        title="Low Pass Filter"
        icon="☾"
        accent="#22c55e"
        enabled={drone.filterEnabled}
        onToggle={(v) => setDrone({ filterEnabled: v })}
        freq={drone.filterHz}
        onFreq={(v) => setDrone({ filterHz: v })}
        q={drone.filterQ}
        onQ={(v) => setDrone({ filterQ: v })}
      />

      <FilterRow
        title="High Pass Filter"
        icon="☀"
        accent="#22c55e"
        enabled={drone.highPassEnabled}
        onToggle={(v) => setDrone({ highPassEnabled: v })}
        freq={drone.highPassHz}
        onFreq={(v) => setDrone({ highPassHz: v })}
        q={drone.highPassQ}
        onQ={(v) => setDrone({ highPassQ: v })}
      />

      <PeakRow
        enabled={drone.peakEnabled}
        onToggle={(v) => setDrone({ peakEnabled: v })}
        freq={drone.peakHz}
        onFreq={(v) => setDrone({ peakHz: v })}
        q={drone.peakQ}
        onQ={(v) => setDrone({ peakQ: v })}
        gainDb={drone.peakGainDb}
        onGainDb={(v) => setDrone({ peakGainDb: v })}
      />

      <ResponsePlot drone={drone} />
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Row components                                                              */
/* -------------------------------------------------------------------------- */

function FilterRow({
  title,
  icon,
  accent,
  enabled,
  onToggle,
  freq,
  onFreq,
  q,
  onQ,
}: {
  title: string;
  icon: string;
  accent: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  freq: number;
  onFreq: (v: number) => void;
  q: number;
  onQ: (v: number) => void;
}) {
  return (
    <div style={rowWrap(enabled)}>
      <div style={rowHeader}>
        <span style={{ fontSize: 15, opacity: 0.9 }}>{icon}</span>
        <strong style={{ fontSize: 12 }}>{title}</strong>
        <PowerButton enabled={enabled} onToggle={onToggle} accent={accent} />
      </div>
      <div style={sliderRow}>
        <LogRange
          value={freq}
          min={20}
          max={20000}
          onChange={onFreq}
          accent={accent}
        />
        <ReadoutHz value={freq} />
      </div>
      <div style={inlineControl}>
        <span style={inlineLabel}>Q</span>
        <input
          type="number"
          min={0.1}
          max={12}
          step={0.1}
          value={+q.toFixed(2)}
          onChange={(e) => onQ(parseFloat(e.target.value) || 0.1)}
          style={numInput}
        />
      </div>
    </div>
  );
}

function PeakRow({
  enabled,
  onToggle,
  freq,
  onFreq,
  q,
  onQ,
  gainDb,
  onGainDb,
}: {
  enabled: boolean;
  onToggle: (v: boolean) => void;
  freq: number;
  onFreq: (v: number) => void;
  q: number;
  onQ: (v: number) => void;
  gainDb: number;
  onGainDb: (v: number) => void;
}) {
  return (
    <div style={rowWrap(enabled)}>
      <div style={rowHeader}>
        <span style={{ fontSize: 15, opacity: 0.9 }}>▲</span>
        <strong style={{ fontSize: 12 }}>Peak Filter</strong>
        <PowerButton enabled={enabled} onToggle={onToggle} accent="#22c55e" />
      </div>
      <div style={sliderRow}>
        <LogRange
          value={freq}
          min={20}
          max={20000}
          onChange={onFreq}
          accent="#22c55e"
        />
        <ReadoutHz value={freq} />
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={inlineControl}>
          <span style={inlineLabel}>Q</span>
          <input
            type="number"
            min={0.1}
            max={20}
            step={0.1}
            value={+q.toFixed(2)}
            onChange={(e) => onQ(parseFloat(e.target.value) || 0.1)}
            style={numInput}
          />
        </div>
        <div style={inlineControl}>
          <span style={inlineLabel}>dB</span>
          <input
            type="number"
            min={-24}
            max={24}
            step={0.5}
            value={+gainDb.toFixed(1)}
            onChange={(e) => onGainDb(parseFloat(e.target.value) || 0)}
            style={numInput}
          />
        </div>
      </div>
    </div>
  );
}

function PowerButton({
  enabled,
  onToggle,
  accent,
}: {
  enabled: boolean;
  onToggle: (v: boolean) => void;
  accent: string;
}) {
  return (
    <button
      onClick={() => onToggle(!enabled)}
      title={enabled ? "Bypass" : "Enable"}
      style={{
        marginLeft: "auto",
        background: enabled ? accent : "rgba(255,255,255,0.08)",
        color: enabled ? "#0a1420" : "rgba(207,214,230,0.7)",
        border: `1px solid ${enabled ? accent : "rgba(255,255,255,0.2)"}`,
        borderRadius: 999,
        width: 26,
        height: 22,
        cursor: "pointer",
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      ⏻
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Combined magnitude response                                                */
/* -------------------------------------------------------------------------- */

/** Draws the composite magnitude response of the master EQ chain. */
function ResponsePlot({ drone }: { drone: DroneParams }) {
  const W = 520;
  const H = 150;
  const PAD_X = 34;
  const PAD_Y = 18;
  const FMIN = 20;
  const FMAX = 20000;
  const DB_MIN = -24;
  const DB_MAX = 24;

  const xForF = (f: number) => {
    const t = (Math.log(f) - Math.log(FMIN)) / (Math.log(FMAX) - Math.log(FMIN));
    return PAD_X + t * (W - PAD_X * 2);
  };
  const yForDb = (db: number) => {
    const t = (db - DB_MIN) / (DB_MAX - DB_MIN);
    return H - PAD_Y - t * (H - PAD_Y * 2);
  };

  const samples = 220;
  const pts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const f = Math.exp(
      Math.log(FMIN) + u * (Math.log(FMAX) - Math.log(FMIN)),
    );
    const db = totalDb(f, drone);
    const clamped = Math.max(DB_MIN, Math.min(DB_MAX, db));
    pts.push(`${xForF(f).toFixed(1)},${yForDb(clamped).toFixed(1)}`);
  }
  const path = `M ${pts.join(" L ")}`;
  const y0 = yForDb(0);
  const fill = `${path} L ${xForF(FMAX)} ${y0} L ${xForF(FMIN)} ${y0} Z`;

  const gridDb = [20, 10, 0, -10, -20];
  const gridF = [20, 100, 1000, 10000, 20000];

  return (
    <div
      style={{
        background: "rgba(0,0,0,0.55)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 8,
        padding: 8,
      }}
    >
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        {gridDb.map((db) => {
          const y = yForDb(db);
          return (
            <g key={db}>
              <line
                x1={PAD_X}
                x2={W - PAD_X}
                y1={y}
                y2={y}
                stroke={db === 0 ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.08)"}
              />
              <text
                x={PAD_X - 4}
                y={y + 3}
                fontSize={9}
                textAnchor="end"
                fill="rgba(255,255,255,0.6)"
              >
                {db > 0 ? `+${db}` : db}
              </text>
            </g>
          );
        })}
        <text
          x={8}
          y={12}
          fontSize={9}
          fill="rgba(255,255,255,0.6)"
        >
          dB
        </text>
        {gridF.map((f) => {
          const x = xForF(f);
          return (
            <g key={f}>
              <line
                x1={x}
                x2={x}
                y1={PAD_Y}
                y2={H - PAD_Y}
                stroke="rgba(255,255,255,0.08)"
              />
              <text
                x={x}
                y={H - 4}
                fontSize={9}
                textAnchor="middle"
                fill="rgba(255,255,255,0.6)"
              >
                {f >= 1000 ? `${f / 1000}k` : f}
              </text>
            </g>
          );
        })}
        <text
          x={W / 2}
          y={H - 4}
          fontSize={9}
          textAnchor="middle"
          fill="rgba(255,255,255,0.5)"
        >
          Hz
        </text>
        <path d={fill} fill="rgba(34,197,94,0.18)" />
        <path d={path} fill="none" stroke="#22c55e" strokeWidth={2} />
      </svg>
    </div>
  );
}

/** Composite EQ response in dB at frequency f (Hz). */
function totalDb(f: number, d: DroneParams): number {
  let db = 0;
  if (d.filterEnabled) db += biquadDb("lowpass", f, d.filterHz, d.filterQ, 0);
  if (d.highPassEnabled) db += biquadDb("highpass", f, d.highPassHz, d.highPassQ, 0);
  if (d.peakEnabled) db += biquadDb("peaking", f, d.peakHz, d.peakQ, d.peakGainDb);
  return db;
}

/**
 * Analytical Web Audio-style BiquadFilterNode magnitude response,
 * matching Chrome's implementation of the "RBJ Audio EQ Cookbook".
 * Returns the response in dB. Only handles the three types we use.
 */
function biquadDb(
  type: "lowpass" | "highpass" | "peaking",
  f: number,
  f0: number,
  Q: number,
  gainDb: number,
): number {
  const fs = 48000;
  const w0 = (2 * Math.PI * f0) / fs;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Math.max(0.0001, Q));
  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  if (type === "lowpass") {
    b0 = (1 - cosw0) / 2;
    b1 = 1 - cosw0;
    b2 = (1 - cosw0) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cosw0;
    a2 = 1 - alpha;
  } else if (type === "highpass") {
    b0 = (1 + cosw0) / 2;
    b1 = -(1 + cosw0);
    b2 = (1 + cosw0) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cosw0;
    a2 = 1 - alpha;
  } else {
    const A = Math.pow(10, gainDb / 40);
    b0 = 1 + alpha * A;
    b1 = -2 * cosw0;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cosw0;
    a2 = 1 - alpha / A;
  }
  const w = (2 * Math.PI * f) / fs;
  const cosw = Math.cos(w);
  const cos2w = Math.cos(2 * w);
  const sinw = Math.sin(w);
  const sin2w = Math.sin(2 * w);
  const numRe = b0 + b1 * cosw + b2 * cos2w;
  const numIm = -(b1 * sinw + b2 * sin2w);
  const denRe = a0 + a1 * cosw + a2 * cos2w;
  const denIm = -(a1 * sinw + a2 * sin2w);
  const numMag = Math.sqrt(numRe * numRe + numIm * numIm);
  const denMag = Math.sqrt(denRe * denRe + denIm * denIm);
  const magnitude = numMag / Math.max(1e-9, denMag);
  return 20 * Math.log10(Math.max(1e-9, magnitude));
}

/* -------------------------------------------------------------------------- */
/* Small controls                                                              */
/* -------------------------------------------------------------------------- */

function LogRange({
  value,
  min,
  max,
  onChange,
  accent,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  accent: string;
}) {
  const sMin = Math.log(min);
  const sMax = Math.log(max);
  return (
    <input
      type="range"
      min={sMin}
      max={sMax}
      step={(sMax - sMin) / 500}
      value={Math.log(Math.max(1e-4, value))}
      onChange={(e) => onChange(Math.exp(parseFloat(e.target.value)))}
      style={{ flex: 1, accentColor: accent }}
    />
  );
}

function ReadoutHz({ value }: { value: number }) {
  const s =
    value >= 1000 ? `${(value / 1000).toFixed(2)} kHz` : `${value.toFixed(0)} Hz`;
  return (
    <span
      style={{
        fontSize: 10,
        opacity: 0.75,
        width: 70,
        textAlign: "right",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {s}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Styles                                                                      */
/* -------------------------------------------------------------------------- */

function rowWrap(enabled: boolean): React.CSSProperties {
  return {
    padding: 10,
    borderRadius: 8,
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.08)",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    opacity: enabled ? 1 : 0.65,
  };
}

const rowHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const sliderRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const inlineControl: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11,
};

const inlineLabel: React.CSSProperties = {
  opacity: 0.7,
  minWidth: 20,
};

const numInput: React.CSSProperties = {
  width: 60,
  background: "rgba(255,255,255,0.06)",
  color: "inherit",
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 4,
  padding: "2px 6px",
  fontSize: 11,
};
