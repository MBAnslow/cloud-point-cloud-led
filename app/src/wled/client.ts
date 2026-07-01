import { sanitizeHost, updateWledStatus } from "../stream/wledStatus";

/**
 * Thin WebSocket client that streams a Uint8Array of RGB triplets to the
 * local relay, which then forwards them as DDP packets to the WLED
 * controller. Implements simple backpressure: if the previous frame is
 * still buffered we drop the new one rather than queueing.
 *
 * Runtime state (connection, frame counters, resolved target) is mirrored
 * into `stream/wledStatus.ts` so UI overlays can observe it without
 * forcing per-frame React re-renders.
 */
export class WledStreamClient {
  private ws: WebSocket | null = null;
  private url: string;
  private wantOpen = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTarget: { host: string; port: number } | null = null;

  public framesSent = 0;
  public framesDropped = 0;

  constructor(url = "ws://localhost:7890") {
    this.url = url;
  }

  start() {
    this.wantOpen = true;
    updateWledStatus({ enabled: true, lastError: null });
    this.openSocket();
  }

  stop() {
    this.wantOpen = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    updateWledStatus({ enabled: false, connected: false });
  }

  /**
   * Update the WLED target host on the relay. The input is sanitised
   * (scheme/path/port stripped) before being sent.
   */
  setTarget(host: string, port = 4048) {
    const cleanHost = sanitizeHost(host);
    this.lastTarget = { host: cleanHost, port };
    updateWledStatus({ target: cleanHost, port });
    this.sendControl();
  }

  private sendControl() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.lastTarget) return;
    this.ws.send(
      JSON.stringify({
        type: "target",
        host: this.lastTarget.host,
        port: this.lastTarget.port,
      }),
    );
  }

  send(buf: Uint8Array): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.framesDropped++;
      updateWledStatus({ framesDropped: this.framesDropped });
      return false;
    }
    if (this.ws.bufferedAmount > 6 * 1024) {
      this.framesDropped++;
      updateWledStatus({ framesDropped: this.framesDropped });
      return false;
    }
    this.ws.send(buf);
    this.framesSent++;
    updateWledStatus({ framesSent: this.framesSent });
    return true;
  }

  private openSocket() {
    if (!this.wantOpen) return;
    try {
      const ws = new WebSocket(this.url);
      ws.binaryType = "arraybuffer";
      this.ws = ws;

      ws.addEventListener("open", () => {
        updateWledStatus({ connected: true, lastError: null });
        this.sendControl();
      });
      ws.addEventListener("close", () => {
        updateWledStatus({ connected: false });
        this.ws = null;
        if (this.wantOpen) this.scheduleReconnect();
      });
      ws.addEventListener("error", () => {
        updateWledStatus({ lastError: "ws error (is the relay running?)" });
      });
    } catch (err) {
      updateWledStatus({
        lastError: err instanceof Error ? err.message : "ws open failed",
      });
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, 1500);
  }
}
