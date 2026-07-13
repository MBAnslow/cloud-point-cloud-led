import * as Tone from "tone";
import {
  HARMONIC_COUNT,
  HARMONIC_OCTAVE_OFFSETS,
  HARMONIC_VOICE_DEFAULTS,
  NOTE_FX_DEFAULTS,
  harmonicLayerDefaultSemitones,
  type DroneLfoShape,
  type DroneParams,
  type DroneWaveform,
  type HarmonicVoice,
  type NoteFx,
} from "../state";

/**
 * Anti-beating micro-drift applied to extension layers only. Sines at
 * close just-intonation intervals (e.g. +7 P5 vs +9 M6 at C1) beat at
 * their frequency difference in the low Hz range — pure physics. A
 * small always-on pitch LFO (a couple cents, sub-Hz) continuously
 * varies each layer's frequency by an imperceptible amount so the
 * beat frequency itself modulates, dissolving the perceived beat into
 * a subtle chorus. Only applied to extension layers because octave
 * layers are far enough apart that their sums don't produce audible
 * beating.
 */
const ANTI_BEAT_DRIFT_CENTS = 1.5;

/**
 * Build a partials array for a per-layer overtone slider in [0, 1].
 * At 0 the layer is a pure sine. As `b` rises, harmonics 2..8 fade in
 * with a 1/n decaying series (sawtooth-shaped), producing a smooth
 * pure→bright continuum. Fundamental is always at unity so overall
 * level is preserved for the ear.
 */
function overtonePartials(b: number): number[] {
  const amt = Math.max(0, Math.min(1, b));
  return [
    1,
    amt * (1 / 2),
    amt * (1 / 3),
    amt * (1 / 4),
    amt * (1 / 5),
    amt * (1 / 6),
    amt * (1 / 7),
    amt * (1 / 8),
  ];
}
function antiBeatDriftHz(layerIndex: number): number {
  // Deterministic per-layer sub-Hz jitter so no two extension layers
  // share the same drift rate; keeps them permanently decorrelated.
  return 0.27 + (layerIndex % HARMONIC_COUNT) * 0.11;
}
import { activeVoicesAt } from "./droneCycle";

/**
 * Maximum filter wobble depth in octaves (depth=1 sweeps the cutoff
 * from `base` down to `base / 2^MAX_WOBBLE_OCTAVES`). Log-space sweep
 * is used so the modulation stays audible regardless of base cutoff.
 */
const MAX_WOBBLE_OCTAVES = 5;

/**
 * Per-oscillator rate multipliers for drift LFOs. Keeping them slightly
 * irrational-ish prevents the drift LFOs from phase-aligning across
 * unison voices, which would sound like a single wobble instead of a
 * chorus of independent wanderings.
 */
const DRIFT_JITTER = [1.0, 0.83, 1.17, 0.71, 1.29, 0.93, 1.11, 0.77];


interface Voice {
  note: string;
  /** Stacked unison oscillators. Length equals fx.unisonCount. */
  oscs: Tone.Oscillator[];
  /**
   * Per-oscillator drift LFOs, index-aligned with `oscs`. Each LFO
   * overrides its osc's detune param and outputs the absolute cents
   * value; min==max collapses to a DC signal at that value.
   */
  driftLfos: Tone.LFO[];
  /** Sums the unison stack with equal-power compensation. */
  unisonMix: Tone.Gain;
  /** Hidden legacy base-osc path; kept muted so layers are source-of-truth. */
  legacyBaseGain: Tone.Gain;
  /** Per-voice lowpass filter. Cutoff = fx.filterHz (modulated by filterLfo). */
  perNoteFilter: Tone.Filter;
  /** Per-voice filter cutoff LFO (kept inert for compatibility). */
  perNoteFilterLfo: Tone.LFO;
  /** ADSR gain node (manually ramped). */
  env: Tone.Gain;
  /** Per-voice tremolo gain (overridden by perNoteTremoloLfo). */
  perNoteTremoloGain: Tone.Gain;
  /** Per-voice tremolo LFO. */
  perNoteTremoloLfo: Tone.LFO;
  /**
   * Harmonic partial slots (2×..(HARMONIC_COUNT+1)× fundamental). Each
   * slot is a mini synth voice:
   *   osc → levelGain → tremGain (LFO-overridden) → unisonMix
   * and a drift LFO overrides osc.detune. All arrays index-aligned.
   */
  harmonicOscs: Tone.Oscillator[];
  harmonicLevels: Tone.Gain[];
  harmonicTremGains: Tone.Gain[];
  harmonicTremLfos: Tone.LFO[];
  harmonicDriftLfos: Tone.LFO[];
  /** Last snapshot of each harmonic slot — used for change detection. */
  harmonicPrev: HarmonicVoice[];
  isOn: boolean;
  /** Last applied fx snapshot — used to skip no-op writes. */
  fx: NoteFx;
}

