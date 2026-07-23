/**
 * WebSocket client that receives breath OSC forwards from the local
 * relay (UDP 999 → WS). TouchDesigner sends `/breathN/breath_binary`
 * etc.; the relay broadcasts `{ type: "oscBreath", channel, key, value }`.
 */

export type OscBreathKey = "binary" | "thresholded";

export interface OscBreathChannel {
  binary: number;
  thresholded: number;
  updatedAtMs: number;
}

export interface OscBreathEvent {
  tMs: number;
  channel: number;
  key: OscBreathKey;
  value: number;
}

export interface OscRelayStatus {
  packets: number;
  messages: number;
  matched: number;
  lastAddress: string;
  lastValue: number;
  lastMatched: boolean;
  lastAtMs: number;
  addresses: { address: string; count: number }[];
}

const channels = new Map<number, OscBreathChannel>();
const history: OscBreathEvent[] = [];
/** Pending OSC exhale rising-edges per channel (count = independent spawns). */
const pendingExhaleCounts = new Map<number, number>();
const HISTORY_KEEP_MS = 60_000;
const HISTORY_MAX = 2000;

let ws: WebSocket | null = null;
let wantOpen = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connected = false;
let relayStatus: OscRelayStatus | null = null;
const listeners = new Set<() => void>();
let notifyRaf = 0;

const DEFAULT_URL = "ws://localhost:7890";

function isOscExhaleValue(v: number): boolean {
  return v >= 0.5;
}

/** Coalesce UI notifications to one per animation frame (OSC can be audio-rate). */
function notify(): void {
  if (notifyRaf) return;
  notifyRaf = requestAnimationFrame(() => {
    notifyRaf = 0;
    for (const l of listeners) l();
  });
}

function notifyNow(): void {
  if (notifyRaf) {
    cancelAnimationFrame(notifyRaf);
    notifyRaf = 0;
  }
  for (const l of listeners) l();
}

function ensureChannel(channel: number): OscBreathChannel {
  let c = channels.get(channel);
  if (!c) {
    c = { binary: 0, thresholded: 0, updatedAtMs: 0 };
    channels.set(channel, c);
  }
  return c;
}

function pruneHistory(nowMs = performance.now()): void {
  const cutoff = nowMs - HISTORY_KEEP_MS;
  while (history.length > 0 && history[0].tMs < cutoff) {
    history.shift();
  }
  if (history.length > HISTORY_MAX) {
    history.splice(0, history.length - HISTORY_MAX);
  }
}

function pushEvent(
  channel: number,
  key: OscBreathKey,
  value: number,
  tMs: number,
): void {
  history.push({ tMs, channel, key, value });
  pruneHistory(tMs);
}

