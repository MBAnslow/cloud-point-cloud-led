import * as Tone from "tone";
import type { MasterFxParams } from "../state";
import { meterAbs } from "./meterAbs";

/**
 * Shared post-instrument EQ + output bus. All three engines (drone/pad/
 * samples) route into either `fxInput()` (HPF+LPF) or `directInput()`
 * (bypass). Both paths sum into `sumGain` → Limiter → destination so
 * concurrent engines cannot hard-clip the DAC.
 *
 *   fxInput → highPass → lowPass ─┐
 *                                 ├→ sumGain → Limiter → destination
 *   directInput ──────────────────┘              └→ program Meter
 */
export class MasterFxBus {
  private started = false;
  private fxIn: Tone.Gain | null = null;
  private directIn: Tone.Gain | null = null;
  private hp: Tone.Filter | null = null;
  private lp: Tone.Filter | null = null;
  private sumGain: Tone.Gain | null = null;
  private limiter: Tone.Limiter | null = null;
  private meter: Tone.Meter | null = null;

  async start(): Promise<void> {
    if (this.started) return;
    await Tone.start();
    this.hp = new Tone.Filter({ type: "highpass", frequency: 20, Q: 0.7 });
    this.lp = new Tone.Filter({ type: "lowpass", frequency: 20000, Q: 0.7 });
    this.fxIn = new Tone.Gain(1);
    this.directIn = new Tone.Gain(1);
    this.sumGain = new Tone.Gain(1);
    this.limiter = new Tone.Limiter(-1);
    this.meter = new Tone.Meter({ normalRange: true });

    this.fxIn.connect(this.hp);
    this.hp.connect(this.lp);
    this.lp.connect(this.sumGain);
    this.directIn.connect(this.sumGain);
    this.sumGain.connect(this.limiter);
    this.limiter.toDestination();
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

  /** Program peak after the sum, before the limiter (0..1+). */
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
