import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useSimStore, type Vec3 } from "../state";
import {
  boundFileName,
  loadFromFile,
  saveToFile,
  summariseMissing,
} from "../state/fileIO";
import { applyMappingOrientation, azElToDir, dirToAzEl } from "./geometry";
import { deleteMeshBlob, invalidateMeshGeometry, putMeshBlob } from "./meshAsset";

interface Props {
  selected: number | null;
  setSelected: (index: number | null) => void;
}

const NUDGE_DEG = 2;
const NUDGE_RAD = (NUDGE_DEG * Math.PI) / 180;

export function MappingPanel({ selected, setSelected }: Props) {
  const mapping = useSimStore((s) => s.mapping);
  const setMapping = useSimStore((s) => s.setMapping);
  const mesh = useSimStore((s) => s.mesh);
  const setMesh = useSimStore((s) => s.setMesh);
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

      <Section title="Surface">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 6,
            marginBottom: 6,
          }}
        >
          <div style={{ opacity: 0.85, overflow: "hidden", textOverflow: "ellipsis" }}>
            {mesh.id ? mesh.name || "(unnamed mesh)" : "No mesh loaded"}
          </div>
          {mesh.id && (
            <Button
              danger
              onClick={() => {
                if (mesh.id) {
                  invalidateMeshGeometry(mesh.id);
                  deleteMeshBlob(mesh.id).catch(() => {});
                }
                setMesh({ id: null, name: "" });
              }}
            >
              Remove
            </Button>
          )}
        </div>
        <label
          style={{
            display: "inline-block",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 6,
            padding: "4px 10px",
            cursor: "pointer",
            fontSize: 11,
            marginBottom: 8,
          }}
        >
          Upload .glb / .gltf
          <input
            type="file"
            accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
            style={{ display: "none" }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              const id = `mesh-${Date.now().toString(36)}-${Math.random()
                .toString(36)
                .slice(2, 8)}`;
              try {
                await putMeshBlob(id, file);
                setMesh({
                  id,
                  name: file.name,
                  scale: 1,
                  yawDeg: 0,
                  tiltDeg: 0,
                  offsetY: 0,
                });
              } catch (err) {
                console.warn("[mapping] mesh upload failed", err);
              }
            }}
          />
        </label>
        <div style={{ opacity: 0.6, marginBottom: 6, lineHeight: 1.4 }}>
          Export from Blender: File → Export → glTF 2.0 (.glb). Uploaded
          mesh becomes the surface LEDs snap to when Mesh mode is active.
        </div>
        <SliderRow
          label="scale"
          value={mesh.scale}
          min={0.05}
          max={10}
          step={0.05}
          onChange={(v) => setMesh({ scale: v })}
          format={formatScale}
        />
        <SliderRow
          label="yaw"
          value={mesh.yawDeg}
          min={-180}
          max={180}
          step={1}
          onChange={(v) => setMesh({ yawDeg: v })}
          format={formatDeg}
        />
        <SliderRow
          label="tilt"
          value={mesh.tiltDeg}
          min={-180}
          max={180}
          step={1}
          onChange={(v) => setMesh({ tiltDeg: v })}
          format={formatDeg}
        />
        <SliderRow
          label="y-off"
          value={mesh.offsetY}
          min={-3}
          max={3}
          step={0.01}
          onChange={(v) => setMesh({ offsetY: v })}
          format={formatMeters}
        />
        <SliderRow
          label="bead"
          value={mapping.ledSize}
          min={0.005}
          max={0.02}
          step={0.001}
          onChange={(v) => setMapping({ ledSize: v })}
          format={formatMillimeters}
        />
        <SliderRow
          label="max seg"
          value={mapping.maxSegmentLength}
          min={0.01}
          max={0.1}
          step={0.001}
          onChange={(v) => setMapping({ maxSegmentLength: v })}
          format={formatSmallDistance}
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
        <ConfigButtons onLoaded={() => setSelected(null)} />
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
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <label
      style={{
        display: "grid",
        gridTemplateColumns: "44px 1fr 60px",
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
        {format ? format(value) : value.toFixed(2)}
      </span>
    </label>
  );
}

// All scene distances are in metres (three.js world units). These helpers
// pick a friendly unit per magnitude so the readout matches the physical
// scale you'd measure on the real cloud.
function formatMeters(v: number): string {
  return `${v.toFixed(2)} m`;
}

function formatMillimeters(v: number): string {
  return `${(v * 1000).toFixed(0)} mm`;
}

function formatSmallDistance(v: number): string {
  return v < 1 ? `${(v * 100).toFixed(1)} cm` : `${v.toFixed(2)} m`;
}

function formatDeg(v: number): string {
  return `${v.toFixed(0)}°`;
}

function formatScale(v: number): string {
  return `${v.toFixed(2)}×`;
}

function ConfigButtons({ onLoaded }: { onLoaded: () => void }) {
  const [file, setFile] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // Show which file subsequent Saves will write to.
    boundFileName().then(setFile);
  }, []);
  const wrap = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      console.warn("[config] file I/O failed", err);
      setStatus(`Error: ${(err as Error).message ?? String(err)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Button
          disabled={busy || !file}
          onClick={() =>
            wrap(async () => {
              await saveToFile();
              setFile(await boundFileName());
              setStatus(`Saved to ${await boundFileName()}`);
            })
          }
        >
          Save
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            wrap(async () => {
              await saveToFile({ forcePicker: true });
              setFile(await boundFileName());
              setStatus(`Saved to ${await boundFileName()}`);
            })
          }
        >
          Save as…
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            wrap(async () => {
              const res = await loadFromFile();
              if (!res) return;
              setFile(res.fileName);
              onLoaded();
              const missing = summariseMissing(res.missingAssets);
              setStatus(missing ?? `Loaded ${res.fileName}`);
            })
          }
        >
          Open…
        </Button>
      </div>
      <div style={{ fontSize: 10, opacity: 0.7, lineHeight: 1.4 }}>
        {file ? `Bound to ${file}` : "No file bound. Use ‘Save as…’ to create one."}
      </div>
      {status && (
        <div style={{ fontSize: 10, opacity: 0.85, lineHeight: 1.4 }}>{status}</div>
      )}
    </div>
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
