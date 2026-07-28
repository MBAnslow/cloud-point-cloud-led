import * as Tone from "tone";
import type { LightningParams, LightningSample } from "../state";
import { getSampleBlob } from "../samples/sampleStorage";
import { pickBoltSample } from "./boltSampleMatch";
import { ensureLimitedAux } from "./MasterFxBus";

/**
 * Audio engine for the lightning system.
 *
 * - A single Tone.Player owns the background ambience and loops for as
 *   long as `enabled && withinActiveWindow`.
 * - Cloud-flash bolts pick from the tagged `boltSamples` library.
 * - Ground strikes play the single `strikeSample` (if set).
 * - Sprite flashes play the single `spriteSample` (if set).
 * - Each one-shot gets a random Tone.PitchShift in ±boltPitchJitterCents.
 *
 * Buffers are lazily loaded from the shared IndexedDB blob store
 * (same one used by the Samples panel). Missing buffers are silently
 * skipped rather than crashing playback.
 */
export class LightningAudioEngine {
  private started = false;
  private out: Tone.Gain | null = null;
  private bg: Tone.Player | null = null;
  private bgPanner: Tone.Panner | null = null;
  private bgSampleId: string | null = null;
  private bgWasEnabled = false;
  private boltBuffers = new Map<string, AudioBuffer>();
  private pendingLoads = new Set<string>();
  private voices: Array<{
    source: Tone.ToneBufferSource;
    pitchShift: Tone.PitchShift | null;
    gain: Tone.Gain;
    panner: Tone.Panner;
    endsAt: number;
  }> = [];

  async start(): Promise<void> {
    if (this.started) return;
    await Tone.start();
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
    const bgWanted = p.enabled && active && !!p.backgroundSample;
    void this.syncBackground(
      p.backgroundSample,
      bgWanted,
      p.backgroundGain,
      p.pan ?? 0,
    );
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
    if (!p.enabled) return;
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
    if (!p.enabled) return;
    const sample = p.strikeSample;
    if (!sample) return;
    this.playOneShot(p, sample, strikeIntensity, boltGain, pan);
  }

  /**
   * Trigger the storm-sprite appear one-shot (`spriteSample`).
   * No-op when no sprite sound is uploaded.
   */
  triggerSprite(
    p: LightningParams,
    intensity = 1,
    gain = p.spriteGain,
    pan = p.pan ?? 0,
  ): void {
    if (!this.started || !this.out) return;
    if (!p.enabled) return;
    const sample = p.spriteSample;
    if (!sample) return;
    this.playOneShot(p, sample, intensity, gain, pan);
  }

  /** Preload all referenced buffers so first triggers aren't skipped. */
  preload(p: LightningParams): void {
    for (const s of p.boltSamples) void this.ensureBoltBuffer(s.id);
    if (p.strikeSample) void this.ensureBoltBuffer(p.strikeSample.id);
    if (p.spriteSample) void this.ensureBoltBuffer(p.spriteSample.id);
    if (p.backgroundSample) void this.ensureBoltBuffer(p.backgroundSample.id);
  }

