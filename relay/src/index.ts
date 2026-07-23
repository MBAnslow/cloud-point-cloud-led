import { createSocket } from "node:dgram";
import { WebSocketServer, type WebSocket } from "ws";

const WS_PORT = Number(process.env.WS_PORT ?? 7890);
const OSC_PORT = Number(process.env.OSC_PORT ?? 999);
const DDP_PORT = 4048;

const udp = createSocket("udp4");
udp.on("error", (err) => {
  console.error("[udp] error", err);
});

/** Inbound OSC from TouchDesigner (breath channels). */
const oscUdp = createSocket("udp4");
oscUdp.on("error", (err) => {
  console.error("[osc] udp error", err);
});

const wss = new WebSocketServer({ port: WS_PORT });
const clients = new Set<WebSocket>();

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

/** Read a null-terminated OSC string, advancing offset to next 4-byte boundary. */
function readOscString(buf: Buffer, offset: number): { value: string; next: number } {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  const value = buf.subarray(offset, end).toString("utf8");
  // Include the null, then pad to 4 bytes.
  const rawLen = end - offset + 1;
  const padded = Math.ceil(rawLen / 4) * 4;
  return { value, next: offset + padded };
}

/**
 * Minimal OSC message decode: address + type tags + first numeric arg.
 * Enough for TouchDesigner float/int breath channels.
 */
function parseOscMessage(
  buf: Buffer,
  offset = 0,
): { address: string; value: number } | null {
  if (buf.length - offset < 8) return null;
  try {
    const addr = readOscString(buf, offset);
    if (!addr.value || addr.value.startsWith("#")) return null;
    const types = readOscString(buf, addr.next);
    if (!types.value.startsWith(",")) return null;
    let argOffset = types.next;
    // Prefer first numeric tag (skip T/F/N/I and leading unknowns).
    for (let ti = 1; ti < types.value.length; ti++) {
      const tag = types.value[ti];
      if (tag === "f" && argOffset + 4 <= buf.length) {
        return { address: addr.value, value: buf.readFloatBE(argOffset) };
      }
      if (tag === "i" && argOffset + 4 <= buf.length) {
        return { address: addr.value, value: buf.readInt32BE(argOffset) };
      }
      if (tag === "d" && argOffset + 8 <= buf.length) {
        return { address: addr.value, value: buf.readDoubleBE(argOffset) };
      }
      if (tag === "h" && argOffset + 8 <= buf.length) {
        // 64-bit int — coerce via Number (fine for -1/0/1).
        const hi = buf.readInt32BE(argOffset);
        const lo = buf.readUInt32BE(argOffset + 4);
        return { address: addr.value, value: hi * 0x1_0000_0000 + lo };
      }
      if (tag === "T") return { address: addr.value, value: 1 };
      if (tag === "F" || tag === "N") return { address: addr.value, value: 0 };
      // Advance past known fixed-size / string args we skip.
      if (tag === "s" || tag === "S" || tag === "b") {
        const s = readOscString(buf, argOffset);
        argOffset = s.next;
        continue;
      }
      if (tag === "t" || tag === "d" || tag === "h") {
        argOffset += 8;
        continue;
      }
      if (tag === "c" || tag === "r" || tag === "i" || tag === "f" || tag === "m") {
        argOffset += 4;
        continue;
      }
      // Unknown tag — stop.
      break;
    }
    return null;
  } catch {
    return null;
  }
}

/** Unpack a single OSC message or `#bundle` into flat messages. */
function unpackOsc(buf: Buffer, out: { address: string; value: number }[]): void {
  if (buf.length < 8) return;
  if (buf.toString("utf8", 0, 8) === "#bundle\0") {
    let offset = 16; // "#bundle\0" + 8-byte timetag
    while (offset + 4 <= buf.length) {
      const size = buf.readInt32BE(offset);
      offset += 4;
      if (size < 0 || offset + size > buf.length) break;
      unpackOsc(buf.subarray(offset, offset + size), out);
      offset += size;
    }
    return;
  }
  const parsed = parseOscMessage(buf);
  if (parsed) out.push(parsed);
}

const BREATH_RE =
  /^\/?breath[_\s-]?(\d+)\/(breath[_\s-]?)?(binary|thresholded)$/i;
/** Single-channel forms TouchDesigner often emits from a CHOP named breath_binary. */
const BREATH_FLAT_RE = /^\/?breath[_\s-]?(binary|thresholded)$/i;

const oscStats = {
  packets: 0,
  messages: 0,
  matched: 0,
  lastAddress: "" as string,
  lastValue: 0,
  lastMatched: false,
  lastAtMs: 0,
};

const uniqueAddresses = new Map<string, number>();

function broadcastJson(payload: object) {
  const text = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(text);
      } catch {
        // drop
      }
    }
  }
}

function broadcastOscBreath(channel: number, key: "binary" | "thresholded", value: number) {
  broadcastJson({
    type: "oscBreath",
    channel,
    key,
    value,
  });
}

function statusPayload() {
  return {
    type: "oscStatus" as const,
    packets: oscStats.packets,
    messages: oscStats.messages,
    matched: oscStats.matched,
    lastAddress: oscStats.lastAddress,
    lastValue: oscStats.lastValue,
    lastMatched: oscStats.lastMatched,
    lastAtMs: oscStats.lastAtMs,
    addresses: [...uniqueAddresses.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([address, count]) => ({ address, count })),
  };
}

