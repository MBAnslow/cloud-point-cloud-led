/**
 * Keeps the live Zustand store mirrored to localStorage, and on first
 * paint tries to reload the last YAML config file the user opened/saved
 * (File System Access handle in IndexedDB).
 */

import { currentSnapshot, useSimStore } from "../state";
import { saveSnapshot } from "./persistence";
import { reloadBoundFileIfPossible } from "./fileIO";

const AUTOSAVE_MS = 400;

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Call once from the app entrypoint. */
export function startPersistence(): void {
  if (started) return;
  started = true;

  // Debounced mirror of every store change into localStorage so a refresh
  // restores the latest parameters even if the user never hit Save.
  useSimStore.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      saveSnapshot(currentSnapshot());
    }, AUTOSAVE_MS);
  });

  // Prefer the last bound YAML file when the browser still grants access.
  void reloadBoundFileIfPossible().then((res) => {
    if (res) {
      console.info(`[persistence] Restored config from ${res.fileName}`);
    }
  });
}
