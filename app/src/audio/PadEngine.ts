import * as Tone from "tone";
import type { PadDelaySync, PadParams, PadWaveform } from "../state";
import { activePadVoicesAt } from "./padCycle";
import { applyFilterChain } from "./filterChain";
import { meterAbs } from "./meterAbs";
import { ensureLimitedAux, limitedAuxIfStarted } from "./MasterFxBus";

const finite = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

const changed = (previous: number, next: number, epsilon = 0.0001): boolean =>
  !Number.isFinite(previous) || Math.abs(previous - next) > epsilon;

/** Map the 0..0.99 "Room" control onto a convolution decay of ~0.6–8 s. */
function roomSizeToDecaySec(room: number): number {
  const r = Math.max(0, Math.min(0.99, finite(room, 0.78)));
  return 0.6 + 8 * Math.pow(r, 1.5);
}

const SYNC_BEATS: Record<Exclude<PadDelaySync, "off">, number> = {
  "1/4": 1,
  "1/8": 0.5,
  "1/8d": 0.75,
  "1/8t": 1 / 3,
  "1/16": 0.25,
};

function delaySeconds(p: PadParams): number {
  if (p.delaySync === "off") return finite(p.delayTimeSec, 0.375);
  const bpm = Math.max(30, Math.min(300, finite(p.tempoBpm, 90)));
  return (60 / bpm) * SYNC_BEATS[p.delaySync];
}

/**
 * Decay and release use exponential curves (setTargetAtTime). Time
 * constant = stage / divisor. Release uses a gentler divisor so the tail
 * hangs on through most of the Release time instead of dropping early
 * (half level at ~0.35 r, -17 dB at r). A release is treated as finished
 * after ENV_RELEASE_TAIL × r, by which point it is below -60 dB.
 */
const ENV_TAU_DIV = 4;
const ENV_RELEASE_TAU_DIV = 2;
/** Key tracking pivot: notes at middle C keep the set cutoff. */
const KEY_TRACK_REF_HZ = 261.63;
/** Pink noise is broadband and loud; keep Noise level 1 a gentle layer. */
const NOISE_GAIN_SCALE = 0.25;
const ENV_RELEASE_TAIL = 3.5;

/** Equal-ish spacing in [-1, 1] bunched toward the centre (supersaw style). */
function unisonPosition(i: number, n: number): number {
  if (n <= 1) return 0;
  const t = (i / (n - 1)) * 2 - 1;
  return Math.sign(t) * Math.pow(Math.abs(t), 1.6);
}

function normalizedWetMixes(
  reverb: number,
  delay: number,
): { dry: number; reverb: number; delay: number } {
  const r = Math.max(0, Math.min(1, finite(reverb, 0)));
  const d = Math.max(0, Math.min(1, finite(delay, 0)));
  const dry = Math.max(0, 1 - r - d);
  const total = Math.max(1, dry + r + d);
  return { dry: dry / total, reverb: r / total, delay: d / total };
}

/**
 * Warm-pad synth engine. Signal chain per voice:
 *
 *   Oscillator[unisonCount] (detuned, stereo-spread, phase-randomised)
 *     + mono sine sub
 *     → per-note low-pass → voiceGain (ADSR-scheduled)
 *     → padBus
 *
 * Global bus chain:
 *
 *   padBus → glue compressor → compensated saturation → chorus
 *          → normalized dry / reverb / ping-pong delay returns
 *          → master → mid/side (side high-passed) → 3-band EQ
 *          → HP/LP filter chain → destination
 *
 * Independent of the drone engine — separate Tone graph and singleton
 * so both instruments can play concurrently.
 */

interface PadVoice {
  note: string;
  oscs: Tone.Oscillator[];
  /** Stereo position for each unison oscillator before summing. */
  panners: Tone.Panner[];
  /** Symmetric detune constant per osc index; recomputed on unison count change. */
  detuneOffsets: number[];
  /** Smoothed live detune value; avoids rescheduling AudioParam ramps per frame. */
  detuneStates: number[];
  /**
   * Random phase offset (radians) per unison osc for the pitch-drift
   * LFO, so drift feels organic rather than in phase lock across the stack.
   */
  driftPhases: number[];
  /** Sums the unison stack. */
  mix: Tone.Gain;
  /** Mono sine an octave or two below; bypasses unison gain compensation. */
  sub: Tone.Oscillator;
  subGain: Tone.Gain;
  lastSubLevel: number;
  lastSubOctave: number;
  /** Second, single-oscillator timbre layer at an interval from the note. */
  osc2: Tone.Oscillator;
  osc2Gain: Tone.Gain;
  lastOsc2Level: number;
  lastOsc2Semitones: number;
  lastOsc2Waveform: PadWaveform;
  /** Band-passed shared noise, enveloped per voice, bypassing the low-pass. */
  noiseFilter: Tone.Filter;
  noiseGain: Tone.Gain;
  lastNoiseLevel: number;
  lastNoiseToneHz: number;
  /** Humanize offsets rolled once per note. */
  humanDetuneCents: number;
  humanCutoffMul: number;
  humanGainMul: number;
  /** Per-note low-pass, modulated by this voice's own ADSR. */
  filter: Tone.Filter;
  lastFilterSlope: number;
  filterCutoffState: number;
  filterLfoPhase: number;
  lastFilterQ: number;
  /** ADSR-scheduled gain. */
  env: Tone.Gain;
  isOn: boolean;
  /** Last applied gain multiplier — used to detect live sustain edits. */
  lastGain: number;
  /** Tone-context timestamp of the most recent attack. */
  attackAt: number;
  /** Tone-context timestamp of release, or null while still holding. */
  releaseAt: number | null;
  lastUnisonCount: number;
  lastUnisonSpread: number;
  lastStereoWidth: number;
  /** ADSR params captured at attack time so envelope math is stable
   *  even if the user edits ADSR sliders mid-note. */
  adsr: { a: number; d: number; s: number; r: number };
}

