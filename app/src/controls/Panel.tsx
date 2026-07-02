import { button, folder, useControls } from "leva";
import { useEffect } from "react";
import {
  applySnapshot,
  currentSnapshot,
  useSimStore,
  type StartDirection,
} from "../state";
import { loadSnapshot, saveSnapshot } from "../state/persistence";

const START_OPTIONS: Record<string, StartDirection> = {
  top: "top",
  bottom: "bottom",
  left: "left",
  right: "right",
  front: "front",
  back: "back",
};

/**
 * Renders no DOM itself — leva manages its own panel. We use the controls
 * purely to drive the zustand store so the rest of the app reads from a
 * single source of truth.
 *
 * Note: the time-of-day visualization color palette is not controlled here anymore. The
 * `SkyTimeline` overlay component owns the draggable swatch stops and
 * writes them directly to the store. This panel only manages playback
 * settings and global intensity scales for the time-of-day visualization.
 */
export function ControlPanel() {
  const setEllipsoid = useSimStore((s) => s.setEllipsoid);
  const setCloud = useSimStore((s) => s.setCloud);
  const setStrand = useSimStore((s) => s.setStrand);
  const setAmbient = useSimStore((s) => s.setAmbient);
  const setSky = useSimStore((s) => s.setSky);
  const setWled = useSimStore((s) => s.setWled);

  const initial = useSimStore.getState();

  const [ell, setEll] = useControls(
    "Ellipsoid (m)",
    () => ({
      rx: { value: initial.ellipsoid.rx, min: 0.1, max: 5, step: 0.05 },
      ry: { value: initial.ellipsoid.ry, min: 0.1, max: 5, step: 0.05 },
      rz: { value: initial.ellipsoid.rz, min: 0.1, max: 5, step: 0.05 },
    }),
    [],
  );

  const [cl, setCl] = useControls(
    "Cloud",
    () => ({
      opacity: {
        value: initial.cloud.opacity,
        min: 0,
        max: 1,
        step: 0.01,
        label: "opacity (light)",
      },
      showOpacity: { value: initial.cloud.showOpacity, label: "show cloud" },
    }),
    [],
  );

  const [str, setStr] = useControls(
    "Strand",
    () => ({
      count: { value: initial.strand.count, min: 2, max: 2000, step: 1 },
      turns: { value: initial.strand.turns, min: 0, max: 50, step: 0.25 },
      start: { value: initial.strand.start, options: START_OPTIONS },
      ledSize: {
        value: initial.strand.ledSize,
        min: 0.005,
        max: 0.2,
        step: 0.005,
        label: "LED size (m)",
      },
    }),
    [],
  );

  const [lights, setLights] = useControls(
    "Lights",
    () => ({
      ambient: folder({
        ambientColor: { value: initial.ambient.color, label: "ambient color" },
        ambientIntensity: {
          value: initial.ambient.intensity,
          min: 0,
          max: 2,
          step: 0.01,
          label: "ambient intensity",
        },
      }),
    }),
    [],
  );

  const [wledControls, setWledControls] = useControls(
    "WLED",
    () => ({
      enabled: { value: initial.wled.enabled, label: "stream" },
      host: { value: initial.wled.host, label: "host" },
      fps: { value: initial.wled.fps, min: 1, max: 60, step: 1 },
    }),
    [],
  );

  const [skyControls, setSkyControls] = useControls(
    "Time of Day Visualization",
    () => ({
      enabled: { value: initial.sky.enabled, label: "enable time of day" },
      visualizationAmount: {
        value: initial.sky.visualizationAmount ?? 1,
        min: 0,
        max: 1,
        step: 0.01,
        label: "time of day amount",
      },
      cycleSeconds: {
        value: initial.sky.cycleSeconds,
        min: 20,
        max: 600,
        step: 1,
        label: "24h cycle (sec)",
      },
      ambientScale: {
        value: initial.sky.ambientScale,
        min: 0,
        max: 3,
        step: 0.01,
        label: "ambient scale",
      },
      sunScale: {
        value: initial.sky.sunScale,
        min: 0,
        max: 3,
        step: 0.01,
        label: "sun scale",
      },
      moonScale: {
        value: initial.sky.moonScale,
        min: 0,
        max: 3,
        step: 0.01,
        label: "moon scale",
      },
    }),
    [],
  );

  useControls("Presets", {
    save: button(() => {
      saveSnapshot(currentSnapshot());
    }),
    load: button(() => {
      const snap = loadSnapshot();
      if (!snap) {
        console.warn("[presets] no saved settings to load");
        return;
      }
      applySnapshot(snap);
      // The store is now in sync; mirror that into the leva controls so the
      // sliders/colour pickers reflect the loaded values. `enabled` is
      // deliberately forced off — see applySnapshot for the rationale.
      setEll({
        rx: snap.ellipsoid.rx,
        ry: snap.ellipsoid.ry,
        rz: snap.ellipsoid.rz,
      });
      setCl({
        opacity: snap.cloud.opacity,
        showOpacity: snap.cloud.showOpacity,
      });
      setStr({
        count: snap.strand.count,
        turns: snap.strand.turns,
        start: snap.strand.start,
        ledSize: snap.strand.ledSize,
      });
      setLights({
        ambientColor: snap.ambient.color,
        ambientIntensity: snap.ambient.intensity,
      });
      setSkyControls({
        enabled: snap.sky?.enabled ?? true,
        visualizationAmount: snap.sky?.visualizationAmount ?? 1,
        cycleSeconds: snap.sky?.cycleSeconds ?? 180,
        ambientScale: snap.sky?.ambientScale ?? 1,
        sunScale: snap.sky?.sunScale ?? 1,
        moonScale: snap.sky?.moonScale ?? 1,
      });
      setWledControls({
        enabled: false,
        host: snap.wled.host,
        fps: snap.wled.fps,
      });
    }),
  });

  useEffect(() => {
    setEllipsoid({ rx: ell.rx, ry: ell.ry, rz: ell.rz });
  }, [ell.rx, ell.ry, ell.rz, setEllipsoid]);

  useEffect(() => {
    setCloud({ opacity: cl.opacity, showOpacity: cl.showOpacity });
  }, [cl.opacity, cl.showOpacity, setCloud]);

  useEffect(() => {
    setStrand({
      count: str.count,
      turns: str.turns,
      start: str.start as StartDirection,
      ledSize: str.ledSize,
    });
  }, [str.count, str.turns, str.start, str.ledSize, setStrand]);

  useEffect(() => {
    setAmbient({
      color: lights.ambientColor,
      intensity: lights.ambientIntensity,
    });
  }, [lights.ambientColor, lights.ambientIntensity, setAmbient]);

  // Push sky-cycle playback / scale controls to the store. The timeline
  // overlay owns `timeHours`, `autoPlay`, and `stops`, so we deliberately
  // don't include them here.
  useEffect(() => {
    setSky({
      enabled: skyControls.enabled,
      visualizationAmount: skyControls.visualizationAmount,
      cycleSeconds: skyControls.cycleSeconds,
      ambientScale: skyControls.ambientScale,
      sunScale: skyControls.sunScale,
      moonScale: skyControls.moonScale,
    });
  }, [
    skyControls.enabled,
    skyControls.visualizationAmount,
    skyControls.cycleSeconds,
    skyControls.ambientScale,
    skyControls.sunScale,
    skyControls.moonScale,
    setSky,
  ]);

  useEffect(() => {
    setWled({
      enabled: wledControls.enabled,
      host: wledControls.host,
      fps: wledControls.fps,
    });
  }, [wledControls.enabled, wledControls.host, wledControls.fps, setWled]);

  return null;
}
