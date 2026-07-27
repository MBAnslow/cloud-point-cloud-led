import * as Tone from "tone";
import type { MasterFxParams } from "../state";
import { meterAbs } from "./meterAbs";

/**
 * Shared post-instrument EQ + brickwall output. All three engines
 * (drone/pad/samples) route into either `fxInput()` (HPF+LPF) or
 * `directInput()` (bypass). Lightning / breath use `auxInput()`.
 * Everything sums into `sumGain` → Compressor → Limiter → destination
 * so concurrent sources cannot hard-clip the DAC.
 *
 *   fxInput → highPass → lowPass ─┐
 *   directInput ──────────────────┼→ sumGain → Comp → Limiter → dest
 *   auxInput ─────────────────────┘              └→ program Meter
 */
export class MasterFxBus {
  private started = false;
  private fxIn: Tone.Gain | null = null;
  private directIn: Tone.Gain | null = null;
  private auxIn: Tone.Gain | null = null;
  private hp: Tone.Filter | null = null;
  private lp: Tone.Filter | null = null;
  private sumGain: Tone.Gain | null = null;
  private compressor: Tone.Compressor | null = null;
  private limiter: Tone.Limiter | null = null;
  private meter: Tone.Meter | null = null;

  async start(): Promise<void> {
    if (this.started) return;
    await Tone.start();
    this.hp = new Tone.Filter({ type: "highpass", frequency: 20, Q: 0.7 });
    this.lp = new Tone.Filter({ type: "lowpass", frequency: 20000, Q: 0.7 });
    this.fxIn = new Tone.Gain(1);
    this.directIn = new Tone.Gain(1);
    this.auxIn = new Tone.Gain(1);
    this.sumGain = new Tone.Gain(1);
    // Soft catch of busy mixes, then a hard ceiling just under 0 dBFS.
    this.compressor = new Tone.Compressor({
      threshold: -12,
      ratio: 6,
      attack: 0.003,
      release: 0.12,
      knee: 6,
    });
    this.limiter = new Tone.Limiter(-1);
    this.meter = new Tone.Meter({ normalRange: true });

    this.fxIn.connect(this.hp);
    this.hp.connect(this.lp);
    this.lp.connect(this.sumGain);
    this.directIn.connect(this.sumGain);
    this.auxIn.connect(this.sumGain);
    this.sumGain.connect(this.compressor);
    this.compressor.connect(this.limiter);
    this.limiter.toDestination();
    // Meter before dynamics so the Output bar shows when limiting kicks in.
    this.sumGain.connect(this.meter);
    this.started = true;
  }

  isStarted(): boolean {
    return this.started;
  }

  /** EQ path entry. Engines connect their master LP here when applying. */
  fxInput(): Tone.Gain {
    if (!this.fxIn) throw new Error("MasterFxBus not started");
    return this.fxIn;
  }

  /** Bypass path entry. Engines connect here when bypassing the EQ. */
  directInput(): Tone.Gain {
    if (!this.directIn) throw new Error("MasterFxBus not started");
    return this.directIn;
  }

  /**
   * Limited program input for one-shots (lightning, breath exhale) that
   * should not go through the shared EQ but must share the brickwall.
   */
  auxInput(): Tone.Gain {
    if (!this.auxIn) throw new Error("MasterFxBus not started");
    return this.auxIn;
  }

  /** Program peak after the sum, before the compressor/limiter (0..1+). */
  getPeakLevel(): number {
    if (!this.meter) return 0;
    return meterAbs(this.meter.getValue());
  }

  update(p: MasterFxParams): void {
    if (!this.hp || !this.lp || !this.sumGain) return;
    const hpHz = p.hpEnabled ? Math.max(20, Math.min(20000, p.hpHz)) : 20;
    this.hp.frequency.rampTo(hpHz, 0.08);
    this.hp.Q.rampTo(p.hpEnabled ? Math.max(0.1, p.hpQ) : 0.7, 0.08);
    const lpHz = p.lpEnabled ? Math.max(20, Math.min(20000, p.lpHz)) : 20000;
    this.lp.frequency.rampTo(lpHz, 0.08);
    this.lp.Q.rampTo(p.lpEnabled ? Math.max(0.1, p.lpQ) : 0.7, 0.08);
    const out = Math.max(0, Math.min(1.5, Number(p.outputGain) || 1));
    this.sumGain.gain.rampTo(out, 0.05);
  }
}

let singleton: MasterFxBus | null = null;
export function getMasterFxBus(): MasterFxBus {
  if (!singleton) singleton = new MasterFxBus();
  return singleton;
}

/**
 * Ensure the shared bus (and brickwall) is running, then return its
 * limited aux input. Used by engines that must never hit destination raw.
 */
export async function ensureLimitedAux(): Promise<Tone.Gain> {
  const bus = getMasterFxBus();
  if (!bus.isStarted()) await bus.start();
  return bus.auxInput();
}