export class PadEngine {
  private started = false;
  private startPromise: Promise<void> | null = null;
  private master: Tone.Gain | null = null;
  private msSplit: Tone.MidSideSplit | null = null;
  private msMerge: Tone.MidSideMerge | null = null;
  private sideHp: Tone.Filter | null = null;
  private glue: Tone.Compressor | null = null;
  private glueMakeup: Tone.Gain | null = null;
  private lastGlue = Number.NaN;
  private lastMonoBelowHz = Number.NaN;
  private eqLow: Tone.Filter | null = null;
  private eqMid: Tone.Filter | null = null;
  private eqHigh: Tone.Filter | null = null;
  private lastEqKey = "";
  private fft: Tone.FFT | null = null;
  /** One pink noise source shared by every voice's air layer. */
  private noise: Tone.Noise | null = null;
  private lastReverbDecaySec = Number.NaN;
  private pendingReverbDecaySec = Number.NaN;
  private reverbDecayTimer: ReturnType<typeof setTimeout> | null = null;
  private masterHp: Tone.Filter | null = null;
  private masterLp: Tone.Filter | null = null;
  private chorus: Tone.Chorus | null = null;
  private saturation: Tone.Distortion | null = null;
  private postSaturationGain: Tone.Gain | null = null;
  private bus: Tone.Gain | null = null;
  private dryGain: Tone.Gain | null = null;
  private reverbPreDelay: Tone.FeedbackDelay | null = null;
  private reverb: Tone.Reverb | null = null;
  private reverbDampingFilter: Tone.Filter | null = null;
  private reverbWet: Tone.Gain | null = null;
  private delay: Tone.PingPongDelay | null = null;
  private delayWet: Tone.Gain | null = null;
  private meter: Tone.Meter | null = null;

