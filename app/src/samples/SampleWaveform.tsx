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
  style,
}: {
  sampleId: string;
  color?: string;
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
    drawWaveform(ctx, peaks, size.w, size.h, color);
  }, [peaks, size, color]);

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