/**
 * Tone.js drone engine. Signal chain:
 *
 *   voices (osc → env) → bus → filter → tremoloGain → master → destination
 *                                 ▲            ▲
 *                          filterLFO      tremoloLFO
 *
 * IMPORTANT: `Tone.Signal.connect(toneParam)` OVERRIDES the destination
 * param rather than adding to it (this differs from raw Web Audio's
 * additive param modulation). So the LFO output is the absolute value
 * of the param — its `min`/`max` are the full range, not a delta. With
 * depth=0 we set min==max==base so the "LFO" is a DC signal equal to
 * the base value and the chain stays transparent.
 */
export class DroneEngine {
  private started = false;
  private master: Tone.Gain | null = null;
  private distortion: Tone.Distortion | null = null;
  private saturation: Tone.WaveShaper | null = null;
  private saturationMix: Tone.CrossFade | null = null;
  private tremoloGain: Tone.Gain | null = null;
  private tremoloLfo: Tone.LFO | null = null;
  private bus: Tone.Gain | null = null;

  private voices = new Map<string, Voice>();
  private previewVoice: Voice | null = null;
  private previewNote: string | null = null;
  private currentWaveform: DroneWaveform = "triangle";
  private currentTremoloShape: DroneLfoShape = "sine";
  private currentDistortionDrive = -1;

  private shapeSample(shape: DroneLfoShape, phase01: number): number {
    const p = phase01 - Math.floor(phase01);
    if (shape === "sine") return Math.sin(2 * Math.PI * p);
    if (shape === "triangle") return 1 - 4 * Math.abs(p - 0.5);
    if (shape === "square") return p < 0.5 ? 1 : -1;
    return 2 * p - 1;
  }

  private harmonicFreq(baseHz: number, semitones: number): number {
    return baseHz * this.intervalRatio(semitones);
  }

  /**
   * Ratio for interval stacking. Uses simple just-intonation ratios for
   * common named intervals to reduce beating against the fundamental, while
   * still supporting arbitrary semitone offsets from the dropdown.
   */
  private intervalRatio(semitones: number): number {
    const rounded = Math.round(semitones);
    const oct = Math.floor(rounded / 12);
    const rem = ((rounded % 12) + 12) % 12;
    const justBySemitone: number[] = [
      1, // unison
      16 / 15, // m2
      9 / 8, // M2
      6 / 5, // m3
      5 / 4, // M3
      4 / 3, // P4
      45 / 32, // tritone
      3 / 2, // P5
      8 / 5, // m6
      5 / 3, // M6
      9 / 5, // m7
      15 / 8, // M7
    ];
    return Math.pow(2, oct) * justBySemitone[rem];
  }

  async start(): Promise<void> {
    if (this.started) return;
    await Tone.start();
    // Master output is intentionally left disconnected here; the shared
    // MasterFxBus decides whether to route it through the EQ chain or
    // directly to destination via `setRouting`.
    this.master = new Tone.Gain(0);
    this.distortion = new Tone.Distortion({ distortion: 0, wet: 0, oversample: "2x" });
    this.distortion.connect(this.master);
    this.tremoloGain = new Tone.Gain(1);
    this.tremoloGain.connect(this.distortion);
    // --- Master saturation: tanh soft-clip waveshaper crossfaded with
    // the dry signal. amount=0 → 100% dry (bypass), amount=1 → fully
    // shaped. Sits between the bus and the tremolo gain so it colors
    // the summed drone before amplitude modulation. The static
    // low-pass / high-pass EQ chain lives in the shared MasterFxBus
    // downstream of `master`.
    this.saturation = new Tone.WaveShaper((x) => Math.tanh(3 * x), 4096);
    this.saturationMix = new Tone.CrossFade(0);
    this.saturation.connect(this.saturationMix.b);
    this.saturationMix.connect(this.tremoloGain);
    this.bus = new Tone.Gain(1);
    this.bus.connect(this.saturationMix.a);
    this.bus.connect(this.saturation);
    // Tremolo LFO: min/max is the absolute gain range. With depth=0 we
    // set both to 1 so the "LFO" is a DC 1 → passthrough.
    this.tremoloLfo = new Tone.LFO({
      frequency: 4,
      min: 1,
      max: 1,
      type: "sine",
    }).start();
    this.tremoloLfo.connect(this.tremoloGain.gain);
    this.started = true;
  }

