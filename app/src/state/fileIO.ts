/**
 * YAML config file I/O for the app's full snapshot.
 *
 * Everything the user can tweak — sliders, menus, panel visibility,
 * placed LEDs, sample metadata etc. — is already captured by the
 * `Snapshot` shape defined in `persistence.ts`. This module just
 * marshals that shape to/from a YAML file on disk using the File System
 * Access API (`showSaveFilePicker` / `showOpenFilePicker`) when
 * available, and falls back to Blob download + `<input type=file>`
 * upload on browsers that don't support it (Firefox, Safari today).
 *
 * Binary assets (uploaded audio, uploaded mesh) intentionally live in
 * IndexedDB and are NOT embedded in the YAML — the file stays small
 * and readable; on a different machine any dangling asset ids surface
 * as a warning after load so the user knows which files to re-upload.
 */

import YAML from "yaml";
import {
  applySnapshot,
  currentSnapshot,
  useSimStore,
  type SimState,
} from "../state";
import { saveSnapshot, type Snapshot } from "./persistence";
import { getSampleBlob } from "../samples/sampleStorage";
import { getMeshBlob } from "../mapping/meshAsset";
import {
  clearConfigHandle,
  getConfigHandle,
  putConfigHandle,
} from "./configHandleStorage";

const HEADER = "# cloud-point-cloud-led — application state\n";
const SUGGESTED_NAME = "cloud-led-config.yaml";
const YAML_MIME = "application/x-yaml";

export function snapshotToYaml(snap: Omit<Snapshot, "version">): string {
  // Wrap in an object literal (rather than casting) so YAML.stringify sees
  // plain data and doesn't try to serialise class prototypes.
  const doc = YAML.stringify(
    { version: 1, ...snap },
    { indent: 2, sortMapEntries: false },
  );
  return HEADER + doc;
}

export function yamlToSnapshot(text: string): Snapshot {
  const parsed = YAML.parse(text) as Snapshot;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Config file is empty or invalid YAML");
  }
  return parsed;
}

