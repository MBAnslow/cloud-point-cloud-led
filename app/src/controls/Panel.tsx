import { button, folder, useControls } from "leva";
import { useEffect } from "react";
import {
  applySnapshot,
  currentSnapshot,
  useSimStore,
} from "../state";
import { loadSnapshot, saveSnapshot } from "../state/persistence";

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
  const setCloud = useSimStore((s) => s.setCloud);
  const setStrand = useSimStore((s) => s.setStrand);
  const setAmbient = useSimStore((s) => s.setAmbient);
  const setSky = useSimStore((s) => s.setSky);
  const setWled = useSimStore((s) => s.setWled);

  const initial = useSimStore.getState();

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
      rotationYDeg: {
        value: initial.cloud.rotationYDeg ?? 0,
        min: -180,
        max: 180,
        step: 1,
        label: "yaw (deg)",
      },
      offsetX: {
        value: initial.cloud.offsetX ?? 0,
        min: -5,
        max: 5,
        step: 0.01,
        label: "offset x (m)",
      },
      offsetZ: {
        value: initial.cloud.offsetZ ?? 0,
        min: -5,
        max: 5,
        step: 0.01,
        label: "offset z (m)",
      },
    }),
    [],
  );

  const [str, setStr] = useControls(
    "Strand",
    () => ({
      ledSize: {
        value: initial.strand.ledSize,
        min: 0.005,
        max: 0.2,
        step: 0.005,
        label: "LED size (m)",
      },
      sensorHemisphereFocus: {
        value: initial.strand.sensorHemisphereFocus ?? 0,
        min: 0,
        max: 12,
        step: 0.1,
        label: "sensor focus",
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
      sunSpread: {
        value: initial.sky.sunSpread ?? 0.9,
        min: 0,
        max: 1,
        step: 0.01,
        label: "sun spread",
      },
      moonScale: {
        value: initial.sky.moonScale,
        min: 0,
        max: 3,
        step: 0.01,
        label: "moon scale",
      },
      moonSpread: {
        value: initial.sky.moonSpread ?? 0.9,
        min: 0,
        max: 1,
        step: 0.01,
        label: "moon spread",
      },
      horizonCutoffDeg: {
        value: initial.sky.horizonCutoffDeg ?? -7,
        min: -30,
        max: 30,
        step: 0.5,
        label: "horizon cutoff (deg)",
      },
      horizonSoftnessDeg: {
        value: initial.sky.horizonSoftnessDeg ?? 0,
        min: 0,
        max: 60,
        step: 0.5,
        label: "horizon softness (deg)",
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
      // (Ellipsoid dimensions are owned by the LED-mapping app now, so they
      // are applied via applySnapshot above and not mirrored here.)
      setCl({
        opacity: snap.cloud.opacity,
        showOpacity: snap.cloud.showOpacity,
        rotationYDeg: snap.cloud.rotationYDeg ?? 0,
        offsetX: snap.cloud.offsetX ?? 0,
        offsetZ: snap.cloud.offsetZ ?? 0,
      });
      setStr({
        ledSize: snap.strand.ledSize,
        sensorHemisphereFocus: snap.strand.sensorHemisphereFocus ?? 0,
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
        sunSpread: snap.sky?.sunSpread ?? 0.9,
        moonScale: snap.sky?.moonScale ?? 1,
        moonSpread: snap.sky?.moonSpread ?? 0.9,
        horizonCutoffDeg: snap.sky?.horizonCutoffDeg ?? -7,
        horizonSoftnessDeg: snap.sky?.horizonSoftnessDeg ?? 0,
      });
      setWledControls({
        enabled: false,
        host: snap.wled.host,
        fps: snap.wled.fps,
      });
    }),
  });

  useEffect(() => {
    setCloud({
      opacity: cl.opacity,
      showOpacity: cl.showOpacity,
      rotationYDeg: cl.rotationYDeg,
      offsetX: cl.offsetX,
      offsetZ: cl.offsetZ,
    });
  }, [cl.opacity, cl.showOpacity, cl.rotationYDeg, cl.offsetX, cl.offsetZ, setCloud]);

  useEffect(() => {
    setStrand({
      ledSize: str.ledSize,
      sensorHemisphereFocus: str.sensorHemisphereFocus,
    });
  }, [str.ledSize, str.sensorHemisphereFocus, setStrand]);

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
      sunSpread: skyControls.sunSpread,
      moonScale: skyControls.moonScale,
      moonSpread: skyControls.moonSpread,
      horizonCutoffDeg: skyControls.horizonCutoffDeg,
      horizonSoftnessDeg: skyControls.horizonSoftnessDeg,
    });
  }, [
    skyControls.enabled,
    skyControls.visualizationAmount,
    skyControls.cycleSeconds,
    skyControls.ambientScale,
    skyControls.sunScale,
    skyControls.sunSpread,
    skyControls.moonScale,
    skyControls.moonSpread,
    skyControls.horizonCutoffDeg,
    skyControls.horizonSoftnessDeg,
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
