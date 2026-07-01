/**
 * Lightweight pub/sub for the WLED streaming client's runtime state.
 * Updated from inside `WledStreamClient`, read by UI overlays (histogram).
 * Kept off React state so per-frame counter bumps don't re-render the tree.
 */
export interface WledStatus {
  /** UI toggle state for streaming (set from React via setEnabled). */
  enabled: boolean;
  /** WebSocket → relay open. */
  connected: boolean;
  /** Sanitised target host as the relay sees it (after URL parsing). */
  target: string;
  /** UDP target port (always 4048 for DDP). */
  port: number;
  framesSent: number;
  framesDropped: number;
  /** Last error message from the WebSocket, if any. */
  lastError: string | null;
}

let status: WledStatus = {
  enabled: false,
  connected: false,
  target: "",
  port: 4048,
  framesSent: 0,
  framesDropped: 0,
  lastError: null,
};

export function getWledStatus(): WledStatus {
  return status;
}

export function updateWledStatus(patch: Partial<WledStatus>): void {
  status = { ...status, ...patch };
}

/**
 * Parse a user-entered host string into a bare hostname or IP suitable for
 * `dgram.send`. Accepts things like:
 *
 *   "10.0.4.54"            → "10.0.4.54"
 *   "10.0.4.54/"           → "10.0.4.54"
 *   "http://10.0.4.54/"    → "10.0.4.54"
 *   "  wled.local "        → "wled.local"
 *   "wled.local:80/json"   → "wled.local"
 *   "[fe80::1]:1234"       → "fe80::1"
 */
export function sanitizeHost(input: string): string {
  let h = (input ?? "").trim();
  if (!h) return "";
  // Strip URL scheme (http://, https://, ws://, etc.).
  h = h.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
  // Strip path / query / hash.
  h = h.split("/")[0].split("?")[0].split("#")[0];
  // Strip bracketed IPv6 with optional port, e.g. "[fe80::1]:1234" → "fe80::1".
  const ipv6 = h.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (ipv6) return ipv6[1];
  // Strip trailing :port for plain hosts (but only if it looks like a port).
  // Leave IPv6 without brackets alone since they contain colons.
  if (!h.includes(":") || /:[0-9]+$/.test(h)) {
    h = h.replace(/:[0-9]+$/, "");
  }
  return h;
}
