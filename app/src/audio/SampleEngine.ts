import * as Tone from "tone";
import type { Sample, SamplesParams } from "../state";
import { getSampleBlob } from "../samples/sampleStorage";
import { activeSampleClipsAt, type ActiveSampleClip } from "./sampleCycle";

/**
 * Samples engine. Fires a `Tone.Player` per active clip. Chain per clip:
 *
 *   Player(buffer) → clipGain (fade in/out) → panner → sampleBus
 *
 * Global chain: sampleBus → master → destination.
 *
 * The engine loads sample blobs from IndexedDB lazily — the first time
 * a clip references a sampleId the blob is fetched and decoded, then
 * cached forever (per session). Buffer decode is async so a clip may
 * miss its first frame after upload; playback catches up naturally on
 * the following pass.
 *
 * Scrub awareness: the engine keeps the previous playhead hour and, if
 * the clock jumps discontinuously (e.g. ruler scrub), it tears down
 * and restarts any affected clips at their new offset so audio stays
 * in sync with the timeline.
 */

interface Voice {
  clipId: string;
  sampleId: string;
  player: Tone.Player;
  gain: Tone.Gain;
  panner: Tone.Panner;
  /** Post-panner splitter into dry/reverb/delay parallel sums. */
  dryGain: Tone.Gain;
  reverb: Tone.Freeverb;
  reverbWet: Tone.Gain;
  delay: Tone.FeedbackDelay;
  delayWet: Tone.Gain;
  /**
   * Random-detune multiplier picked once at trigger time and combined
   * with the clip's base playbackRate to form the actual player rate.
   * Kept so live edits to the base rate keep the random offset.
   */
  randomRateMult: number;
}

// Reflects a discontinuous playhead jump; larger than any single-frame
// delta at reasonable cycle lengths (24h / 5s cycle = 4.8 h/s ≈ 0.08 h/frame).
const SCRUB_JUMP_HOURS = 0.5;

export class SampleEngine {
  private started = false;
  private master: Tone.Gain | null = null;
  private bus: Tone.Gain | null = null;

  private voices = new Map<string, Voice>();
  private buffers = new Map<string, ToneAudioBufferLike>();
  private loading = new Map<string, Promise<Tone.ToneAudioBuffer | null>>();
  private lastHour = -1;

  async start(): Promise<void> {
    if (this.started) return;
    await Tone.start();
    this.master = new Tone.Gain(0).toDestination();
    this.bus = new Tone.Gain(1);
    this.bus.connect(this.master);
    this.started = true;
  }

  isStarted(): boolean {
    return this.started;
  }

  /**
   * Preload a sample's buffer into the engine cache. Call from the UI
   * right after upload so the first placed clip plays without a decode
   * delay.
   */
  async ensureSampleLoaded(sample: Sample): Promise<void> {
    await this.loadBuffer(sample.id);
    void sample; // sample metadata not needed beyond the id.
  }

  update(hour: number, cycleSeconds: number, p: SamplesParams): void {
    if (!this.started || !this.master || !this.bus) return;

    this.master.gain.rampTo(p.enabled ? p.master : 0, 0.05);

    if (!p.enabled) {
      // Tear everything down while disabled so re-enable is glitch-free.
      for (const v of this.voices.values()) this.disposeVoice(v);
      this.voices.clear();
      this.lastHour = hour;
      return;
    }

    // Detect discontinuous playhead jumps so we can restart affected
    // clips at their new offset.
    const jumped =
      this.lastHour >= 0 &&
      Math.abs(hour - this.lastHour) > SCRUB_JUMP_HOURS &&
      // Ignore natural wrap-around 23.9 → 0.
      !(this.lastHour > 23.5 && hour < 0.5);

    const active = activeSampleClipsAt(hour, p, Math.max(1, cycleSeconds));
    const activeMap = new Map(active.map((a) => [a.clipId, a]));

    // Stop voices whose clip no longer contains the playhead, or that
    // are stale after a scrub.
    for (const [clipId, voice] of this.voices) {
      const a = activeMap.get(clipId);
      if (!a || jumped) {
        this.disposeVoice(voice);
        this.voices.delete(clipId);
      }
    }

    // Start voices for clips that should be sounding but aren't.
    for (const a of active) {
      if (this.voices.has(a.clipId)) {
        // Live edits on an already-sounding voice. Random detune was
        // baked in at trigger; multiply here to preserve it.
        const voice = this.voices.get(a.clipId)!;
        const effectiveRate = Math.max(0.05, a.playbackRate * voice.randomRateMult);
        voice.panner.pan.rampTo(a.pan, 0.05);
        if (Math.abs(voice.player.playbackRate - effectiveRate) > 0.001) {
          voice.player.playbackRate = effectiveRate;
        }
        voice.gain.gain.rampTo(a.gain, 0.05);
        this.applyClipFx(voice, a);
        continue;
      }
      const buf = this.buffers.get(a.sampleId);
      if (!buf) {
        // Kick off a load; the clip will start on a subsequent tick.
        this.loadBuffer(a.sampleId).catch(() => undefined);
        continue;
      }
      this.startVoice(a, buf);
    }

    this.lastHour = hour;
  }

