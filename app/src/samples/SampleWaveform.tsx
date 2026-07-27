import { useEffect, useRef, useState } from "react";
import {
  drawWaveform,
  getSamplePeaks,
  type WaveformPeaks,
} from "./samplePeaks";

/**
 * Canvas waveform for a library sample. Stretches to fill its parent;
 * peaks are cached per sample id after the first decode.
 */
export function SampleWaveform({
  sampleId,
  color = "rgba(255,255,255,0.55)",
  trimStartFrac = 0,
  trimEndFrac = 1,
  /** "overlay" dims outsides; "crop" draws only the trimmed region. */
  trimMode = "overlay",
  style,
}: {
  sampleId: string;
  color?: string;
  /** 0..1 region start within the full file waveform. */
  trimStartFrac?: number;
  /** 0..1 region end within the full file waveform. */
  trimEndFrac?: number;
  trimMode?: "overlay" | "crop";
  style?: React.CSSProperties;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [peaks, setPeaks] = useState<WaveformPeaks | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    let cancelled = false;
    setPeaks(null);
    void getSamplePeaks(sampleId).then((p) => {
      if (!cancelled) setPeaks(p);
    });
    return () => {
      cancelled = true;
    };
  }, [sampleId]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      const w = Math.max(1, Math.round(cr.width));
      const h = Math.max(1, Math.round(cr.height));
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || size.w < 1 || size.h < 1) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const a = Math.max(0, Math.min(1, trimStartFrac));
    const b = Math.max(a, Math.min(1, trimEndFrac));
    if (trimMode === "crop") {
      drawWaveform(ctx, peaks, size.w, size.h, color, a, b);
      return;
    }
    drawWaveform(ctx, peaks, size.w, size.h, color);
    if (a > 0.001 || b < 0.999) {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      if (a > 0) ctx.fillRect(0, 0, a * size.w, size.h);
      if (b < 1) ctx.fillRect(b * size.w, 0, (1 - b) * size.w, size.h);
      ctx.strokeStyle = "rgba(251,146,60,0.9)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a * size.w + 0.5, 0);
      ctx.lineTo(a * size.w + 0.5, size.h);
      ctx.moveTo(b * size.w - 0.5, 0);
      ctx.lineTo(b * size.w - 0.5, size.h);
      ctx.stroke();
    }
  }, [peaks, size, color, trimStartFrac, trimEndFrac, trimMode]);

  return (
    <div
      ref={wrapRef}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        ...style,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%" }}
      />
    </div>
  );
}