  private playOneShot(
    p: LightningParams,
    sample: LightningSample,
    strikeIntensity: number,
    boltGain: number,
    pan: number,
  ): void {
    if (!this.out) return;
    const buf = this.boltBuffers.get(sample.id);
    if (!buf) {
      void this.ensureBoltBuffer(sample.id);
      return;
    }
    // Random pitch in ±boltPitchJitterCents. Use PitchShift (semitones)
    // rather than playbackRate so thunder keeps its length — rate-only
    // jitter is easy to miss on broadband rumble (strike sound).
    const jitter = Math.max(0, Number(p.boltPitchJitterCents) || 0);
    const cents = jitter > 0 ? (Math.random() * 2 - 1) * jitter : 0;
    const semitones = cents / 100;
    const gainLin = Math.max(
      0.0001,
      Math.max(0, boltGain) * Math.max(0, strikeIntensity),
    );
    const panVal = Math.max(-1, Math.min(1, pan));

    const source = new Tone.ToneBufferSource({
      url: buf,
      playbackRate: 1,
    });
    const gain = new Tone.Gain(gainLin);
    const panner = new Tone.Panner(panVal);
    let pitchShift: Tone.PitchShift | null = null;
    if (Math.abs(semitones) >= 0.01) {
      pitchShift = new Tone.PitchShift({
        pitch: semitones,
        windowSize: 0.1,
        feedback: 0,
      });
      source.connect(pitchShift);
      pitchShift.connect(gain);
    } else {
      source.connect(gain);
    }
    gain.connect(panner);
    panner.connect(this.out);
    try {
      source.start();
    } catch (err) {
      console.warn("[lightning] one-shot start failed", err);
      source.dispose();
      pitchShift?.dispose();
      gain.dispose();
      panner.dispose();
      return;
    }
    // PitchShift adds a short delay line; keep the voice alive a bit longer.
    const dur = buf.duration + (pitchShift ? 0.2 : 0.05);
    this.voices.push({
      source,
      pitchShift,
      gain,
      panner,
      endsAt: Tone.now() + dur,
    });
    this.reap();
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
        return false;
      }
      return true;
    });
  }

  private async syncBackground(
    sample: LightningSample | null,
    wanted: boolean,
    gain: number,
    pan: number,
  ): Promise<void> {
    if (!this.out) return;
    const panVal = Math.max(-1, Math.min(1, pan));
    const wantedId = wanted && sample ? sample.id : null;
    // Rewire if the desired sample changed.
    if (wantedId !== this.bgSampleId) {
      if (this.bg) {
        try {
          this.bg.stop();
        } catch {
          /* ignore */
        }
        this.bg.dispose();
        this.bg = null;
      }
      if (this.bgPanner) {
        this.bgPanner.dispose();
        this.bgPanner = null;
      }
      this.bgSampleId = wantedId;
      this.bgWasEnabled = false;
      if (wantedId && sample) {
        try {
          const buf = await this.ensureBoltBuffer(sample.id);
          if (!buf || this.bgSampleId !== sample.id) return;
          const player = new Tone.Player();
          const panner = new Tone.Panner(panVal);
          (player as unknown as { buffer: Tone.ToneAudioBuffer }).buffer =
            new Tone.ToneAudioBuffer(buf);
          player.loop = true;
          player.volume.value = Tone.gainToDb(Math.max(0.0001, gain));
          player.connect(panner);
          panner.connect(this.out);
          this.bg = player;
          this.bgPanner = panner;
        } catch (err) {
          console.warn("[lightning] background load failed", err);
        }
      }
    }
    // Update volume + pan + play/stop.
    if (this.bg) {
      this.bg.volume.rampTo(Tone.gainToDb(Math.max(0.0001, gain)), 0.1);
      if (this.bgPanner) this.bgPanner.pan.rampTo(panVal, 0.1);
      if (wanted && !this.bgWasEnabled) {
        try {
          this.bg.start();
          this.bgWasEnabled = true;
        } catch (err) {
          console.warn("[lightning] background start failed", err);
        }
      } else if (!wanted && this.bgWasEnabled) {
        try {
          this.bg.stop();
        } catch {
          /* ignore */
        }
        this.bgWasEnabled = false;
      }
    }
  }

  private async ensureBoltBuffer(id: string): Promise<AudioBuffer | null> {
    if (this.boltBuffers.has(id)) return this.boltBuffers.get(id) ?? null;
    if (this.pendingLoads.has(id)) return null;
    this.pendingLoads.add(id);
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
    } finally {
      this.pendingLoads.delete(id);
    }
  }
}

let singleton: LightningAudioEngine | null = null;
export function getLightningAudioEngine(): LightningAudioEngine {
  if (!singleton) singleton = new LightningAudioEngine();
  return singleton;
}