function openSocket(url: string): void {
  if (!wantOpen) return;
  if (
    ws &&
    (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }
  try {
    const socket = new WebSocket(url);
    ws = socket;
    socket.onopen = () => {
      connected = true;
      notifyNow();
    };
    socket.onclose = () => {
      connected = false;
      ws = null;
      notifyNow();
      if (wantOpen) {
        reconnectTimer = setTimeout(() => openSocket(url), 1000);
      }
    };
    socket.onerror = () => {
      // onclose will fire and schedule reconnect
    };
    socket.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      try {
        const msg = JSON.parse(ev.data) as {
          type?: string;
          channel?: number;
          key?: string;
          value?: number;
          packets?: number;
          messages?: number;
          matched?: number;
          lastAddress?: string;
          lastValue?: number;
          lastMatched?: boolean;
          lastAtMs?: number;
        };
        if (msg.type === "oscStatus") {
          const addresses = Array.isArray(
            (msg as { addresses?: unknown }).addresses,
          )
            ? (
                (msg as { addresses: { address?: string; count?: number }[] })
                  .addresses
              )
                .map((a) => ({
                  address: String(a.address ?? ""),
                  count: Number(a.count) || 0,
                }))
                .filter((a) => a.address)
            : [];
          relayStatus = {
            packets: Number(msg.packets) || 0,
            messages: Number(msg.messages) || 0,
            matched: Number(msg.matched) || 0,
            lastAddress: String(msg.lastAddress ?? ""),
            lastValue: Number(msg.lastValue) || 0,
            lastMatched: Boolean(msg.lastMatched),
            lastAtMs: Number(msg.lastAtMs) || 0,
            addresses,
          };
          notify();
          return;
        }
        if (msg.type !== "oscBreath") return;
        const ch = Number(msg.channel);
        if (!Number.isFinite(ch) || ch < 1) return;
        const value = Number(msg.value);
        if (!Number.isFinite(value)) return;
        const key: OscBreathKey | null =
          msg.key === "binary"
            ? "binary"
            : msg.key === "thresholded"
              ? "thresholded"
              : null;
        if (!key) return;
        const entry = ensureChannel(ch);
        if (key === "binary") {
          const prev = entry.binary;
          entry.binary = value;
          // Queue edge here so short TD pulses aren't missed between frames.
          if (isOscExhaleValue(value) && !isOscExhaleValue(prev)) {
            pendingExhaleCounts.set(
              ch,
              (pendingExhaleCounts.get(ch) ?? 0) + 1,
            );
          }
        } else {
          entry.thresholded = value;
        }
        entry.updatedAtMs = performance.now();
        pushEvent(ch, key, value, entry.updatedAtMs);
        notify();
      } catch {
        // ignore non-JSON / unrelated
      }
    };
  } catch {
    if (wantOpen) {
      reconnectTimer = setTimeout(() => openSocket(url), 1000);
    }
  }
}

/** Start receiving OSC breath forwards from the relay. Idempotent. */
export function startOscBreathClient(url = DEFAULT_URL): void {
  wantOpen = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  openSocket(url);
}

export function stopOscBreathClient(): void {
  wantOpen = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  connected = false;
  notifyNow();
}

export function isOscBreathConnected(): boolean {
  return connected;
}

export function getOscRelayStatus(): OscRelayStatus | null {
  return relayStatus;
}

/**
 * Channels that received a binary rising-edge into exhale since the last
 * call. One entry per independent pulse (duplicates allowed). Cleared on
 * read — call once per sim frame from the wave controller.
 */
export function consumeOscExhaleTriggers(): number[] {
  if (pendingExhaleCounts.size === 0) return [];
  const out: number[] = [];
  for (const [ch, count] of pendingExhaleCounts) {
    for (let i = 0; i < count; i++) out.push(ch);
  }
  pendingExhaleCounts.clear();
  return out;
}

/** Latest binary for OSC channel N (breathN → N). Default 0 if never received. */
export function getOscBreathBinary(channel: number): number {
  return channels.get(channel)?.binary ?? 0;
}

export function getOscBreathChannel(channel: number): OscBreathChannel | null {
  return channels.get(channel) ?? null;
}

/** Events in the keep window, oldest → newest. Optionally filter by key. */
export function getOscBreathHistory(
  windowMs = HISTORY_KEEP_MS,
  key?: OscBreathKey,
): OscBreathEvent[] {
  const now = performance.now();
  pruneHistory(now);
  const cutoff = now - windowMs;
  const out: OscBreathEvent[] = [];
  for (const e of history) {
    if (e.tMs < cutoff) continue;
    if (key && e.key !== key) continue;
    out.push(e);
  }
  return out;
}

/** Value of `key` for `channel` at or before `atMs` (0 if never received). */
export function getOscBreathValueAt(
  channel: number,
  key: OscBreathKey,
  atMs: number,
): number {
  let v = 0;
  for (const e of history) {
    if (e.channel !== channel || e.key !== key) continue;
    if (e.tMs > atMs) break;
    v = e.value;
  }
  return v;
}

export function clearOscBreathHistory(): void {
  history.length = 0;
  notify();
}

/** Subscribe to OSC updates / connection changes. Returns unsubscribe. */
export function subscribeOscBreath(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