function resolveBreathAddress(
  address: string,
): { channel: number; key: "binary" | "thresholded" } | null {
  const m = address.match(BREATH_RE);
  if (m) {
    const channel = Number(m[1]);
    if (!Number.isFinite(channel) || channel < 1) return null;
    const key = m[3].toLowerCase().startsWith("binary")
      ? "binary"
      : "thresholded";
    return { channel, key };
  }
  const flat = address.match(BREATH_FLAT_RE);
  if (flat) {
    // No breath index in path → participant 1.
    const key = flat[1].toLowerCase().startsWith("binary")
      ? "binary"
      : "thresholded";
    return { channel: 1, key };
  }
  return null;
}

const lastForwarded = new Map<string, number>(); // `${channel}:${key}` → value
let lastStatusBroadcastAt = 0;
const STATUS_MIN_INTERVAL_MS = 100;

oscUdp.on("message", (msg) => {
  oscStats.packets++;
  const parsedList: { address: string; value: number }[] = [];
  unpackOsc(msg, parsedList);
  if (parsedList.length === 0) {
    if (oscStats.packets <= 5 || oscStats.packets % 500 === 0) {
      const head = msg.subarray(0, Math.min(48, msg.length));
      console.warn(
        `[osc] unparsed packet #${oscStats.packets} (${msg.length}b) head=${JSON.stringify(head.toString("utf8"))}`,
      );
    }
    oscStats.lastAddress = "(unparsed)";
    oscStats.lastMatched = false;
    oscStats.lastAtMs = Date.now();
    maybeBroadcastStatus(true);
    return;
  }

  let forwarded = 0;
  for (const parsed of parsedList) {
    oscStats.messages++;
    oscStats.lastAddress = parsed.address;
    oscStats.lastValue = parsed.value;
    oscStats.lastAtMs = Date.now();
    uniqueAddresses.set(
      parsed.address,
      (uniqueAddresses.get(parsed.address) ?? 0) + 1,
    );

    const resolved = resolveBreathAddress(parsed.address);
    if (!resolved) {
      oscStats.lastMatched = false;
      continue;
    }
    oscStats.matched++;
    oscStats.lastMatched = true;

    // Only forward when the value changes — TD often streams at audio
    // rate; flooding every WS client would stall WLED DDP frames.
    const fwdKey = `${resolved.channel}:${resolved.key}`;
    if (lastForwarded.get(fwdKey) === parsed.value) continue;
    lastForwarded.set(fwdKey, parsed.value);

    if (oscStats.matched <= 5 || oscStats.matched % 200 === 0) {
      console.log(
        `[osc] ${parsed.address} -> ch${resolved.channel} ${resolved.key}=${parsed.value}`,
      );
    }
    broadcastOscBreath(resolved.channel, resolved.key, parsed.value);
    forwarded++;
  }

  maybeBroadcastStatus(forwarded > 0);
});

function maybeBroadcastStatus(force = false) {
  const now = Date.now();
  if (!force && now - lastStatusBroadcastAt < STATUS_MIN_INTERVAL_MS) return;
  lastStatusBroadcastAt = now;
  broadcastJson(statusPayload());
}

interface LoggedSession extends Session {
  framesForwarded: number;
  framesDropped: number;
  loggedFirstPacket: boolean;
  lastLog: number;
}

wss.on("connection", (ws: WebSocket) => {
  clients.add(ws);
  const session: LoggedSession = {
    host: null,
    port: DDP_PORT,
    seq: 1,
    framesForwarded: 0,
    framesDropped: 0,
    loggedFirstPacket: false,
    lastLog: 0,
  };
  console.log(`[ws] client connected (${clients.size} total)`);
  // Snapshot so a newly connected UI sees OSC state without waiting.
  try {
    ws.send(JSON.stringify(statusPayload()));
  } catch {
    // drop
  }

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
          console.log(`[wled] target -> ${session.host}:${session.port}`);
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
    // Outbound DDP to WLED — separate socket from OSC listen (udp ≠ oscUdp).
    udp.send(pkt, 0, pkt.length, session.port, session.host, (err) => {
      if (err) {
        console.error(
          `[wled] udp send error to ${session.host}:${session.port} — ${err.message}`,
        );
        return;
      }
      session.framesForwarded++;
      if (!session.loggedFirstPacket) {
        session.loggedFirstPacket = true;
        console.log(
          `[wled] first DDP packet → ${session.host}:${session.port} (${pkt.length} bytes, ${payload.length / 3} LEDs)`,
        );
      }
      const now = Date.now();
      if (now - session.lastLog > 2000) {
        console.log(
          `[wled] ${session.framesForwarded} frames forwarded, ${session.framesDropped} dropped`,
        );
        session.lastLog = now;
      }
    });
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[ws] client disconnected (${clients.size} total)`);
  });

  ws.on("error", (err) => {
    console.error("[ws] error", err);
  });
});

wss.on("listening", () => {
  console.log(`[ws] relay listening on ws://localhost:${WS_PORT}`);
});

wss.on("error", (err) => {
  console.error("[ws] server error", err);
});

// Dedicated outbound socket for WLED DDP (not bound to OSC_PORT).
udp.bind(0, () => {
  const addr = udp.address();
  console.log(
    `[wled] outbound DDP ready (local udp ${typeof addr === "string" ? addr : addr.port})`,
  );
});

oscUdp.bind(OSC_PORT, () => {
  console.log(`[osc] listening for breath OSC on udp://0.0.0.0:${OSC_PORT}`);
  console.log(
    `[relay] dual-UDP: OSC in :${OSC_PORT} + WLED DDP out :${DDP_PORT} (via ws :${WS_PORT})`,
  );
});

const shutdown = () => {
  console.log("[relay] shutting down");
  wss.close();
  udp.close();
  oscUdp.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