  /**
   * Repatch the master output. Pass a node to route into, or `null` to
   * revert to a raw destination connection. Safe to call every frame —
   * we track the current target and no-op when it doesn't change.
   */
  private currentRoutingTarget: Tone.InputNode | null | undefined = undefined;
  setRouting(target: Tone.InputNode | null): void {
    if (!this.started || !this.master) return;
    if (this.currentRoutingTarget === target) return;
    this.master.disconnect();
    if (target) this.master.connect(target);
    else this.master.toDestination();
    this.currentRoutingTarget = target;
  }

  isStarted(): boolean {
    return this.started;
  }

  setPreview(note: string | null): void {
    this.previewNote = note;
  }

  update(hour: number, p: DroneParams): void {
    if (
      !this.started ||
      !this.master ||
      !this.tremoloGain ||
      !this.tremoloLfo ||
      !this.saturationMix ||
      !this.distortion
    )
      return;
    this.master.gain.rampTo(p.enabled ? p.masterGain : 0, 0.05);

    if (p.waveform !== this.currentWaveform) {
      this.currentWaveform = p.waveform;
      for (const v of this.voices.values()) {
        for (const o of v.oscs) o.type = p.waveform;
      }
      if (this.previewVoice) {
        for (const o of this.previewVoice.oscs) o.type = p.waveform;
      }
    }

    // Tremolo LFO drives the gain directly (it overrides). Full range
    // is [1 - depth, 1]; depth=0 collapses to a constant 1 = passthrough.
    const trDepth = Math.max(0, Math.min(1, p.tremoloDepth));
    this.tremoloLfo.frequency.rampTo(Math.max(0.01, p.tremoloRateHz), 0.05);
    this.tremoloLfo.min = 1 - trDepth;
    this.tremoloLfo.max = 1;
    if (p.tremoloShape !== this.currentTremoloShape) {
      this.tremoloLfo.type = p.tremoloShape;
      this.currentTremoloShape = p.tremoloShape;
    }

    // Master saturation: crossfade between dry (a) and shaped (b).
    this.saturationMix.fade.rampTo(
      Math.max(0, Math.min(1, p.saturation)),
      0.08,
    );

    // Distortion: single soft-clip waveshaper. Only rebuild the curve
    // when drive actually moves — regenerating allocates a new Float32.
    const distDrive = Math.max(0, Math.min(1, p.distortionDrive));
    if (Math.abs(distDrive - this.currentDistortionDrive) > 0.01) {
      this.distortion.distortion = distDrive;
      this.currentDistortionDrive = distDrive;
    }
    this.distortion.wet.rampTo(
      p.distortionEnabled ? Math.max(0, Math.min(1, p.distortionMix)) : 0,
      0.1,
    );

    if (!p.enabled) {
      for (const v of this.voices.values()) this.release(v, p);
      if (this.previewVoice) this.release(this.previewVoice, p);
      return;
    }

    const active = activeVoicesAt(p.notes, hour);
    const seen = new Set<string>();
    for (const av of active) {
      seen.add(av.id);
      const voice = this.getOrCreateVoice(av.id, av.note, p.waveform);
      const prevGain = voice.fx.gain;
      // Sync per-note filter + tremolo params (also mutates voice.fx).
      this.applyFxToVoice(voice, av.fx);
      const g = Math.max(0, Math.min(1, av.fx.gain));
      if (!voice.isOn) {
        this.attack(voice, p);
        voice.isOn = true;
      } else if (Math.abs(prevGain - g) > 0.001) {
        // Volume edited while sustaining — smoothly retarget sustain
        // level so live tweaks are audible without re-triggering.
        const now = Tone.now();
        const s = Math.max(0.0001, Math.min(1, p.sustain));
        const gp = voice.env.gain;
        gp.cancelScheduledValues(now);
        gp.setValueAtTime(gp.value, now);
        gp.linearRampToValueAtTime(s * g, now + 0.05);
      }
    }
    for (const [id, voice] of this.voices) {
      if (!seen.has(id)) this.release(voice, p);
    }

    if (this.previewNote) {
      const pv = this.ensurePreviewVoice(this.previewNote, p.waveform);
      if (!pv.isOn) {
        this.attack(pv, p);
        pv.isOn = true;
      }
    } else if (this.previewVoice) {
      this.release(this.previewVoice, p);
    }
  }

