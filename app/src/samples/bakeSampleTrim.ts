import { getSampleBlob, putSampleBlob } from "./sampleStorage";
import { invalidateSamplePeaks } from "./samplePeaks";

/** Encode an AudioBuffer as a 16-bit PCM WAV blob. */
export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const headerSize = 44;
  const ab = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(ab);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));

  let offset = headerSize;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c]![i]!));
      view.setInt16(
        offset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true,
      );
      offset += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

/**
 * Decode the stored blob, keep `[startSec, endSec)`, rewrite as WAV,
 * and invalidate waveform peaks. Returns the new duration in seconds.
 */
export async function bakeSampleTrim(
  sampleId: string,
  startSec: number,
  endSec: number,
): Promise<number> {
  const blob = await getSampleBlob(sampleId);
  if (!blob) throw new Error("sample blob missing");
  const arr = await blob.arrayBuffer();
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new AC();
  let src: AudioBuffer;
  try {
    src = await ctx.decodeAudioData(arr.slice(0));
  } finally {
    if (ctx.state !== "closed") await ctx.close().catch(() => undefined);
  }

  const start = Math.max(0, Math.min(src.duration, startSec));
  const end = Math.max(start + 1e-3, Math.min(src.duration, endSec));
  const startFrame = Math.floor(start * src.sampleRate);
  const endFrame = Math.min(src.length, Math.ceil(end * src.sampleRate));
  const frames = Math.max(1, endFrame - startFrame);

  const offline = new OfflineAudioContext(
    src.numberOfChannels,
    frames,
    src.sampleRate,
  );
  const sliced = offline.createBuffer(
    src.numberOfChannels,
    frames,
    src.sampleRate,
  );
  for (let c = 0; c < src.numberOfChannels; c++) {
    sliced.copyToChannel(
      src.getChannelData(c).subarray(startFrame, startFrame + frames),
      c,
    );
  }

  const wav = audioBufferToWavBlob(sliced);
  await putSampleBlob(sampleId, wav);
  invalidateSamplePeaks(sampleId);
  return sliced.duration;
}
