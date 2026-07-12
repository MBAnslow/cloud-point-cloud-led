import * as Tone from "tone";
import type { PadParams, PadWaveform } from "../state";
import { activePadVoicesAt } from "./padCycle";

/**
 * Warm-pad synth engine. Signal chain per voice:
 *
 *   Oscillator[unisonCount] (detuned, phase-randomised)
 *     → voiceGain (ADSR-scheduled)
 *     → padBus
 *
 * Global bus chain:
 *
 *   padBus → filter (low-pass, cutoff + env from ADSR peak)
 *          → chorus
 *          → reverbDry / reverbWet (explicit parallel gains for
 *            deterministic mix across Tone.js versions)
 *          → master → destination
 *
 * Independent of the drone engine — separate Tone graph and singleton
 * so both instruments can play concurrently.
 */

interface PadVoice {
  note: string;
  oscs: Tone.Oscillator[];
  /** Symmetric detune constant per osc index; recomputed on unison count change. */
  detuneOffsets: number[];
  /**
   * Random phase offset (radians) per unison osc for the pitch-drift
   * LFO, so drift feels organic rather than in phase lock across the stack.
   */
  driftPhases: number[];
  /** Sums the unison stack. */
  mix: Tone.Gain;
  /** ADSR-scheduled gain. */
  env: Tone.Gain;
  isOn: boolean;
  /** Last applied gain multiplier — used to detect live sustain edits. */
  lastGain: number;
  /** Tone-context timestamp of the most recent attack. */
  attackAt: number;
  /** Tone-context timestamp of release, or null while still holding. */
  releaseAt: number | null;
  /** ADSR params captured at attack time so envelope math is stable
   *  even if the user edits ADSR sliders mid-note. */
  adsr: { a: number; d: number; s: number; r: number };
}

export class PadEngine {
  private started = false;
  private master: Tone.Gain | null = null;
  private reverb: Tone.Reverb | null = null;
  private reverbDryGain: Tone.Gain | null = null;
  private reverbWetGain: Tone.Gain | null = null;
  private chorus: Tone.Chorus | null = null;
  private filter: Tone.Filter | null = null;
  private saturation: Tone.Distortion | null = null;
  private bus: Tone.Gain | null = null;

  private voices = new Map<string, PadVoice>();
  /**
   * Cached probability-gate decision per note id. Set on window entry,
   * cleared on window exit so the next entry re-rolls. `true` = allowed
   * to play this pass, `false` = suppressed.
   */
  private probGate = new Map<string, boolean>();
  private currentWaveform: PadWaveform = "sawtooth";
  private currentReverbDecay = -1;

  async start(): Promise<void> {
    if (this.started) return;
    await Tone.start();
    this.master = new Tone.Gain(0);
    this.reverb = new Tone.Reverb({ decay: 3, preDelay: 0.02, wet: 1 });
    this.reverb.generate().catch(() => undefined);
    this.reverbDryGain = new Tone.Gain(1);
    this.reverbWetGain = new Tone.Gain(0);
    this.reverbDryGain.connect(this.master);
    this.reverbWetGain.connect(this.master);
    this.reverb.connect(this.reverbWetGain);
    // Chorus feeds both the dry send and the reverb input.
    this.chorus = new Tone.Chorus({
      frequency: 0.3,
      delayTime: 3.5,
      depth: 0.6,
      wet: 0.4,
    }).start();
    this.chorus.connect(this.reverbDryGain);
    this.chorus.connect(this.reverb);
    // Waveshaper for warmth / drive. `wet` is scaled from p.saturation
    // in update(), so at 0 the chain is transparent.
    this.saturation = new Tone.Distortion({ distortion: 0, wet: 0 });
    this.saturation.connect(this.chorus);
    this.filter = new Tone.Filter({ type: "lowpass", frequency: 900, Q: 0.7 });
    this.filter.connect(this.saturation);
    this.bus = new Tone.Gain(1);
    this.bus.connect(this.filter);
    this.started = true;
  }

  isStarted(): boolean {
    return this.started;
  }

  private currentRoutingTarget: Tone.InputNode | null | undefined = undefined;
  /** See DroneEngine.setRouting. */
  setRouting(target: Tone.InputNode | null): void {
    if (!this.started || !this.master) return;
    if (this.currentRoutingTarget === target) return;
    this.master.disconnect();
    if (target) this.master.connect(target);
    else this.master.toDestination();
    this.currentRoutingTarget = target;
  }