type FsWindow = typeof window & {
  showSaveFilePicker?: (opts?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (opts?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
};

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: {
    description?: string;
    accept: Record<string, string[]>;
  }[];
}

interface OpenFilePickerOptions extends SaveFilePickerOptions {
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
}

const w = (): FsWindow => window as FsWindow;

function fileAccessSupported(): boolean {
  return typeof w().showSaveFilePicker === "function";
}

async function verifyReadable(handle: FileSystemFileHandle): Promise<boolean> {
  const h = handle as FileSystemFileHandle & {
    queryPermission?: (opts: { mode: "read" }) => Promise<PermissionState>;
    requestPermission?: (opts: { mode: "read" }) => Promise<PermissionState>;
  };
  if (!h.queryPermission || !h.requestPermission) return true;
  const state = await h.queryPermission({ mode: "read" });
  if (state === "granted") return true;
  try {
    const asked = await h.requestPermission({ mode: "read" });
    return asked === "granted";
  } catch {
    // Without a user gesture the prompt may be blocked — fall through.
    return false;
  }
}

async function verifyWritable(handle: FileSystemFileHandle): Promise<boolean> {
  // File handles from a prior session need permission re-granted the
  // first time we touch them per page load. `queryPermission` returns
  // "granted" / "denied" / "prompt"; the request variant surfaces a
  // native browser prompt in the "prompt" case.
  const h = handle as FileSystemFileHandle & {
    queryPermission?: (opts: { mode: "readwrite" }) => Promise<PermissionState>;
    requestPermission?: (opts: { mode: "readwrite" }) => Promise<PermissionState>;
  };
  if (!h.queryPermission || !h.requestPermission) return true;
  const state = await h.queryPermission({ mode: "readwrite" });
  if (state === "granted") return true;
  const asked = await h.requestPermission({ mode: "readwrite" });
  return asked === "granted";
}

async function writeYamlToHandle(
  handle: FileSystemFileHandle,
  yaml: string,
): Promise<void> {
  const writable = await (
    handle as FileSystemFileHandle & { createWritable: () => Promise<FileSystemWritableFileStream> }
  ).createWritable();
  try {
    await writable.write(new Blob([yaml], { type: YAML_MIME }));
  } finally {
    await writable.close();
  }
}

interface FileSystemWritableFileStream {
  write(data: Blob | string): Promise<void>;
  close(): Promise<void>;
}

/**
 * True after either `saveToFile` or `loadFromFile` has stored a handle
 * this session — used to enable/disable the "Save (same file)" button.
 */
export async function hasBoundFile(): Promise<boolean> {
  if (!fileAccessSupported()) return false;
  const h = await getConfigHandle();
  return !!h;
}

/** Best-effort name of the currently bound file. */
export async function boundFileName(): Promise<string | null> {
  const h = await getConfigHandle();
  return h?.name ?? null;
}

export interface SaveOptions {
  /** Force showing the save picker even if a bound handle exists. */
  forcePicker?: boolean;
}

/**
 * Serialise the live store to YAML and write it to disk. Uses the
 * previously-bound handle when available so users can save with one
 * click; passes `forcePicker` for "Save as…". Falls back to a browser
 * download when the File System Access API is unavailable.
 */
export async function saveToFile(opts: SaveOptions = {}): Promise<void> {
  const yaml = snapshotToYaml(currentSnapshot());
  if (fileAccessSupported()) {
    let handle: FileSystemFileHandle | null = opts.forcePicker
      ? null
      : await getConfigHandle();
    if (handle && !(await verifyWritable(handle))) {
      handle = null;
    }
    if (!handle) {
      try {
        handle = await w().showSaveFilePicker!({
          suggestedName: SUGGESTED_NAME,
          types: [
            {
              description: "Cloud LED config (YAML)",
              accept: { [YAML_MIME]: [".yaml", ".yml"] },
            },
          ],
        });
      } catch (err) {
        // AbortError = user cancelled picker; not an error we surface.
        if ((err as { name?: string }).name === "AbortError") return;
        throw err;
      }
    }
    await writeYamlToHandle(handle, yaml);
    await putConfigHandle(handle);
    saveSnapshot(currentSnapshot());
    return;
  }
  // Fallback: trigger a browser download.
  const blob = new Blob([yaml], { type: YAML_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = SUGGESTED_NAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  saveSnapshot(currentSnapshot());
}

export interface LoadResult {
  fileName: string;
  missingAssets: MissingAssets;
}

export interface MissingAssets {
  samples: { id: string; name: string }[];
  lightningBolts: { id: string; name: string }[];
  lightningBackground: { id: string; name: string } | null;
  mesh: { id: string; name: string } | null;
}

/**
 * Prompt the user for a YAML file, parse it, and apply it to the live
 * store. Returns a summary of any binary assets referenced by the file
 * whose blobs are not present in IndexedDB on this machine, so the UI
 * can warn the user to re-upload them.
 */
export async function loadFromFile(): Promise<LoadResult | null> {
  let text: string;
  let fileName = "";
  if (fileAccessSupported()) {
    let handle: FileSystemFileHandle;
    try {
      const [picked] = await w().showOpenFilePicker!({
        multiple: false,
        types: [
          {
            description: "Cloud LED config (YAML)",
            accept: { [YAML_MIME]: [".yaml", ".yml"] },
          },
        ],
      });
      handle = picked;
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return null;
      throw err;
    }
    const file = await handle.getFile();
    fileName = file.name;
    text = await file.text();
    // Bind subsequent saves to this file too.
    await putConfigHandle(handle);
  } else {
    text = await pickTextFallback();
    fileName = "(uploaded)";
    if (!text) return null;
    // No handle to bind in the fallback path.
    await clearConfigHandle();
  }
  const snap = yamlToSnapshot(text);
  applySnapshot(snap);
  // Keep the browser auto-restore copy in sync with the file we just opened.
  saveSnapshot(currentSnapshot());
  const missing = await auditBinaryAssets(useSimStore.getState());
  return { fileName, missingAssets: missing };
}

/**
 * If a YAML config was opened/saved previously, reload it into the live
 * store. Used on startup so the last bound file is the default session.
 * Returns null when there is no handle, permission is denied, or the
 * browser doesn't support the File System Access API.
 */
export async function reloadBoundFileIfPossible(): Promise<LoadResult | null> {
  if (!fileAccessSupported()) return null;
  const handle = await getConfigHandle();
  if (!handle) return null;
  if (!(await verifyReadable(handle))) return null;
  try {
    const file = await handle.getFile();
    const text = await file.text();
    const snap = yamlToSnapshot(text);
    applySnapshot(snap);
    saveSnapshot(currentSnapshot());
    const missing = await auditBinaryAssets(useSimStore.getState());
    return { fileName: file.name, missingAssets: missing };
  } catch (err) {
    console.warn("[fileIO] reloadBoundFileIfPossible failed", err);
    return null;
  }
}

function pickTextFallback(): Promise<string> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".yaml,.yml," + YAML_MIME;
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? await f.text() : "");
    };
    input.oncancel = () => resolve("");
    input.click();
  });
}

/**
 * Walk state slices that reference IndexedDB blob ids and check each
 * against its store. Returns the ids that resolved to nothing so the
 * caller can surface a "re-upload these" hint.
 */
async function auditBinaryAssets(state: SimState): Promise<MissingAssets> {
  const missing: MissingAssets = {
    samples: [],
    lightningBolts: [],
    lightningBackground: null,
    mesh: null,
  };
  for (const s of state.samples.library) {
    const blob = await getSampleBlob(s.id).catch(() => null);
    if (!blob) missing.samples.push({ id: s.id, name: s.name });
  }
  for (const s of state.lightning.boltSamples ?? []) {
    const blob = await getSampleBlob(s.id).catch(() => null);
    if (!blob) missing.lightningBolts.push({ id: s.id, name: s.name });
  }
  const bg = state.lightning.backgroundSample;
  if (bg) {
    const blob = await getSampleBlob(bg.id).catch(() => null);
    if (!blob) missing.lightningBackground = { id: bg.id, name: bg.name };
  }
  if (state.mesh.id) {
    const blob = await getMeshBlob(state.mesh.id).catch(() => null);
    if (!blob) missing.mesh = { id: state.mesh.id, name: state.mesh.name };
  }
  return missing;
}

/** Human-readable one-line summary of missing assets, or null when none. */
export function summariseMissing(m: MissingAssets): string | null {
  const parts: string[] = [];
  if (m.samples.length) parts.push(`${m.samples.length} sample(s)`);
  if (m.lightningBolts.length)
    parts.push(`${m.lightningBolts.length} lightning bolt sound(s)`);
  if (m.lightningBackground) parts.push("lightning background sound");
  if (m.mesh) parts.push(`mesh "${m.mesh.name}"`);
  if (parts.length === 0) return null;
  return `Config loaded, but the following are not on this machine and need re-uploading: ${parts.join(", ")}.`;
}
