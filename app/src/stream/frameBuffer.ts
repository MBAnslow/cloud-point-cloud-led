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
let latestPositions: Float32Array | null = null;
let latestNormals: Float32Array | null = null;
let latestPositionValidity: Uint8Array | null = null;
let positionCount = 0;
let positionVersion = 0;

export function publishFrame(bytes: Uint8Array, n: number): void {
  latestBuffer = bytes;
  latestCount = n;
  frameVersion++;
}

/** Publish world-space LED centres whenever mapping or transforms change. */
export function publishLedPositions(
  positions: Float32Array,
  normals: Float32Array,
  n: number,
  validity?: Uint8Array,
): void {
  latestPositions = positions;
  latestNormals = normals;
  latestPositionValidity = validity ?? null;
  positionCount = n;
  positionVersion++;
}

export interface FrameSnapshot {
  buffer: Uint8Array | null;
  count: number;
  version: number;
  positions: Float32Array | null;
  normals: Float32Array | null;
  positionValidity: Uint8Array | null;
  positionCount: number;
  positionVersion: number;
}

export function getFrame(): FrameSnapshot {
  return {
    buffer: latestBuffer,
    count: latestCount,
    version: frameVersion,
    positions: latestPositions,
    normals: latestNormals,
    positionValidity: latestPositionValidity,
    positionCount,
    positionVersion,
  };
}