  update(hour: number, p: PadParams): void {
    if (
      !this.started ||
      !this.master ||
      !this.reverb ||
      !this.reverbDryGain ||
      !this.reverbWetGain ||
      !this.chorus ||
      !this.filter ||
      !this.saturation ||
      !this.bus
    )
      return;

    this.master.gain.rampTo(p.enabled ? p.master : 0, 0.05);

    if (p.waveform !== this.currentWaveform) {
      this.currentWaveform = p.waveform;
      for (const v of this.voices.values()) {
        for (const o of v.oscs) o.type = p.waveform;
      }
    }

    // Filter cutoff pipeline (matches PadFilterResponse exactly):
    //   base   = filterHz * 2^(envAmount/1200 * peakEnv)    [ADSR-shaped]
    //   cutoff = base * 2^(-lfoDepth * (0.5 + 0.5·sin(2π·rate·t)))
    // Env amount is in *cents* (log units), so it multiplies the base
    // in log-space rather than being added as Hz.
    const tNow = Tone.now();
    const peakEnv = this.getEnvelopePeak(tNow);
    const envOctaves = (Math.max(0, p.filterEnvAmount) / 1200) * peakEnv;
    const baseCutoff = Math.max(
      20,
      Math.min(20000, p.filterHz * Math.pow(2, envOctaves)),
    );
    let cutoff = baseCutoff;
    const lfoDepth = Math.max(0, Math.min(1, p.filterLfoDepth));
    if (lfoDepth > 0 && p.filterLfoRateHz > 0) {
      // Unipolar sine [0, 1] → sweep 0 to `depth` octaves below base.
      const s = 0.5 + 0.5 * Math.sin(2 * Math.PI * p.filterLfoRateHz * tNow);
      cutoff = baseCutoff * Math.pow(2, -lfoDepth * s);
    }
    // Direct value write (not `rampTo`) so per-frame LFO modulation
    // isn't smoothed away by successive ramp cancellations. At 60 fps
    // the resulting step-wise cutoff is well below any audible zipper
    // for LFO rates up to ~10 Hz.
    this.filter.frequency.value = Math.max(20, Math.min(20000, cutoff));
    this.filter.Q.rampTo(Math.max(0.1, p.filterQ), 0.08);

    // Saturation: both drive amount and wet mix scale with the same
    // knob so 0 is bit-perfect transparent.
    const sat = Math.max(0, Math.min(1, p.saturation));
    (this.saturation as unknown as { distortion: number }).distortion = sat;
    this.saturation.wet.rampTo(sat, 0.08);

    // Chorus params.
    this.chorus.frequency.rampTo(Math.max(0.05, p.chorusRateHz), 0.1);
    // depth is a plain number field on Tone.Chorus (not a Signal).
    (this.chorus as unknown as { depth: number }).depth = Math.max(
      0,
      Math.min(1, p.chorusDepth),
    );
    // `wet` scales the amount of chorus in the parallel chain.
    this.chorus.wet.rampTo(Math.max(0, Math.min(1, p.chorusDepth)), 0.1);

    // Reverb: regen IR only when decay actually moves — generation
    // allocates a fresh Float32 IR.
    const decay = Math.max(0.1, p.reverbDecay);
    if (Math.abs(decay - this.currentReverbDecay) > 0.01) {
      this.reverb.decay = decay;
      this.reverb.generate().catch(() => undefined);
      this.currentReverbDecay = decay;
    }
    const reverbMix = Math.max(0, Math.min(1, p.reverbMix));
    this.reverbDryGain.gain.rampTo(1 - reverbMix, 0.1);
    this.reverbWetGain.gain.rampTo(reverbMix, 0.1);

    if (!p.enabled) {
      for (const v of this.voices.values()) this.release(v, p);
      return;
    }

    const active = activePadVoicesAt(p.notes, hour);
    const seen = new Set<string>();
    // Per-frame drift LFO value scale; cached per-osc random phase in
    // voice.driftPhases keeps oscs out of phase-lock for organic feel.
    const driftActive = p.driftDepthCents > 0 && p.driftRateHz > 0;
    const driftOmega = 2 * Math.PI * p.driftRateHz;
    for (const av of active) {
      seen.add(av.id);
      // Per-entry probability gate: roll once on the frame the note
      // first becomes active. A "suppressed" note is skipped for the
      // whole window; the roll re-runs the next time the playhead
      // re-enters (e.g. after a period loop).
      if (av.triggerProbability < 1) {
        const gate = this.probGate.get(av.id);
        if (gate === undefined) {
          const pass = Math.random() < av.triggerProbability;
          this.probGate.set(av.id, pass);
          if (!pass) continue;
        } else if (!gate) {
          continue;
        }
      }
      const voice = this.getOrCreateVoice(av.id, av.note, p);
      this.syncUnison(voice, p);
      // Base-frequency retune when the note changes.
      if (voice.note !== av.note) {
        voice.note = av.note;
        const f = Tone.Frequency(av.note).toFrequency();
        for (const o of voice.oscs) o.frequency.rampTo(f, 0.03);
      }
      // Constant detune (unison spread + per-note offset) plus drift LFO.
      for (let i = 0; i < voice.oscs.length; i++) {
        const constant = (voice.detuneOffsets[i] ?? 0) + av.detuneCents;
        const mod = driftActive
          ? p.driftDepthCents *
            Math.sin(driftOmega * tNow + (voice.driftPhases[i] ?? 0))
          : 0;
        voice.oscs[i].detune.rampTo(constant + mod, 0.05);
      }
      const gain = av.gain;
      if (!voice.isOn) {
        this.attack(voice, p, gain);
        voice.isOn = true;
        voice.lastGain = gain;
      } else if (Math.abs(voice.lastGain - gain) > 0.001) {
        // Retarget sustain smoothly for live gain edits.
        const now = Tone.now();
        const s = Math.max(0.0001, Math.min(1, p.sustain));
        const g = voice.env.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(s * gain, now + 0.05);
        voice.lastGain = gain;
      }
    }
    for (const [id, voice] of this.voices) {
      if (!seen.has(id)) this.release(voice, p);
    }
    // Reap voices whose release has completed. `envAt` returns 0 for
    // t >= releaseAt + r; adding a small tail keeps LFO/drift smooth
    // right up to the final sample.
    for (const [id, voice] of this.voices) {
      if (
        voice.releaseAt !== null &&
        tNow > voice.releaseAt + voice.adsr.r + 0.1
      ) {
        this.disposeVoice(voice);
        this.voices.delete(id);
      }
    }
    // Clear probability-gate memory for notes that are no longer active
    // (whether suppressed or previously played) so the next entry rolls.
    for (const id of this.probGate.keys()) {
      if (!seen.has(id)) this.probGate.delete(id);
    }
  }