  private getOrCreateVoice(id: string, note: string, wf: DroneWaveform): Voice {
    let v = this.voices.get(id);
    if (v) {
      if (v.note !== note) {
        v.note = note;
        const f = Tone.Frequency(note).toFrequency();
        for (const o of v.oscs) o.frequency.rampTo(f, 0.02);
        for (let i = 0; i < v.harmonicOscs.length; i++) {
          const semi = v.fx.harmonics[i]?.intervalSemitones ?? 0;
          v.harmonicOscs[i].frequency.rampTo(this.harmonicFreq(f, semi), 0.02);
        }
      }
      return v;
    }
    v = this.buildVoice(note, wf);
    this.voices.set(id, v);
    return v;
  }

  private ensurePreviewVoice(note: string, wf: DroneWaveform): Voice {
    if (this.previewVoice) {
      if (this.previewVoice.note !== note) {
        this.previewVoice.note = note;
        const f = Tone.Frequency(note).toFrequency();
        for (const o of this.previewVoice.oscs) o.frequency.rampTo(f, 0.02);
        for (let i = 0; i < this.previewVoice.harmonicOscs.length; i++) {
          const semi = this.previewVoice.fx.harmonics[i]?.intervalSemitones ?? 0;
          this.previewVoice.harmonicOscs[i].frequency.rampTo(
            this.harmonicFreq(f, semi),
            0.02,
          );
        }
      }
      return this.previewVoice;
    }
    this.previewVoice = this.buildVoice(note, wf);
    return this.previewVoice;
  }

