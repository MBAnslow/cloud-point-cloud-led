import { useEffect, useState } from "react";

export function ColorInput({
  color,
  onChange,
  compact = false,
}: {
  color: string;
  onChange: (color: string) => void;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState(color);
  useEffect(() => setDraft(color), [color]);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <input
        type="color"
        value={color}
        onChange={(event) => onChange(event.target.value)}
        style={{
          width: compact ? 44 : 58,
          height: compact ? 32 : 42,
          background: "transparent",
          border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: 5,
          padding: 1,
          cursor: "pointer",
        }}
      />
      <input
        type="text"
        value={draft}
        aria-label="Hex color"
        onChange={(event) => {
          const value = event.target.value.trim();
          setDraft(value);
          if (/^#[0-9a-fA-F]{6}$/.test(value)) onChange(value);
        }}
        onBlur={() => setDraft(color)}
        style={{
          background: "rgba(0,0,0,0.35)",
          color: "inherit",
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 4,
          padding: "3px 5px",
          fontSize: 12,
          width: 76,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      />
    </div>
  );
}

