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
  /** Sums the unison stack. */
  mix: Tone.Gain;
  /** ADSR-scheduled gain. */
  env: Tone.Gain;
  isOn: boolean;
  /** Last applied gain multiplier — used to detect live sustain edits. */
  lastGain: number;
}

export class PadEngine {
  private started = false;
  private master: Tone.Gain | null = null;
  private reverb: Tone.Reverb | null = null;
  private reverbDryGain: Tone.Gain | null = null;
  private reverbWetGain: Tone.Gain | null = null;
  private chorus: Tone.Chorus | null = null;
  private filter: Tone.Filter | null = null;
  private bus: Tone.Gain | null = null;

  private voices = new Map<string, PadVoice>();
  private currentWaveform: PadWaveform = "sawtooth";
  private currentReverbDecay = -1;

  async start(): Promise<void> {
    if (this.started) return;
    await Tone.start();
    this.master = new Tone.Gain(0).toDestination();
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
    this.filter = new Tone.Filter({ type: "lowpass", frequency: 900, Q: 0.7 });
    this.filter.connect(this.chorus);
    this.bus = new Tone.Gain(1);
    this.bus.connect(this.filter);
    this.started = true;
  }

  isStarted(): boolean {
    return this.started;
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

    // Global filter cutoff. The pad has no filter LFO — env amount is
    // applied per-voice inside `attack` by scheduling the base cutoff
    // together with an added envelope contribution on this global node.
    // To keep the engine simple, we hold the filter at the base cutoff
    // (env amount adds a static offset while any voice is sounding).
    const anyOn = Array.from(this.voices.values()).some((v) => v.isOn);
    const envBoost = anyOn ? Math.max(0, p.filterEnvAmount) : 0;
    const targetCutoff = Math.max(
      20,
      Math.min(20000, p.filterHz + envBoost),
    );
    this.filter.frequency.rampTo(targetCutoff, 0.15);
    this.filter.Q.rampTo(Math.max(0.1, p.filterQ), 0.08);

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
    for (const av of active) {
      seen.add(av.id);
      const voice = this.getOrCreateVoice(av.id, av.note, p);
      // Live retune if the note pitch or detune drifted.
      this.retune(voice, av.note, av.detuneCents, p);
      this.syncUnison(voice, p);
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
      mix,
      env,
      isOn: false,
      lastGain: 0,
    };
    this.growUnisonTo(v, freq, p);
    return v;
  }

  private retune(v: PadVoice, note: string, detuneCents: number, p: PadParams): void {
    if (v.note !== note) {
      v.note = note;
      const f = Tone.Frequency(note).toFrequency();
      for (const o of v.oscs) o.frequency.rampTo(f, 0.03);
    }
    for (let i = 0; i < v.oscs.length; i++) {
      const target = detuneCents + (v.detuneOffsets[i] ?? 0);
      v.oscs[i].detune.rampTo(target, 0.05);
    }
    // Silence unused suffix if unison shrank — actual grow/shrink handled
    // in syncUnison; this keeps existing oscs on the right pitch.
    void p;
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
    }
    while (v.oscs.length > target) {
      const osc = v.oscs.pop();
      osc?.disconnect();
      osc?.stop();
      osc?.dispose();
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
    const g = v.env.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + r);
    v.isOn = false;
    v.lastGain = 0;
  }
}

let singleton: PadEngine | null = null;
export function getPadEngine(): PadEngine {
  if (!singleton) singleton = new PadEngine();
  return singleton;
}