  private startVoice(a: ActiveSampleClip, buffer: ToneAudioBufferLike): void {
    if (!this.bus) return;
    const now = Tone.now();

    // Roll a random detune once per trigger and bake into the player rate.
    const randCents = a.randomPitchCents > 0
      ? (Math.random() * 2 - 1) * a.randomPitchCents
      : 0;
    const randomRateMult = Math.pow(2, randCents / 1200);
    const effectiveRate = Math.max(0.05, a.playbackRate * randomRateMult);

    const player = new Tone.Player({
      url: buffer as unknown as Tone.ToneAudioBuffer,
      autostart: false,
      loop: false,
    });
    player.playbackRate = effectiveRate;
    const gain = new Tone.Gain(0);
    const panner = new Tone.Panner(a.pan);

    // Parallel FX split: dry + reverb.wet + delay.wet each with its
    // own gain, summed into the bus. Reverb uses Freeverb (algorithmic,
    // no async IR generation) so start-up is instant.
    const dryGain = new Tone.Gain(1);
    const reverb = new Tone.Freeverb({
      roomSize: Math.max(0, Math.min(0.99, a.reverbDecay)),
      dampening: 3000,
    });
    const reverbWet = new Tone.Gain(0);
    const delay = new Tone.FeedbackDelay({
      delayTime: Math.max(0, Math.min(2, a.delayTimeSec)),
      feedback: Math.max(0, Math.min(0.95, a.delayFeedback)),
      wet: 1, // internal wet is 1; the send-level lives on delayWet.
    });
    const delayWet = new Tone.Gain(0);

    player.connect(gain);
    gain.connect(panner);
    panner.connect(dryGain);
    panner.connect(reverb);
    reverb.connect(reverbWet);
    panner.connect(delay);
    delay.connect(delayWet);
    dryGain.connect(this.bus);
    reverbWet.connect(this.bus);
    delayWet.connect(this.bus);

    // Fade in from 0 → target gain across fadeInSec.
    const fi = Math.max(0.001, a.fadeInSec);
    const g = gain.gain;
    g.setValueAtTime(0, now);
    g.linearRampToValueAtTime(a.gain, now + fi);

    // Start playback at the current offset so the clip stays in sync
    // with the timeline after a scrub or delayed load.
    try {
      player.start(now, a.offsetSec);
    } catch (err) {
      console.warn("[samples] player.start failed", err);
      player.dispose();
      gain.dispose();
      panner.dispose();
      dryGain.dispose();
      reverb.dispose();
      reverbWet.dispose();
      delay.dispose();
      delayWet.dispose();
      return;
    }
    const voice: Voice = {
      clipId: a.clipId,
      sampleId: a.sampleId,
      player,
      gain,
      panner,
      dryGain,
      reverb,
      reverbWet,
      delay,
      delayWet,
      randomRateMult,
    };
    // Set initial wet levels from clip params.
    this.applyClipFx(voice, a);
    this.voices.set(a.clipId, voice);
  }

  /**
   * Apply live-editable clip FX params to an existing voice. Wet
   * levels ramp smoothly so slider drags don't zipper. Reverb decay
   * and delay time/feedback are cheap to reassign on Tone nodes.
   */
  private applyClipFx(v: Voice, a: ActiveSampleClip): void {
    v.reverbWet.gain.rampTo(Math.max(0, Math.min(1, a.reverbMix)), 0.08);
    v.delayWet.gain.rampTo(Math.max(0, Math.min(1, a.delayMix)), 0.08);
    const room = Math.max(0, Math.min(0.99, a.reverbDecay));
    // roomSize is a Signal on Freeverb.
    (v.reverb.roomSize as unknown as Tone.Signal<"normalRange">).rampTo(
      room,
      0.1,
    );
    v.delay.delayTime.rampTo(Math.max(0, Math.min(2, a.delayTimeSec)), 0.08);
    v.delay.feedback.rampTo(
      Math.max(0, Math.min(0.95, a.delayFeedback)),
      0.08,
    );
  }

  private disposeVoice(v: Voice): void {
    const now = Tone.now();
    // Very short release to avoid a click when torn down mid-buffer.
    try {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(v.gain.gain.value, now);
      v.gain.gain.linearRampToValueAtTime(0, now + 0.02);
      v.player.stop(now + 0.03);
    } catch {
      /* player already stopped; ignore */
    }
    // Dispose slightly after the ramp completes.
    setTimeout(() => {
      v.player.dispose();
      v.gain.dispose();
      v.panner.dispose();
      v.dryGain.dispose();
      v.reverb.dispose();
      v.reverbWet.dispose();
      v.delay.dispose();
      v.delayWet.dispose();
    }, 80);
  }

  private async loadBuffer(
    sampleId: string,
  ): Promise<Tone.ToneAudioBuffer | null> {
    const cached = this.buffers.get(sampleId);
    if (cached) return cached as Tone.ToneAudioBuffer;
    const pending = this.loading.get(sampleId);
    if (pending) return pending;
    const p = (async () => {
      const blob = await getSampleBlob(sampleId);
      if (!blob) return null;
      const arr = await blob.arrayBuffer();
      // Tone's ToneAudioBuffer can decode raw ArrayBuffers.
      const ab = await Tone.getContext().rawContext.decodeAudioData(
        arr.slice(0),
      );
      const tab = new Tone.ToneAudioBuffer(ab);
      this.buffers.set(sampleId, tab);
      return tab;
    })();
    this.loading.set(sampleId, p);
    try {
      return await p;
    } finally {
      this.loading.delete(sampleId);
    }
  }
}

// A minimal shape so we don't need to import Tone's private buffer types.
type ToneAudioBufferLike = Tone.ToneAudioBuffer;

let singleton: SampleEngine | null = null;
export function getSampleEngine(): SampleEngine {
  if (!singleton) singleton = new SampleEngine();
  return singleton;
}
