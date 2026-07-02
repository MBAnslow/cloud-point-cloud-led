import type {
  AmbientLightParams,
  BreathParams,
  CloudParams,
  DirectionalLightParams,
  EllipsoidParams,
  LedViewMode,
  SkyParams,
  StrandParams,
  WledParams,
} from "../state";

/** Bumped whenever the shape of the saved snapshot changes incompatibly. */
const SCHEMA_VERSION = 1;
const STORAGE_KEY = "cloudLeds.settings.v1";

export interface Snapshot {
  version: typeof SCHEMA_VERSION;
  ellipsoid: EllipsoidParams;
  cloud: CloudParams;
  strand: StrandParams;
  ambient: AmbientLightParams;
  directional: DirectionalLightParams;
  sky?: SkyParams;
  wled: WledParams;
  breath?: BreathParams;
  ledViewMode?: LedViewMode;
}

export function saveSnapshot(snap: Omit<Snapshot, "version">): void {
  const payload: Snapshot = { version: SCHEMA_VERSION, ...snap };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn("[persistence] saveSnapshot failed", err);
  }
}

export function loadSnapshot(): Snapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Snapshot;
    if (data.version !== SCHEMA_VERSION) return null;
    return data;
  } catch (err) {
    console.warn("[persistence] loadSnapshot failed", err);
    return null;
  }
}

export function hasSavedSnapshot(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}
