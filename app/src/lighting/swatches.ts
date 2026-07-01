/**
 * Shared library of named sky swatches.
 *
 * Each swatch bundles three colors (ambient sky, sun, moon) that read
 * plausibly together for a specific time of day. The timeline UI and any
 * "pick a preset" dropdowns both read from this same file so that the
 * label you see on a timeline pin matches the swatch selector.
 */
export interface SkySwatch {
  id: string;
  label: string;
  ambientColor: string;
  sunColor: string;
  moonColor: string;
}

export const SKY_SWATCHES: SkySwatch[] = [
  {
    id: "moonlitBlue",
    label: "Moonlit blue",
    ambientColor: "#0c1734",
    sunColor: "#05070d",
    moonColor: "#b7c8ff",
  },
  {
    id: "blueHour",
    label: "Blue hour",
    ambientColor: "#1b2d5e",
    sunColor: "#463f75",
    moonColor: "#aebfff",
  },
  {
    id: "azureTwilight",
    label: "Azure twilight",
    ambientColor: "#2f569c",
    sunColor: "#6f82ca",
    moonColor: "#9eb3ff",
  },
  {
    id: "roseDawn",
    label: "Rose dawn",
    ambientColor: "#7c68b3",
    sunColor: "#f39d84",
    moonColor: "#95a9ea",
  },
  {
    id: "goldenPeach",
    label: "Golden peach",
    ambientColor: "#d89274",
    sunColor: "#f8c67d",
    moonColor: "#90a2d7",
  },
  {
    id: "noonSky",
    label: "Noon sky",
    ambientColor: "#a1c8f2",
    sunColor: "#fff8ea",
    moonColor: "#7285ad",
  },
  {
    id: "warmDay",
    label: "Warm day",
    ambientColor: "#f2c190",
    sunColor: "#ffe5be",
    moonColor: "#8596c3",
  },
  {
    id: "emberSunset",
    label: "Ember sunset",
    ambientColor: "#d46c8f",
    sunColor: "#ef708a",
    moonColor: "#98a6df",
  },
  {
    id: "crimsonSunset",
    label: "Crimson sunset",
    ambientColor: "#3f1f3f",
    sunColor: "#ff4a1f",
    moonColor: "#a4b4f0",
  },
  {
    id: "violetDusk",
    label: "Violet dusk",
    ambientColor: "#7163b2",
    sunColor: "#8f74c6",
    moonColor: "#a4b4f0",
  },
  {
    id: "deepMagenta",
    label: "Deep magenta",
    ambientColor: "#5f3f8f",
    sunColor: "#ff5e73",
    moonColor: "#8ea1ef",
  },
];

/** Lookup a swatch by id. Falls back to the neutral moonlit blue. */
export function getSwatch(id: string): SkySwatch {
  return (
    SKY_SWATCHES.find((s) => s.id === id) ??
    SKY_SWATCHES[0]
  );
}

export const CUSTOM_SWATCH_ID = "custom";
