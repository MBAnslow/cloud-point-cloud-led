import { getSampleBlob } from "./sampleStorage";

/** Per-bucket min/max peaks for drawing a DAW-style waveform. */
export interface WaveformPeaks {
  mins: Float32Array;
  maxs: Float32Array;
}

const PEAK_BUCKETS = 1024;
const cache = new Map<string, WaveformPeaks>();
const inflight = new Map<string, Promise<WaveformPeaks | null>>();

function peaksFromBuffer(buf: AudioBuffer, buckets: number): WaveformPeaks {
  const chans = buf.numberOfChannels;
  const len = buf.length;
  const mins = new Float32Array(buckets);
  const maxs = new Float32Array(buckets);
  mins.fill(0);
  maxs.fill(0);
  if (len <= 0 || buckets <= 0) return { mins, maxs };

  const channels: Float32Array[] = [];
  for (let c = 0; c < chans; c++) channels.push(buf.getChannelData(c));

  for (let i = 0; i < buckets; i++) {
    const start = Math.floor((i / buckets) * len);
    const end = Math.floor(((i + 1) / buckets) * len);
    let mn = 0;
    let mx = 0;
    let first = true;
    for (let s = start; s < end; s++) {
      let v = 0;
      for (let c = 0; c < chans; c++) v += channels[c]![s]!;
      v /= chans;
      if (first) {
        mn = v;
        mx = v;
        first = false;
      } else {
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    mins[i] = mn;
    maxs[i] = mx;
  }
  return { mins, maxs };
}

/**
 * Decode the sample blob and return cached min/max peaks. Returns
 * null if the blob is missing or decode fails.
 */
export async function getSamplePeaks(
  sampleId: string,
): Promise<WaveformPeaks | null> {
  const hit = cache.get(sampleId);
  if (hit) return hit;
  const pending = inflight.get(sampleId);
  if (pending) return pending;

  const p = (async () => {
    try {
      const blob = await getSampleBlob(sampleId);
      if (!blob) return null;
      const arr = await blob.arrayBuffer();
      const AC = window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AC();
      try {
        const buf = await ctx.decodeAudioData(arr.slice(0));
        const peaks = peaksFromBuffer(buf, PEAK_BUCKETS);
        cache.set(sampleId, peaks);
        return peaks;
      } finally {
        if (ctx.state !== "closed") await ctx.close().catch(() => undefined);
      }
    } catch (err) {
      console.warn("[samples] waveform decode failed", sampleId, err);
      return null;
    } finally {
      inflight.delete(sampleId);
    }
  })();

  inflight.set(sampleId, p);
  return p;
}

export function invalidateSamplePeaks(sampleId: string): void {
  cache.delete(sampleId);
  inflight.delete(sampleId);
}

/** Draw min/max peaks into a canvas, stretched to its pixel size. */
export function drawWaveform(
  ctx: CanvasRenderingContext2D,
  peaks: WaveformPeaks,
  width: number,
  height: number,
  color: string,
): void {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  ctx.clearRect(0, 0, w, h);

  const mid = h / 2;
  const n = peaks.mins.length;
  if (n === 0) return;

  // Soft midline
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(w, mid);
  ctx.stroke();

  ctx.fillStyle = color;
  for (let x = 0; x < w; x++) {
    const i = Math.min(n - 1, Math.floor((x / w) * n));
    const mn = peaks.mins[i]!;
    const mx = peaks.maxs[i]!;
    const y0 = mid - mx * mid;
    const y1 = mid - mn * mid;
    const top = Math.min(y0, y1);
    const bot = Math.max(y0, y1);
    const barH = Math.max(1, bot - top);
    ctx.fillRect(x, top, 1, barH);
  }
}