  private disposeVoice(v: PadVoice): void {
    for (const o of v.oscs) {
      try {
        o.disconnect();
        o.stop();
        o.dispose();
      } catch {
        /* already stopped */
      }
    }
    v.oscs = [];
    v.mix.disconnect();
    v.mix.dispose();
    v.env.disconnect();
    v.env.dispose();
  }

  private getOrCreateVoice(
    id: string,
    note: string,
    p: PadParams,
  ): PadVoice {
    const existing = this.voices.get(id);
    if (existing) return existing;
    const v = this.buildVoice(note, p);
    this.voices.set(id, v);
    return v;
  }

  private buildVoice(note: string, p: PadParams): PadVoice {
    if (!this.bus) throw new Error("PadEngine.start() must complete first");
    const freq = Tone.Frequency(note).toFrequency();
    const mix = new Tone.Gain(1);
    const env = new Tone.Gain(0);
    mix.connect(env);
    env.connect(this.bus);
    const v: PadVoice = {
      note,
      oscs: [],
      detuneOffsets: [],
      driftPhases: [],
      mix,
      env,
      isOn: false,
      lastGain: 0,
      attackAt: 0,
      releaseAt: null,
      adsr: { a: 0.001, d: 0.001, s: 1, r: 0.001 },
    };
    this.growUnisonTo(v, freq, p);
    return v;
  }

  private growUnisonTo(v: PadVoice, freq: number, p: PadParams): void {
    const wf = this.currentWaveform;
    const count = Math.max(1, Math.min(8, Math.round(p.unisonCount)));
    while (v.oscs.length < count) {
      const osc = new Tone.Oscillator({
        type: wf,
        frequency: freq,
        phase: Math.random() * 360,
      }).start();
      osc.connect(v.mix);
      v.oscs.push(osc);
      v.driftPhases.push(Math.random() * Math.PI * 2);
    }
    this.recomputeDetuneOffsets(v, p);
    // Apply detune constants immediately.
    for (let i = 0; i < v.oscs.length; i++) {
      v.oscs[i].detune.value = v.detuneOffsets[i] ?? 0;
    }
  }

