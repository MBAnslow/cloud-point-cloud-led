import { useEffect, useMemo, useState } from "react";
import * as Tone from "tone";
import type { PadParams } from "../state";
import { getPadEngine } from "../audio/PadEngine";

/**
 * Live magnitude-response plot for the pad's low-pass filter.
 *
 * Draws two curves:
 *  - a faint band showing the LFO sweep range (base ↔ base·2^-depth)
 *  - a solid curve at the *current* cutoff, animated every frame so
 *    users see the LFO wobble in real time
 *
 * Matches the pad engine's cutoff pipeline exactly:
 *   base   = filterHz * 2^(envAmount/1200 * peakEnv)
 *   cutoff = base * 2^(-depth * (0.5 + 0.5·sin(2π·rate·t)))
 * where `peakEnv ∈ [0, 1]` is the maximum ADSR envelope across all
 * live voices (queried from the engine each frame, so probability
 * suppression and release tails are honoured).
 */
export function PadFilterResponse({ pad }: { pad: PadParams }) {
  const lfoDepth = clamp(0, 1, pad.filterLfoDepth);
  const lfoActive = lfoDepth > 0 && pad.filterLfoRateHz > 0;

  // Both the base cutoff (via peakEnv) and the LFO modulate every
  // frame — sample them together.
  const [liveCutoff, setLiveCutoff] = useState(pad.filterHz);
  const [baseCutoff, setBaseCutoff] = useState(pad.filterHz);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = Tone.now();
      const engine = getPadEngine();
      const peakEnv = engine.isStarted() ? engine.getEnvelopePeak(t) : 0;
      const envOct = (Math.max(0, pad.filterEnvAmount) / 1200) * peakEnv;
      const base = clamp(20, 20000, pad.filterHz * Math.pow(2, envOct));
      setBaseCutoff(base);
      if (!lfoActive) {
        setLiveCutoff(base);
        return;
      }
      const s = 0.5 + 0.5 * Math.sin(2 * Math.PI * pad.filterLfoRateHz * t);
      setLiveCutoff(Math.max(20, base * Math.pow(2, -lfoDepth * s)));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pad.filterHz, pad.filterEnvAmount, pad.filterLfoRateHz, lfoActive, lfoDepth]);

  const minCutoff = lfoActive
    ? Math.max(20, baseCutoff * Math.pow(2, -lfoDepth))
    : baseCutoff;

  const Q = Math.max(0.1, pad.filterQ);
  const W = 300;
  const H = 90;
  const PAD_X = 26;
  const PAD_Y = 10;
  const FMIN = 20;
  const FMAX = 20000;
  const DB_MIN = -36;
  const DB_MAX = 12;

  const xForF = (f: number) =>
    PAD_X +
    ((Math.log(f) - Math.log(FMIN)) / (Math.log(FMAX) - Math.log(FMIN))) *
      (W - PAD_X * 2);
  const yForDb = (db: number) =>
    H -
    PAD_Y -
    ((db - DB_MIN) / (DB_MAX - DB_MIN)) * (H - PAD_Y * 2);

  // Sample points shared by all curves (memoized on shape params).
  const samples = 140;
  const freqs = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i <= samples; i++) {
      const u = i / samples;
      out.push(
        Math.exp(Math.log(FMIN) + u * (Math.log(FMAX) - Math.log(FMIN))),
      );
    }
    return out;
  }, []);

  const buildPath = (cutoff: number) => {
    const pts: string[] = [];
    for (const f of freqs) {
      const db = clamp(
        DB_MIN,
        DB_MAX,
        biquadLowpassDb(f, cutoff, Q),
      );
      pts.push(`${xForF(f).toFixed(1)},${yForDb(db).toFixed(1)}`);
    }
    return `M ${pts.join(" L ")}`;
  };

  const curveLive = buildPath(liveCutoff);
  const curveMin = lfoActive ? buildPath(minCutoff) : null;
  const curveMax = lfoActive ? buildPath(baseCutoff) : null;

  return (
    <div
      style={{
        background: "rgba(0,0,0,0.4)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 4,
        marginTop: 4,
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        width="100%"
        height={H}
        style={{ display: "block" }}
      >
        {/* 0-dB reference line. */}
        <line
          x1={PAD_X}
          x2={W - PAD_X}
          y1={yForDb(0)}
          y2={yForDb(0)}
          stroke="rgba(255,255,255,0.18)"
          strokeDasharray="2 3"
        />
        {/* Decade gridlines. */}
        {[100, 1000, 10000].map((f) => (
          <line
            key={f}
            x1={xForF(f)}
            x2={xForF(f)}
            y1={PAD_Y}
            y2={H - PAD_Y}
            stroke="rgba(255,255,255,0.08)"
          />
        ))}
        {/* LFO sweep band: two extreme curves + a faint fill in between. */}
        {curveMin && curveMax && (
          <>
            <path d={curveMin} fill="none" stroke="rgba(192,132,252,0.35)" strokeWidth={1} />
            <path d={curveMax} fill="none" stroke="rgba(192,132,252,0.35)" strokeWidth={1} />
          </>
        )}
        {/* Live curve at the currently-modulated cutoff. */}
        <path d={curveLive} fill="none" stroke="#c084fc" strokeWidth={2} />
        {/* Cutoff marker. */}
        <line
          x1={xForF(liveCutoff)}
          x2={xForF(liveCutoff)}
          y1={PAD_Y}
          y2={H - PAD_Y}
          stroke="rgba(255,255,255,0.35)"
          strokeDasharray="1 3"
        />
        {/* Frequency labels. */}
        {[100, 1000, 10000].map((f) => (
          <text
            key={f}
            x={xForF(f)}
            y={H - 1}
            fontSize={8}
            textAnchor="middle"
            fill="rgba(255,255,255,0.5)"
          >
            {f >= 1000 ? `${f / 1000}k` : f}
          </text>
        ))}
        <text
          x={xForF(liveCutoff) + 3}
          y={PAD_Y + 8}
          fontSize={9}
          fill="#c084fc"
          fontFamily="ui-monospace, monospace"
        >
          {liveCutoff >= 1000
            ? `${(liveCutoff / 1000).toFixed(2)}kHz`
            : `${liveCutoff.toFixed(0)}Hz`}
        </text>
      </svg>
    </div>
  );
}

function clamp(lo: number, hi: number, v: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Analytical BiquadFilterNode magnitude response for a lowpass,
 * matching Chrome's implementation of the RBJ Audio EQ Cookbook.
 * Returns response at `f` in dB when the filter is tuned to `f0` with
 * quality `Q`.
 */
function biquadLowpassDb(f: number, f0: number, Q: number): number {
  const fs = 48000;
  const w0 = (2 * Math.PI * f0) / fs;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Math.max(0.0001, Q));
  const b0 = (1 - cosw0) / 2;
  const b1 = 1 - cosw0;
  const b2 = (1 - cosw0) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;
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
  return 20 * Math.log10(Math.max(1e-9, numMag / Math.max(1e-9, denMag)));
}
