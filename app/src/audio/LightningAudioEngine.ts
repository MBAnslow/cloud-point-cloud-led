import * as Tone from "tone";
import type { LightningParams, LightningSample } from "../state";
import { getSampleBlob } from "../samples/sampleStorage";
import { pickBoltSample } from "./boltSampleMatch";
import { ensureLimitedAux } from "./MasterFxBus";
import { meterAbs } from "./meterAbs";

const MAX_ONE_SHOT_VOICES = 24;

/**
 * Audio engine for the lightning system.
 *
 * - A single Tone.Player owns the background ambience and loops for as
 *   long as `enabled && withinActiveWindow`.
 * - Cloud-flash bolts pick from the tagged `boltSamples` library.
 * - Ground strikes play the single `strikeSample` (if set).
 * - Sprite flashes randomly choose from `spriteAudioSamples`.
 * - Each one-shot gets a random Tone.PitchShift in ±boltPitchJitterCents.
 *
 * Buffers are lazily loaded from the shared IndexedDB blob store
 * (same one used by the Samples panel). Missing buffers are silently
 * skipped rather than crashing playback.
 */
export class LightningAudioEngine {
  private started = false;
  private startPromise: Promise<void> | null = null;
  private out: Tone.Gain | null = null;
  private bg: Tone.Player | null = null;
  private bgGain: Tone.Gain | null = null;
  private bgPanner: Tone.Panner | null = null;
  private bgSampleId: string | null = null;
  private desiredBgSampleId: string | null = null;
  private bgGeneration = 0;
  private boltBuffers = new Map<string, AudioBuffer>();
  private pendingLoads = new Map<string, Promise<AudioBuffer | null>>();
  private spriteVoices = new Map<
    number,
    {
      gain: Tone.Gain;
      baseGain: number;
      meter: Tone.Meter;
      audioEndsAt: number;
    }
  >();
  private voices: Array<{
    source: Tone.ToneBufferSource;
    pitchShift: Tone.PitchShift | null;
    gain: Tone.Gain;
    panner: Tone.Panner;
    meter: Tone.Meter;
    endsAt: number;
  }> = [];

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
    this.out = new Tone.Gain(1);
    // Route through the shared brickwall so strikes can't slam the DAC.
    const aux = await ensureLimitedAux();
    this.out.connect(aux);
    this.started = true;
  }

  isStarted(): boolean {
    return this.started;
  }

  /**
   * Update background loop + volumes/pan to match current params. Called
   * every frame from `LightningAudioRuntime`.
   */
  update(p: LightningParams, active: boolean): void {
    if (!this.started || !this.out) return;
    this.reap();
    const bgWanted = p.enabled && active && !!p.backgroundSample;
    void this.syncBackground(
      p.backgroundSample,
      bgWanted,
      p.backgroundGain,
      p.pan ?? 0,
    ).catch((err) => console.warn("[lightning] background sync failed", err));
  }

  /**
   * Trigger a cloud-flash bolt sound. Chooses a sample matching flash
   * intensity + length tags when possible, then applies pitch jitter.
   * `strikeIntensity` scales the base `boltGain`.
   */
  triggerBolt(
    p: LightningParams,
    strikeIntensity: number,
    boltGain = p.boltGain,
    pan = p.pan ?? 0,
    match?: { intensity01: number; durationMs: number },
  ): void {
    if (!this.started || !this.out) return;
    if (p.boltSamples.length === 0) return;
    const sample =
      pickBoltSample(
        p.boltSamples,
        match?.intensity01 ?? 0.5,
        match?.durationMs ?? 600,
      ) ?? p.boltSamples[0];
    if (!sample) return;
    this.playOneShot(p, sample, strikeIntensity, boltGain, pan);
  }

  /**
   * Trigger the dedicated ground-strike one-shot (`strikeSample`).
   * No-op when no strike sample is uploaded.
   */
  triggerStrike(
    p: LightningParams,
    strikeIntensity: number,
    boltGain = p.boltGain,
    pan = p.pan ?? 0,
  ): void {
    if (!this.started || !this.out) return;
    const sample = p.strikeSample;
    if (!sample) return;
    this.playOneShot(p, sample, strikeIntensity, boltGain, pan);
  }

  /**
   * Trigger a random storm-sprite one-shot.
   */
  triggerSprite(
    p: LightningParams,
    intensity = 1,
    gain = p.spriteAudioGain,
    pan = p.pan ?? 0,
    eventId?: number,
  ): void {
    if (!this.started || !this.out) return;
    const library = p.spriteAudioSamples ?? [];
    if (library.length === 0) return;
    const ready = library.filter((sample) =>
      this.boltBuffers.has(sample.id),
    );
    if (ready.length === 0) {
      for (const sample of library) void this.ensureBoltBuffer(sample.id);
      return;
    }
    const sample = ready[Math.floor(Math.random() * ready.length)]!;
    const voice = this.playOneShot(p, sample, intensity, gain, pan);
    if (voice && eventId !== undefined) {
      this.spriteVoices.set(eventId, voice);
    }
  }

  /** Apply the shared visual strobe envelope to an active sprite voice. */
  setSpriteEnvelope(eventId: number, envelope: number): void {
    const voice = this.spriteVoices.get(eventId);
    if (!voice) return;
    const safeEnvelope = Number.isFinite(envelope) ? envelope : 0;
    const target =
      voice.baseGain * Math.max(0, Math.min(1, safeEnvelope));
    voice.gain.gain.rampTo(target, 0.008);
  }

  /**
   * Source-waveform loudness for visual modulation. The meter is connected
   * before the user volume gain, so Sprite volume cannot alter brightness.
   */
  getSpriteDynamics(eventId: number): number {
    const voice = this.spriteVoices.get(eventId);
    if (!voice) return 0;
    const raw = meterAbs(voice.meter.getValue());
    if (!Number.isFinite(raw)) return 0;
    // Ignore tiny decoder/meter tail impulses, then taper the final 50 ms so
    // an end-of-buffer discontinuity cannot become a full visual flash.
    if (raw <= 0.002) return 0;
    const tail = Math.max(
      0,
      Math.min(1, (voice.audioEndsAt - Tone.now()) / 0.05),
    );
    const level = (Math.sqrt(raw) - Math.sqrt(0.002)) * 2.7;
    return Math.max(0, Math.min(1, level)) * tail;
  }

  /** Preload all referenced buffers so first triggers aren't skipped. */
  preload(p: LightningParams): void {
    for (const s of p.boltSamples) void this.ensureBoltBuffer(s.id);
    if (p.strikeSample) void this.ensureBoltBuffer(p.strikeSample.id);
    for (const sample of p.spriteAudioSamples ?? []) {
      void this.ensureBoltBuffer(sample.id);
    }
    if (p.backgroundSample) void this.ensureBoltBuffer(p.backgroundSample.id);
  }

  private playOneShot(
    p: LightningParams,
    sample: LightningSample,
    strikeIntensity: number,
    boltGain: number,
    pan: number,
  ): {
    gain: Tone.Gain;
    baseGain: number;
    meter: Tone.Meter;
    audioEndsAt: number;
  } | null {
    if (!this.out) return null;
    const buf = this.boltBuffers.get(sample.id);
    if (!buf) {
      void this.ensureBoltBuffer(sample.id);
      return null;
    }
    // Random pitch in ±boltPitchJitterCents. Use PitchShift (semitones)
    // rather than playbackRate so thunder keeps its length — rate-only
    // jitter is easy to miss on broadband rumble (strike sound).
    const jitter = Math.max(
      0,
      Number.isFinite(p.boltPitchJitterCents)
        ? p.boltPitchJitterCents
        : 0,
    );
    const cents = jitter > 0 ? (Math.random() * 2 - 1) * jitter : 0;
    const semitones = cents / 100;
    const safeGain = Number.isFinite(boltGain) ? boltGain : 0;
    const safeIntensity = Number.isFinite(strikeIntensity)
      ? strikeIntensity
      : 0;
    const gainLin = Math.min(
      2,
      Math.max(0, safeGain) * Math.max(0, safeIntensity),
    );
    if (gainLin <= 0) return null;
    const panVal = Math.max(
      -1,
      Math.min(1, Number.isFinite(pan) ? pan : 0),
    );

    const source = new Tone.ToneBufferSource({
      url: buf,
      playbackRate: 1,
      fadeIn: 0.008,
      fadeOut: 0.025,
    });
    const gain = new Tone.Gain(0);
    const panner = new Tone.Panner(panVal);
    const meter = new Tone.Meter({ normalRange: true, smoothing: 0.8 });
    let pitchShift: Tone.PitchShift | null = null;
    if (Math.abs(semitones) >= 0.01) {
      pitchShift = new Tone.PitchShift({
        pitch: semitones,
        windowSize: 0.1,
        feedback: 0,
      });
      source.connect(pitchShift);
      pitchShift.connect(gain);
      pitchShift.connect(meter);
    } else {
      source.connect(gain);
      source.connect(meter);
    }
    gain.connect(panner);
    panner.connect(this.out);
    const now = Tone.now();
    try {
      source.start(now + 0.003);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(gainLin, now + 0.011);
    } catch (err) {
      console.warn("[lightning] one-shot start failed", err);
      source.dispose();
      pitchShift?.dispose();
      gain.dispose();
      panner.dispose();
      meter.dispose();
      return null;
    }
    // PitchShift adds a short delay line; keep the voice alive a bit longer.
    const dur = buf.duration + (pitchShift ? 0.2 : 0.05);
    if (this.voices.length >= MAX_ONE_SHOT_VOICES) {
      this.fadeOutVoice(
        this.voices[this.voices.length - MAX_ONE_SHOT_VOICES],
      );
    }
    this.voices.push({
      source,
      pitchShift,
      gain,
      panner,
      meter,
      endsAt: now + dur,
    });
    this.reap();
    return {
      gain,
      baseGain: gainLin,
      meter,
      audioEndsAt: now + buf.duration,
    };
  }

  private reap(): void {
    const now = Tone.now();
    this.voices = this.voices.filter((v) => {
      if (v.endsAt <= now) {
        try {
          v.source.stop();
        } catch {
          /* ignore */
        }
        v.source.dispose();
        v.pitchShift?.dispose();
        v.gain.dispose();
        v.panner.dispose();
        v.meter.dispose();
        for (const [id, spriteVoice] of this.spriteVoices) {
          if (spriteVoice.gain === v.gain) this.spriteVoices.delete(id);
        }
        return false;
      }
      return true;
    });
  }

  private fadeOutVoice(
    voice:
      | {
          source: Tone.ToneBufferSource;
          gain: Tone.Gain;
          endsAt: number;
        }
      | undefined,
  ): void {
    if (!voice) return;
    const now = Tone.now();
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      voice.gain.gain.linearRampToValueAtTime(0, now + 0.02);
      voice.source.stop(now + 0.025);
    } catch {
      /* already stopped */
    }
    voice.endsAt = Math.min(voice.endsAt, now + 0.03);
  }

  private async syncBackground(
    sample: LightningSample | null,
    wanted: boolean,
    gain: number,
    pan: number,
  ): Promise<void> {
    if (!this.out) return;
    const panVal = Math.max(
      -1,
      Math.min(1, Number.isFinite(pan) ? pan : 0),
    );
    const gainVal = Math.max(
      0,
      Math.min(2, Number.isFinite(gain) ? gain : 0),
    );
    const wantedId = wanted && sample ? sample.id : null;
    if (wantedId !== this.desiredBgSampleId) {
      this.desiredBgSampleId = wantedId;
      this.bgGeneration += 1;
      if (!wantedId) {
        const old = this.takeBackground();
        if (old) this.fadeDisposeBackground(old);
        return;
      }
    }
    if (!wantedId || !sample) return;

    if (this.bgSampleId === wantedId && this.bg && this.bgGain) {
      this.bgGain.gain.rampTo(gainVal, 0.1);
      this.bgPanner?.pan.rampTo(panVal, 0.1);
      return;
    }

    const generation = this.bgGeneration;
    const buf = await this.ensureBoltBuffer(wantedId);
    if (
      !buf ||
      generation !== this.bgGeneration ||
      this.desiredBgSampleId !== wantedId ||
      !this.out
    ) {
      return;
    }
    // Another waiter for the same in-flight decode may have won the race.
    if (this.bgSampleId === wantedId && this.bg && this.bgGain) return;

    const player = new Tone.Player({
      url: new Tone.ToneAudioBuffer(buf),
      loop: true,
      fadeIn: 0.01,
      fadeOut: 0.03,
    });
    const gainNode = new Tone.Gain(0);
    const panner = new Tone.Panner(panVal);
    player.connect(gainNode);
    gainNode.connect(panner);
    panner.connect(this.out);
    try {
      player.start();
    } catch (err) {
      player.dispose();
      gainNode.dispose();
      panner.dispose();
      console.warn("[lightning] background start failed", err);
      return;
    }
    const old = this.takeBackground();
    this.bg = player;
    this.bgGain = gainNode;
    this.bgPanner = panner;
    this.bgSampleId = wantedId;
    gainNode.gain.rampTo(gainVal, 0.15);
    if (old) this.fadeDisposeBackground(old);
  }

  private async ensureBoltBuffer(id: string): Promise<AudioBuffer | null> {
    if (this.boltBuffers.has(id)) return this.boltBuffers.get(id) ?? null;
    const pending = this.pendingLoads.get(id);
    if (pending) return pending;
    const load = (async () => {
      try {
        const blob = await getSampleBlob(id);
        if (!blob) return null;
        const arr = await blob.arrayBuffer();
        const ctx = Tone.getContext().rawContext as unknown as AudioContext;
        const buf = await ctx.decodeAudioData(arr.slice(0));
        this.boltBuffers.set(id, buf);
        return buf;
      } catch (err) {
        console.warn("[lightning] buffer load failed", id, err);
        return null;
      }
    })();
    this.pendingLoads.set(id, load);
    try {
      return await load;
    } finally {
      if (this.pendingLoads.get(id) === load) this.pendingLoads.delete(id);
    }
  }

  private takeBackground(): {
    player: Tone.Player;
    gain: Tone.Gain;
    panner: Tone.Panner;
  } | null {
    if (!this.bg || !this.bgGain || !this.bgPanner) return null;
    const value = {
      player: this.bg,
      gain: this.bgGain,
      panner: this.bgPanner,
    };
    this.bg = null;
    this.bgGain = null;
    this.bgPanner = null;
    this.bgSampleId = null;
    return value;
  }

  private fadeDisposeBackground(nodes: {
    player: Tone.Player;
    gain: Tone.Gain;
    panner: Tone.Panner;
  }): void {
    const now = Tone.now();
    try {
      nodes.gain.gain.cancelScheduledValues(now);
      nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, now);
      nodes.gain.gain.linearRampToValueAtTime(0, now + 0.15);
      nodes.player.stop(now + 0.16);
    } catch {
      /* already stopped */
    }
    setTimeout(() => {
      nodes.player.dispose();
      nodes.gain.dispose();
      nodes.panner.dispose();
    }, 220);
  }
}

let singleton: LightningAudioEngine | null = null;
export function getLightningAudioEngine(): LightningAudioEngine {
  if (!singleton) singleton = new LightningAudioEngine();
  return singleton;
}
