import * as Tone from "tone";
import type { BreathParams, LightningSample } from "../state";
import { getSampleBlob } from "../samples/sampleStorage";
import { ensureLimitedAux } from "./MasterFxBus";

const MAX_EXHALE_VOICES = 8;

/**
 * One-shot exhale audio: plays `breath.exhaleSample` with random
 * PitchShift (±exhalePitchJitterCents), matching lightning bolt/strike
 * pitch treatment.
 */
export class BreathExhaleAudioEngine {
  private started = false;
  private startPromise: Promise<void> | null = null;
  private out: Tone.Gain | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private pendingLoads = new Map<string, Promise<AudioBuffer | null>>();
  private voices: Array<{
    source: Tone.ToneBufferSource;
    pitchShift: Tone.PitchShift | null;
    gain: Tone.Gain;
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
    const aux = await ensureLimitedAux();
    this.out.connect(aux);
    this.started = true;
  }

  isStarted(): boolean {
    return this.started;
  }

  update(): void {
    if (this.started) this.reap();
  }

  preload(p: BreathParams): void {
    if (p.exhaleSample) void this.ensureBuffer(p.exhaleSample.id);
  }

  /**
   * Fire once per breath-out (wave spawn). No-op when disabled or no sample.
   */
  triggerExhale(p: BreathParams): void {
    if (!this.started || !this.out) return;
    if (!p.enabled) return;
    const sample = p.exhaleSample;
    if (!sample) return;
    this.playOneShot(sample, p.exhaleGain, p.exhalePitchJitterCents);
  }

  private playOneShot(
    sample: LightningSample,
    gain: number,
    pitchJitterCents: number,
  ): void {
    if (!this.out) return;
    const buf = this.buffers.get(sample.id);
    if (!buf) {
      void this.ensureBuffer(sample.id);
      return;
    }
    const jitter = Math.max(
      0,
      Number.isFinite(pitchJitterCents) ? pitchJitterCents : 0,
    );
    const cents = jitter > 0 ? (Math.random() * 2 - 1) * jitter : 0;
    const semitones = cents / 100;
    const gainLin = Math.min(
      2,
      Math.max(0, Number.isFinite(gain) ? gain : 0),
    );
    if (gainLin <= 0) return;

    const source = new Tone.ToneBufferSource({
      url: buf,
      playbackRate: 1,
      fadeIn: 0.008,
      fadeOut: 0.025,
    });
    const gainNode = new Tone.Gain(0);
    let pitchShift: Tone.PitchShift | null = null;
    if (Math.abs(semitones) >= 0.01) {
      pitchShift = new Tone.PitchShift({
        pitch: semitones,
        windowSize: 0.1,
        feedback: 0,
      });
      source.connect(pitchShift);
      pitchShift.connect(gainNode);
    } else {
      source.connect(gainNode);
    }
    gainNode.connect(this.out);
    const now = Tone.now();
    try {
      source.start(now + 0.003);
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(gainLin, now + 0.011);
    } catch (err) {
      console.warn("[breath-exhale] start failed", err);
      source.dispose();
      pitchShift?.dispose();
      gainNode.dispose();
      return;
    }
    const dur = buf.duration + (pitchShift ? 0.2 : 0.05);
    if (this.voices.length >= MAX_EXHALE_VOICES) {
      const oldest = this.voices[this.voices.length - MAX_EXHALE_VOICES];
      if (oldest) {
        const fadeNow = Tone.now();
        try {
          oldest.gain.gain.cancelScheduledValues(fadeNow);
          oldest.gain.gain.setValueAtTime(oldest.gain.gain.value, fadeNow);
          oldest.gain.gain.linearRampToValueAtTime(0, fadeNow + 0.02);
          oldest.source.stop(fadeNow + 0.025);
        } catch {
          /* already stopped */
        }
        oldest.endsAt = Math.min(oldest.endsAt, fadeNow + 0.03);
      }
    }
    this.voices.push({
      source,
      pitchShift,
      gain: gainNode,
      endsAt: now + dur,
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
        return false;
      }
      return true;
    });
  }

  private async ensureBuffer(id: string): Promise<AudioBuffer | null> {
    if (this.buffers.has(id)) return this.buffers.get(id) ?? null;
    const pending = this.pendingLoads.get(id);
    if (pending) return pending;
    const load = (async () => {
      try {
        const blob = await getSampleBlob(id);
        if (!blob) return null;
        const arr = await blob.arrayBuffer();
        const ctx = Tone.getContext().rawContext as unknown as AudioContext;
        const buf = await ctx.decodeAudioData(arr.slice(0));
        this.buffers.set(id, buf);
        return buf;
      } catch (err) {
        console.warn("[breath-exhale] buffer load failed", id, err);
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
}

let singleton: BreathExhaleAudioEngine | null = null;
export function getBreathExhaleAudioEngine(): BreathExhaleAudioEngine {
  if (!singleton) singleton = new BreathExhaleAudioEngine();
  return singleton;
}
