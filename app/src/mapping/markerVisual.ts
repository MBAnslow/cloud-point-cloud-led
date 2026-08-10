export type LedMarkerKind = "led" | "sensor";

/** Exact outward-hemisphere geometry shared by mapping and simulation. */
export function markerSphereArgs(
  radius: number,
  kind: LedMarkerKind,
): [number, number, number, number, number, number, number] {
  return kind === "sensor"
    ? [radius, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2]
    : [radius, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2];
}

export function markerRadius(
  kind: LedMarkerKind,
  mappingLedSize: number,
  sensorSize: number,
): number {
  return kind === "sensor" ? sensorSize : mappingLedSize;
}

export const MARKER_MATERIAL_DEFAULTS = {
  roughness: 0.5,
  metalness: 0,
  toneMapped: false,
  transparent: true,
} as const;

export function alignMarkerNormal(
  candidate: [number, number, number],
  reference: [number, number, number],
): [number, number, number] {
  const dot =
    candidate[0] * reference[0] +
    candidate[1] * reference[1] +
    candidate[2] * reference[2];
  return dot >= 0
    ? candidate
    : [-candidate[0], -candidate[1], -candidate[2]];
}

/** Make an instanced standard material's emissive term follow instanceColor. */
export function applyMarkerInstanceEmissive(shader: {
  vertexShader: string;
  fragmentShader: string;
}): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <color_pars_vertex>",
      "#include <color_pars_vertex>\nvarying vec3 vMarkerInstanceColor;",
    )
    .replace(
      "#include <color_vertex>",
      `#include <color_vertex>
vMarkerInstanceColor = vec3(1.0);
#ifdef USE_INSTANCING_COLOR
  vMarkerInstanceColor = instanceColor;
#endif`,
    );
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <color_pars_fragment>",
    "#include <color_pars_fragment>\nvarying vec3 vMarkerInstanceColor;",
  );
  shader.fragmentShader = shader.fragmentShader.replace(
    "vec3 totalEmissiveRadiance = emissive;",
    "vec3 totalEmissiveRadiance = emissive * vMarkerInstanceColor;",
  );
}