  private syncUnison(v: PadVoice, p: PadParams): void {
    const target = Math.max(1, Math.min(8, Math.round(p.unisonCount)));
    if (v.oscs.length === target) {
      // Detune spread may have changed — recompute + apply.
      this.recomputeDetuneOffsets(v, p);
      for (let i = 0; i < v.oscs.length; i++) {
        v.oscs[i].detune.rampTo(v.detuneOffsets[i] ?? 0, 0.05);
      }
      return;
    }
    const freq = Tone.Frequency(v.note).toFrequency();
    while (v.oscs.length < target) {
      const osc = new Tone.Oscillator({
        type: this.currentWaveform,
        frequency: freq,
        phase: Math.random() * 360,
      }).start();
      osc.connect(v.mix);
      v.oscs.push(osc);
      v.driftPhases.push(Math.random() * Math.PI * 2);
    }
    while (v.oscs.length > target) {
      const osc = v.oscs.pop();
      osc?.disconnect();
      osc?.stop();
      osc?.dispose();
      v.driftPhases.pop();
    }
    this.recomputeDetuneOffsets(v, p);
    for (let i = 0; i < v.oscs.length; i++) {
      v.oscs[i].detune.rampTo(v.detuneOffsets[i] ?? 0, 0.05);
    }
    // Equal-power-ish compensation so more unison doesn't blow up level.
    v.mix.gain.rampTo(1 / Math.sqrt(target), 0.05);
  }

  private recomputeDetuneOffsets(v: PadVoice, p: PadParams): void {
    const n = v.oscs.length;
    const spread = Math.max(0, p.unisonDetuneCents);
    const offsets: number[] = [];
    if (n === 1) {
      offsets.push(0);
    } else {
      for (let i = 0; i < n; i++) {
        // Fan symmetrically across [-spread, +spread].
        const t = n === 1 ? 0 : i / (n - 1) - 0.5;
        offsets.push(t * 2 * spread);
      }
    }
    v.detuneOffsets = offsets;
  }

  private attack(v: PadVoice, p: PadParams, gain: number): void {
    const now = Tone.now();
    const a = Math.max(0.001, p.attack);
    const d = Math.max(0.001, p.decay);
    const s = Math.max(0, Math.min(1, p.sustain));
    const r = Math.max(0.001, p.release);
    v.attackAt = now;
    v.releaseAt = null;
    v.adsr = { a, d, s, r };
    const g = v.env.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(gain, now + a);
    g.linearRampToValueAtTime(s * gain, now + a + d);
  }

  private release(v: PadVoice, p: PadParams): void {
    if (!v.isOn) return;
    const now = Tone.now();
    const r = Math.max(0.001, p.release);
    v.adsr = { ...v.adsr, r };
    v.releaseAt = now;
    const g = v.env.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + r);
    v.isOn = false;
    v.lastGain = 0;
  }

  /**
   * Analytical ADSR envelope value at `t` (Tone context seconds) for
   * a voice, in [0, 1]. Uses the ADSR captured at attack time so live
   * slider edits don't warp an already-scheduled envelope.
   */
  private envAt(v: PadVoice, t: number): number {
    if (v.attackAt === 0) return 0;
    const { a, d, s, r } = v.adsr;
    if (v.releaseAt !== null) {
      const rt = t - v.releaseAt;
      if (rt >= r) return 0;
      // Level at release start: sample the pre-release shape.
      const preRel = this.holdEnv(v.releaseAt - v.attackAt, a, d, s);
      return preRel * (1 - rt / r);
    }
    return this.holdEnv(t - v.attackAt, a, d, s);
  }

  private holdEnv(dt: number, a: number, d: number, s: number): number {
    if (dt <= 0) return 0;
    if (dt < a) return dt / a;
    if (dt < a + d) return 1 + (s - 1) * ((dt - a) / d);
    return s;
  }

  /**
   * Peak ADSR envelope value across all voices at `t`. This is the
   * modulation source for the filter's envelope-amount boost. Exposed
   * for the UI so the response plot mirrors the engine exactly.
   */
  getEnvelopePeak(t: number = Tone.now()): number {
    let peak = 0;
    for (const v of this.voices.values()) {
      const e = this.envAt(v, t);
      if (e > peak) peak = e;
    }
    return peak;
  }
}

let singleton: PadEngine | null = null;
export function getPadEngine(): PadEngine {
  if (!singleton) singleton = new PadEngine();
  return singleton;
}
