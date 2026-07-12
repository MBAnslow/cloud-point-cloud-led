import { useCallback, useMemo, useRef } from "react";
import { useSimStore, type MasterFxParams } from "../state";

const PLOT_W = 360;
const PLOT_H = 70;
const F_MIN = 20;
const F_MAX = 20000;
const DB_MIN = -30;
const DB_MAX = 12;

/**
 * Compact, always-visible master frequency panel. Owns the shared
 * `MasterFxParams` slice: two filter rows (LPF + HPF) plus per-engine
 * Apply / Bypass toggles that decide whether each engine's output
 * flows through the EQ chain or a direct passthrough. A tiny magnitude
 * response plot summarizes the combined LPF+HPF curve so the user can
 * see the shape at a glance.
 */
export function MasterFrequencyPanel() {
  const fx = useSimStore((s) => s.masterFx);
  const setMasterFx = useSimStore((s) => s.setMasterFx);
  const upd = useCallback(
    (patch: Partial<MasterFxParams>) => setMasterFx(patch),
    [setMasterFx],
  );
  return (
    <div style={panelStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={titleStyle}>Master Frequency</div>
        <EngineToggle
          label="Drone"
          apply={fx.applyToDrone}
          onChange={(v) => upd({ applyToDrone: v })}
        />
        <EngineToggle
          label="Pad"
          apply={fx.applyToPad}
          onChange={(v) => upd({ applyToPad: v })}
        />
        <EngineToggle
          label="Samples"
          apply={fx.applyToSamples}
          onChange={(v) => upd({ applyToSamples: v })}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
        <FilterRow
          label="LPF"
          enabled={fx.lpEnabled}
          hz={fx.lpHz}
          q={fx.lpQ}
          onToggle={(v) => upd({ lpEnabled: v })}
          onHz={(v) => upd({ lpHz: v })}
          onQ={(v) => upd({ lpQ: v })}
        />
        <FilterRow
          label="HPF"
          enabled={fx.hpEnabled}
          hz={fx.hpHz}
          q={fx.hpQ}
          onToggle={(v) => upd({ hpEnabled: v })}
          onHz={(v) => upd({ hpHz: v })}
          onQ={(v) => upd({ hpQ: v })}
        />
      </div>
      <div style={{ marginTop: 4 }}>
        <ResponsePlot fx={fx} />
      </div>
    </div>
  );
}

function EngineToggle({
  label,
  apply,
  onChange,
}: {
  label: string;
  apply: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        opacity: 0.9,
      }}
    >
      <span style={{ opacity: 0.75 }}>{label}</span>
      <select
        value={apply ? "apply" : "bypass"}
        onChange={(e) => onChange(e.target.value === "apply")}
        style={selectStyle}
      >
        <option value="apply">Apply</option>
        <option value="bypass">Bypass</option>
      </select>
    </label>
  );
}

