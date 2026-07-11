import { DronesPanel } from "./DronesPanel";

/**
 * Dedicated `/drones` route. Mirrors `MappingApp` in role: a separate
 * "window" that focuses on drone editing. Audio is driven globally by
 * `DroneRuntime` mounted on the main app, so navigating here just
 * opens the editor UI.
 */
export function DronesApp() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background:
          "radial-gradient(ellipse at 30% 20%, #12233a, #05070d 65%)",
        color: "rgba(207,214,230,0.95)",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <DronesPanel />
    </div>
  );
}
