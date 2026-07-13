import * as Tone from "tone";
import type { LightningParams, LightningSample } from "../state";
import { getSampleBlob } from "../samples/sampleStorage";

/**
 * Audio engine for the lightning system.
 *
 * - A single Tone.Player owns the background ambience and loops for as
 *   long as `enabled && withinActiveWindow`.
 * - Bolt sounds are triggered on demand from a small pool of
 *   Tone.Player voices (one per fired strike, reaped when the buffer
 *   is done playing). Each trigger picks a random uploaded bolt buffer
 *   and applies ±jitter cents to the playback rate for variety.
 *
 * Buffers are lazily loaded from the shared IndexedDB blob store
 * (same one used by the Samples panel). Missing buffers are silently
 * skipped rather than crashing playback.
 */
export class LightningAudioEngine {
  private started = false;
  private out: Tone.Gain | null = null;
  private bg: Tone.Player | null = null;
  private bgSampleId: string | null = null;
  private bgWasEnabled = false;
  private boltBuffers = new Map<string, AudioBuffer>();
  private pendingLoads = new Set<string>();
  private voices: Array<{ player: Tone.Player; endsAt: number }> = [];

  async start(): Promise<void> {
    if (this.started) return;
    await Tone.start();
    this.out = new Tone.Gain(1).toDestination();
    this.started = true;
  }

  isStarted(): boolean {
    return this.started;
  }

  /**
   * Update background loop + volumes to match current params. Called
   * every frame from `LightningAudioRuntime`.
   */
  update(p: LightningParams, active: boolean): void {
    if (!this.started || !this.out) return;
    const bgWanted = p.enabled && active && !!p.backgroundSample;
    void this.syncBackground(p.backgroundSample, bgWanted, p.backgroundGain);
  }

  /**
   * Trigger a bolt sound. Called once per newly-spawned strike from
   * the runtime. Chooses a random sample and applies pitch jitter.
   */
  triggerBolt(p: LightningParams): void {
    if (!this.started || !this.out) return;
    if (!p.enabled) return;
    if (p.boltSamples.length === 0) return;
    const sample =
      p.boltSamples[Math.floor(Math.random() * p.boltSamples.length)];
    if (!sample) return;
    const buf = this.boltBuffers.get(sample.id);
    if (!buf) {
      // Kick off a load for next time, then skip this trigger.
      void this.ensureBoltBuffer(sample.id);
      return;
    }
    const cents =
      (Math.random() * 2 - 1) * Math.max(0, p.boltPitchJitterCents);
    const rate = Math.pow(2, cents / 1200);
    const player = new Tone.Player();
    (player as unknown as { buffer: Tone.ToneAudioBuffer }).buffer =
      new Tone.ToneAudioBuffer(buf);
    player.playbackRate = rate;
    player.volume.value = Tone.gainToDb(Math.max(0.0001, p.boltGain));
    player.connect(this.out);
    try {
      player.start();
    } catch (err) {
      console.warn("[lightning] bolt start failed", err);
      player.dispose();
      return;
    }
    const dur = (buf.duration / Math.max(0.01, rate)) + 0.05;
    this.voices.push({ player, endsAt: Tone.now() + dur });
    this.reap();
  }

  /** Preload all referenced buffers so first triggers aren't skipped. */
  preload(p: LightningParams): void {
    for (const s of p.boltSamples) void this.ensureBoltBuffer(s.id);
    if (p.backgroundSample) void this.ensureBoltBuffer(p.backgroundSample.id);
  }

  private reap(): void {
    const now = Tone.now();
    this.voices = this.voices.filter((v) => {
      if (v.endsAt <= now) {
        try { v.player.stop(); } catch { /* ignore */ }
        v.player.dispose();
        return false;
      }
      return true;
    });
  }

  private async syncBackground(
    sample: LightningSample | null,
    wanted: boolean,
    gain: number,
  ): Promise<void> {
    if (!this.out) return;
    const wantedId = wanted && sample ? sample.id : null;
    // Rewire if the desired sample changed.
    if (wantedId !== this.bgSampleId) {
      if (this.bg) {
        try { this.bg.stop(); } catch { /* ignore */ }
        this.bg.dispose();
        this.bg = null;
      }
      this.bgSampleId = wantedId;
      this.bgWasEnabled = false;
      if (wantedId && sample) {
        try {
          const buf = await this.ensureBoltBuffer(sample.id);
          if (!buf || this.bgSampleId !== sample.id) return;
          const player = new Tone.Player();
          (player as unknown as { buffer: Tone.ToneAudioBuffer }).buffer =
            new Tone.ToneAudioBuffer(buf);
          player.loop = true;
          player.volume.value = Tone.gainToDb(Math.max(0.0001, gain));
          player.connect(this.out);
          this.bg = player;
        } catch (err) {
          console.warn("[lightning] background load failed", err);
        }
      }
    }
    // Update volume + play/stop.
    if (this.bg) {
      this.bg.volume.rampTo(Tone.gainToDb(Math.max(0.0001, gain)), 0.1);
      if (wanted && !this.bgWasEnabled) {
        try { this.bg.start(); this.bgWasEnabled = true; } catch (err) {
          console.warn("[lightning] background start failed", err);
        }
      } else if (!wanted && this.bgWasEnabled) {
        try { this.bg.stop(); } catch { /* ignore */ }
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