  private voices = new Map<string, PadVoice>();
  /**
   * Cached probability-gate decision per note id. Set on window entry,
   * cleared on window exit so the next entry re-rolls. `true` = allowed
   * to play this pass, `false` = suppressed.
   */
  private probGate = new Map<string, boolean>();
  private currentWaveform: PadWaveform = "sawtooth";
  private waveformTransitioning = false;
  private lastMasterTarget = Number.NaN;
  private lastSaturation = Number.NaN;
  private lastChorusRateHz = Number.NaN;
  private lastChorusDepth = Number.NaN;
  private lastDryGain = Number.NaN;
  private lastReverbGain = Number.NaN;
  private lastDelayGain = Number.NaN;
  private lastReverbRoomSize = Number.NaN;
  private lastReverbDampingHz = Number.NaN;
  private lastReverbPreDelaySec = Number.NaN;
  private lastDelayTimeSec = Number.NaN;
  private lastDelayFeedback = Number.NaN;
  async start(): Promise<void> {
    if (this.started) {
      if (Tone.getContext().rawContext.state !== "running") await Tone.start();
      return;
    }
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startOnce();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async startOnce(): Promise<void> {
    await Tone.start();
    if (this.started) return;
    this.master = new Tone.Gain(0);
    this.masterHp = new Tone.Filter({ type: "highpass", frequency: 10, Q: 0.7 });
    this.masterLp = new Tone.Filter({ type: "lowpass", frequency: 22000, Q: 0.7 });
    // Mid/side stage: high-passing only the side channel keeps the low end
    // mono so unison panning, chorus and reverb can't smear the bass.
    this.msSplit = new Tone.MidSideSplit();
    this.msMerge = new Tone.MidSideMerge();
    this.sideHp = new Tone.Filter({ type: "highpass", frequency: 140, Q: 0.7 });
    this.master.connect(this.msSplit);
    this.msSplit.mid.connect(this.msMerge.mid);
    this.msSplit.side.connect(this.sideHp);
    this.sideHp.connect(this.msMerge.side);
    this.eqLow = new Tone.Filter({ type: "lowshelf", frequency: 120, gain: 0 });
    this.eqMid = new Tone.Filter({ type: "peaking", frequency: 800, Q: 1, gain: 0 });
    this.eqHigh = new Tone.Filter({ type: "highshelf", frequency: 8000, gain: 0 });
    this.msMerge.connect(this.eqLow);
    this.eqLow.connect(this.eqMid);
    this.eqMid.connect(this.eqHigh);
    this.eqHigh.connect(this.masterHp);
    this.masterHp.connect(this.masterLp);
    this.chorus = new Tone.Chorus({
      frequency: 0.3,
      delayTime: 3.5,
      depth: 0.6,
      wet: 0.4,
    }).start();
    // Waveshaper for warmth / drive. `wet` is scaled from p.saturation
    // in update(), so at 0 the chain is transparent.
    this.saturation = new Tone.Distortion({
      // Keep the curve fixed. Rebuilding a WaveShaper curve during a
      // slider drag can make discontinuities; the Drive control adjusts
      // wet amount and compensated output gain instead.
      distortion: 0.45,
      wet: 0,
      oversample: "4x",
    });
    this.postSaturationGain = new Tone.Gain(1);
    this.saturation.connect(this.postSaturationGain);
    this.postSaturationGain.connect(this.chorus);

    // Normalized dry + ambience returns. Parallel gains always sum to
    // unity so increasing space does not also increase total loudness.
    this.dryGain = new Tone.Gain(1);
    this.reverbPreDelay = new Tone.FeedbackDelay({
      delayTime: 0.035,
      feedback: 0,
      wet: 1,
    });
    // Convolution reverb from a decaying stereo noise impulse: smoother
    // and less metallic than Freeverb's comb tank on sustained pads.
    // Pre-delay is handled by `reverbPreDelay` so it never regenerates
    // the impulse.
    this.reverb = new Tone.Reverb({
      decay: roomSizeToDecaySec(0.78),
      preDelay: 0,
      wet: 1,
    });
    this.lastReverbDecaySec = roomSizeToDecaySec(0.78);
    await this.reverb.ready;
    this.reverbDampingFilter = new Tone.Filter({
      type: "lowpass",
      frequency: 3500,
      Q: 0.5,
    });
    this.reverbWet = new Tone.Gain(0);
    this.delay = new Tone.PingPongDelay({
      delayTime: 0.375,
      feedback: 0.25,
      wet: 1,
    });
    this.delayWet = new Tone.Gain(0);
    this.chorus.connect(this.dryGain);
    this.dryGain.connect(this.master);
    this.chorus.connect(this.reverbPreDelay);
    this.reverbPreDelay.connect(this.reverb);
    this.reverb.connect(this.reverbDampingFilter);
    this.reverbDampingFilter.connect(this.reverbWet);
    this.reverbWet.connect(this.master);
    this.chorus.connect(this.delay);
    this.delay.connect(this.delayWet);
    this.delayWet.connect(this.master);

    this.glue = new Tone.Compressor({
      threshold: -0.01,
      ratio: 2.5,
      knee: 6,
      attack: 0.03,
      release: 0.25,
    });
    this.glueMakeup = new Tone.Gain(1);
    this.bus = new Tone.Gain(1);
    this.bus.connect(this.glue);
    this.glue.connect(this.glueMakeup);
    this.glueMakeup.connect(this.saturation);
    this.noise = new Tone.Noise("pink").start();
    this.meter = new Tone.Meter({ normalRange: true });
    this.fft = new Tone.FFT({ size: 2048, smoothing: 0.8 });
    this.masterLp.connect(this.fft);
    const aux = await ensureLimitedAux();
    this.masterLp.connect(aux);
    this.masterLp.connect(this.meter);
    this.currentRoutingTarget = null;
    this.started = true;
  }

  isStarted(): boolean {
    return this.started;
  }

  private currentRoutingTarget: Tone.InputNode | null | undefined = undefined;
  /** See DroneEngine.setRouting. */
  setRouting(target: Tone.InputNode | null): void {
    if (!this.started || !this.masterLp) return;
    if (this.currentRoutingTarget === target) return;
    this.masterLp.disconnect();
    if (target) {
      this.masterLp.connect(target);
      this.connectTaps();
      this.currentRoutingTarget = target;
      return;
    }
    this.currentRoutingTarget = null;
    const auxNow = limitedAuxIfStarted();
    if (auxNow) {
      this.masterLp.connect(auxNow);
      this.connectTaps();
      return;
    }
    void ensureLimitedAux().then((aux) => {
      if (this.currentRoutingTarget !== null || !this.masterLp) return;
      this.masterLp.disconnect();
      this.masterLp.connect(aux);
      this.connectTaps();
    });
  }

  /**
   * Regenerating a convolution impulse swaps the buffer abruptly, so
   * changes are debounced (Room keyframes can move it every frame) and
   * the reverb return is ducked around the swap.
   */
  private scheduleReverbDecay(decaySec: number): void {
    if (Math.abs(decaySec - this.lastReverbDecaySec) < 0.15) return;
    this.pendingReverbDecaySec = decaySec;
    if (this.reverbDecayTimer) clearTimeout(this.reverbDecayTimer);
    this.reverbDecayTimer = setTimeout(() => {
      this.reverbDecayTimer = null;
      void this.applyReverbDecay();
    }, 400);
  }

  private async applyReverbDecay(): Promise<void> {
    const reverb = this.reverb;
    const wet = this.reverbWet;
    const target = this.pendingReverbDecaySec;
    if (!reverb || !wet || !Number.isFinite(target)) return;
    const level = this.lastReverbGain;
    wet.gain.rampTo(0, 0.08);
    await new Promise((r) => setTimeout(r, 90));
    reverb.decay = target;
    await reverb.ready;
    this.lastReverbDecaySec = target;
    wet.gain.rampTo(Number.isFinite(level) ? level : 0, 0.25);
  }

  /** Re-attach analysis taps after `masterLp.disconnect()` drops them. */
  private connectTaps(): void {
    if (!this.masterLp) return;
    if (this.meter) this.masterLp.connect(this.meter);
    if (this.fft) this.masterLp.connect(this.fft);
  }

  /** Output spectrum in dB per FFT bin (bin i = i * sampleRate / size). */
  getSpectrum(): Float32Array | null {
    return this.fft ? this.fft.getValue() : null;
  }

  getSampleRate(): number {
    return Tone.getContext().sampleRate;
  }

  /** Peak level after engine EQ (0..1+). */
  getPeakLevel(): number {
    if (!this.meter) return 0;
    return meterAbs(this.meter.getValue());
  }

  update(hour: number, p: PadParams): void {
    if (
      !this.started ||
      !this.master ||
      !this.chorus ||
      !this.saturation ||
      !this.postSaturationGain ||
      !this.dryGain ||
      !this.reverbPreDelay ||
      !this.reverb ||
      !this.reverbDampingFilter ||
      !this.reverbWet ||
      !this.delay ||
      !this.delayWet ||
      !this.bus
    )
      return;

    const masterTarget = p.enabled
      ? Math.max(0, Math.min(1, finite(p.master, 0)))
      : 0;
    if (
      !this.waveformTransitioning &&
      changed(this.lastMasterTarget, masterTarget, 0.001)
    ) {
      this.master.gain.rampTo(masterTarget, 0.05);
      this.lastMasterTarget = masterTarget;
    }
    applyFilterChain(this.masterHp, this.masterLp, p.filters);

    if (p.waveform !== this.currentWaveform && !this.waveformTransitioning) {
      const nextWaveform = p.waveform;
      this.waveformTransitioning = true;
      this.master.gain.rampTo(0, 0.01);
      setTimeout(() => {
        for (const v of this.voices.values()) {
          for (const o of v.oscs) o.type = nextWaveform;
        }
        this.currentWaveform = nextWaveform;
        this.waveformTransitioning = false;
        this.master?.gain.rampTo(masterTarget, 0.02);
        this.lastMasterTarget = masterTarget;
      }, 12);
    }

    const tNow = Tone.now();

    // The waveshaper curve is fixed at construction. Only smoothly move
    // its wet/output gains; replacing the curve mid-buffer sounds fuzzy.
    const sat = Math.max(0, Math.min(1, finite(p.saturation, 0)));
    if (changed(this.lastSaturation, sat, 0.001)) {
      this.saturation.wet.rampTo(sat * 0.6, 0.12);
      this.postSaturationGain.gain.rampTo(1 / (1 + sat * 0.25), 0.12);
      this.lastSaturation = sat;
    }

    // Glue: threshold drops to -24 dB at full amount; makeup recovers
    // roughly the expected gain reduction so the control isn't a fader.
    const glue = Math.max(0, Math.min(1, finite(p.glue, 0)));
    if (this.glue && this.glueMakeup && changed(this.lastGlue, glue, 0.001)) {
      // Tone's ramps replace a current value of exactly 0 with 1e-7, which
      // is outside the threshold's [-100, 0] range and throws.
      this.glue.threshold.linearRampTo(Math.min(-0.01, -24 * glue), 0.12);
      this.glueMakeup.gain.rampTo(Math.pow(10, (glue * 4) / 20), 0.12);
      this.lastGlue = glue;
    }

    const monoBelowHz = Math.max(20, Math.min(400, finite(p.monoBelowHz, 140)));
    if (this.sideHp && changed(this.lastMonoBelowHz, monoBelowHz, 0.5)) {
      this.sideHp.frequency.rampTo(monoBelowHz, 0.1);
      this.lastMonoBelowHz = monoBelowHz;
    }

    const eq = p.eq;
    if (eq && this.eqLow && this.eqMid && this.eqHigh) {
      const on = eq.enabled;
      const key = `${on}|${eq.lowHz}|${eq.lowDb}|${eq.midHz}|${eq.midDb}|${eq.midQ}|${eq.highHz}|${eq.highDb}`;
      if (key !== this.lastEqKey) {
        this.eqLow.frequency.rampTo(finite(eq.lowHz, 120), 0.08);
        this.eqLow.gain.rampTo(on ? finite(eq.lowDb, 0) : 0, 0.08);
        this.eqMid.frequency.rampTo(finite(eq.midHz, 800), 0.08);
        this.eqMid.Q.rampTo(Math.max(0.2, finite(eq.midQ, 1)), 0.08);
        this.eqMid.gain.rampTo(on ? finite(eq.midDb, 0) : 0, 0.08);
        this.eqHigh.frequency.rampTo(finite(eq.highHz, 8000), 0.08);
        this.eqHigh.gain.rampTo(on ? finite(eq.highDb, 0) : 0, 0.08);
        this.lastEqKey = key;
      }
    }

    // Chorus params.
    const chorusRateHz = Math.max(0.05, finite(p.chorusRateHz, 0.3));
    if (changed(this.lastChorusRateHz, chorusRateHz, 0.001)) {
      this.chorus.frequency.rampTo(chorusRateHz, 0.16);
      this.lastChorusRateHz = chorusRateHz;
    }
    // depth is a plain number field on Tone.Chorus (not a Signal).
    const chorusDepth = Math.max(
      0,
      Math.min(1, finite(p.chorusDepth, 0.4)),
    );
    if (changed(this.lastChorusDepth, chorusDepth, 0.001)) {
      (this.chorus as unknown as { depth: number }).depth = chorusDepth;
      this.chorus.wet.rampTo(Math.min(0.75, chorusDepth), 0.16);
      this.lastChorusDepth = chorusDepth;
    }

    const ambience = normalizedWetMixes(p.reverbMix, p.delayMix);
    if (changed(this.lastDryGain, ambience.dry, 0.001)) {
      this.dryGain.gain.rampTo(ambience.dry, 0.16);
      this.lastDryGain = ambience.dry;
    }
    if (changed(this.lastReverbGain, ambience.reverb, 0.001)) {
      this.reverbWet.gain.rampTo(ambience.reverb, 0.16);
      this.lastReverbGain = ambience.reverb;
    }
    if (changed(this.lastDelayGain, ambience.delay, 0.001)) {
      this.delayWet.gain.rampTo(ambience.delay, 0.16);
      this.lastDelayGain = ambience.delay;
    }
    const reverbRoomSize = Math.max(
      0,
      Math.min(0.99, finite(p.reverbRoomSize, 0.78)),
    );
    if (changed(this.lastReverbRoomSize, reverbRoomSize, 0.001)) {
      this.scheduleReverbDecay(roomSizeToDecaySec(reverbRoomSize));
      this.lastReverbRoomSize = reverbRoomSize;
    }
    const reverbDampingHz = Math.max(
      200,
      Math.min(12000, finite(p.reverbDampingHz, 3500)),
    );
    if (changed(this.lastReverbDampingHz, reverbDampingHz, 5)) {
      this.reverbDampingFilter.frequency.rampTo(reverbDampingHz, 0.2);
      this.lastReverbDampingHz = reverbDampingHz;
    }
    const reverbPreDelaySec = Math.max(
      0,
      Math.min(0.2, finite(p.reverbPreDelaySec, 0.035)),
    );
    if (changed(this.lastReverbPreDelaySec, reverbPreDelaySec, 0.0005)) {
      this.reverbPreDelay.delayTime.rampTo(reverbPreDelaySec, 0.1);
      this.lastReverbPreDelaySec = reverbPreDelaySec;
    }
    const delayTimeSec = Math.max(0.05, Math.min(1.5, delaySeconds(p)));
    if (changed(this.lastDelayTimeSec, delayTimeSec, 0.002)) {
      this.delay.delayTime.rampTo(delayTimeSec, 0.1);
      this.lastDelayTimeSec = delayTimeSec;
    }
    const delayFeedback = Math.max(
      0,
      Math.min(0.75, finite(p.delayFeedback, 0.25)),
    );
    if (changed(this.lastDelayFeedback, delayFeedback, 0.001)) {
      this.delay.feedback.rampTo(delayFeedback, 0.12);
      this.lastDelayFeedback = delayFeedback;
    }

    if (!p.enabled) {
      for (const v of this.voices.values()) this.release(v, p);
      for (const v of this.voices.values()) this.updateVoiceFilter(v, p, tNow);
      this.reapReleasedVoices(tNow);
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
        voice.sub.frequency.rampTo(f * Math.pow(2, voice.lastSubOctave), 0.03);
        voice.osc2.frequency.rampTo(
          f * Math.pow(2, voice.lastOsc2Semitones / 12),
          0.03,
        );
      }
      this.syncSub(voice, p);
      this.syncLayers(voice, p);
      voice.osc2.detune.value = av.detuneCents + voice.humanDetuneCents;
      // Constant detune (unison spread + per-note offset) plus drift LFO.
      for (let i = 0; i < voice.oscs.length; i++) {
        const constant =
          (voice.detuneOffsets[i] ?? 0) + av.detuneCents + voice.humanDetuneCents;
        const mod = driftActive
          ? p.driftDepthCents *
            Math.sin(driftOmega * tNow + (voice.driftPhases[i] ?? 0))
          : 0;
        const target = constant + mod;
        const previous = voice.detuneStates[i] ?? target;
        const smoothed = previous + 0.22 * (target - previous);
        voice.detuneStates[i] = smoothed;
        voice.oscs[i].detune.value = smoothed;
      }
      const gain = av.gain * voice.humanGainMul;
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
    for (const voice of this.voices.values()) {
      this.updateVoiceFilter(voice, p, tNow);
    }
    // Reap voices whose release has completed. `envAt` returns 0 for
    // t >= releaseAt + r; adding a small tail keeps LFO/drift smooth
    // right up to the final sample.
    this.reapReleasedVoices(tNow);
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
    for (const panner of v.panners) {
      panner.disconnect();
      panner.dispose();
    }
    v.panners = [];
    try {
      v.sub.stop();
    } catch {
      /* already stopped */
    }
    v.sub.dispose();
    v.subGain.dispose();
    try {
      v.osc2.stop();
    } catch {
      /* already stopped */
    }
    v.osc2.dispose();
    v.osc2Gain.dispose();
    this.noise?.disconnect(v.noiseFilter);
    v.noiseFilter.dispose();
    v.noiseGain.dispose();
    v.mix.disconnect();
    v.mix.dispose();
    v.filter.disconnect();
    v.filter.dispose();
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
    const slope = p.filterSlope === 12 ? -12 : -24;
    const filter = new Tone.Filter({
      type: "lowpass",
      frequency: Math.max(20, Math.min(20000, finite(p.filterHz, 900))),
      Q: Math.max(0.1, Math.min(20, finite(p.filterQ, 0.7))),
      rolloff: slope,
    });
    const env = new Tone.Gain(0);
    mix.connect(filter);
    filter.connect(env);
    env.connect(this.bus);

    const osc2Semitones = Math.round(
      Math.max(-24, Math.min(24, finite(p.osc2Semitones, 12))),
    );
    const osc2Level = Math.max(0, Math.min(1, finite(p.osc2Level, 0)));
    const osc2 = new Tone.Oscillator({
      type: p.osc2Waveform,
      frequency: freq * Math.pow(2, osc2Semitones / 12),
      phase: Math.random() * 360,
    }).start();
    const osc2Gain = new Tone.Gain(osc2Level);
    osc2.connect(osc2Gain);
    osc2Gain.connect(filter);

    // Noise skips the low-pass so the air stays bright on dark patches.
    const noiseToneHz = Math.max(500, Math.min(14000, finite(p.noiseToneHz, 6000)));
    const noiseLevel = Math.max(0, Math.min(1, finite(p.noiseLevel, 0)));
    const noiseFilter = new Tone.Filter({
      type: "bandpass",
      frequency: noiseToneHz,
      Q: 0.8,
    });
    const noiseGain = new Tone.Gain(noiseLevel * NOISE_GAIN_SCALE);
    this.noise?.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(env);

    const h = Math.max(0, Math.min(1, finite(p.humanize, 0)));
    const bipolar = () => Math.random() * 2 - 1;
    const subOctave = p.subOctave === -2 ? -2 : -1;
    const subLevel = Math.max(0, Math.min(1, finite(p.subLevel, 0)));
    const sub = new Tone.Oscillator({
      type: "sine",
      frequency: freq * Math.pow(2, subOctave),
    }).start();
    const subGain = new Tone.Gain(subLevel);
    sub.connect(subGain);
    subGain.connect(filter);
    const v: PadVoice = {
      note,
      oscs: [],
      panners: [],
      detuneOffsets: [],
      detuneStates: [],
      driftPhases: [],
      mix,
      sub,
      subGain,
      lastSubLevel: subLevel,
      lastSubOctave: subOctave,
      osc2,
      osc2Gain,
      lastOsc2Level: osc2Level,
      lastOsc2Semitones: osc2Semitones,
      lastOsc2Waveform: p.osc2Waveform,
      noiseFilter,
      noiseGain,
      lastNoiseLevel: noiseLevel,
      lastNoiseToneHz: noiseToneHz,
      humanDetuneCents: bipolar() * 8 * h,
      humanCutoffMul: Math.pow(2, bipolar() * 0.35 * h),
      humanGainMul: 1 - Math.random() * 0.25 * h,
      filter,
      lastFilterSlope: slope,
      filterCutoffState: Math.max(
        20,
        Math.min(20000, finite(p.filterHz, 900)),
      ),
      filterLfoPhase: Math.random() * Math.PI * 2,
      lastFilterQ: finite(p.filterQ, 0.7),
      env,
      isOn: false,
      lastGain: 0,
      attackAt: 0,
      releaseAt: null,
      lastUnisonCount: 0,
      lastUnisonSpread: Number.NaN,
      lastStereoWidth: Number.NaN,
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
      const panner = new Tone.Panner(0);
      osc.connect(panner);
      panner.connect(v.mix);
      v.oscs.push(osc);
      v.panners.push(panner);
      v.detuneStates.push(0);
      v.driftPhases.push(Math.random() * Math.PI * 2);
    }
    this.recomputeDetuneOffsets(v, p);
    this.syncStereoPositions(v, p, false);
    v.mix.gain.value = 1 / Math.sqrt(Math.max(1, count));
    v.lastUnisonCount = count;
    v.lastUnisonSpread = Math.max(0, finite(p.unisonDetuneCents, 0));
    v.lastStereoWidth = Math.max(0, Math.min(1, finite(p.stereoWidth, 0.7)));
    // Apply detune constants immediately.
    for (let i = 0; i < v.oscs.length; i++) {
      const detune = v.detuneOffsets[i] ?? 0;
      v.detuneStates[i] = detune;
      v.oscs[i].detune.value = detune;
    }
  }

  private syncUnison(v: PadVoice, p: PadParams): void {
    const target = Math.max(1, Math.min(8, Math.round(p.unisonCount)));
    const spread = Math.max(0, finite(p.unisonDetuneCents, 0));
    const stereoWidth = Math.max(
      0,
      Math.min(1, finite(p.stereoWidth, 0.7)),
    );
    if (
      v.oscs.length === target &&
      v.lastUnisonCount === target &&
      Math.abs(v.lastUnisonSpread - spread) < 0.01 &&
      Math.abs(v.lastStereoWidth - stereoWidth) < 0.001
    ) {
      return;
    }
    if (v.oscs.length === target) {
      this.recomputeDetuneOffsets(v, p);
      this.syncStereoPositions(v, p, true);
      v.mix.gain.rampTo(1 / Math.sqrt(Math.max(1, target)), 0.05);
      v.lastUnisonCount = target;
      v.lastUnisonSpread = spread;
      v.lastStereoWidth = stereoWidth;
      return;
    }
    const freq = Tone.Frequency(v.note).toFrequency();
    while (v.oscs.length < target) {
      const osc = new Tone.Oscillator({
        type: this.currentWaveform,
        frequency: freq,
        phase: Math.random() * 360,
      }).start();
      const panner = new Tone.Panner(0);
      osc.connect(panner);
      panner.connect(v.mix);
      v.oscs.push(osc);
      v.panners.push(panner);
      v.detuneStates.push(0);
      v.driftPhases.push(Math.random() * Math.PI * 2);
    }
    while (v.oscs.length > target) {
      const osc = v.oscs.pop();
      const panner = v.panners.pop();
      osc?.disconnect();
      osc?.stop();
      osc?.dispose();
      panner?.disconnect();
      panner?.dispose();
      v.detuneStates.pop();
      v.driftPhases.pop();
    }
    this.recomputeDetuneOffsets(v, p);
    this.syncStereoPositions(v, p, true);
    // Equal-power-ish compensation so more unison doesn't blow up level.
    v.mix.gain.rampTo(1 / Math.sqrt(target), 0.05);
    v.lastUnisonCount = target;
    v.lastUnisonSpread = spread;
    v.lastStereoWidth = stereoWidth;
  }

  private syncSub(v: PadVoice, p: PadParams): void {
    const level = Math.max(0, Math.min(1, finite(p.subLevel, 0)));
    if (changed(v.lastSubLevel, level, 0.001)) {
      v.subGain.gain.rampTo(level, 0.05);
      v.lastSubLevel = level;
    }
    const octave = p.subOctave === -2 ? -2 : -1;
    if (octave !== v.lastSubOctave) {
      const f = Tone.Frequency(v.note).toFrequency();
      v.sub.frequency.rampTo(f * Math.pow(2, octave), 0.03);
      v.lastSubOctave = octave;
    }
  }

  private syncLayers(v: PadVoice, p: PadParams): void {
    const osc2Level = Math.max(0, Math.min(1, finite(p.osc2Level, 0)));
    if (changed(v.lastOsc2Level, osc2Level, 0.001)) {
      v.osc2Gain.gain.rampTo(osc2Level, 0.05);
      v.lastOsc2Level = osc2Level;
    }
    const semis = Math.round(Math.max(-24, Math.min(24, finite(p.osc2Semitones, 12))));
    if (semis !== v.lastOsc2Semitones) {
      const f = Tone.Frequency(v.note).toFrequency();
      v.osc2.frequency.rampTo(f * Math.pow(2, semis / 12), 0.03);
      v.lastOsc2Semitones = semis;
    }
    if (p.osc2Waveform !== v.lastOsc2Waveform) {
      v.osc2.type = p.osc2Waveform;
      v.lastOsc2Waveform = p.osc2Waveform;
    }
    const noiseLevel = Math.max(0, Math.min(1, finite(p.noiseLevel, 0)));
    if (changed(v.lastNoiseLevel, noiseLevel, 0.001)) {
      v.noiseGain.gain.rampTo(noiseLevel * NOISE_GAIN_SCALE, 0.05);
      v.lastNoiseLevel = noiseLevel;
    }
    const tone = Math.max(500, Math.min(14000, finite(p.noiseToneHz, 6000)));
    if (changed(v.lastNoiseToneHz, tone, 5)) {
      v.noiseFilter.frequency.rampTo(tone, 0.08);
      v.lastNoiseToneHz = tone;
    }
    const slope = p.filterSlope === 12 ? -12 : -24;
    if (slope !== v.lastFilterSlope) {
      v.filter.rolloff = slope;
      v.lastFilterSlope = slope;
    }
  }

  private recomputeDetuneOffsets(v: PadVoice, p: PadParams): void {
    const n = v.oscs.length;
    const spread = Math.max(0, p.unisonDetuneCents);
    const offsets: number[] = [];
    for (let i = 0; i < n; i++) {
      const pos = unisonPosition(i, n);
      offsets.push(pos * spread);
      // Inner voices carry the pitch centre; outer ones add shimmer.
      v.oscs[i].volume.value = Math.abs(pos) < 0.3 ? 0 : -2;
    }
    v.detuneOffsets = offsets;
  }

  private syncStereoPositions(
    v: PadVoice,
    p: PadParams,
    ramp: boolean,
  ): void {
    const width = Math.max(0, Math.min(1, finite(p.stereoWidth, 0.7)));
    const count = v.panners.length;
    for (let i = 0; i < count; i++) {
      const position = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
      const pan = position * width;
      if (ramp) v.panners[i].pan.rampTo(pan, 0.08);
      else v.panners[i].pan.value = pan;
    }
  }

  private updateVoiceFilter(v: PadVoice, p: PadParams, now: number): void {
    const envelope = this.envAt(v, now);
    const envOctaves =
      (Math.max(0, finite(p.filterEnvAmount, 0)) / 1200) * envelope;
    const keyTrack = Math.max(0, Math.min(1, finite(p.filterKeyTrack, 0)));
    const noteRatio = Tone.Frequency(v.note).toFrequency() / KEY_TRACK_REF_HZ;
    const keyMul = keyTrack > 0 ? Math.pow(noteRatio, keyTrack) : 1;
    const baseCutoff = Math.max(
      20,
      Math.min(
        20000,
        finite(p.filterHz, 900) *
          Math.pow(2, envOctaves) *
          keyMul *
          v.humanCutoffMul,
      ),
    );
    const depth = Math.max(0, Math.min(1, finite(p.filterLfoDepth, 0)));
    const rate = Math.max(0, finite(p.filterLfoRateHz, 0));
    let cutoff = baseCutoff;
    if (depth > 0 && rate > 0) {
      const lfo =
        0.5 +
        0.5 * Math.sin(2 * Math.PI * rate * now + v.filterLfoPhase);
      cutoff = baseCutoff * Math.pow(2, -depth * lfo);
    }
    v.filterCutoffState += 0.25 * (cutoff - v.filterCutoffState);
    v.filter.frequency.value = Math.max(
      20,
      Math.min(20000, v.filterCutoffState),
    );
    const q = Math.max(0.1, Math.min(20, finite(p.filterQ, 0.7)));
    if (Math.abs(q - v.lastFilterQ) > 0.001) {
      v.filter.Q.rampTo(q, 0.08);
      v.lastFilterQ = q;
    }
  }

  private reapReleasedVoices(now: number): void {
    for (const [id, voice] of this.voices) {
      if (
        voice.releaseAt !== null &&
        now > voice.releaseAt + voice.adsr.r * ENV_RELEASE_TAIL + 0.1
      ) {
        this.disposeVoice(voice);
        this.voices.delete(id);
      }
    }
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
    g.setTargetAtTime(s * gain, now + a, d / ENV_TAU_DIV);
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
    g.setTargetAtTime(0, now, r / ENV_RELEASE_TAU_DIV);
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
      if (rt >= r * ENV_RELEASE_TAIL) return 0;
      // Level at release start: sample the pre-release shape.
      const preRel = this.holdEnv(v.releaseAt - v.attackAt, a, d, s);
      return preRel * Math.exp(-rt / (r / ENV_RELEASE_TAU_DIV));
    }
    return this.holdEnv(t - v.attackAt, a, d, s);
  }

  private holdEnv(dt: number, a: number, d: number, s: number): number {
    if (dt <= 0) return 0;
    if (dt < a) return dt / a;
    return s + (1 - s) * Math.exp(-(dt - a) / (d / ENV_TAU_DIV));
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

  /** Brightest currently-rendered per-note filter cutoff for the UI plot. */
  getBrightestFilterCutoff(fallback: number): number {
    let brightest = 0;
    for (const voice of this.voices.values()) {
      if (voice.filterCutoffState > brightest) {
        brightest = voice.filterCutoffState;
      }
    }
    return brightest > 0 ? brightest : fallback;
  }
}

let singleton: PadEngine | null = null;
export function getPadEngine(): PadEngine {
  if (!singleton) singleton = new PadEngine();
  return singleton;
}
