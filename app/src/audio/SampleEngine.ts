import * as Tone from "tone";
import type { Sample, SamplesParams } from "../state";
import { getSampleBlob } from "../samples/sampleStorage";
import { sampleClipsToTrigger, type TriggeredClip } from "./sampleCycle";

/**
 * Samples engine — trigger model.
 *
 * Each `SampleClip` acts as a fire-and-forget trigger positioned at
 * `startHour`. Whenever the playhead crosses that hour we start a new
 * voice which plays the whole sample buffer from t=0 and then disposes
 * itself. Multiple simultaneous voices for the same clip are allowed
 * (retrigger before natural end); the timeline does not depict a
 * clip's audio length.
 *
 * Per-voice chain:
 *   Player(buffer) → gain (fade in/out) → panner →
 *      ┬── dryGain ──►
 *      ├── reverb → reverbWet ──►  → sampleBus → master → destination
 *      └── delay  → delayWet  ──►
 */

interface Voice {
  clipId: string;
  sampleId: string;
  player: Tone.Player;
  gain: Tone.Gain;
  panner: Tone.Panner;
  dryGain: Tone.Gain;
  reverb: Tone.Freeverb;
  reverbWet: Tone.Gain;
  delay: Tone.FeedbackDelay;
  delayWet: Tone.Gain;
  /** Random detune baked in at trigger; combined with the live
   *  playbackRate so slider edits still respect the initial roll. */
  randomRateMult: number;
  /** Real-clock end time (Tone context seconds) after which the voice
   *  can be reaped. */
  endsAt: number;
  disposed: boolean;
}

export class SampleEngine {
  private started = false;
  private master: Tone.Gain | null = null;
  private bus: Tone.Gain | null = null;

  private voices: Voice[] = [];
  private buffers = new Map<string, Tone.ToneAudioBuffer>();
  private loading = new Map<string, Promise<Tone.ToneAudioBuffer | null>>();
  private prevHour = -1;

