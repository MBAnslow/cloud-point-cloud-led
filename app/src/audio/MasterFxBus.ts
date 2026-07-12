import * as Tone from "tone";
import type { MasterFxParams } from "../state";

/**
 * Shared post-instrument EQ bus. All three engines (drone/pad/samples)
 * route their master outputs into either `fxInput()` (goes through the
 * HPF+LPF chain) or `directInput()` (bypasses the EQ). Both paths sum
 * into the audio destination. Bypass is per-engine and lives in state
 * (`MasterFxParams.applyTo*`).
 *
 *   fxInput → highPass → lowPass ─┐
 *                                 ├→ destination
 *   directInput ──────────────────┘
 *
 * When `hpEnabled`/`lpEnabled` are false, the corresponding filter is
 * held at a passthrough setting (HP at 20 Hz, LP at 20 kHz, Q ≈ 0.7)
 * rather than physically rewiring the graph — much cheaper than
 * disconnect/reconnect for every toggle.
 */
export class MasterFxBus {
  private started = false;
  private fxIn: Tone.Gain | null = null;
  private directIn: Tone.Gain | null = null;
  private hp: Tone.Filter | null = null;
  private lp: Tone.Filter | null = null;

  async start(): Promise<void> {
    if (this.started) return;
    await Tone.start();
    this.hp = new Tone.Filter({ type: "highpass", frequency: 20, Q: 0.7 });
    this.lp = new Tone.Filter({ type: "lowpass", frequency: 20000, Q: 0.7 });
    this.fxIn = new Tone.Gain(1);
    this.directIn = new Tone.Gain(1);
    this.fxIn.connect(this.hp);
    this.hp.connect(this.lp);
    this.lp.toDestination();
    this.directIn.toDestination();
    this.started = true;
  }

  isStarted(): boolean {
    return this.started;
  }

  /** EQ path entry. Engines connect their `master` here when applying. */
  fxInput(): Tone.Gain {
    if (!this.fxIn) throw new Error("MasterFxBus not started");
    return this.fxIn;
  }

  /** Bypass path entry. Engines connect their `master` here when bypassing. */
  directInput(): Tone.Gain {
    if (!this.directIn) throw new Error("MasterFxBus not started");
    return this.directIn;
  }

  update(p: MasterFxParams): void {
    if (!this.hp || !this.lp) return;
    const hpHz = p.hpEnabled ? Math.max(20, Math.min(20000, p.hpHz)) : 20;
    this.hp.frequency.rampTo(hpHz, 0.08);
    this.hp.Q.rampTo(p.hpEnabled ? Math.max(0.1, p.hpQ) : 0.7, 0.08);
    const lpHz = p.lpEnabled ? Math.max(20, Math.min(20000, p.lpHz)) : 20000;
    this.lp.frequency.rampTo(lpHz, 0.08);
    this.lp.Q.rampTo(p.lpEnabled ? Math.max(0.1, p.lpQ) : 0.7, 0.08);
  }
}

let singleton: MasterFxBus | null = null;
export function getMasterFxBus(): MasterFxBus {
  if (!singleton) singleton = new MasterFxBus();
  return singleton;
}
