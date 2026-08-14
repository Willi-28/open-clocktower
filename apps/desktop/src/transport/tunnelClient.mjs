/**
 * Tunnel client (joining player side).
 *
 * Runs a local TCP listener. Every connection the Electron window makes to it
 * (all HTTP requests and the room WebSocket) is forwarded over the channel to
 * the host, whose backend answers. The frontend is simply pointed at
 * http://127.0.0.1:<localPort> and behaves exactly as against a normal server.
 */

import net from 'node:net';

import { OP_OPEN, OP_DATA, OP_CLOSE, encodeFrame, decodeFrame, sendData } from './framing.mjs';

/**
 * @param {object}  opts
 * @param {{send:Function,onMessage:Function,onPeerLeft?:Function}} opts.channel
 * @param {string}  opts.hostPeerId  peer id of the host on the channel
 * @param {number}  opts.localPort   0 = pick a free port
 * @param {string} [opts.host]       bind address (default 127.0.0.1)
 * @returns {Promise<{port:number, close:Function}>}
 */
export function startTunnelClient({ channel, hostPeerId, localPort, host = '127.0.0.1' }) {
  const sockets = new Map(); // connId -> net.Socket
  let nextConnId = 1;

  channel.onMessage((_peerId, buffer) => {
    const { op, connId, payload } = decodeFrame(buffer);
    const socket = sockets.get(connId);
    if (!socket) {
      return;
    }
    if (op === OP_DATA) {
      socket.write(payload);
    } else if (op === OP_CLOSE) {
      sockets.delete(connId);
      socket.end();
    }
  });

  const server = net.createServer((socket) => {
    const connId = nextConnId++;
    sockets.set(connId, socket);
    channel.send(hostPeerId, encodeFrame(OP_OPEN, connId));
    socket.on('data', (chunk) => sendData(channel.send.bind(channel), hostPeerId, connId, chunk));
    socket.on('close', () => {
      if (sockets.delete(connId)) {
        channel.send(hostPeerId, encodeFrame(OP_CLOSE, connId));
      }
    });
    socket.on('error', () => {});
  });

  return new Promise((resolve) => {
    server.listen(localPort, host, () => {
      resolve({
        port: server.address().port,
        close: () => {
          for (const socket of sockets.values()) {
            socket.destroy();
          }
          sockets.clear();
          server.close();
        },
      });
    });
  });
}
