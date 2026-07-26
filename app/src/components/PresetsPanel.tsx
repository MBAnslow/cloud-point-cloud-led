import {
  applySnapshot,
  currentSnapshot,
} from "../state";
import { loadSnapshot, saveSnapshot } from "../state/persistence";
import { loadFromFile, saveToFile, summariseMissing } from "../state/fileIO";

/**
 * Compact save/load strip pinned above the footer on the bottom-right.
 * Replaces the Leva "Presets" folder.
 */
export function PresetsPanel() {
  return (
    <div style={panelStyle}>
      <div style={titleStyle}>Save</div>
      <div style={rowStyle}>
        <button
          type="button"
          style={btnStyle}
          title="Save current settings to the browser"
          onClick={() => saveSnapshot(currentSnapshot())}
        >
          Browser save
        </button>
        <button
          type="button"
          style={btnStyle}
          title="Load settings from the browser"
          onClick={() => {
            const snap = loadSnapshot();
            if (!snap) {
              console.warn("[presets] no saved settings to load");
              return;
            }
            applySnapshot(snap);
          }}
        >
          Browser load
        </button>
      </div>
      <div style={rowStyle}>
        <button
          type="button"
          style={btnStyle}
          title="Save to the last chosen file (or pick one)"
          onClick={() => {
            void saveToFile().catch((err) =>
              console.warn("[presets] save-to-file failed", err),
            );
          }}
        >
          Save file
        </button>
        <button
          type="button"
          style={btnStyle}
          title="Pick a new file and save"
          onClick={() => {
            void saveToFile({ forcePicker: true }).catch((err) =>
              console.warn("[presets] save-as failed", err),
            );
          }}
        >
          Save as…
        </button>
        <button
          type="button"
          style={btnStyle}
          title="Open a settings file"
          onClick={() => {
            void loadFromFile()
              .then((res) => {
                if (!res) return;
                const missing = summariseMissing(res.missingAssets);
                if (missing) console.warn(`[presets] ${missing}`);
              })
              .catch((err) => console.warn("[presets] open-file failed", err));
          }}
        >
          Open…
        </button>
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  position: "fixed",
  right: 12,
  bottom: 52,
  zIndex: 18,
  width: 220,
  background: "rgba(10, 12, 20, 0.88)",
  backdropFilter: "blur(8px)",
  color: "rgba(207,214,230,0.95)",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.12)",
  fontFamily:
    "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
};

const titleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.3,
  opacity: 0.85,
  marginBottom: 6,
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 4,
  marginBottom: 4,
};

const btnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  color: "inherit",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 4,
  padding: "4px 8px",
  fontSize: 10,
  cursor: "pointer",
};
