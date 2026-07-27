import { getSampleBlob } from "../samples/sampleStorage";

/** Decoded RGBA sprite image ready for LED sampling. */
export interface SpriteImageData {
  width: number;
  height: number;
  /** Row-major RGBA, length width*height*4. */
  rgba: Uint8ClampedArray;
}

const cache = new Map<string, SpriteImageData>();
const inflight = new Map<string, Promise<SpriteImageData | null>>();

export function getCachedSpriteImage(id: string): SpriteImageData | null {
  return cache.get(id) ?? null;
}

export function invalidateSpriteImage(id: string): void {
  cache.delete(id);
  inflight.delete(id);
}

/**
 * Decode an IndexedDB blob into RGBA pixels (cached). Returns null if
 * the blob is missing or decode fails.
 */
export async function ensureSpriteImage(
  id: string,
): Promise<SpriteImageData | null> {
  const hit = cache.get(id);
  if (hit) return hit;
  const pending = inflight.get(id);
  if (pending) return pending;

  const p = (async () => {
    try {
      const blob = await getSampleBlob(id);
      if (!blob) return null;
      const bitmap = await createImageBitmap(blob);
      try {
        const w = bitmap.width;
        const h = bitmap.height;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(bitmap, 0, 0);
        const imageData = ctx.getImageData(0, 0, w, h);
        const data: SpriteImageData = {
          width: w,
          height: h,
          rgba: imageData.data,
        };
        cache.set(id, data);
        return data;
      } finally {
        bitmap.close();
      }
    } catch (err) {
      console.warn("[sprite] decode failed", id, err);
      return null;
    } finally {
      inflight.delete(id);
    }
  })();

  inflight.set(id, p);
  return p;
}

/** Nearest-neighbour sample; returns [r,g,b] in 0..1 or null if OOB. */
export function sampleSpriteRgb(
  img: SpriteImageData,
  u: number,
  v: number,
): [number, number, number] | null {
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null;
  const x = Math.min(img.width - 1, Math.max(0, Math.floor(u * img.width)));
  const y = Math.min(img.height - 1, Math.max(0, Math.floor(v * img.height)));
  const i = (y * img.width + x) * 4;
  const a = img.rgba[i + 3]! / 255;
  if (a < 0.02) return null;
  return [
    (img.rgba[i]! / 255) * a,
    (img.rgba[i + 1]! / 255) * a,
    (img.rgba[i + 2]! / 255) * a,
  ];
}
