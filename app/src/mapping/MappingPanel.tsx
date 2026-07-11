import { Link } from "react-router-dom";
import {
  applySnapshot,
  currentSnapshot,
  useSimStore,
  type Vec3,
} from "../state";
import { loadSnapshot, saveSnapshot } from "../state/persistence";
import { applyMappingOrientation, azElToDir, dirToAzEl } from "./geometry";

interface Props {
  selected: number | null;
  setSelected: (index: number | null) => void;
}

const NUDGE_DEG = 2;
const NUDGE_RAD = (NUDGE_DEG * Math.PI) / 180;

export function MappingPanel({ selected, setSelected }: Props) {
  const ellipsoid = useSimStore((s) => s.ellipsoid);
  const setEllipsoid = useSimStore((s) => s.setEllipsoid);
  const mapping = useSimStore((s) => s.mapping);
  const setMapping = useSimStore((s) => s.setMapping);
  const moveMappedLed = useSimStore((s) => s.moveMappedLed);
  const removeLastMappedLed = useSimStore((s) => s.removeLastMappedLed);
  const clearMappedLeds = useSimStore((s) => s.clearMappedLeds);

  const count = mapping.leds.length;
  const lastIndex = count - 1;
  const reversed = mapping.reversed;
  // Display number for a placement index, honoring the reverse toggle.
  const displayNumber = (i: number) => (reversed ? count - i : i + 1);
  // The physical threading end (where add/delete happen) shown as its number.
  const endNumber = reversed ? 1 : count;

  const nudge = (dAz: number, dEl: number) => {
    if (selected === null) return;
    const led = mapping.leds[selected];
    if (!led) return;
    const displayDir = applyMappingOrientation(
      led.dir,
      mapping.flipUpDown,
      mapping.flipLeftRight,
    );
    const { az, el } = dirToAzEl(displayDir);
    const nextEl = Math.max(
      -Math.PI / 2 + 1e-3,
      Math.min(Math.PI / 2 - 1e-3, el + dEl),
    );
    const nextDisplayDir: Vec3 = azElToDir(az + dAz, nextEl);
    moveMappedLed(
      selected,
      applyMappingOrientation(
        nextDisplayDir,
        mapping.flipUpDown,
        mapping.flipLeftRight,
      ),
    );
  };

  const deleteLast = () => {
    if (count === 0) return;
    removeLastMappedLed();
    if (selected !== null && selected >= lastIndex) {
      setSelected(lastIndex - 1 >= 0 ? lastIndex - 1 : null);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        left: 12,
        width: 300,
        maxHeight: "calc(100vh - 24px)",
        overflowY: "auto",
        zIndex: 10,
        background: "rgba(10, 12, 20, 0.82)",
        backdropFilter: "blur(8px)",
        borderRadius: 12,
        boxShadow: "0 1px 0 rgba(255,255,255,0.05) inset",
        color: "rgba(207,214,230,0.95)",
        padding: "12px 12px 14px",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        fontSize: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <span
          style={{
            textTransform: "uppercase",
            letterSpacing: 0.6,
            opacity: 0.75,
            fontSize: 11,
          }}
        >
          LED Mapping
        </span>
        <Link
          to="/drones"
          style={{
            color: "inherit",
            textDecoration: "none",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 6,
            padding: "2px 8px",
            fontSize: 11,
          }}
        >
          Drones →
        </Link>
        <Link
          to="/"
          style={{
            color: "inherit",
            textDecoration: "none",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 6,
            padding: "2px 8px",
            fontSize: 11,
          }}
        >
          ← simulator
        </Link>
      </div>

      <Section title="Cloud dimensions (m)">
        <SliderRow
          label="rx"
          value={ellipsoid.rx}
          min={0.1}
          max={5}
          step={0.05}
          onChange={(v) => setEllipsoid({ rx: v })}
        />
        <SliderRow
          label="ry"
          value={ellipsoid.ry}
          min={0.1}
          max={5}
          step={0.05}
          onChange={(v) => setEllipsoid({ ry: v })}
        />
        <SliderRow
          label="rz"
          value={ellipsoid.rz}
          min={0.1}
          max={5}
          step={0.05}
          onChange={(v) => setEllipsoid({ rz: v })}
        />
        <SliderRow
          label="bead"
          value={mapping.ledSize}
          min={0.01}
          max={0.2}
          step={0.005}
          onChange={(v) => setMapping({ ledSize: v })}
        />
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 4,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={mapping.flipUpDown}
            onChange={(e) => setMapping({ flipUpDown: e.target.checked })}
          />
          <span>Flip up/down</span>
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 4,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={mapping.flipLeftRight}
            onChange={(e) => setMapping({ flipLeftRight: e.target.checked })}
          />
          <span>Flip left/right</span>
        </label>
      </Section>

      <Section title={`Sequence — ${count} LED${count === 1 ? "" : "s"}`}>
        <div style={{ opacity: 0.7, lineHeight: 1.4, marginBottom: 8 }}>
          Click the cloud surface to place the next LED. Drag a bead to move
          it. You can only add or delete at the end of the string.
        </div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={reversed}
            onChange={(e) => setMapping({ reversed: e.target.checked })}
          />
          <span>Reverse direction (last placed = #1)</span>
        </label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Button onClick={deleteLast} disabled={count === 0} danger>
            Delete last (#{endNumber})
          </Button>
          <Button onClick={() => { clearMappedLeds(); setSelected(null); }} disabled={count === 0}>
            Clear all
          </Button>
        </div>
      </Section>

      <Section title="Move selected">
        {selected === null ? (
          <div style={{ opacity: 0.6 }}>Select an LED to nudge it.</div>
        ) : (
          <>
            <div style={{ marginBottom: 8, opacity: 0.85 }}>
              LED #{displayNumber(selected)}
              {selected === lastIndex ? " (end)" : ""}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: 6,
              }}
            >
              <Button onClick={() => nudge(-NUDGE_RAD, 0)}>◀ around</Button>
              <Button onClick={() => nudge(NUDGE_RAD, 0)}>around ▶</Button>
              <Button onClick={() => nudge(0, NUDGE_RAD)}>▲ up</Button>
              <Button onClick={() => nudge(0, -NUDGE_RAD)}>▼ down</Button>
            </div>
          </>
        )}
      </Section>

      <Section title="Configuration">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Button onClick={() => saveSnapshot(currentSnapshot())}>Save</Button>
          <Button
            onClick={() => {
              const snap = loadSnapshot();
              if (!snap) return;
              applySnapshot(snap);
              setSelected(null);
            }}
          >
            Load
          </Button>
        </div>
      </Section>

      <Section title="LEDs">
        <div style={{ display: "grid", gap: 3 }}>
          {count === 0 && <div style={{ opacity: 0.6 }}>No LEDs placed yet.</div>}
          {mapping.leds.map((_, k) => {
            // Render in logical (numbered) order; map back to placement index.
            const i = reversed ? count - 1 - k : k;
            return (
              <button
                key={i}
                onClick={() => setSelected(i)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  textAlign: "left",
                  background:
                    i === selected
                      ? "rgba(70,225,110,0.16)"
                      : "rgba(255,255,255,0.04)",
                  border: `1px solid ${
                    i === selected
                      ? "rgba(70,225,110,0.4)"
                      : "rgba(255,255,255,0.08)"
                  }`,
                  color: "inherit",
                  borderRadius: 6,
                  padding: "3px 8px",
                  cursor: "pointer",
                  fontSize: 11,
                }}
              >
                <span>LED #{k + 1}</span>
                {i === lastIndex && (
                  <span style={{ opacity: 0.7, color: "#7ef0a3" }}>end</span>
                )}
              </button>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        marginBottom: 12,
        paddingBottom: 10,
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.45,
          opacity: 0.65,
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label
      style={{
        display: "grid",
        gridTemplateColumns: "34px 1fr 44px",
        alignItems: "center",
        gap: 8,
        marginBottom: 6,
      }}
    >
      <span style={{ opacity: 0.75 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: "100%" }}
      />
      <span
        style={{
          textAlign: "right",
          opacity: 0.82,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value.toFixed(2)}
      </span>
    </label>
  );
}

function Button({
  onClick,
  children,
  disabled,
  danger,
}: {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: danger
          ? "rgba(255,90,90,0.14)"
          : "rgba(255,255,255,0.06)",
        color: "inherit",
        border: `1px solid ${
          danger ? "rgba(255,90,90,0.35)" : "rgba(255,255,255,0.15)"
        }`,
        borderRadius: 6,
        padding: "4px 10px",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        fontSize: 11,
      }}
    >
      {children}
    </button>
  );
}