  private buildVoice(note: string, wf: DroneWaveform): Voice {
    if (!this.bus) throw new Error("DroneEngine.start() must complete first");
    const freq = Tone.Frequency(note).toFrequency();

    // MINIMAL known-good chain (restored):
    //   osc → unisonMix → perNoteFilter → env → perNoteTremoloGain → bus
    //
    // The drift LFO, breath LFO, harmonic oscillators, shimmer oscillator
    // and pink noise are all constructed so the Voice interface stays
    // stable, but they are NOT connected to the audible path here. They
    // only get connected on-demand from applyFxToVoice when their driving
    // parameter goes above 0. Doing this eagerly caused silence on some
    // Tone.js builds — either from LFO override edge cases or noise nodes
    // running while nominally muted.
    const unisonMix = new Tone.Gain(1);
    // Random starting phase decorrelates the fundamental unison osc from
    // other layers so their sum doesn't produce phase-lock beat artifacts.
    const osc = new Tone.Oscillator({
      type: wf,
      frequency: freq,
      phase: Math.random() * 360,
    }).start();
    // Keep legacy root/unison oscillators fully muted. Audible pitch content
    // now comes strictly from the user-visible octave/extension layers.
    const legacyBaseGain = new Tone.Gain(0);
    osc.connect(legacyBaseGain);
    legacyBaseGain.connect(unisonMix);

    const perNoteFilter = new Tone.Filter({
      type: "lowpass",
      frequency: NOTE_FX_DEFAULTS.filterHz,
      Q: NOTE_FX_DEFAULTS.filterQ,
    });
    const env = new Tone.Gain(0);
    const perNoteTremoloGain = new Tone.Gain(1);
    unisonMix.connect(perNoteFilter);
    perNoteFilter.connect(env);
    env.connect(perNoteTremoloGain);
    perNoteTremoloGain.connect(this.bus);

    // Tremolo LFO (kept — it worked before and is the only always-on
    // LFO in the voice path). min==max==1 → DC 1 = passthrough.
    const perNoteTremoloLfo = new Tone.LFO({
      frequency: NOTE_FX_DEFAULTS.tremoloRateHz,
      min: 1,
      max: 1,
      type: NOTE_FX_DEFAULTS.tremoloShape,
    }).start();
    perNoteTremoloLfo.connect(perNoteTremoloGain.gain);

    // Drift LFO starts disconnected; applyFxToVoice will connect/start it
    // when needed as part of unison sync.
    const driftLfo = new Tone.LFO({
      frequency: 0.3,
      min: 0,
      max: 0,
      type: "sine",
    });
    // Per-note cutoff wobble node is kept inert; fundamental cutoff wobble
    // is applied explicitly in applyFxToVoice to avoid AudioParam override
    // edge cases that can mute voices.
    const perNoteFilterLfo = new Tone.LFO({
      frequency: 2,
      min: NOTE_FX_DEFAULTS.filterHz,
      max: NOTE_FX_DEFAULTS.filterHz,
      type: NOTE_FX_DEFAULTS.filterLfoShape,
    }).start();
    // --- Harmonic slots. Each partial gets its own mini synth voice:
    //   hOsc → levelGain → tremGain → unisonMix
    // where the tremolo LFO overrides tremGain.gain (min==max==1 = DC
    // passthrough when off), and a drift LFO overrides hOsc.detune
    // (min==max==0 = detune=0 when off). All are started so param
    // changes take effect immediately without extra bookkeeping; level
    // defaults to 0 keeping every partial silent until raised.
    const harmonicOscs: Tone.Oscillator[] = [];
    const harmonicLevels: Tone.Gain[] = [];
    const harmonicTremGains: Tone.Gain[] = [];
    const harmonicTremLfos: Tone.LFO[] = [];
    const harmonicDriftLfos: Tone.LFO[] = [];
    for (let i = 0; i < HARMONIC_COUNT; i++) {
      const semi = NOTE_FX_DEFAULTS.harmonics[i]?.intervalSemitones ?? 0;
      // Random starting phase for each layer prevents phase-lock beating
      // when multiple pure sines sum together (all-zero-phase sines at
      // rational-ratio frequencies produce audible amplitude beating at
      // their difference frequency and slow drift artifacts).
      // Use `partials` (custom harmonic series) instead of a pure "sine"
      // so we can smoothly add overtones per-layer. partials = [1] is
      // acoustically identical to type: "sine".
      const hOsc = new Tone.Oscillator({
        frequency: this.harmonicFreq(freq, semi),
        phase: Math.random() * 360,
      });
      hOsc.partials = overtonePartials(0);
      hOsc.start();
      const levelGain = new Tone.Gain(0);
      const tremGain = new Tone.Gain(1);
      hOsc.connect(levelGain);
      levelGain.connect(tremGain);
      tremGain.connect(unisonMix);

      const tremLfo = new Tone.LFO({
        frequency: HARMONIC_VOICE_DEFAULTS.tremRateHz,
        min: 1,
        max: 1,
        type: "sine",
        phase: (i * 71) % 360,
      }).start();
      tremLfo.connect(tremGain.gain);

      const isExtension = i >= HARMONIC_OCTAVE_OFFSETS.length;
      const antiBeatCents = isExtension ? ANTI_BEAT_DRIFT_CENTS : 0;
      const antiBeatHz = isExtension ? antiBeatDriftHz(i) : 0;
      const driftLfo = new Tone.LFO({
        frequency: HARMONIC_VOICE_DEFAULTS.driftRateHz + antiBeatHz,
        min: -antiBeatCents,
        max: antiBeatCents,
        type: "sine",
        phase: (i * 137) % 360,
      }).start();
      driftLfo.connect(hOsc.detune);

      harmonicOscs.push(hOsc);
      harmonicLevels.push(levelGain);
      harmonicTremGains.push(tremGain);
      harmonicTremLfos.push(tremLfo);
      harmonicDriftLfos.push(driftLfo);
    }
    const harmonicPrev = Array.from(
      { length: HARMONIC_COUNT },
      (_, i) => ({
        ...HARMONIC_VOICE_DEFAULTS,
        intervalSemitones: harmonicLayerDefaultSemitones(i),
      }),
    );

    return {
      note,
      oscs: [osc],
      driftLfos: [driftLfo],
      unisonMix,
      legacyBaseGain,
      perNoteFilter,
      perNoteFilterLfo,
      env,
      perNoteTremoloGain,
      perNoteTremoloLfo,
      harmonicOscs,
      harmonicLevels,
      harmonicTremGains,
      harmonicTremLfos,
      harmonicDriftLfos,
      harmonicPrev,
      isOn: false,
      fx: {
        ...NOTE_FX_DEFAULTS,
        harmonics: NOTE_FX_DEFAULTS.harmonics.map((h) => ({ ...h })),
      },
    };
  }

