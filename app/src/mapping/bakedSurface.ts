import { BufferGeometry, Mesh } from "three";

let bakedGeometry: BufferGeometry | null = null;
let bakedOccluderGeometry: BufferGeometry | null = null;
let bakedOccluderMesh: Mesh<BufferGeometry> | null = null;

export function setBakedSurfaceGeometry(
  nextRender: BufferGeometry | null,
  nextOccluder?: BufferGeometry | null,
): void {
  if (bakedGeometry) bakedGeometry.dispose();
  if (bakedOccluderGeometry) bakedOccluderGeometry.dispose();
  bakedGeometry = nextRender;
  bakedOccluderGeometry = nextOccluder ?? nextRender;
  bakedOccluderMesh = bakedOccluderGeometry ? new Mesh(bakedOccluderGeometry) : null;
}

export function clearBakedSurfaceGeometry(): void {
  setBakedSurfaceGeometry(null);
}

export function getBakedSurfaceGeometry(): BufferGeometry | null {
  return bakedGeometry;
}

export function getBakedSurfaceOccluder(): Mesh<BufferGeometry> | null {
  return bakedOccluderMesh;
}

