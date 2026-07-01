/**
 * Single-frame publish/subscribe bridge between the LED shading loop (which
 * runs inside R3F's useFrame) and out-of-tree DOM consumers like the
 * histogram. Keeping this off React state means we don't re-render the
 * component tree every animation frame.
 *
 * The published buffer is the same `Uint8Array` we forward to the WLED
 * relay — so the histogram shows the bytes that would actually be sent.
 */
let latestBuffer: Uint8Array | null = null;
let latestCount = 0;
let frameVersion = 0;

export function publishFrame(bytes: Uint8Array, n: number): void {
  latestBuffer = bytes;
  latestCount = n;
  frameVersion++;
}

export interface FrameSnapshot {
  buffer: Uint8Array | null;
  count: number;
  version: number;
}

export function getFrame(): FrameSnapshot {
  return {
    buffer: latestBuffer,
    count: latestCount,
    version: frameVersion,
  };
}
