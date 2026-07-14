import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Two-thumb range slider. Emits `[low, high]` in the parent's range,
 * always keeping `low <= high`. Useful anywhere a parameter should be
 * randomised uniformly within a user-controlled window rather than
 * pinned to a single value (per-strike lightning params, etc.).
 */
export function RangeSlider({
  min,
  max,
  step = 0.01,
  value,
  onChange,
  color = "#4c6ef5",
}: {
  min: number;
  max: number;
  step?: number;
  value: readonly [number, number];
  onChange: (next: [number, number]) => void;
  color?: string;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<"low" | "high" | null>(null);

  const quant = useCallback(
    (v: number): number => {
      const clamped = Math.max(min, Math.min(max, v));
      const steps = Math.round((clamped - min) / step);
      return min + steps * step;
    },
    [min, max, step],
  );

  const clientToVal = useCallback(
    (clientX: number): number => {
      const el = trackRef.current;
      if (!el) return min;
      const rect = el.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return quant(min + t * (max - min));
    },
    [min, max, quant],
  );

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const v = clientToVal(e.clientX);
      const [lo, hi] = value;
      if (drag === "low") onChange([Math.min(v, hi), hi]);
      else onChange([lo, Math.max(v, lo)]);
    };
    const onUp = () => setDrag(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag, clientToVal, onChange, value]);

  const span = Math.max(1e-9, max - min);
  const lowPct = ((value[0] - min) / span) * 100;
  const highPct = ((value[1] - min) / span) * 100;

  return (
    <div
      ref={trackRef}
      onPointerDown={(e) => {
        // Clicking the track without hitting a thumb picks the closer one.
        const v = clientToVal(e.clientX);
        const nearLow = Math.abs(v - value[0]) < Math.abs(v - value[1]);
        setDrag(nearLow ? "low" : "high");
        if (nearLow) onChange([Math.min(v, value[1]), value[1]]);
        else onChange([value[0], Math.max(v, value[0])]);
        e.preventDefault();
      }}
      style={{
        position: "relative",
        height: 14,
        flex: 1,
        cursor: "ew-resize",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 6,
          height: 2,
          background: "rgba(255,255,255,0.15)",
          borderRadius: 2,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: `${lowPct}%`,
          width: `${Math.max(0, highPct - lowPct)}%`,
          top: 6,
          height: 2,
          background: color,
          borderRadius: 2,
        }}
      />
      <Thumb pct={lowPct} color={color} onDown={() => setDrag("low")} />
      <Thumb pct={highPct} color={color} onDown={() => setDrag("high")} />
    </div>
  );
}

function Thumb({
  pct,
  color,
  onDown,
}: {
  pct: number;
  color: string;
  onDown: () => void;
}) {
  return (
    <div
      onPointerDown={(e) => {
        onDown();
        e.stopPropagation();
        e.preventDefault();
      }}
      style={{
        position: "absolute",
        left: `calc(${pct}% - 6px)`,
        top: 1,
        width: 12,
        height: 12,
        borderRadius: 6,
        background: color,
        border: "1px solid rgba(255,255,255,0.6)",
        boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
        touchAction: "none",
      }}
    />
  );
}
