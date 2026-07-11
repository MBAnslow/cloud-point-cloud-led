import { PadsPanel } from "./PadsPanel";

/**
 * Dedicated `/pads` route. Mirrors `DronesApp` in role: a separate
 * "window" that focuses on warm-pad editing. Audio is driven globally
 * by `PadRuntime` mounted at the app root, so navigating here just
 * opens the editor UI.
 */
export function PadsApp() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        // Slightly warmer background than the drones view to visually
        // distinguish the two instruments at a glance.
        background:
          "radial-gradient(ellipse at 30% 20%, #2a1d33, #07050d 65%)",
        color: "rgba(207,214,230,0.95)",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <PadsPanel />
    </div>
  );
}
