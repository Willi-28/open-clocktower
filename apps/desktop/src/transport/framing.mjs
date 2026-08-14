/**
 * Tunnel wire framing.
 *
 * The desktop app tunnels the *entire* HTTP + WebSocket byte stream between a
 * joining player and the host's local backend over a `TransportChannel` (Steam
 * networking in production, an in-memory loopback in tests). It is deliberately
 * protocol-agnostic: neither the FastAPI backend nor the React frontend is aware
 * the tunnel exists — they speak plain localhost HTTP/WS.
 *
 * One TCP connection from the browser becomes a stream of frames:
 *   [op:uint8][connId:uint32 BE][payload...]
 * The channel preserves message boundaries and ordering per peer, so a frame is
 * exactly one channel message — no length-prefixed re-framing is needed.
 */

export const OP_OPEN = 1; // a new browser->tunnel connection was opened (client->host)
export const OP_DATA = 2; // stream bytes in either direction
export const OP_CLOSE = 3; // the connection closed on the sender's side

// Steam reliable messages cap near 512 KiB; stay well under so large HTTP bodies
// (e.g. avatar / character-pack uploads) are split across ordered DATA frames.
export const MAX_PAYLOAD = 400 * 1024;

/** Encode one tunnel frame. `payload` is optional for OPEN/CLOSE. */
export function encodeFrame(op, connId, payload) {
  const body = payload ?? Buffer.alloc(0);
  const frame = Buffer.allocUnsafe(5 + body.length);
  frame.writeUInt8(op, 0);
  frame.writeUInt32BE(connId >>> 0, 1);
  if (body.length) {
    Buffer.from(body).copy(frame, 5);
  }
  return frame;
}

/** Decode one tunnel frame. `payload` is a view into the original buffer. */
export function decodeFrame(buffer) {
  const buf = Buffer.from(buffer);
  return { op: buf.readUInt8(0), connId: buf.readUInt32BE(1), payload: buf.subarray(5) };
}

/** Split a chunk into <=MAX_PAYLOAD DATA frames and hand each to `send`. */
export function sendData(send, peerId, connId, chunk) {
  for (let offset = 0; offset < chunk.length; offset += MAX_PAYLOAD) {
    send(peerId, encodeFrame(OP_DATA, connId, chunk.subarray(offset, offset + MAX_PAYLOAD)));
  }
}
