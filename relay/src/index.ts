import { createSocket } from "node:dgram";
import { WebSocketServer, type WebSocket } from "ws";

const WS_PORT = Number(process.env.WS_PORT ?? 7890);
const DDP_PORT = 4048;

const udp = createSocket("udp4");
udp.on("error", (err) => {
  console.error("[udp] error", err);
});

const wss = new WebSocketServer({ port: WS_PORT });

interface Session {
  host: string | null;
  port: number;
  seq: number;
}

function encodeDdp(payload: Buffer, seq: number): Buffer {
  // DDP header (10 bytes):
  //  byte 0  flags  : 0x41 (VER1 0x40 | PUSH 0x01)
  //  byte 1  seq    : low 4 bits is sequence number (1..15, 0 = none)
  //  byte 2  type   : 0x0B = RGB 24bpp
  //  byte 3  id     : 1 = primary display
  //  bytes 4-7 offset (uint32 BE)
  //  bytes 8-9 length (uint16 BE)
  const header = Buffer.alloc(10);
  header.writeUInt8(0x41, 0);
  header.writeUInt8(seq & 0x0f, 1);
  header.writeUInt8(0x0b, 2);
  header.writeUInt8(0x01, 3);
  header.writeUInt32BE(0, 4);
  header.writeUInt16BE(payload.length, 8);
  return Buffer.concat([header, payload]);
}

function isControlMessage(data: unknown): data is {
  type: "target";
  host: string;
  port?: number;
} {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "target" &&
    typeof (data as { host?: unknown }).host === "string"
  );
}

interface LoggedSession extends Session {
  framesForwarded: number;
  framesDropped: number;
  loggedFirstPacket: boolean;
  lastLog: number;
}

wss.on("connection", (ws: WebSocket) => {
  const session: LoggedSession = {
    host: null,
    port: DDP_PORT,
    seq: 1,
    framesForwarded: 0,
    framesDropped: 0,
    loggedFirstPacket: false,
    lastLog: 0,
  };
  console.log("[ws] client connected");

  ws.on("message", (raw, isBinary) => {
    if (!isBinary) {
      try {
        const text =
          raw instanceof Buffer
            ? raw.toString("utf8")
            : Buffer.from(raw as ArrayBuffer).toString("utf8");
        const msg = JSON.parse(text);
        if (isControlMessage(msg)) {
          session.host = msg.host;
          session.port = msg.port ?? DDP_PORT;
          session.loggedFirstPacket = false;
          console.log(`[ws] target -> ${session.host}:${session.port}`);
        }
      } catch (err) {
        console.warn("[ws] bad control message", err);
      }
      return;
    }

    if (!session.host) {
      session.framesDropped++;
      return;
    }
    const payload =
      raw instanceof Buffer ? raw : Buffer.from(raw as ArrayBuffer);
    const pkt = encodeDdp(payload, session.seq);
    session.seq = (session.seq % 15) + 1;
    udp.send(pkt, 0, pkt.length, session.port, session.host, (err) => {
      if (err) {
        console.error(
          `[udp] send error to ${session.host}:${session.port} — ${err.message}`,
        );
        return;
      }
      session.framesForwarded++;
      if (!session.loggedFirstPacket) {
        session.loggedFirstPacket = true;
        console.log(
          `[udp] first packet sent to ${session.host}:${session.port} (${pkt.length} bytes, ${payload.length / 3} LEDs)`,
        );
      }
      // Periodic throughput line every 2 s.
      const now = Date.now();
      if (now - session.lastLog > 2000) {
        console.log(
          `[udp] ${session.framesForwarded} frames forwarded, ${session.framesDropped} dropped`,
        );
        session.lastLog = now;
      }
    });
  });

  ws.on("close", () => {
    console.log("[ws] client disconnected");
  });

  ws.on("error", (err) => {
    console.error("[ws] error", err);
  });
});

wss.on("listening", () => {
  console.log(`[ws] relay listening on ws://localhost:${WS_PORT}`);
});

const shutdown = () => {
  console.log("[relay] shutting down");
  wss.close();
  udp.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