  async start(): Promise<void> {
    if (this.started) return;
    await Tone.start();
    this.master = new Tone.Gain(0);
    this.bus = new Tone.Gain(1);
    this.bus.connect(this.master);
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

  async ensureSampleLoaded(sample: Sample): Promise<void> {
    await this.loadBuffer(sample.id);
    void sample;
  }

  update(hour: number, cycleSeconds: number, p: SamplesParams): void {
    if (!this.started || !this.master || !this.bus) return;
    void cycleSeconds; // trigger model no longer needs cycle length.

    this.master.gain.rampTo(p.enabled ? p.master : 0, 0.05);

    if (!p.enabled) {
      // Tear everything down while disabled.
      for (const v of this.voices) this.disposeVoice(v);
      this.voices = [];
      this.prevHour = hour;
      return;
    }

    // Fire triggers crossed on this frame — with per-clip probability
    // gating. A failed roll is a silent trigger; the next crossing
    // rolls afresh.
    const triggers = sampleClipsToTrigger(this.prevHour, hour, p);
    for (const t of triggers) {
      if (t.triggerProbability < 1 && Math.random() >= t.triggerProbability) {
        continue;
      }
      const buf = this.buffers.get(t.sampleId);
      if (!buf) {
        // Kick off a load; the trigger is missed (rare — samples are
        // preloaded on upload). Nothing to schedule.
        this.loadBuffer(t.sampleId).catch(() => undefined);
        continue;
      }
      this.startVoice(t, buf);
    }

    // Apply live-editable FX + gain/pan to sounding voices matching
    // each clip.
    const clipById = new Map(p.clips.map((c) => [c.id, c]));
    for (const v of this.voices) {
      const c = clipById.get(v.clipId);
      if (!c) continue;
      v.panner.pan.rampTo(c.pan, 0.05);
      v.gain.gain.rampTo(c.gain, 0.05);
      const effRate = Math.max(0.05, c.playbackRate * v.randomRateMult);
      if (Math.abs(v.player.playbackRate - effRate) > 0.001) {
        v.player.playbackRate = effRate;
      }
      v.reverbWet.gain.rampTo(Math.max(0, Math.min(1, c.reverbMix ?? 0)), 0.08);
      v.delayWet.gain.rampTo(Math.max(0, Math.min(1, c.delayMix ?? 0)), 0.08);
      (v.reverb.roomSize as unknown as Tone.Signal<"normalRange">).rampTo(
        Math.max(0, Math.min(0.99, c.reverbDecay ?? 0.7)),
        0.1,
      );
      v.delay.delayTime.rampTo(
        Math.max(0, Math.min(2, c.delayTimeSec ?? 0.25)),
        0.08,
      );
      v.delay.feedback.rampTo(
        Math.max(0, Math.min(0.95, c.delayFeedback ?? 0.3)),
        0.08,
      );
    }

    // Reap voices past their natural end. A tail is left after
    // `endsAt` for the reverb/delay wash — one second is plenty.
    const now = Tone.now();
    const REAP_TAIL_SEC = 1.0;
    this.voices = this.voices.filter((v) => {
      if (!v.disposed && now > v.endsAt + REAP_TAIL_SEC) {
        this.disposeVoice(v);
        return false;
      }
      return true;
    });

    // Also drop voices whose clip was deleted from the arrangement.
    this.voices = this.voices.filter((v) => {
      if (!clipById.has(v.clipId)) {
        this.disposeVoice(v);
        return false;
      }
      return true;
    });

    this.prevHour = hour;
  }

  private startVoice(t: TriggeredClip, buffer: Tone.ToneAudioBuffer): void {
    if (!this.bus) return;
    const now = Tone.now();

    const randCents =
      t.randomPitchCents > 0
        ? (Math.random() * 2 - 1) * t.randomPitchCents
        : 0;
    const randomRateMult = Math.pow(2, randCents / 1200);
    const effectiveRate = Math.max(0.05, t.playbackRate * randomRateMult);

    const player = new Tone.Player({
      url: buffer,
      autostart: false,
      loop: false,
    });
    player.playbackRate = effectiveRate;
    const gain = new Tone.Gain(0);
    const panner = new Tone.Panner(t.pan);
    const dryGain = new Tone.Gain(1);
    const reverb = new Tone.Freeverb({
      roomSize: Math.max(0, Math.min(0.99, t.reverbDecay)),
      dampening: 3000,
    });
    const reverbWet = new Tone.Gain(Math.max(0, Math.min(1, t.reverbMix)));
    const delay = new Tone.FeedbackDelay({
      delayTime: Math.max(0, Math.min(2, t.delayTimeSec)),
      feedback: Math.max(0, Math.min(0.95, t.delayFeedback)),
      wet: 1,
    });
    const delayWet = new Tone.Gain(Math.max(0, Math.min(1, t.delayMix)));

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

    // Fade in from 0 → target gain over fadeInSec.
    const fi = Math.max(0.001, t.fadeInSec);
    const gAudioParam = gain.gain;
    gAudioParam.setValueAtTime(0, now);
    gAudioParam.linearRampToValueAtTime(t.gain, now + fi);

    // Duration in real seconds of the played buffer.
    const durRealSec = buffer.duration / effectiveRate;
    // Schedule a fade-out just before natural end so we don't cut hard.
    const fo = Math.max(0.001, t.fadeOutSec);
    const endAt = now + durRealSec;
    const fadeStart = Math.max(now + fi, endAt - fo);
    gAudioParam.setValueAtTime(t.gain, fadeStart);
    gAudioParam.linearRampToValueAtTime(0, endAt);

    try {
      player.start(now, 0);
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

    this.voices.push({
      clipId: t.clipId,
      sampleId: t.sampleId,
      player,
      gain,
      panner,
      dryGain,
      reverb,
      reverbWet,
      delay,
      delayWet,
      randomRateMult,
      endsAt: endAt,
      disposed: false,
    });
  }

  private disposeVoice(v: Voice): void {
    if (v.disposed) return;
    v.disposed = true;
    const now = Tone.now();
    try {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(v.gain.gain.value, now);
      v.gain.gain.linearRampToValueAtTime(0, now + 0.02);
      v.player.stop(now + 0.03);
    } catch {
      /* already stopped */
    }
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
    if (cached) return cached;
    const pending = this.loading.get(sampleId);
    if (pending) return pending;
    const p = (async () => {
      const blob = await getSampleBlob(sampleId);
      if (!blob) return null;
      const arr = await blob.arrayBuffer();
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

let singleton: SampleEngine | null = null;
export function getSampleEngine(): SampleEngine {
  if (!singleton) singleton = new SampleEngine();
  return singleton;
}