  private attack(v: Voice, p: DroneParams): void {
    const now = Tone.now();
    const a = Math.max(0.001, p.attack);
    const d = Math.max(0.001, p.decay);
    const s = Math.max(0.0001, Math.min(1, p.sustain));
    const g = v.env.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    const vg = Math.max(0, Math.min(1, v.fx.gain));
    g.linearRampToValueAtTime(vg, now + a);
    g.linearRampToValueAtTime(s * vg, now + a + d);
  }

  /**
   * Grow or shrink the unison stack on this voice to `count` oscillators
   * and fan detune symmetrically around the base pitch. Uses equal-power
   * compensation on the submix gain so total loudness stays roughly the
   * same as you stack more voices.
   */
  private syncUnison(v: Voice, fx: NoteFx): void {
    const targetCount = Math.max(1, Math.min(8, Math.round(fx.unisonCount)));
    const freq = Tone.Frequency(v.note).toFrequency();
    const wf = this.currentWaveform;

    // Grow.
    while (v.oscs.length < targetCount) {
      const i = v.oscs.length;
      const osc = new Tone.Oscillator({
        type: wf,
        frequency: freq,
        phase: Math.random() * 360,
      }).start();
      osc.connect(v.legacyBaseGain);
      const driftLfo = new Tone.LFO({
        frequency:
          Math.max(0.01, fx.unisonDriftRateHz) *
          DRIFT_JITTER[i % DRIFT_JITTER.length],
        min: 0,
        max: 0,
        type: "sine",
        phase: (i * 137) % 360,
      }).start();
      driftLfo.connect(osc.detune);
      v.oscs.push(osc);
      v.driftLfos.push(driftLfo);
    }
    // Shrink.
    while (v.oscs.length > targetCount) {
      const osc = v.oscs.pop();
      const lfo = v.driftLfos.pop();
      lfo?.disconnect();
      lfo?.stop();
      lfo?.dispose();
      osc?.disconnect();
      osc?.stop();
      osc?.dispose();
    }

    v.unisonMix.gain.rampTo(1 / Math.sqrt(targetCount), 0.05);

    const spread = Math.max(0, fx.unisonDetuneCents);
    const drift = Math.max(0, fx.unisonDriftCents);
    const rate = Math.max(0.01, fx.unisonDriftRateHz);

    for (let i = 0; i < v.oscs.length; i++) {
      const t = v.oscs.length === 1 ? 0 : (i / (v.oscs.length - 1)) * 2 - 1;
      const baseCents = fx.detuneCents + t * spread;
      const lfo = v.driftLfos[i];
      lfo.min = baseCents - drift;
      lfo.max = baseCents + drift;
      lfo.frequency.rampTo(
        rate * DRIFT_JITTER[i % DRIFT_JITTER.length],
        0.1,
      );
    }
  }

