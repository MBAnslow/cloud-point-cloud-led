import { SamplesPanel } from "./SamplesPanel";

/**
 * Dedicated `/samples` route entry. Mirrors DronesApp/PadsApp — audio
 * is driven by SampleRuntime globally, so this component just opens
 * the editor. Amber gradient background to differentiate the track at
 * a glance from Drones (blue) and Pads (purple).
 */
export function SamplesApp() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background:
          "radial-gradient(ellipse at 30% 20%, #3a2412, #0d0805 65%)",
        color: "rgba(207,214,230,0.95)",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <SamplesPanel />
    </div>
  );
}