function FilterRow({
  label,
  enabled,
  hz,
  q,
  onToggle,
  onHz,
  onQ,
}: {
  label: string;
  enabled: boolean;
  hz: number;
  q: number;
  onToggle: (v: boolean) => void;
  onHz: (v: number) => void;
  onQ: (v: number) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        opacity: enabled ? 1 : 0.55,
      }}
    >
      <button
        onClick={() => onToggle(!enabled)}
        title={enabled ? "Disable" : "Enable"}
        style={{
          ...pillStyle,
          background: enabled ? "#4c6ef5" : "rgba(255,255,255,0.08)",
          borderColor: enabled ? "#4c6ef5" : "rgba(255,255,255,0.2)",
        }}
      >
        ⏻
      </button>
      <span style={{ width: 28, opacity: 0.85 }}>{label}</span>
      <LogRange
        min={F_MIN}
        max={F_MAX}
        value={hz}
        onChange={onHz}
        width={140}
      />
      <span style={{ width: 60, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {formatHz(hz)}
      </span>
      <span style={{ opacity: 0.6 }}>Q</span>
      <input
        type="range"
        min={0.1}
        max={12}
        step={0.05}
        value={q}
        onChange={(e) => onQ(parseFloat(e.target.value))}
        style={{ width: 70 }}
      />
      <span style={{ width: 34, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {q.toFixed(2)}
      </span>
    </div>
  );
}

function LogRange({
  min,
  max,
  value,
  onChange,
  width,
}: {
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  width: number;
}) {
  const lMin = Math.log(min);
  const lMax = Math.log(max);
  const pos = Math.max(0, Math.min(1, (Math.log(Math.max(min, value)) - lMin) / (lMax - lMin)));
  return (
    <input
      type="range"
      min={0}
      max={1}
      step={0.001}
      value={pos}
      onChange={(e) => {
        const t = parseFloat(e.target.value);
        onChange(Math.exp(lMin + t * (lMax - lMin)));
      }}
      style={{ width }}
    />
  );
}

function ResponsePlot({ fx }: { fx: MasterFxParams }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const path = useMemo(() => {
    const N = PLOT_W;
    const lMin = Math.log(F_MIN);
    const lMax = Math.log(F_MAX);
    let d = "";
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const f = Math.exp(lMin + t * (lMax - lMin));
      let db = 0;
      if (fx.lpEnabled) db += biquadDb("lowpass", f, fx.lpHz, fx.lpQ, 0);
      if (fx.hpEnabled) db += biquadDb("highpass", f, fx.hpHz, fx.hpQ, 0);
      const y =
        PLOT_H -
        ((Math.max(DB_MIN, Math.min(DB_MAX, db)) - DB_MIN) / (DB_MAX - DB_MIN)) *
          PLOT_H;
      d += (i === 0 ? "M" : "L") + i.toFixed(1) + " " + y.toFixed(2) + " ";
    }
    return d;
  }, [fx]);
  return (
    <svg
      ref={svgRef}
      width={PLOT_W}
      height={PLOT_H}
      viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
      style={{
        display: "block",
        background: "rgba(0,0,0,0.35)",
        borderRadius: 4,
        border: "1px solid rgba(255,255,255,0.1)",
      }}
    >
      {/* 0 dB baseline */}
      <line
        x1={0}
        x2={PLOT_W}
        y1={((DB_MAX - 0) / (DB_MAX - DB_MIN)) * PLOT_H}
        y2={((DB_MAX - 0) / (DB_MAX - DB_MIN)) * PLOT_H}
        stroke="rgba(255,255,255,0.15)"
      />
      <path d={path} fill="none" stroke="#82c9ff" strokeWidth={1.5} />
    </svg>
  );
}

/**
 * Analytical magnitude response of a biquad filter in dB. Standard
 * RBJ cookbook formulas. `gainDb` is ignored for non-peaking/shelf.
 */
function biquadDb(
  type: "lowpass" | "highpass",
  f: number,
  f0: number,
  Q: number,
  _gainDb: number,
): number {
  void _gainDb;
  const w = 2 * Math.PI * f;
  const w0 = 2 * Math.PI * f0;
  const s = w / w0;
  // |H(jw)|² for RBJ LP/HP normalized to 0 dB at DC / Nyquist respectively.
  if (type === "lowpass") {
    const denom = Math.pow(1 - s * s, 2) + Math.pow(s / Q, 2);
    return 10 * Math.log10(1 / denom);
  }
  const denom = Math.pow(1 - s * s, 2) + Math.pow(s / Q, 2);
  const num = Math.pow(s, 4);
  return 10 * Math.log10(num / denom);
}

function formatHz(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)}k`;
  return `${v.toFixed(0)}`;
}

const panelStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 12,
  left: 12,
  zIndex: 15,
  background: "rgba(10, 12, 20, 0.82)",
  backdropFilter: "blur(8px)",
  color: "rgba(207,214,230,0.95)",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.12)",
  fontFamily:
    "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  width: PLOT_W + 24,
};

const titleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: 0.3,
  marginRight: "auto",
};

const selectStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  color: "inherit",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 4,
  padding: "1px 3px",
  fontSize: 11,
};

const pillStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 4,
  color: "inherit",
  fontSize: 10,
  lineHeight: 1,
  padding: "2px 5px",
  cursor: "pointer",
};
