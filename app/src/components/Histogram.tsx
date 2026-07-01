import { useEffect, useRef, useState } from "react";
import { getFrame } from "../stream/frameBuffer";
import { getWledStatus } from "../stream/wledStatus";

const HIST_BIN_WIDTH = 16;
const HIST_BINS = 256 / HIST_BIN_WIDTH;

/**
 * RGB histogram of the exact bytes that get streamed to WLED.
 *
 * Reads the latest frame from the shared frame buffer module on its own
 * requestAnimationFrame loop, so it never causes a React re-render.
 * Mirrors the design used in the cloud-bottom-leds project: 16 bins (each
 * 16 byte values wide), grouped per-channel bars with log-scaled heights,
 * 0..255 axis labels.
 */
export function Histogram() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Polled, low-frequency snapshot of WLED status for the small text line
  // above the histogram. Re-rendering 2 Hz is cheap.
  const [status, setStatus] = useState(getWledStatus);

  useEffect(() => {
    const id = setInterval(() => setStatus({ ...getWledStatus() }), 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const histR = new Float32Array(HIST_BINS);
    const histG = new Float32Array(HIST_BINS);
    const histB = new Float32Array(HIST_BINS);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(2, Math.floor(rect.width * dpr));
      canvas.height = Math.max(2, Math.floor(rect.height * dpr));
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    let lastVersion = -1;
    let rafId = 0;

    const draw = () => {
      rafId = requestAnimationFrame(draw);

      const frame = getFrame();
      if (frame.version === lastVersion) return;
      lastVersion = frame.version;

      const bytes = frame.buffer;
      if (!bytes || frame.count === 0) return;

      const n = frame.count * 3;
      const W = canvas.width;
      const H = canvas.height;
      const s = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const axisH = 12 * s;
      const plotH = H - axisH;

      histR.fill(0);
      histG.fill(0);
      histB.fill(0);

      for (let i = 0; i + 2 < n; i += 3) {
        histR[(bytes[i] / HIST_BIN_WIDTH) | 0]++;
        histG[(bytes[i + 1] / HIST_BIN_WIDTH) | 0]++;
        histB[(bytes[i + 2] / HIST_BIN_WIDTH) | 0]++;
      }

      let peak = 1;
      for (let b = 0; b < HIST_BINS; b++) {
        if (histR[b] > peak) peak = histR[b];
        if (histG[b] > peak) peak = histG[b];
        if (histB[b] > peak) peak = histB[b];
      }
      const norm = plotH / (Math.log1p(peak) || 1);
      const binW = W / HIST_BINS;
      const gap = Math.max(1, binW * 0.08);
      const barW = (binW - gap * 2) / 3;

      ctx.clearRect(0, 0, W, H);

      const channels: Array<[Float32Array, string]> = [
        [histR, "rgba(255,80,80,0.95)"],
        [histG, "rgba(70,225,110,0.95)"],
        [histB, "rgba(95,155,255,0.95)"],
      ];
      for (let b = 0; b < HIST_BINS; b++) {
        const x0 = b * binW + gap;
        for (let ch = 0; ch < 3; ch++) {
          const [hist, color] = channels[ch];
          const h = Math.log1p(hist[b]) * norm;
          ctx.fillStyle = color;
          ctx.fillRect(x0 + ch * barW, plotH - h, barW, h);
        }
      }

      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.fillRect(0, plotH, W, Math.max(1, s));
      ctx.fillStyle = "rgba(207,214,230,0.8)";
      ctx.font = `${Math.round(9 * s)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textBaseline = "bottom";
      const ticks = [0, 64, 128, 192, 255];
      for (const t of ticks) {
        const x = (t / 255) * W;
        ctx.textAlign = t === 0 ? "left" : t === 255 ? "right" : "center";
        ctx.fillText(String(t), Math.min(W - 1, Math.max(1, x)), H);
      }
    };

    rafId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);

  const dotColor = !status.enabled
    ? "rgba(160,168,184,0.6)"
    : status.connected
      ? "#46e16e"
      : "#ff9a3c";
  const statusLabel = !status.enabled
    ? "stream off"
    : !status.connected
      ? "no relay (ws disconnected)"
      : status.target
        ? `→ ${status.target}:${status.port}  sent ${status.framesSent}  dropped ${status.framesDropped}`
        : "relay connected, no target set";

  return (
    <div
      style={{
        position: "fixed",
        left: 12,
        bottom: 12,
        width: "min(420px, 30vw)",
        height: 116,
        padding: "8px 10px 4px",
        background: "rgba(10, 12, 20, 0.6)",
        backdropFilter: "blur(6px)",
        borderRadius: 10,
        zIndex: 9,
        pointerEvents: "none",
        boxShadow: "0 1px 0 rgba(255,255,255,0.04) inset",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 10,
          letterSpacing: 0.4,
          textTransform: "uppercase",
          color: "rgba(207,214,230,0.7)",
          marginBottom: 2,
        }}
      >
        <span>Stream RGB histogram</span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          color: "rgba(207,214,230,0.85)",
          marginBottom: 4,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: 8,
            background: dotColor,
            flexShrink: 0,
          }}
        />
        <span
          style={{ overflow: "hidden", textOverflow: "ellipsis" }}
          title={status.lastError ?? statusLabel}
        >
          {status.lastError ?? statusLabel}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          width: "100%",
          height: "calc(100% - 36px)",
        }}
      />
    </div>
  );
}
