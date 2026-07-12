import { useEffect } from "react";
import { useSimStore } from "../state";
import { getMasterFxBus } from "./MasterFxBus";
import { getDroneEngine } from "./DroneEngine";
import { getPadEngine } from "./PadEngine";
import { getSampleEngine } from "./SampleEngine";

/**
 * Headless driver for the shared MasterFxBus. Every frame it:
 *   1. lazily starts the bus once any engine has started (so all four
 *      share the same AudioContext lock),
 *   2. pushes the current MasterFxParams into the bus,
 *   3. repatches each engine's master output through either the fx or
 *      direct input depending on the corresponding `applyTo*` flag.
 * `setRouting` and `update` are both idempotent — no-op on unchanged
 * targets — so ticking this every frame stays cheap.
 */
export function MasterFxRuntime(): null {
  useEffect(() => {
    const bus = getMasterFxBus();
    const drone = getDroneEngine();
    const pad = getPadEngine();
    const samples = getSampleEngine();
    let raf = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      // The bus needs a Tone.start() unlock too, but any engine.start()
      // already awaits it; kick it off once any engine is live so the
      // graph is ready before update() calls do anything.
      const anyStarted =
        drone.isStarted() || pad.isStarted() || samples.isStarted();
      if (anyStarted && !bus.isStarted()) {
        bus.start().catch((err) =>
          console.warn("[masterfx] start failed", err),
        );
      }
      const state = useSimStore.getState();
      if (bus.isStarted()) {
        bus.update(state.masterFx);
        const fx = bus.fxInput();
        const direct = bus.directInput();
        if (drone.isStarted()) {
          drone.setRouting(state.masterFx.applyToDrone ? fx : direct);
        }
        if (pad.isStarted()) {
          pad.setRouting(state.masterFx.applyToPad ? fx : direct);
        }
        if (samples.isStarted()) {
          samples.setRouting(state.masterFx.applyToSamples ? fx : direct);
        }
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
    };
  }, []);
  return null;
}