  /**
   * Sync a voice's per-note filter + tremolo to the given fx. Also
   * updates the stored `fx` on the voice. Skips writes for values
   * that haven't meaningfully changed to avoid churning param ramps.
   */
  private applyFxToVoice(v: Voice, fx: NoteFx): void {
    const prev = v.fx;

    // Unison / density / dissonance / age / width: any of these
    // requires rebuilding the unison stack or its per-osc panning.
    if (
      fx.unisonCount !== prev.unisonCount ||
      Math.abs(fx.unisonDetuneCents - prev.unisonDetuneCents) > 0.1 ||
      Math.abs(fx.detuneCents - prev.detuneCents) > 0.5 ||
      Math.abs(fx.unisonDriftCents - prev.unisonDriftCents) > 0.05 ||
      Math.abs(fx.unisonDriftRateHz - prev.unisonDriftRateHz) > 0.005
    ) {
      this.syncUnison(v, fx);
    }

    // Per-note filter + cutoff wobble around the base cutoff.
    const base = Math.max(20, fx.filterHz);
    const fld = Math.max(0, Math.min(1, fx.filterLfoDepth));
    // Symmetric log-space wobble around the base cutoff so modulation
    // moves both above and below the specified filter frequency.
    const halfSpanOct = (fld * MAX_WOBBLE_OCTAVES) / 2;
    const minHz = Math.max(20, base / Math.pow(2, halfSpanOct));
    const maxHz = Math.max(minHz, Math.min(20000, base * Math.pow(2, halfSpanOct)));
    const rateHz = Math.max(0.05, fx.filterLfoRateHz || 0.05);
    const phase = Tone.now() * rateHz;
    const wave = this.shapeSample(fx.filterLfoShape, phase); // [-1, 1]
    const t = (wave + 1) * 0.5; // [0, 1]
    const cutoffNow =
      fld > 0.0001
        ? minHz * Math.pow(maxHz / minHz, t)
        : base;
    v.perNoteFilter.frequency.rampTo(cutoffNow, 0.03);
    v.perNoteFilter.Q.rampTo(Math.max(0.1, fx.filterQ), 0.05);

    // Per-voice tremolo LFO.
    const td = Math.max(0, Math.min(1, fx.tremoloDepth));
    v.perNoteTremoloLfo.frequency.rampTo(
      Math.max(0.01, fx.tremoloRateHz),
      0.05,
    );
    v.perNoteTremoloLfo.min = 1 - td;
    v.perNoteTremoloLfo.max = 1;
    if (fx.tremoloShape !== prev.tremoloShape) {
      v.perNoteTremoloLfo.type = fx.tremoloShape;
    }

    // --- Per-harmonic sync. Each slot has:
    //   level  → levelGain
    //   trem   → tremLfo drives tremGain (min=1-depth, max=1)
    //   drift  → driftLfo drives osc.detune (min=-drift, max=+drift)
    // Writes are skipped when a value hasn't meaningfully moved.
    for (let i = 0; i < v.harmonicOscs.length; i++) {
      const h = fx.harmonics[i] ?? HARMONIC_VOICE_DEFAULTS;
      const hp = v.harmonicPrev[i];
      if (Math.abs(h.intervalSemitones - hp.intervalSemitones) > 0.1) {
        const baseHz = Tone.Frequency(v.note).toFrequency();
        v.harmonicOscs[i].frequency.rampTo(
          this.harmonicFreq(baseHz, h.intervalSemitones),
          0.05,
        );
      }
      if (Math.abs(h.level - hp.level) > 0.005) {
        v.harmonicLevels[i].gain.rampTo(Math.max(0, Math.min(1, h.level)), 0.05);
      }
      if (Math.abs(h.overtones - hp.overtones) > 0.005) {
        // Reassigning `partials` rebuilds the oscillator's periodic wave.
        // Cheap and glitch-free in Tone.js.
        v.harmonicOscs[i].partials = overtonePartials(h.overtones);
      }
      if (
        Math.abs(h.tremDepth - hp.tremDepth) > 0.005 ||
        Math.abs(h.tremRateHz - hp.tremRateHz) > 0.005
      ) {
        const hd = Math.max(0, Math.min(1, h.tremDepth));
        v.harmonicTremLfos[i].frequency.rampTo(
          Math.max(0.01, h.tremRateHz),
          0.05,
        );
        v.harmonicTremLfos[i].min = 1 - hd;
        v.harmonicTremLfos[i].max = 1;
      }
      if (
        Math.abs(h.driftCents - hp.driftCents) > 0.05 ||
        Math.abs(h.driftRateHz - hp.driftRateHz) > 0.005
      ) {
        const isExtension = i >= HARMONIC_OCTAVE_OFFSETS.length;
        const antiBeatCents = isExtension ? ANTI_BEAT_DRIFT_CENTS : 0;
        const antiBeatHz = isExtension ? antiBeatDriftHz(i) : 0;
        const d = Math.max(0, h.driftCents) + antiBeatCents;
        v.harmonicDriftLfos[i].frequency.rampTo(
          Math.max(0.01, h.driftRateHz + antiBeatHz),
          0.05,
        );
        v.harmonicDriftLfos[i].min = -d;
        v.harmonicDriftLfos[i].max = d;
      }
      v.harmonicPrev[i] = { ...h };
    }

    v.fx = fx;
  }

  private release(v: Voice, p: DroneParams): void {
    if (!v.isOn) return;
    const now = Tone.now();
    const r = Math.max(0.001, p.release);
    const g = v.env.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + r);
    v.isOn = false;
  }
}

let singleton: DroneEngine | null = null;
export function getDroneEngine(): DroneEngine {
  if (!singleton) singleton = new DroneEngine();
  return singleton;
}
