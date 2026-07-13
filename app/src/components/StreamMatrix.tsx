import { useEffect, useRef, useState } from "react";
import { getFrame } from "../stream/frameBuffer";

/**
 * 2D matrix view of the literal RGB byte values published to the stream
 * pipeline. This is intentionally independent from 3D materials/lights so
 * debugging output correctness is straightforward.
 */
export function StreamMatrix({ visible = true }: { visible?: boolean } = {}) {
  if (!visible) return null;
  return <StreamMatrixInner />;
}

function StreamMatrixInner() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(true);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(2, Math.floor(rect.width * dpr));
      canvas.height = Math.max(2, Math.floor(rect.height * dpr));
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    let rafId = 0;
    let lastVersion = -1;
    let lastCount = -1;

    const draw = () => {
      rafId = requestAnimationFrame(draw);
      if (!visible) return;

      const frame = getFrame();
      if (frame.version === lastVersion) return;
      lastVersion = frame.version;

      const bytes = frame.buffer;
      const n = frame.count;
      if (!bytes || n <= 0) return;

      if (n !== lastCount) {
        setCount(n);
        lastCount = n;
      }

      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      // Keep it simple: near-square matrix by default.
      const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
      const rows = Math.max(1, Math.ceil(n / cols));
      const cellW = W / cols;
      const cellH = H / rows;

      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        const col = i % cols;
        const row = (i / cols) | 0;
        const x = col * cellW;
        const y = row * cellH;
        const r = bytes[i3] ?? 0;
        const g = bytes[i3 + 1] ?? 0;
        const b = bytes[i3 + 2] ?? 0;
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, y, cellW, cellH);
      }

      // Light grid lines for readability at high counts.
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      for (let c = 1; c < cols; c++) {
        const x = c * cellW;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      for (let r = 1; r < rows; r++) {
        const y = r * cellH;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
    };

    rafId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [visible]);

  return (
    <div
      style={{
        position: "fixed",
        right: 12,
        bottom: 44,
        width: "min(360px, 28vw)",
        height: 220,
        padding: "8px 10px 10px",
        background: "rgba(10, 12, 20, 0.72)",
        backdropFilter: "blur(8px)",
        borderRadius: 10,
        zIndex: 11,
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
          marginBottom: 6,
        }}
      >
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: "rgba(207,214,230,0.8)" }}>
          Stream RGB Matrix ({count})
        </div>
        <label style={{ color: "rgba(207,214,230,0.9)", fontSize: 12, display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
          show
        </label>
      </div>
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          width: "100%",
          height: "calc(100% - 24px)",
          borderRadius: 6,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(0,0,0,0.35)",
        }}
      />
    </div>
  );
}

