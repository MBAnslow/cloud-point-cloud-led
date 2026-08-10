import type { MappingGaussian, MappingParams } from "../state";

function round(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : 0;
}

function gaussianSignature(g: MappingGaussian): string {
  return [
    g.id,
    round(g.pos[0]),
    round(g.pos[1]),
    round(g.pos[2]),
    round(g.normal[0]),
    round(g.normal[1]),
    round(g.normal[2]),
    round(g.amplitude),
    round(g.width),
    round(g.height),
    round(g.rotationDeg),
  ].join("|");
}

/** Signature for baked dome surface invalidation. */
export function mappingBakeSignature(mapping: MappingParams): string {
  const domes = (mapping.gaussians ?? []).map(gaussianSignature).join(";");
  return [
    round(mapping.bumpAdditivity),
    mapping.flipUpDown ? 1 : 0,
    mapping.flipLeftRight ? 1 : 0,
    domes,
  ].join("#");
}

